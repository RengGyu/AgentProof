import { NextResponse } from "next/server";
import { demoScenarios } from "@/lib/sample-data";
import { buildPullRequestInput } from "@/lib/github";
import { generateVerificationReport } from "@/lib/verifier";
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
      return NextResponse.json(
        { error: "Request is too large. Paste shorter logs or use a PR URL." },
        { status: 413 }
      );
    }

    const rawBody = await request.json();
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
      return NextResponse.json(
        { error: "Provide a PR URL, demo scenario, or pasted PR evidence before analysis." },
        { status: 400 }
      );
    }

    const input = body.demoScenario
      ? demoScenarios[body.demoScenario]
      : await buildPullRequestInput(body);

    const report = generateVerificationReport(input);

    return NextResponse.json({ report });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";

    return NextResponse.json(
      {
        error: message,
        hint: "Use demo mode, paste PR evidence, or provide a fine-grained GitHub token for private PRs."
      },
      { status: 400 }
    );
  }
}

function normalizeAnalyzeRequest(raw: unknown): AnalyzeRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Request body must be a JSON object.");
  }

  const value = raw as Record<string, unknown>;
  const demoScenario = typeof value.demoScenario === "string" && DEMO_SCENARIOS.has(value.demoScenario as DemoScenarioId)
    ? (value.demoScenario as DemoScenarioId)
    : undefined;

  return {
    demoScenario,
    prUrl: cleanString(value.prUrl, 500),
    githubToken: cleanString(value.githubToken, 500),
    taskText: cleanString(value.taskText, 8_000),
    prDescription: cleanString(value.prDescription, 8_000),
    changedFiles: cleanString(value.changedFiles, 12_000),
    checks: cleanString(value.checks, 8_000),
    logs: cleanString(value.logs, 24_000)
  };
}

function cleanString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return value.slice(0, maxLength);
}
