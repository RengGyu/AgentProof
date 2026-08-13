import { describe, expect, it } from "vitest";
import { resolveRuntimeReportValidation } from "./report-runtime-validation";
import { generateVerificationReport } from "./verifier";

const input = {
  title: "Runtime validation fallback",
  description: "",
  taskText: "Add a retry status label.",
  taskSource: "issue" as const,
  changedFiles: [{
    path: "src/retry/status.ts",
    status: "modified" as const,
    patch: "+ export const retryStatus = () => 'ready';"
  }],
  checks: [{ name: "retry status tests", status: "passed" as const, summary: "retry status tests passed." }],
  logs: []
};

describe("resolveRuntimeReportValidation", () => {
  it("falls back to the deterministic report when enhanced planning output is invalid", () => {
    const deterministic = generateVerificationReport(input);
    const enhanced = structuredClone(deterministic);
    enhanced.planner = {
      version: 1,
      contractVersion: "hybrid_requirement_planner.v1",
      schemaVersion: "agentproof_requirement_span_plan_v1",
      promptVersion: "2026-08-12.v1",
      model: "gpt-5-mini"
      // Deliberately no input hash: malformed enhanced output must not fail the analysis.
    } as typeof enhanced.planner;

    const resolved = resolveRuntimeReportValidation({ input, report: enhanced });

    expect(resolved).toMatchObject({ valid: true, usedDeterministicFallback: true });
    if (resolved.valid) expect(resolved.report.planner).toBeUndefined();
  });

  it("does not hide an invalid deterministic report", () => {
    const deterministic = generateVerificationReport(input);
    deterministic.requirements[0]!.status = "met";
    deterministic.requirements[0]!.proofAxes![0]!.state = "incomplete";

    const resolved = resolveRuntimeReportValidation({ input, report: deterministic });

    expect(resolved.valid).toBe(false);
  });
});
