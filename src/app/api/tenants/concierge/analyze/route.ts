import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { reserveConciergeAnalysis, buildConciergeRequestKey, finishConciergeAnalysis, getConciergeAnalysisStoreStatus } from "@/lib/concierge-analysis-store";
import { authorizeConciergeAccess, conciergeRuntimeDefaults } from "@/lib/concierge-private-beta";
import { verifySameOriginMutationRequest } from "@/lib/csrf";
import { createGitHubInstallationAccessToken } from "@/lib/github-app";
import { buildGitHubPullRequestInput, fetchGitHubPullRequestHead } from "@/lib/github";
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
    tenantId: body.tenantId,
    installationId: body.installationId,
    repositoryId: body.repositoryId,
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
    const token = await createGitHubInstallationAccessToken(body.installationId);
    const prUrl = `https://github.com/${access.repositoryFullName}/pull/${body.pullRequestNumber}`;
    const initialHeadSha = await fetchGitHubPullRequestHead(prUrl, token);
    if (!initialHeadSha) throw new Error("head_unavailable");
    requestKey = buildConciergeRequestKey({
      tenantId: body.tenantId,
      installationId: body.installationId,
      repositoryId: body.repositoryId,
      pullRequestNumber: body.pullRequestNumber,
      headSha: initialHeadSha,
      explicitTaskHash: body.explicitTask ? createHash("sha256").update(body.explicitTask).digest("hex") : undefined
    });
    const reservation = await reserveConciergeAnalysis({
      requestKey,
      tenantId: body.tenantId,
      installationId: body.installationId,
      repositoryId: body.repositoryId
    });
    if (reservation.outcome === "duplicate") return json({ error: "This manual request was already accepted.", code: "duplicate_request" }, 409);
    if (reservation.outcome !== "reserved") return json({ error: "Manual analysis reservation is unavailable.", code: "idempotency_unavailable" }, 503);
    const telemetry = createConciergeSideEffectTelemetry({ caseIdOrHash: requestKey, sourceHeadSha: initialHeadSha });

    const input = await buildGitHubPullRequestInput(prUrl, token, body.explicitTask ?? "", undefined, { expectedHeadSha: initialHeadSha });
    if (!input) throw new Error("evidence_unavailable");
    const report = generateVerificationReport(input);
    const validation = validateVerificationReport(report, { mode: "full", requireSourceProvenance: true });
    if (!validation.valid) throw new Error("report_validation_failed");
    const finalHeadSha = await fetchGitHubPullRequestHead(prUrl, token);
    if (finalHeadSha !== initialHeadSha) throw new Error("head_changed");
    const finalAccess = await authorizeConciergeAccess({
      tenantId: body.tenantId,
      installationId: body.installationId,
      repositoryId: body.repositoryId,
      repositoryFullName: body.repositoryFullName,
      cookieHeader: request.headers.get("cookie")
    });
    if (!finalAccess.authorized) {
      if (!await recordFailureOrBlockDelivery(requestKey, finalAccess.reason)) {
        return json({ error: "Analysis terminal state could not be recorded.", code: "terminal_record_unavailable" }, 503);
      }
      return json({ error: "Concierge analysis was stopped before delivery.", code: finalAccess.reason }, 403);
    }
    const sideEffectTelemetry = telemetry.snapshot();
    if (!validateZeroConciergeSideEffectTelemetry(sideEffectTelemetry, { caseIdOrHash: requestKey, sourceHeadSha: initialHeadSha })) {
      if (!await recordFailureOrBlockDelivery(requestKey, "side_effect_telemetry_invalid")) {
        return json({ error: "Analysis terminal state could not be recorded.", code: "terminal_record_unavailable" }, 503);
      }
      return json({ error: "Concierge side-effect telemetry rejected delivery.", code: "side_effect_telemetry_invalid" }, 503);
    }
    if (!await finishConciergeAnalysis({ requestKey, outcome: "completed", reason: "manual_report_validated" })) {
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

interface Body { tenantId: string; installationId: number; repositoryId: number; repositoryFullName: string; pullRequestNumber: number; requestId: string; explicitTask?: string }
function parseBody(text: string): Body | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const keys = Object.keys(value).sort().join(",");
    if (keys !== "explicitTask,installationId,pullRequestNumber,repositoryFullName,repositoryId,requestId,tenantId" && keys !== "installationId,pullRequestNumber,repositoryFullName,repositoryId,requestId,tenantId") return null;
    if (typeof value.tenantId !== "string" || typeof value.repositoryFullName !== "string" || typeof value.requestId !== "string") return null;
    if (!Number.isSafeInteger(value.installationId) || !Number.isSafeInteger(value.repositoryId) || !Number.isSafeInteger(value.pullRequestNumber)) return null;
    if (!/^[a-f0-9-]{16,64}$/i.test(value.requestId) || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repositoryFullName)) return null;
    if (value.explicitTask !== undefined && (typeof value.explicitTask !== "string" || !value.explicitTask.trim() || value.explicitTask.length > 6000)) return null;
    return value as unknown as Body;
  } catch { return null; }
}

function boundedFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "provider_unavailable";
  if (["head_unavailable", "evidence_unavailable", "report_validation_failed", "head_changed"].includes(message)) return message;
  return "github_evidence_unavailable";
}

async function recordFailureOrBlockDelivery(requestKey: string, reason: string): Promise<boolean> {
  return finishConciergeAnalysis({ requestKey, outcome: "failed", reason });
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
}
