import { NextResponse } from "next/server";
import { demoScenarios } from "@/lib/sample-data";
import {
  buildPullRequestInput,
  GITHUB_EVIDENCE_TIMING_PHASES,
  GitHubFetchError,
  parseGitHubPullUrl,
  type GitHubEvidenceTimingPhase,
  type GitHubEvidenceTimingSink,
  type GitHubFetchFailureCode
} from "@/lib/github";
import { validateVerificationReport } from "@/lib/report-validation";
import { generateVerificationReport } from "@/lib/verifier";
import { utf8ByteLength } from "@/lib/http";
import { redactSecrets } from "@/lib/redact";
import type { AnalyzeRequest, DemoScenarioId } from "@/lib/types";

const MAX_BODY_BYTES = 80_000;
const DEMO_SCENARIOS = new Set<DemoScenarioId>([
  "clean",
  "scope-creep",
  "missing-tests",
  "failed-ci",
  "vague-task"
]);
const ANALYZE_TIMING_PHASES = ["input", "evidence", "report", "validation"] as const;

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

  try {
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

    timing.start("evidence");
    const input = body.demoScenario
      ? demoScenarios[body.demoScenario]
      : await buildPullRequestInput(body, evidenceTiming);

    timing.start("report");
    const report = generateVerificationReport(input);

    timing.start("validation");
    const validation = validateVerificationReport(report, { mode: "full" });

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

    return jsonNoStore({ report }, 200, timing, evidenceTiming);
  } catch (error) {
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
    hint: "Use demo mode, paste PR evidence, or provide a fine-grained GitHub token for private PRs.",
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

function githubFailureActions(code: GitHubFetchFailureCode, tokenProvided: boolean): string[] {
  switch (code) {
    case "github_auth_required":
      return [
        "Provide a fine-grained GitHub token with read access to this repository.",
        "Paste PR evidence manually if you do not want to send a token."
      ];
    case "github_token_rejected":
      return [
        "Create or refresh the fine-grained GitHub token, then try again.",
        "Confirm the token was copied completely and has not expired."
      ];
    case "github_permission_denied":
      return tokenProvided
        ? [
          "Confirm the token has pull request, contents, checks, statuses, and Actions metadata read access for this repository.",
          "If this is a private repo, make sure the token is scoped to the selected repository."
        ]
        : [
          "Provide a fine-grained GitHub token with read access to this repository.",
          "Paste PR evidence manually if you do not want to send a token."
        ];
    case "github_not_found":
      return tokenProvided
        ? [
          "Check that the PR URL is correct and visible to the provided GitHub token.",
          "For private repos, confirm the token is scoped to that repository."
        ]
        : [
          "Check that the PR URL is correct and publicly visible.",
          "For private repos, use a fine-grained token scoped to that repository."
        ];
    case "github_rate_limited":
      return [
        "Wait for the GitHub API rate limit to reset, then retry.",
        "Use a fine-grained token to increase the available request budget."
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

function normalizeAnalyzeRequest(raw: unknown): AnalyzeRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Request body must be a JSON object.");
  }

  const value = raw as Record<string, unknown>;
  const inputLimitations: string[] = [];
  const demoScenario = typeof value.demoScenario === "string" && DEMO_SCENARIOS.has(value.demoScenario as DemoScenarioId)
    ? (value.demoScenario as DemoScenarioId)
    : undefined;

  return {
    demoScenario,
    prUrl: cleanString(value.prUrl, 500, "PR URL", inputLimitations),
    githubToken: cleanString(value.githubToken, 500, "GitHub token", inputLimitations),
    taskText: cleanString(value.taskText, 8_000, "Task text", inputLimitations),
    prDescription: cleanString(value.prDescription, 8_000, "PR description", inputLimitations),
    changedFiles: cleanString(value.changedFiles, 12_000, "Changed files", inputLimitations),
    checks: cleanString(value.checks, 8_000, "Checks", inputLimitations),
    logs: cleanString(value.logs, 24_000, "Logs", inputLimitations),
    inputLimitations
  };
}

function cleanString(
  value: unknown,
  maxLength: number,
  label: string,
  inputLimitations: string[]
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  if (value.length > maxLength) {
    inputLimitations.push(`${label} was truncated to ${maxLength} characters before analysis.`);
  }

  return value.slice(0, maxLength);
}
