import { PaidBudgetError, withPaidAnalysis } from "@/lib/paid-budget";
import { resolveTenantAuthAccess } from "@/lib/tenant-auth";
import { isPrivateAnalysisGrantCurrent, resolveGitHubAnalysisCredential } from "@/lib/github-analysis-access";
import { readGitHubRepositoryPrivate } from "@/lib/github-repository-visibility";
import { csrfFailureResponse, verifySameOriginMutationRequest } from "@/lib/csrf";
import { resolveNavigationProvider } from "@/lib/gemini-navigation";
import { getReviewNavigationDiagnostics, type ReviewNavigationDiagnostics } from "@/lib/review-intent";
import { NextResponse } from "next/server";
import { demoScenarios } from "@/lib/sample-data";
import { normalizeAnalyzeRequest } from "@/lib/analyze-request";
import {
  buildGitHubPullRequestInput,
  buildPullRequestInput,
  GITHUB_EVIDENCE_TIMING_PHASES,
  GitHubFetchError,
  parseGitHubPullUrl,
  type GitHubEvidenceTimingPhase,
  type GitHubEvidenceTimingSink,
  type GitHubFetchFailureCode
} from "@/lib/github";
import { submitGeneralPrSemanticObservationWithOpenAI } from "@/lib/openai-semantic";
import { resolveRuntimeReportValidation } from "@/lib/report-runtime-validation";
import * as generalPrObservationService from "@/lib/general-pr-observation-service";
import type { RunGeneralPrObservationNowOptionsV2 } from "@/lib/general-pr-observation-service";
import { collectReviewArtifacts, collectOrdinaryDocumentationArtifacts, collectOrdinaryStaticArtifacts, collectOrdinaryScalarArtifacts, collectOrdinaryTypeScriptProject } from "@/lib/github";
import { buildGeneralPrSemanticOperatorDiagnosticsV1 } from "@/lib/general-pr-observation-telemetry";
import { runGeneralPrInformationDiagnosticV1 } from "@/lib/general-pr-information-diagnostic";
import { resolveGeneralPrAssessmentRuntimePolicyV1 } from "@/lib/general-pr-runtime-policy";
import { generateVerificationReportV2FromInput } from "@/lib/verifier";
import { utf8ByteLength } from "@/lib/http";
import { verifyOpsRequest } from "@/lib/ops-auth";
import { redactSecrets } from "@/lib/redact";
import type { AnalyzeRequest, VerificationReportV2 } from "@/lib/types";

const MAX_BODY_BYTES = 80_000;
const ANALYZE_TIMING_PHASES = ["input", "evidence", "report", "validation"] as const;
const OPERATOR_DIAGNOSTIC_HEADER = "x-agentproof-observation-diagnostics";
const OPERATOR_DIAGNOSTIC_VERSION = "semantic-boundary-v1";

type AnalyzeTimingPhase = (typeof ANALYZE_TIMING_PHASES)[number];
type AnalyzeTimingDurations = Partial<Record<AnalyzeTimingPhase, number>>;
type GitHubEvidenceTimingDurations = Partial<Record<GitHubEvidenceTimingPhase, number>>;

interface AnalyzeTiming {
  start: (phase: AnalyzeTimingPhase) => void;
  serverTiming: () => string;
}

interface GitHubEvidenceTiming extends GitHubEvidenceTimingSink {
  header: () => string | null;
}

