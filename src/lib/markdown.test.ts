import { describe, expect, it } from "vitest";
import { AGENTPROOF_COMMENT_MARKER, reportToGitHubComment } from "./markdown";
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
    expect(comment).toContain("### Review Priority");
    expect(comment).not.toContain("<summary>Agent re-prompt</summary>");
    expect(comment.length).toBeLessThan(5000);
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
});
