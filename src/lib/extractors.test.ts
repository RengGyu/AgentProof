import { describe, expect, it } from "vitest";
import { buildEvidenceIndex, extractRequirements } from "./extractors";

describe("extractRequirements", () => {
  it("ignores GitHub issue template comments and fenced traces", () => {
    const requirements = extractRequirements(
      [
        "IndexError: tuple index out of range in identify_format (io.registry)",
        "<!-- This comments are hidden when you submit the issue,",
        "so you do not need to remove them! -->",
        "<!-- Please be sure to check out our contributing guidelines,",
        "https://github.com/astropy/astropy/blob/main/CONTRIBUTING.md . -->",
        "### Description",
        "Cron tests using identify_format started failing with IndexError.",
        "Citing the maintainer: when `filepath` is a string without a FITS extension, the function executes `isinstance(args[0], ...)`.",
        "### Steps to Reproduce",
        "```",
        "Traceback (most recent call last):",
        "  File \"connect.py\", line 72, in is_fits",
        "IndexError: tuple index out of range",
        "```",
        "### System Details",
        "Python 3.10"
      ].join("\n"),
      ""
    );
    const requirementText = requirements.map((requirement) => requirement.text).join("\n");

    expect(requirementText).toContain("identify_format");
    expect(requirementText).toContain("filepath");
    expect(requirementText).toContain("FITS extension");
    expect(requirementText).not.toMatch(/hidden when|contributing guidelines|Traceback|System Details|Steps to Reproduce/i);
  });

  it("redacts evidence labels and strips URL credentials, query, and hash fragments", () => {
    const evidence = buildEvidenceIndex(
      "Acceptance criteria: keep api_key=sk-abcdefghijklmnopqrstuvwxyz123456 out of reports.",
      "Implemented handling for token=github_pat_abcdefghijklmnopqrstuvwxyz123456.",
      [],
      [
        {
          name: "unit tests: passed token=ghp_abcdefghijklmnopqrstuvwxyz123456",
          status: "unknown",
          summary: "previous run passed with sk-abcdefghijklmnopqrstuvwxyz123456",
          url: "https://user:pass@github.com/acme/repo/actions/runs/1?token=ghp_abcdefghijklmnopqrstuvwxyz123456#step"
        }
      ],
      [
        {
          source: "pasted logs sk-abcdefghijklmnopqrstuvwxyz123456",
          status: "passed",
          text: "Authorization: Bearer abcdefghijklmnopqrstuvwxyz.1234567890\nunit tests passed"
        }
      ]
    );
    const serialized = JSON.stringify(evidence);
    const checkEvidence = evidence.find((item) => item.kind === "check");
    const logEvidence = evidence.find((item) => item.kind === "log");

    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("ghp_");
    expect(serialized).not.toContain("sk-");
    expect(serialized).not.toContain("Bearer abc");
    expect(checkEvidence?.locator).toBe("https://github.com/acme/repo/actions/runs/1");
    expect(checkEvidence?.summary).toMatch(/^Status: unknown\./);
    expect(logEvidence?.summary).toMatch(/^Status: passed\./);
  });
});
