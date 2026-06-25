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

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("scope.evidenceRefs is required");
    expect(result.errors.join("\n")).toContain("reviewPriority[0].evidenceRefs is required");
  });

  it("separates full-report validation from summary-only validation", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const shared = decodeSharedReport(encodeReportForShare(report));

    expect(shared.evidenceIndex).toHaveLength(0);
    expect(validateVerificationReport(shared, { mode: "summary" })).toEqual({ valid: true, errors: [] });

    const result = validateVerificationReport(shared, { mode: "full" });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("evidenceIndex must contain evidence items for full reports");
  });

  it("allows strict validation when missing provenance is explained at the item level", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;
    delete report.reviewPriority[0].evidenceRefs;
    report.scope.reasons = ["Scope evidence was unavailable from the imported report source."];
    report.reviewPriority[0].reason = "File-level priority evidence was unavailable from the imported report source.";

    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("does not let a global limitation bypass full-report provenance checks", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;
    delete report.reviewPriority[0].evidenceRefs;
    report.limitations.push("File-level priority evidence was unavailable from the imported report source.");

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("scope.evidenceRefs is required");
    expect(result.errors.join("\n")).toContain("reviewPriority[0].evidenceRefs is required");
  });

  it("rejects semantically overconfident full reports", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.summary.confidence = 1;

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("summary.confidence must be capped");
  });

  it("rejects met test requirements without passing execution evidence", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    report.requirements[2].status = "met";
    report.requirements[2].gaps = [];

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("test requirement cannot be met without passing test execution evidence");
  });

  it("rejects met non-test requirements without passing execution evidence", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    report.requirements[0].status = "met";
    report.requirements[0].gaps = [];
    report.requirements[0].evidenceRefs = report.evidenceIndex.filter((item) => item.kind === "diff").map((item) => item.id).slice(0, 1);

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("cannot be met without passing test, build, or CI execution evidence");
  });

  it("rejects supported execution claims without passing check or log evidence", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    report.claims = [
      {
        id: "claim_1",
        text: "Tested password reset validation",
        evidenceRefs: report.evidenceIndex.filter((item) => item.kind === "test").map((item) => item.id),
        supported: true
      }
    ];

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("execution claim cannot be supported without passing test or CI execution evidence");
  });

  it("rejects passed CI status without passing execution evidence", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    report.testing.ciStatus = "passed";
    report.evidenceIndex.push({
      id: "ev_security_check",
      kind: "check",
      label: "Socket Security: Project Report",
      summary: "Socket Security: Project Report: passed",
      confidence: 0.9
    });

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("testing.ciStatus cannot be passed without passing test, build, or CI execution evidence");
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
