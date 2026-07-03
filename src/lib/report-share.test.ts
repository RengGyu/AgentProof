import { describe, expect, it } from "vitest";
import { buildShareUrl, decodeSharedReport, encodeReportForShare, sanitizeReportForShare, SUMMARY_ONLY_LIMITATION } from "./report-share";
import { validateVerificationReport } from "./report-validation";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";

describe("report share", () => {
  it("round-trips a summary-only report without raw evidence or re-prompt text", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.evidenceIndex.push({
      id: "ev_annotation_secret",
      kind: "check",
      label: "unit tests",
      summary: "Check annotations: failure at src/private/auth.test.ts:42. raw_details annotation message with ghp_secret_should_not_leak",
      confidence: 0.9
    });
    report.claims.push({
      id: "claim_annotation_secret",
      text: "Annotation raw_details retained sk-secret_should_not_leak",
      evidenceRefs: ["ev_annotation_secret"],
      supported: false
    });
    report.reprompt.prompt = "raw_details re-prompt with github_pat_secret_should_not_leak";
    const payload = encodeReportForShare(report);
    const shared = decodeSharedReport(payload);
    const serialized = JSON.stringify(shared);

    expect(shared.source.title).toBe(report.source.title);
    expect(shared.requirements).toHaveLength(report.requirements.length);
    expect(shared.evidenceIndex).toHaveLength(0);
    expect(shared.claims).toHaveLength(0);
    expect(shared.scope.provenance).toBeUndefined();
    expect(shared.testing.missingTests.every((item) => item.provenance === undefined)).toBe(true);
    expect(shared.reprompt.prompt).not.toContain("Explain or revert");
    expect(shared.testing.missingTests.every((item) => item.evidenceRefs.length === 0)).toBe(true);
    expect(shared.reviewPriority.every((item) => !item.evidenceRefs || item.evidenceRefs.length === 0)).toBe(true);
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("raw_details");
    expect(serialized).not.toContain("src/private/auth.test.ts:42");
    expect(serialized).not.toContain("ghp_secret_should_not_leak");
    expect(serialized).not.toContain("sk-secret_should_not_leak");
    expect(serialized).not.toContain("github_pat_secret_should_not_leak");
    expect(serialized).not.toContain("ev_");
    expect(validateVerificationReport(shared, { mode: "summary" })).toEqual({ valid: true, errors: [] });
  });

  it("redacts retained summary fields before sharing", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.source.title = "PR with github_pat_secret_should_not_leak_1234567890";
    report.summary.oneLine = "Summary with sk-secret_should_not_leak";
    report.summary.topRisks = ["Risk includes https://hooks.slack.com/services/T000/B000/secret"];
    report.requirements[0].requirementText = "Requirement has token=secret_should_not_leak";
    report.requirements[0].gaps = ["Gap has Bearer abc.def.ghi"];
    report.requirements[0].reviewerNote = "Note has AKIAABCDEFGHIJKLMNOP";
    report.testing.missingTests.push({ path: "src/test.ts", why: "Needs test", evidenceRefs: [] });
    report.reviewPriority.push({ path: "src/review.ts", reason: "Needs review", priority: "medium" });
    report.testing.missingTests[0].path = "src/github_pat_secret_should_not_leak_1234567890/test.ts";
    report.testing.missingTests[0].why = "Reason has api_key=secret_should_not_leak";
    report.reviewPriority[0].reason = "Review has -----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----";
    report.limitations.push("Limitation has password=secret_should_not_leak");

    const shared = decodeSharedReport(encodeReportForShare(report));
    const serialized = JSON.stringify(shared);

    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("hooks.slack.com/services");
    expect(serialized).not.toContain("Bearer abc");
    expect(serialized).not.toContain("AKIA");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("secret_should_not_leak");
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

  it("does not retain raw linked issue body evidence in share summaries", () => {
    const rawIssueBody = "RAW_LINKED_ISSUE_BODY_SHOULD_NOT_SHARE";
    const report = generateVerificationReport({
      ...demoScenarios.clean,
      taskSource: "issue",
      taskText: [
        "Linked issue acme/repo#42: Reject expired reset links",
        "Acceptance criteria:",
        "- Reject expired reset links.",
        "```text",
        rawIssueBody,
        "```"
      ].join("\n")
    });
    const shared = sanitizeReportForShare(report);
    const serialized = JSON.stringify(shared);

    expect(report.evidenceIndex.some((item) => item.summary.includes(rawIssueBody))).toBe(true);
    expect(serialized).not.toContain(rawIssueBody);
    expect(serialized).not.toContain("Linked issue acme/repo#42");
    expect(shared.evidenceIndex).toEqual([]);
  });
});
