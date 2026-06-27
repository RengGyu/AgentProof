import { describe, expect, it } from "vitest";
import { buildShareUrl, decodeSharedReport, encodeReportForShare, sanitizeReportForShare, SUMMARY_ONLY_LIMITATION } from "./report-share";
import { validateVerificationReport } from "./report-validation";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";

describe("report share", () => {
  it("round-trips a summary-only report without raw evidence or re-prompt text", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const payload = encodeReportForShare(report);
    const shared = decodeSharedReport(payload);

    expect(shared.source.title).toBe(report.source.title);
    expect(shared.requirements).toHaveLength(report.requirements.length);
    expect(shared.evidenceIndex).toHaveLength(0);
    expect(shared.claims).toHaveLength(0);
    expect(shared.reprompt.prompt).not.toContain("Explain or revert");
    expect(shared.testing.missingTests.every((item) => item.evidenceRefs.length === 0)).toBe(true);
    expect(shared.reviewPriority.every((item) => !item.evidenceRefs || item.evidenceRefs.length === 0)).toBe(true);
    expect(JSON.stringify(shared)).not.toContain("Patch excerpt");
    expect(JSON.stringify(shared)).not.toContain("ev_");
    expect(validateVerificationReport(shared, { mode: "summary" })).toEqual({ valid: true, errors: [] });
  });

  it("builds a portable share URL", () => {
    const report = generateVerificationReport(demoScenarios["clean"]);
    const url = buildShareUrl(report, "https://agentproof.example");

    expect(url).toContain("https://agentproof.example/reports/share#report=");
  });

  it("does not duplicate the summary-only limitation when re-sharing sanitized reports", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const reshared = sanitizeReportForShare(sanitizeReportForShare(report));
    const summaryOnlyLimitations = reshared.limitations.filter((limitation) => limitation === SUMMARY_ONLY_LIMITATION);

    expect(summaryOnlyLimitations).toHaveLength(1);
  });
});
