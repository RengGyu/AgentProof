import { describe, expect, it } from "vitest";
import { buildShareUrl, decodeSharedReport, encodeReportForShare } from "./report-share";
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
    expect(JSON.stringify(shared)).not.toContain("Patch excerpt");
  });

  it("builds a portable share URL", () => {
    const report = generateVerificationReport(demoScenarios["clean"]);
    const url = buildShareUrl(report, "https://agentproof.example");

    expect(url).toContain("https://agentproof.example/reports/share#report=");
  });
});
