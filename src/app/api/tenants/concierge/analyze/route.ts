import { NextResponse } from "next/server";
import { reserveConciergeAnalysis, buildConciergeRequestKey, finishConciergeAnalysis, getConciergeAnalysisStoreStatus } from "@/lib/concierge-analysis-store";
import { authorizeConciergeAccess, conciergeRuntimeDefaults } from "@/lib/concierge-private-beta";
import { verifySameOriginMutationRequest } from "@/lib/csrf";
import { createGitHubInstallationAccessToken } from "@/lib/github-app";
import { buildGitHubPullRequestInput, fetchGitHubPullRequestIdentity } from "@/lib/github";
import { validateVerificationReport } from "@/lib/report-validation";
import { createConciergeSideEffectTelemetry, validateZeroConciergeSideEffectTelemetry } from "@/lib/concierge-side-effect-telemetry";
import { generateVerificationReport } from "@/lib/verifier";

const MAX_BODY_BYTES = 12_000;

export async function POST(request: Request) {
  if (!verifySameOriginMutationRequest(request).ok) return json({ error: "Mutation origin could not be verified.", code: "csrf_rejected" }, 403);
  const runtime = conciergeRuntimeDefaults();
  if (!runtime.manualAnalysisEnabled || runtime.globalKillSwitch) return json({ error: "Concierge analysis is unavailable.", code: runtime.globalKillSwitch ? "global_kill_switch" : "concierge_disabled" }, 503);

  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return json({ error: "Request is too large.", code: "invalid_request" }, 413);
  const body = parseBody(text);
  if (!body) return json({ error: "Concierge analysis request is invalid.", code: "invalid_request" }, 400);

  const access = await authorizeConciergeAccess({
    repositoryFullName: body.repositoryFullName,
    cookieHeader: request.headers.get("cookie")
  });
  if (!access.authorized) return json({ error: "Concierge analysis is not authorized.", code: access.reason }, 403);
  const analysisStore = getConciergeAnalysisStoreStatus();
  if (!analysisStore.configured || !analysisStore.durable) {
    return json({ error: "Durable manual-analysis storage is unavailable.", code: "idempotency_unavailable" }, 503);
  }

  let requestKey = "";
  try {
    const token = await createGitHubInstallationAccessToken(access.installationId);
    const prUrl = `https://github.com/${access.repositoryFullName}/pull/${body.pullRequestNumber}`;
    const initialSnapshot = await fetchGitHubPullRequestIdentity(prUrl, token, undefined, "initial");
    if (!initialSnapshot || !matchesRepositorySnapshot(access, initialSnapshot)) {
      return json({ error: "Concierge analysis is not authorized.", code: "repository_identity_mismatch" }, 403);
    }
    const initialHeadSha = initialSnapshot.headSha;
    requestKey = buildConciergeRequestKey({
      tenantId: access.tenantId,
      installationId: access.installationId,
      repositoryId: access.repositoryId,
      pullRequestNumber: body.pullRequestNumber,
      headSha: initialHeadSha
    });
    const reservation = await reserveConciergeAnalysis({
      requestKey,
      tenantId: access.tenantId,
      installationId: access.installationId,
      repositoryId: access.repositoryId
    });
    if (reservation.outcome === "duplicate") return json({ error: "This manual request was already accepted.", code: "duplicate_request" }, 409);
    if (reservation.outcome !== "reserved") return json({ error: "Manual analysis reservation is unavailable.", code: "idempotency_unavailable" }, 503);
    const telemetry = createConciergeSideEffectTelemetry({ caseIdOrHash: requestKey, sourceHeadSha: initialHeadSha });

    const input = await buildGitHubPullRequestInput(prUrl, token, "", undefined, {
      expectedHeadSha: initialHeadSha,
      expectedRepositoryId: access.repositoryId,
      expectedRepositoryFullName: access.repositoryFullName,
      linkedIssuePolicy: "same_repository_only"
    });
    if (!input) throw new Error("evidence_unavailable");
    const report = generateVerificationReport(input);
    const validation = validateVerificationReport(report, { mode: "full", requireSourceProvenance: true });
    if (!validation.valid) throw new Error("report_validation_failed");
    if (report.source.provenance?.headSha !== initialHeadSha) throw new Error("report_provenance_head_mismatch");
    const finalSnapshot = await fetchGitHubPullRequestIdentity(prUrl, token, undefined, "final");
    if (!finalSnapshot || !matchesRepositorySnapshot(access, finalSnapshot)) {
      if (!await recordFailureOrBlockDelivery(requestKey, "repository_identity_mismatch")) {
        return json({ error: "Analysis terminal state could not be recorded.", code: "terminal_record_unavailable" }, 503);
      }
      return json({ error: "Concierge analysis was stopped before delivery.", code: "repository_identity_mismatch" }, 403);
    }
    if (finalSnapshot.headSha !== initialHeadSha) throw new Error("head_changed");
    const finalAccess = await authorizeConciergeAccess({
      repositoryFullName: body.repositoryFullName,
      cookieHeader: request.headers.get("cookie")
    });
    if (!finalAccess.authorized) {
      if (!await recordFailureOrBlockDelivery(requestKey, finalAccess.reason)) {
        return json({ error: "Analysis terminal state could not be recorded.", code: "terminal_record_unavailable" }, 503);
      }
      return json({ error: "Concierge analysis was stopped before delivery.", code: finalAccess.reason }, 403);
    }
    if (!sameAccessScope(access, finalAccess)) {
      const reason = "repository_grant_changed";
      if (!await recordFailureOrBlockDelivery(requestKey, reason)) {
        return json({ error: "Analysis terminal state could not be recorded.", code: "terminal_record_unavailable" }, 503);
      }
      return json({ error: "Concierge analysis was stopped before delivery.", code: reason }, 403);
    }
    const sideEffectTelemetry = telemetry.snapshot();
    if (!validateZeroConciergeSideEffectTelemetry(sideEffectTelemetry, { caseIdOrHash: requestKey, sourceHeadSha: initialHeadSha })) {
      if (!await recordFailureOrBlockDelivery(requestKey, "side_effect_telemetry_invalid")) {
        return json({ error: "Analysis terminal state could not be recorded.", code: "terminal_record_unavailable" }, 503);
      }
      return json({ error: "Concierge side-effect telemetry rejected delivery.", code: "side_effect_telemetry_invalid" }, 503);
    }
    const decisionCardState = report.proofGraph.summary.gapCount === 0 && report.decisionCard?.topGap === null && report.decisionCard?.reprompt === null
      ? "zero_gap"
      : "has_top_gap";
    if (!await finishConciergeAnalysis({ requestKey, outcome: "completed", reason: "manual_report_validated", decisionCardState })) {
      if (!await recordFailureOrBlockDelivery(requestKey, "completion_record_unavailable")) {
        return json({ error: "Analysis terminal state could not be recorded.", code: "terminal_record_unavailable" }, 503);
      }
      return json({ error: "Analysis completion could not be recorded.", code: "completion_record_unavailable" }, 503);
    }
    return json({
      report,
      caseIdOrHash: requestKey,
      capabilities: runtime,
      privacy: "transient-full-report-no-durable-save",
      sideEffects: { llm: false, save: false, share: false, comment: false, slack: false, webhook: false },
      sideEffectTelemetry
    });
  } catch (error) {
    if (requestKey && !await recordFailureOrBlockDelivery(requestKey, boundedFailure(error))) {
      return json({ error: "Analysis terminal state could not be recorded.", code: "terminal_record_unavailable" }, 503);
    }
    return json({ error: "Private PR evidence could not be collected.", code: boundedFailure(error) }, 502);
  }
}

