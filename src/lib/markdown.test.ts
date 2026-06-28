import { describe, expect, it } from "vitest";
import { AGENTPROOF_COMMENT_MARKER, reportToGitHubComment, reportToMarkdown } from "./markdown";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";

describe("reportToGitHubComment", () => {
  it("creates a concise PR comment with a marker and no re-prompt by default", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const comment = reportToGitHubComment(report);

    expect(comment).toContain(AGENTPROOF_COMMENT_MARKER);
    expect(comment).toContain("## AgentProof Evidence Check");
    expect(comment).toContain("**Priority:** HIGH");
    expect(comment).toContain("### Requirement Coverage");
    expect(comment).toContain("### Verification Priority");
    expect(comment).not.toContain("<summary>Agent re-prompt</summary>");
    expect(comment.length).toBeLessThan(5000);
  });

  it("renders resolved provenance for report findings", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const markdown = reportToMarkdown(report);
    const comment = reportToGitHubComment(report);

    expect(markdown).toContain("source=diff");
    expect(markdown).toContain("locator=src/features/auth/PasswordResetForm.tsx");
    expect(markdown).toContain("confidence=85%");
    expect(markdown).toContain("text=modified src/features/auth/PasswordResetForm.tsx");
    expect(markdown).toContain("- Test/build:");
    expect(markdown).toContain("src/server/auth/sessionExpiry.ts is risk-sensitive");
    expect(markdown).toContain("Provenance: ev_");
    expect(markdown).toContain("source=changed_file");
    expect(markdown).toContain("locator=src/server/auth/sessionExpiry.ts");
    expect(markdown).toContain("Evidence: ev_");
    expect(comment).toContain("### Scope");
    expect(comment).toContain("**Test/Build:**");
    expect(comment).toContain("Provenance: changed_file `src/server/auth/sessionExpiry.ts`");
    expect(comment).toContain("Evidence: ev_");
    expect(comment).toContain("diff src/features/auth/PasswordResetForm.tsx 85%");
  });

  it("can include the re-prompt when explicitly requested and neutralizes mentions", () => {
    const report = generateVerificationReport({
      ...demoScenarios["scope-creep"],
      taskText: "Acceptance criteria: notify @team about invalid email tests."
    });
    const comment = reportToGitHubComment(report, { includeReprompt: true });

    expect(comment).toContain("<summary>Agent re-prompt</summary>");
    expect(comment).not.toContain("@team");
    expect(comment).toContain("@\u200Bteam");
  });

  it("includes capped evidence limitations in PR comments", () => {
    const report = generateVerificationReport({
      ...demoScenarios.clean,
      limitations: [
        "Live GitHub evidence could not be collected: GitHub API rate limit was reached. Report uses pasted evidence only.",
        "GitHub changed-file evidence was capped at 300 files.",
        "No CI or test logs were available.",
        "Fourth limitation.",
        "Fifth limitation should be omitted."
      ]
    });
    const comment = reportToGitHubComment(report);

    expect(comment).toContain("### Evidence Limits");
    expect(comment).toContain("Live GitHub evidence could not be collected");
    expect(comment).toContain("Fourth limitation.");
    expect(comment).not.toContain("Fifth limitation should be omitted.");
  });

  it("surfaces redacted execution evidence while excluding non-execution gates", () => {
    const report = generateVerificationReport({
      ...demoScenarios.clean,
      checks: [
        {
          name: "unit tests",
          status: "passed",
          summary: "Vitest passed with token=ghp_123456789012345678901234"
        },
        {
          name: "next build",
          status: "failed",
          summary: "Build failed after Authorization: Bearer abcdefghijklmnop"
        },
        {
          name: "Vercel Preview tests",
          status: "passed",
          summary: "Deployment preview is ready after smoke tests"
        },
        {
          name: "security coverage scan",
          status: "failed",
          summary: "SAST found a coverage policy issue"
        }
      ],
      logs: [
        {
          source: "playwright e2e",
          status: "pending",
          text: "Waiting for browser run with sk-testsecret1234"
        }
      ]
    });
    const markdown = reportToMarkdown(report);
    const comment = reportToGitHubComment(report);
    const markdownExecution = sectionBetween(markdown, "## Execution Evidence", "## Verification Priority");
    const commentExecution = sectionBetween(comment, "### Execution Evidence", "### Evidence Limits");

    expect(markdownExecution).toContain("**FAILED**");
    expect(markdownExecution).toContain("**PENDING**");
    expect(markdownExecution).toContain("**PASSED**");
    expect(markdownExecution).toContain("next build");
    expect(markdownExecution).toContain("playwright e2e");
    expect(markdownExecution).toContain("unit tests");
    expect(markdownExecution).not.toContain("Vercel Preview tests");
    expect(markdownExecution).not.toContain("security coverage scan");
    expect(markdownExecution).not.toContain("ghp_123456789012345678901234");
    expect(markdownExecution).not.toContain("Authorization: Bearer abcdefghijklmnop");
    expect(markdownExecution).not.toContain("sk-testsecret1234");

    expect(commentExecution).toContain("**FAILED**");
    expect(commentExecution).toContain("**PENDING**");
    expect(commentExecution).toContain("**PASSED**");
    expect(commentExecution).not.toContain("Vercel Preview tests");
    expect(commentExecution).not.toContain("security coverage scan");
  });

  it("renders failed check locations without raw annotation messages", () => {
    const report = generateVerificationReport({
      ...demoScenarios.clean,
      checks: [
        {
          name: "unit tests",
          status: "failed",
          summary:
            "Vitest failed. Check annotations: failure at src/private/auth.test.ts:42, warning at src/lib/verifier.test.ts:77, failure at src/app/api/analyze/route.test.ts:31. Raw annotation messages and raw annotation details omitted."
        }
      ],
      logs: []
    });
    const markdown = reportToMarkdown(report);
    const comment = reportToGitHubComment(report);
    const markdownExecution = sectionBetween(markdown, "## Execution Evidence", "## Verification Priority");
    const commentExecution = sectionBetween(comment, "### Execution Evidence", "### Evidence Limits");

    expect(markdownExecution).toContain("**FAILED**");
    expect(markdownExecution).toContain("Failure locations:");
    expect(markdownExecution).toContain("failure at src/private/auth.test.ts:42");
    expect(markdownExecution).toContain("warning at src/lib/verifier.test.ts:77");
    expect(markdownExecution).not.toContain("Raw annotation messages");
    expect(markdownExecution).not.toContain("raw_details");

    expect(commentExecution).toContain("**FAILED**");
    expect(commentExecution).toContain("Failure locations:");
    expect(commentExecution).toContain("`src/private/auth.test.ts:42`");
    expect(commentExecution).toContain("+1 more");
    expect(commentExecution).not.toContain("Raw annotation messages");
    expect(commentExecution).not.toContain("raw_details");
  });
});

function sectionBetween(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);

  const endIndex = value.indexOf(end, startIndex + start.length);

  return endIndex === -1 ? value.slice(startIndex) : value.slice(startIndex, endIndex);
}