export async function POST(request: Request) {
  const timing = createAnalyzeTiming();
  const evidenceTiming = createGitHubEvidenceTiming();
  const operatorDiagnosticsRequested = request.headers.get(OPERATOR_DIAGNOSTIC_HEADER) === OPERATOR_DIAGNOSTIC_VERSION;

  try {
    if (operatorDiagnosticsRequested) {
      const auth = verifyOpsRequest(request);
      if (!auth.ok) return auth.response;
    }

    const contentLength = Number(request.headers.get("content-length") ?? 0);

    if (contentLength > MAX_BODY_BYTES) {
      return jsonNoStore(
        { error: "Request is too large. Paste shorter logs or use a PR URL." },
        413,
        timing
      );
    }

    const rawText = await request.text();

    if (utf8ByteLength(rawText) > MAX_BODY_BYTES) {
      return jsonNoStore(
        { error: "Request is too large. Paste shorter logs or use a PR URL." },
        413,
        timing
      );
    }

    const rawBody = parseJsonBody(rawText);
    const body = normalizeAnalyzeRequest(rawBody);

    if (
      !body.demoScenario &&
      !body.prUrl?.trim() &&
      !body.taskText?.trim() &&
      !body.prDescription?.trim() &&
      !body.changedFiles?.trim() &&
      !body.checks?.trim() &&
      !body.logs?.trim()
    ) {
      return jsonNoStore(
        { error: "Provide a PR URL, demo scenario, or pasted PR evidence before generating a verification report." },
        400,
        timing
      );
    }

    if (body.prUrl?.trim() && !parseGitHubPullUrl(body.prUrl)) {
      return jsonNoStore(
        { error: "PR URL must be a GitHub pull request URL, for example https://github.com/org/repo/pull/123." },
        400,
        timing
      );
    }

    const policy = resolveGeneralPrAssessmentRuntimePolicyV1(
      process.env.AGENTPROOF_GENERAL_PR_OBSERVATION_MODE
    );
    const publicPrUrl = body.demoScenario ? undefined : body.prUrl?.trim();
    const observerApiKey = process.env.OPENAI_API_KEY?.trim();
    const observerModel = process.env.OPENAI_MODEL?.trim();
    const navigationProvider = resolveNavigationProvider(process.env);
    // Guard every live PR read. The durable login and transient GitHub token expire independently.
    let githubCredential: string | undefined;
    let privateGrant: { tenantId: string; repositoryFullName: string; installationId: number; repositoryId: number } | undefined;
    if (publicPrUrl) {
      let access;
      try {
        access = await resolveTenantAuthAccess({ cookieHeader: request.headers.get("cookie") });
      } catch {
        return jsonNoStore({ error: "Sign-in verification is temporarily unavailable. Please retry.", code: "github_session_unavailable" }, 503, timing);
      }
      if (!access.authorized) {
        return jsonNoStore({ error: "Sign in with GitHub to analyze a PR URL.", code: "github_login_required", hint: "After signing in, return to analysis and enter your PR URL. Demos and pasted evidence are available without signing in." }, 401, timing);
      }
      if (!verifySameOriginMutationRequest(request).ok) return csrfFailureResponse();
      const credential = await resolveGitHubAnalysisCredential({
        prUrl: publicPrUrl,
        tenantId: access.tenantId!,
        memberId: access.memberId!,
        cookieHeader: request.headers.get("cookie")
      });
      if (!credential.ok) return jsonNoStore({ error: credential.error, code: credential.code, hint: credential.hint }, credential.status, timing);
      githubCredential = credential.token;
      if (credential.kind === "installation" && credential.privateAnalysisApproved && credential.installationId && credential.repositoryId) {
        const parsed = parseGitHubPullUrl(publicPrUrl);
        if (parsed) privateGrant = { tenantId: access.tenantId!, repositoryFullName: `${parsed.owner}/${parsed.repo}`, installationId: credential.installationId, repositoryId: credential.repositoryId };
      }
    }

    timing.start("evidence");
    const input = body.demoScenario
      ? demoScenarios[body.demoScenario]
      : await buildPullRequestInput(publicPrUrl ? { ...body, githubToken: githubCredential } : { ...body, githubToken: undefined }, evidenceTiming);
    if (publicPrUrl && input.repositoryPrivate === true && !privateGrant) {
      return jsonNoStore({ error: "Private repository analysis is off until its code-analysis notice is accepted.", code: "github_private_consent_required", hint: "Open repository settings and turn on AgentProof analysis." }, 409, timing);
    }

    timing.start("report");
    const semanticEligible = policy.semanticObservation === "eligible_public_pr" &&
      generalPrObservationService.isGeneralPrSemanticObserverEligibleV2(input) &&
      Boolean(publicPrUrl && observerApiKey && observerModel);
    const navigationEligible = policy.semanticObservation === "eligible_public_pr" &&
      (generalPrObservationService.isGeneralPrSemanticObserverEligibleV2(input) || Boolean(privateGrant && input.repositoryPrivate === true && input.sourceProvenance?.origin === "github_snapshot" && (input.taskText.trim() === "" || input.taskSource === "issue")));
    const navigationDiagnostics: ReviewNavigationDiagnostics[] = [];
    const observationOptions: RunGeneralPrObservationNowOptionsV2 = {
      policy,
      input,
      navigation: {
        model: navigationProvider.model,
        ...(operatorDiagnosticsRequested && input.repositoryPrivate === false ? {
          onDiagnostics: (event: ReviewNavigationDiagnostics) => navigationDiagnostics.push(event)
        } : {}),
        ...(navigationEligible && publicPrUrl && navigationProvider.provider ? {
          provider: navigationProvider.provider,
          ...(privateGrant && input.repositoryPrivate === true ? { authorizePrivate: () => isPrivateAnalysisGrantCurrent(privateGrant!) } : {}),
          readRepositoryPrivate: () => {
            const parsed = parseGitHubPullUrl(publicPrUrl);
            return parsed ? readGitHubRepositoryPrivate(`${parsed.owner}/${parsed.repo}`, githubCredential ?? "") : Promise.resolve(null);
          },
          readArtifacts: (paths, headSha) => collectReviewArtifacts(publicPrUrl, githubCredential, paths, headSha),
          readCurrentInput: () => buildGitHubPullRequestInput(publicPrUrl, githubCredential, "", undefined, {expectedHeadSha:input.sourceProvenance?.headSha,expectedBaseSha:input.sourceProvenance?.baseSha})
        } : {})
      },
      ...(publicPrUrl && input.repositoryPrivate === false ? { collectDocumentationArtifacts: (paths: string[], headSha: string) => collectOrdinaryDocumentationArtifacts(publicPrUrl, githubCredential, paths, headSha) } : {}),
      ...(publicPrUrl && input.repositoryPrivate === false ? { collectStaticArtifacts: (paths: string[], headSha: string) => collectOrdinaryStaticArtifacts(publicPrUrl, githubCredential, paths, headSha) } : {}),
      ...(publicPrUrl && input.repositoryPrivate === false ? { collectScalarArtifacts: (paths: string[], headSha: string) => collectOrdinaryScalarArtifacts(publicPrUrl, githubCredential, paths, headSha) } : {}),
      ...(publicPrUrl && input.repositoryPrivate === false ? { collectTypeScriptProject: (headSha: string) => collectOrdinaryTypeScriptProject(publicPrUrl, githubCredential, headSha) } : {}),
      generateReport: generateVerificationReportV2FromInput,
      // The existing runtime gate remains the final authority below. This
      // preflight merely prevents shadow collection for an invalid report.
      validateDeterministicReport: (candidateInput, candidateReport) =>
        resolveRuntimeReportValidation({
          boundary: "generated_private_full",
          input: candidateInput,
          report: candidateReport,
          requireV2: true
        }).valid,
      ...(semanticEligible && publicPrUrl && observerApiKey && observerModel ? {
        semantic: {
          provider: {
            observe: (semanticPackage) => submitGeneralPrSemanticObservationWithOpenAI(semanticPackage, {
              apiKey: observerApiKey
            })
          },
          providerAvailable: true,
          privateRepository: false,
          readCurrentInput: () => buildGitHubPullRequestInput(publicPrUrl, githubCredential, "", undefined, {
            expectedHeadSha: input.sourceProvenance?.headSha,
            expectedBaseSha: input.sourceProvenance?.baseSha
          }),
          modelProfile: {
            model: observerModel,
            promptVersion: "general-pr-observer.v4",
            inputFieldPolicyVersion: "general-pr-observer-fields.v1"
          }
        }
      } : {})
    };
    const { diagnosticRun, observed } = await withPaidAnalysis(
      `public:${request.headers.get("cookie") ?? ""}:${request.headers.get("x-agentproof-analysis-key") ?? rawText}`,
      async () => {
        const diagnosticRun = operatorDiagnosticsRequested ? await runGeneralPrInformationDiagnosticV1(observationOptions) : null;
        const observed = diagnosticRun?.result ?? await generalPrObservationService.runGeneralPrObservationNowV2(observationOptions);
        return { diagnosticRun, observed };
      }
    );
    const report = observed.report;

    timing.start("validation");
    const validation = resolveRuntimeReportValidation({
      boundary: "generated_private_full",
      input,
      report,
      requireV2: true
    });

    if (!validation.valid) {
      return jsonNoStore(
        {
          error: "Generated report failed runtime validation.",
          details: validation.errors.map((item) => redactSecrets(item))
        },
        500,
        timing
      );
    }

    // Closed, text-free production breadcrumb for a failed reviewer path.
    // Never log the request, report, repository, model output, or credentials.
    const navigation = (validation.report as VerificationReportV2).reviewCandidates?.navigation;
    if (publicPrUrl && input.repositoryPrivate === false && navigationEligible && !navigation?.goals.length) {
      const failure = navigation?.failures?.[0];
      const initialFreshness = navigation && getReviewNavigationDiagnostics(navigation)
        .flatMap((trace) => trace.lifecycle ?? [])
        .find((event) => event.kind === "freshness" && event.phase === "initial");
      const selected = process.env.AGENTPROOF_NAVIGATION_PROVIDER?.trim().toLowerCase();
      const provider = selected === "openai" || (!process.env.GEMINI_API_KEY && !process.env.AI_GATEWAY_API_KEY && navigationProvider.provider)
        ? "openai" : navigationProvider.provider ? "gemini" : "none";
      console.warn("agentproof_navigation_unavailable", {
        provider,
        state: navigation?.state ?? "absent",
        stage: failure?.stage ?? "none",
        reason: failure?.reason ?? "none",
        category: failure?.category ?? "none",
        collectorOutcome: initialFreshness?.kind === "freshness" ? initialFreshness.outcome : "none",
        collectorCode: initialFreshness?.kind === "freshness" ? initialFreshness.code ?? "none" : "none",
        limitations: navigation?.limitations.filter((code) => [
          "private_or_unknown_access", "semantic_unavailable", "stale_snapshot",
          "freshness_access_changed", "freshness_context_changed", "freshness_unavailable",
          "no_interpreted_goal"
        ].includes(code)).slice(0, 4) ?? [],
        freshness: navigation?.limitations.includes("freshness_access_changed") ? "access_changed" :
          navigation?.limitations.includes("freshness_source_changed") ? "source_changed" : "none"
      });
    }

    return jsonNoStore({
      report: validation.report,
      ...(operatorDiagnosticsRequested ? {
        operatorDiagnostics: buildGeneralPrSemanticOperatorDiagnosticsV1(observed.bundle),
        ...(input.repositoryPrivate === false ? { operatorNavigationDiagnostics: navigationDiagnostics } : {}),
        operatorTargetDiagnostics: diagnosticRun?.diagnostic
      } : {})
    }, 200, timing, evidenceTiming);
  } catch (error) {
    if (error instanceof PaidBudgetError) return jsonNoStore({error:error.message,code:error.code}, error.code === "soft_stop" || error.code === "duplicate" ? 429 : 503, timing);
    const message = redactSecrets(error instanceof Error ? error.message : "Analysis failed");
    const guidance = analyzeFailureGuidance(error);

    return jsonNoStore(
      {
        error: message,
        hint: guidance.hint,
        guidance: guidance.actions,
        category: guidance.category
      },
      400,
      timing
    );
  }
}