function sameAccessScope(
  initial: Extract<Awaited<ReturnType<typeof authorizeConciergeAccess>>, { authorized: true }>,
  final: Extract<Awaited<ReturnType<typeof authorizeConciergeAccess>>, { authorized: true }>
): boolean {
  return initial.tenantId === final.tenantId
    && initial.memberId === final.memberId
    && initial.installationId === final.installationId
    && initial.repositoryId === final.repositoryId
    && initial.repositoryFullName.toLowerCase() === final.repositoryFullName.toLowerCase();
}

function matchesRepositorySnapshot(
  access: Extract<Awaited<ReturnType<typeof authorizeConciergeAccess>>, { authorized: true }>,
  snapshot: { repositoryId: number; repositoryFullName: string }
): boolean {
  return snapshot.repositoryId === access.repositoryId
    && snapshot.repositoryFullName.toLowerCase() === access.repositoryFullName.toLowerCase();
}

interface Body { repositoryFullName: string; pullRequestNumber: number; requestId: string }
function parseBody(text: string): Body | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const keys = Object.keys(value).sort().join(",");
    if (keys !== "pullRequestNumber,repositoryFullName,requestId") return null;
    if (typeof value.repositoryFullName !== "string" || typeof value.requestId !== "string") return null;
    if (!Number.isSafeInteger(value.pullRequestNumber) || Number(value.pullRequestNumber) <= 0) return null;
    if (!/^[a-f0-9-]{16,64}$/i.test(value.requestId) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repositoryFullName)) return null;
    return value as unknown as Body;
  } catch { return null; }
}

function boundedFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "provider_unavailable";
  if (["head_unavailable", "evidence_unavailable", "report_validation_failed", "report_provenance_head_mismatch", "head_changed"].includes(message)) return message;
  return "github_evidence_unavailable";
}

async function recordFailureOrBlockDelivery(requestKey: string, reason: string): Promise<boolean> {
  return finishConciergeAnalysis({ requestKey, outcome: "failed", reason, decisionCardState: "not_recorded" });
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
