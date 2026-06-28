import { NextResponse } from "next/server";
import { demoScenarios } from "@/lib/sample-data";
import { buildPullRequestInput, parseGitHubPullUrl } from "@/lib/github";
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

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);

    if (contentLength > MAX_BODY_BYTES) {
      return jsonNoStore(
        { error: "Request is too large. Paste shorter logs or use a PR URL." },
        413
      );
    }

    const rawText = await request.text();

    if (utf8ByteLength(rawText) > MAX_BODY_BYTES) {
      return jsonNoStore(
        { error: "Request is too large. Paste shorter logs or use a PR URL." },
        413
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
        400
      );
    }

    if (body.prUrl?.trim() && !parseGitHubPullUrl(body.prUrl)) {
      return jsonNoStore(
        { error: "PR URL must be a GitHub pull request URL, for example https://github.com/org/repo/pull/123." },
        400
      );
    }

    const input = body.demoScenario
      ? demoScenarios[body.demoScenario]
      : await buildPullRequestInput(body);

    const report = generateVerificationReport(input);
    const validation = validateVerificationReport(report, { mode: "full" });

    if (!validation.valid) {
      return jsonNoStore(
        {
          error: "Generated report failed runtime validation.",
          details: validation.errors.map((item) => redactSecrets(item))
        },
        500
      );
    }

    return jsonNoStore({ report });
  } catch (error) {
    const message = redactSecrets(error instanceof Error ? error.message : "Analysis failed");

    return jsonNoStore(
      {
        error: message,
        hint: "Use demo mode, paste PR evidence, or provide a fine-grained GitHub token for private PRs."
      },
      400
    );
  }
}

function jsonNoStore(payload: unknown, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
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
