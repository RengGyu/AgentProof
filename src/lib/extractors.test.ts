import { describe, expect, it } from "vitest";
import { buildEvidenceIndex, extractClaims, extractKeywords, extractRequirements } from "./extractors";

describe("extractRequirements", () => {
  it("marks requirements from linked issue text as issue-sourced", () => {
    const requirements = extractRequirements(
      "Linked issue acme/repo#42: Reject expired reset links\n\nAcceptance criteria:\n- Reject expired reset links.\n- Add regression coverage.",
      "Fixes #42",
      "issue"
    );

    expect(requirements[0].source).toBe("issue");
    expect(requirements.map((requirement) => requirement.text).join(" ")).toContain("Reject expired reset links");
  });

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

  it("classifies files under top-level tests directories as test evidence", () => {
    const evidence = buildEvidenceIndex(
      "",
      "",
      [
        {
          path: "tests/validators/invalid_urls.txt",
          status: "modified",
          patch: "+ http://invalid example"
        }
      ],
      [],
      []
    );

    expect(evidence[0]?.kind).toBe("test");
  });

  it("splits dotted and CamelCase API identifiers into matchable keywords", () => {
    expect(extractKeywords("io.fits.FITSDiff should handle variable-length arrays.")).toEqual(
      expect.arrayContaining(["fits", "diff", "variable", "length", "arrays"])
    );
  });

  it("keeps common technical aliases for issue-to-patch matching", () => {
    expect(extractKeywords("NumPy proxy authentication pickling failures")).toEqual(
      expect.arrayContaining(["numpy", "np", "proxy", "authentication", "auth", "pickling", "pickle"])
    );
  });

  it("drops issue-template headings without dropping useful expected behavior", () => {
    const requirements = extractRequirements(
      [
        "[Bug]: Unable to pickle figure with aligned labels",
        "### Bug summary",
        "Unable to pickle figure after calling `align_labels()`.",
        "### Code for reproduction",
        "```python",
        "fig.align_ylabels()",
        "pickle.dumps(fig)",
        "```",
        "### Expected outcome",
        "Pickling successful.",
        "### Additional information",
        "_No response_"
      ].join("\n"),
      ""
    );
    const text = requirements.map((requirement) => requirement.text).join("\n");

    expect(text).toContain("Unable to pickle figure");
    expect(text).toContain("Pickling successful");
    expect(text).not.toMatch(/Bug summary|Code for reproduction|Expected outcome|Additional information|No response/i);
  });

  it("drops REPL prompts from requirement text", () => {
    const requirements = extractRequirements(
      [
        "Latex parsing of fractions yields wrong expression due to missing brackets.",
        "## Reproduce:",
        "```",
        "root@example:/# python3",
        "Python 3.11.0",
        ">>> from sympy.parsing.latex import parse_latex",
        ">>> parse_latex('x')",
        "x",
        "```",
        "Expected is a correctly grouped denominator."
      ].join("\n"),
      ""
    );
    const text = requirements.map((requirement) => requirement.text).join("\n");

    expect(text).toContain("Latex parsing");
    expect(text).toContain("Expected is a correctly grouped denominator");
    expect(text).not.toContain("parse_latex");
    expect(text).not.toContain("python3");
  });

  it("does not extract PR validation commands as requirements when task text is absent", () => {
    const requirements = extractRequirements(
      "",
      [
        "## Summary",
        "Rework report UI around evidence cards.",
        "",
        "## Validation",
        "- corepack pnpm test",
        "- corepack pnpm typecheck",
        "- corepack pnpm build"
      ].join("\n")
    );
    const text = requirements.map((requirement) => requirement.text).join("\n");

    expect(text).toContain("Rework report UI around evidence cards");
    expect(text).not.toMatch(/Validation|corepack|pnpm|typecheck|build/i);
  });

  it("keeps Node runtime requirements while still dropping node command lines", () => {
    const requirements = extractRequirements(
      [
        "Acceptance criteria:",
        "- Node should handle malformed input without crashing.",
        "- node scripts/repro.js"
      ].join("\n"),
      ""
    );
    const text = requirements.map((requirement) => requirement.text).join("\n");

    expect(text).toContain("Node should handle malformed input without crashing");
    expect(text).not.toContain("node scripts/repro.js");
  });
});

describe("extractClaims", () => {
  it("captures product and UX claim verbs used by agent-authored PRs", () => {
    const evidence = buildEvidenceIndex("", "", [
      {
        path: "src/components/ReportView.tsx",
        status: "modified",
        patch: "+ Reframe the workspace around evidence cards and rework the report into sections."
      }
    ], [], []);

    const claims = extractClaims(
      "Reframe the workspace around evidence cards. Rework the report into sections. Align UI and export copy.",
      evidence
    );
    const text = claims.map((claim) => claim.text).join("\n");

    expect(text).toContain("Reframe the workspace around evidence cards");
    expect(text).toContain("Rework the report into sections");
    expect(text).toContain("Align UI");
  });
});