function analyzeFailureGuidance(error: unknown): {
  category: "github_access" | "github_rate_limit" | "github_unavailable" | "input";
  hint: string;
  actions: string[];
} {
  if (error instanceof GitHubFetchError) {
    const category = githubFailureCategory(error.code);
    const actions = githubFailureActions(error.code, error.tokenProvided);

    return {
      category,
      hint: actions[0] ?? "Paste PR evidence manually if live GitHub evidence is unavailable.",
      actions
    };
  }

  return {
    category: "input",
    hint: "Use demo mode or paste PR evidence if the live GitHub request is unavailable.",
    actions: [
      "Check that the PR URL is reachable.",
      "Paste PR description, changed files, checks, or logs if GitHub cannot be reached."
    ]
  };
}

function githubFailureCategory(code: GitHubFetchFailureCode): "github_access" | "github_rate_limit" | "github_unavailable" {
  if (code === "github_rate_limited" || code === "github_secondary_rate_limited") {
    return "github_rate_limit";
  }

  if (code === "github_fetch_failed") {
    return "github_unavailable";
  }

  return "github_access";
}

function githubFailureActions(code: GitHubFetchFailureCode, _tokenProvided: boolean): string[] {
  switch (code) {
    case "github_auth_required":
      return [
        "Sign in with GitHub again, or reconnect the GitHub App installation.",
        "Paste PR evidence manually if live access is unavailable."
      ];
    case "github_token_rejected":
      return [
        "Sign in with GitHub again, or reconnect the GitHub App installation.",
        "Retry after GitHub access is restored."
      ];
    case "github_permission_denied":
      return ["Check the repository's GitHub App connection or your GitHub authorization.", "Paste PR evidence manually if live access is unavailable."];
    case "github_not_found":
      return ["Check that the PR URL is correct and visible to the selected GitHub access.", "Connect your own private repository through the GitHub App."];
    case "github_rate_limited":
      return [
        "Wait for the GitHub API rate limit to reset, then retry.",
        "Paste PR evidence manually if you need a report immediately."
      ];
    case "github_secondary_rate_limited":
      return [
        "Wait briefly before retrying; GitHub secondary rate limiting is temporary.",
        "Paste PR evidence manually if you need a report immediately."
      ];
    case "github_fetch_failed":
      return [
        "Retry the PR URL after GitHub or network access is available.",
        "Paste PR evidence manually to generate a report without live GitHub fetches."
      ];
  }
}

