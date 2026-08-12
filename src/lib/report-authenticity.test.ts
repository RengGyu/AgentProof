import { describe, expect, it } from "vitest";
import { createVerifiedAuthenticity, verifyVerifiedAuthenticity } from "./report-authenticity";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";

describe("report authenticity planner compatibility", () => {
  it("keeps legacy signed reports byte-compatible across JSON round trips and omits own undefined planner fields", () => {
    const secret = "test-report-signing-secret-that-is-long-enough";
    const legacy = generateVerificationReport(demoScenarios.clean);
    legacy.authenticity = createVerifiedAuthenticity(legacy, secret);
    const serialized = JSON.stringify(legacy);
    const parsed = JSON.parse(serialized);

    expect(verifyVerifiedAuthenticity(parsed, secret)).toBe(true);
    expect(serialized).not.toContain('"planner"');

    const undefinedPlanner = generateVerificationReport(demoScenarios.clean);
    undefinedPlanner.planner = undefined;
    undefinedPlanner.authenticity = createVerifiedAuthenticity(undefinedPlanner, secret);
    expect(verifyVerifiedAuthenticity(JSON.parse(JSON.stringify(undefinedPlanner)), secret)).toBe(true);
  });

  it("includes neutral planner provenance in the signed canonical payload", () => {
    const secret = "test-report-signing-secret-that-is-long-enough";
    const report = generateVerificationReport(demoScenarios.clean);
    report.planner = {
      version: 1,
      contractVersion: "hybrid_requirement_planner.v1",
      schemaVersion: "agentproof_requirement_span_plan_v1",
      promptVersion: "2026-08-12.v1",
      model: "gpt-5-mini",
      inputHash: "a".repeat(64)
    };
    report.authenticity = createVerifiedAuthenticity(report, secret);
    const originalSignature = report.authenticity.signature;

    expect(verifyVerifiedAuthenticity(report, secret)).toBe(true);
    report.planner.inputHash = "b".repeat(64);
    expect(verifyVerifiedAuthenticity(report, secret)).toBe(false);
    expect(report.authenticity.signature).toBe(originalSignature);
  });
});
