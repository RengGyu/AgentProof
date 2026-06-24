import { describe, expect, it } from "vitest";
import { validateVerificationReport } from "./report-validation";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";

describe("validateVerificationReport", () => {
  it("accepts a generated deterministic report", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);

    expect(validateVerificationReport(report)).toEqual({ valid: true, errors: [] });
  });

  it("rejects missing evidence references and invalid confidence", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.requirements[0].evidenceRefs = ["ev_missing"];
    report.summary.confidence = 2;

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("ev_missing");
    expect(result.errors.join("\n")).toContain("summary.confidence");
  });
});