function jsonNoStore(
  payload: unknown,
  status = 200,
  timing?: AnalyzeTiming,
  evidenceTiming?: GitHubEvidenceTiming
) {
  const headers: Record<string, string> = {
    "Cache-Control": "private, no-store",
    "Referrer-Policy": "no-referrer"
  };

  if (timing) {
    const serverTiming = timing.serverTiming();
    headers["Server-Timing"] = serverTiming;
    headers["X-AgentProof-Timing"] = serverTiming;
  }

  const evidenceTimingHeader = evidenceTiming?.header();
  if (evidenceTimingHeader) {
    headers["X-AgentProof-Evidence-Timing"] = evidenceTimingHeader;
  }

  return NextResponse.json(payload, {
    status,
    headers
  });
}

function createGitHubEvidenceTiming(): GitHubEvidenceTiming {
  const durations: GitHubEvidenceTimingDurations = {};

  return {
    record(phase, durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) {
        return;
      }

      durations[phase] = (durations[phase] ?? 0) + durationMs;
    },
    header() {
      const entries = GITHUB_EVIDENCE_TIMING_PHASES
        .filter((phase) => typeof durations[phase] === "number")
        .map((phase) => `ap_${phase};dur=${formatDurationMs(durations[phase] ?? 0)}`);

      return entries.length > 0 ? entries.join(", ") : null;
    }
  };
}

