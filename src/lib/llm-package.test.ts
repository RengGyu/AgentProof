import { describe, expect, it } from "vitest";
import { buildLlmVerifierPackage } from "./llm-package";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";

describe("buildLlmVerifierPackage", () => {
  it("packages normalized evidence with the structured schema", () => {
    const input = demoScenarios["scope-creep"];
    const report = generateVerificationReport(input);
    const pkg = buildLlmVerifierPackage(input, report);

    expect(pkg.schema.name).toBe("agentproof_verification_report");
    expect(pkg.input.evidenceIndex).toEqual(report.evidenceIndex);
    expect(pkg.input.deterministicReport.analysisId).toBe(report.analysisId);
    expect(JSON.stringify(pkg.schema.schema.properties.scope)).toContain('"evidenceRefs"');
    expect(JSON.stringify(pkg.schema.schema.properties.reviewPriority)).toContain('"evidenceRefs"');
    expect(JSON.stringify(pkg)).not.toContain("githubToken");
  });
});
