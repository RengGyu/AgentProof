import { describe, expect, it } from "vitest";
import { reportToGitHubComment } from "./markdown";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";

describe("reportToGitHubComment", () => {
  it("creates a concise PR comment with evidence and re-prompt details", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const comment = reportToGitHubComment(report);

    expect(comment).toContain("## AgentProof Evidence Check");
    expect(comment).toContain("**Priority:** HIGH");
    expect(comment).toContain("### Requirement Coverage");
    expect(comment).toContain("### Review Priority");
    expect(comment).toContain("<summary>Agent re-prompt</summary>");
    expect(comment.length).toBeLessThan(5000);
  });
});