function createAnalyzeTiming(): AnalyzeTiming {
  const startedAt = nowMs();
  const durations: AnalyzeTimingDurations = {};
  let activePhase: AnalyzeTimingPhase | null = "input";
  let activeStartedAt = startedAt;
  let finalized = false;
  let cachedHeader = "";

  const finishActivePhase = () => {
    if (!activePhase) return;

    const elapsed = Math.max(0, nowMs() - activeStartedAt);
    durations[activePhase] = (durations[activePhase] ?? 0) + elapsed;
    activePhase = null;
  };

  return {
    start(phase) {
      if (finalized) return;

      finishActivePhase();
      activePhase = phase;
      activeStartedAt = nowMs();
    },
    serverTiming() {
      if (!finalized) {
        finishActivePhase();
        cachedHeader = formatServerTiming(durations, Math.max(0, nowMs() - startedAt));
        finalized = true;
      }

      return cachedHeader;
    }
  };
}

function formatServerTiming(durations: AnalyzeTimingDurations, totalMs: number): string {
  const entries = ANALYZE_TIMING_PHASES
    .filter((phase) => typeof durations[phase] === "number")
    .map((phase) => `ap_${phase};dur=${formatDurationMs(durations[phase] ?? 0)}`);

  entries.push(`ap_total;dur=${formatDurationMs(totalMs)}`);

  return entries.join(", ");
}

function formatDurationMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }

  return String(Math.round(value));
}

function nowMs(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function parseJsonBody(rawText: string): unknown {
  try {
    return JSON.parse(rawText);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}
