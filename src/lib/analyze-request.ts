import type { AnalyzeRequest, DemoScenarioId } from "./types";

const DEMO_SCENARIOS = new Set<DemoScenarioId>([
  "clean",
  "scope-creep",
  "missing-tests",
  "failed-ci",
  "vague-task"
]);

export function normalizeAnalyzeRequest(raw: unknown): AnalyzeRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Request body must be a JSON object.");
  }

  const value = raw as Record<string, unknown>;
  const inputLimitations: string[] = [];
  const demoScenario = typeof value.demoScenario === "string" && DEMO_SCENARIOS.has(value.demoScenario as DemoScenarioId)
    ? value.demoScenario as DemoScenarioId
    : undefined;

  return Object.fromEntries(Object.entries({
    demoScenario,
    prUrl: cleanString(value.prUrl, 500, "PR URL", inputLimitations),
    githubToken: cleanString(value.githubToken, 500, "GitHub token", inputLimitations),
    taskText: cleanString(value.taskText, 8_000, "Task text", inputLimitations),
    prDescription: cleanString(value.prDescription, 8_000, "PR description", inputLimitations),
    changedFiles: cleanString(value.changedFiles, 12_000, "Changed files", inputLimitations),
    checks: cleanString(value.checks, 8_000, "Checks", inputLimitations),
    logs: cleanString(value.logs, 24_000, "Logs", inputLimitations),
    inputLimitations
  }).filter(([, item]) => item !== undefined)) as AnalyzeRequest;
}

function cleanString(
  value: unknown,
  maxLength: number,
  label: string,
  inputLimitations: string[]
): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length > maxLength) inputLimitations.push(`${label} was truncated to ${maxLength} characters before analysis.`);
  return value.slice(0, maxLength);
}
