import { describe, expect, it } from "vitest";
import { validateVerificationReport } from "./report-validation";
import { decodeSharedReport, encodeReportForShare } from "./report-share";
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

  it("rejects missing scope and review-priority evidence references", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.scope.evidenceRefs = ["ev_missing_scope"];
    report.reviewPriority[0].evidenceRefs = ["ev_missing_priority"];

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("scope.evidenceRefs cites missing evidence ev_missing_scope");
    expect(result.errors.join("\n")).toContain("reviewPriority[0].evidenceRefs cites missing evidence ev_missing_priority");
  });

  it("keeps default validation backward-compatible for optional provenance", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;
    delete report.reviewPriority[0].evidenceRefs;

    expect(validateVerificationReport(report)).toEqual({ valid: true, errors: [] });
  });

  it("requires full-report provenance when strict mode is enabled", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;
    delete report.reviewPriority[0].evidenceRefs;

    const result = validateVerificationReport(report, { requireFullProvenance: true });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("scope.evidenceRefs is required");
    expect(result.errors.join("\n")).toContain("reviewPriority[0].evidenceRefs is required");
  });

  it("allows strict validation for summary-only reports without an evidence index", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const shared = decodeSharedReport(encodeReportForShare(report));

    expect(shared.evidenceIndex).toHaveLength(0);
    expect(validateVerificationReport(shared, { requireFullProvenance: true })).toEqual({ valid: true, errors: [] });
  });

  it("allows strict validation when a full report explicitly says evidence was unavailable", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;
    delete report.reviewPriority[0].evidenceRefs;
    report.limitations.push("File-level priority evidence was unavailable from the imported report source.");

    expect(validateVerificationReport(report, { requireFullProvenance: true })).toEqual({ valid: true, errors: [] });
  });

  it("rejects missing nested fields and unknown report properties", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    delete (report.summary as Partial<typeof report.summary>).oneLine;
    (report as unknown as Record<string, unknown>).rawDiff = "hidden raw diff";

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("summary.oneLine is required");
    expect(result.errors.join("\n")).toContain("report.rawDiff is not allowed");
  });

  it("rejects non-object array items and invalid enum values", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.requirements = ["not a requirement"] as never;
    report.testing.ciStatus = "green" as never;

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("requirements[0] must be an object");
    expect(result.errors.join("\n")).toContain("testing.ciStatus is invalid");
  });

  it("rejects oversized strings and arrays", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.summary.topRisks = Array.from({ length: 21 }, (_, index) => `risk ${index}`);
    report.evidenceIndex[0].summary = "x".repeat(3001);

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("summary.topRisks must contain at most 20 items");
    expect(result.errors.join("\n")).toContain("evidenceIndex[0].summary must be at most 3000 characters");
  });

  it("rejects malformed nested objects without throwing", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    (report as unknown as Record<string, unknown>).testing = "failed";
    (report as unknown as Record<string, unknown>).reprompt = null;
    (report as unknown as Record<string, unknown>).evidenceIndex = [null];

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("testing must be an object");
    expect(result.errors.join("\n")).toContain("reprompt must be an object");
    expect(result.errors.join("\n")).toContain("evidenceIndex[0] must be an object");
  });
});
