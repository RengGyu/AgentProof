import { describe, expect, it } from "vitest";
import { extractRequirements } from "./extractors";

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
});
