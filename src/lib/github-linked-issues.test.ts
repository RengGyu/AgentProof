import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractSupportedIssueReferences, formatIssueReference } from "./github-linked-issues";

type LinkedIssueReferenceMatrix = {
  schemaVersion: "linked-issue-reference-matrix.v1";
  privacy: "synthetic-linked-issue-reference-matrix-no-private-data";
  status: "synthetic_regression_fixture";
  cases: Array<{
    id: string;
    repository: { owner: string; repo: string };
    inputText: string;
    expectedRefs: string[];
    totalSupportedReferences: number;
    capped: boolean;
  }>;
};

const linkedIssueFixture = JSON.parse(
  readFileSync(new URL("../../eval/fixtures/linked-issue-reference-matrix.json", import.meta.url), "utf8")
) as LinkedIssueReferenceMatrix;

describe("GitHub linked issue references", () => {
  it("keeps linked issue fixture bounded and complete", () => {
    expect(linkedIssueFixture.schemaVersion).toBe("linked-issue-reference-matrix.v1");
    expect(linkedIssueFixture.privacy).toBe("synthetic-linked-issue-reference-matrix-no-private-data");
    expect(linkedIssueFixture.status).toBe("synthetic_regression_fixture");
    expect(linkedIssueFixture.cases.map((testCase) => testCase.id)).toEqual([
      "placeholder-only-ignored",
      "placeholder-plus-real-prefers-real",
      "template-comment-placeholder-ignored",
      "ambiguous-real-refs-remain-multiple"
    ]);

    const serialized = JSON.stringify(linkedIssueFixture);
    expect(serialized).not.toContain("github.com/");
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("ghp_");
  });

  it.each(linkedIssueFixture.cases.map((testCase) => [testCase.id, testCase] as const))(
    "%s extracts supported issue refs deterministically",
    (_id, testCase) => {
      const extraction = extractSupportedIssueReferences(testCase.inputText, testCase.repository);

      expect(extraction.references.map(formatIssueReference)).toEqual(testCase.expectedRefs);
      expect(extraction.totalSupportedReferences).toBe(testCase.totalSupportedReferences);
      expect(extraction.capped).toBe(testCase.capped);
    }
  );

  it("extracts supported local closing refs and qualified refs", () => {
    const extraction = extractSupportedIssueReferences(
      "Fixes #124. Closes owner/other-repo#456. Also see docs/repo#789.",
      { owner: "acme", repo: "app" }
    );

    expect(extraction.references.map(formatIssueReference)).toEqual([
      "acme/app#124",
      "owner/other-repo#456",
      "docs/repo#789"
    ]);
    expect(extraction.totalSupportedReferences).toBe(3);
    expect(extraction.capped).toBe(false);
  });

  it("does not treat bare local issue mentions as supported closing refs", () => {
    const extraction = extractSupportedIssueReferences(
      "Related to #123, fixes the typo in owner/repo#456.",
      { owner: "acme", repo: "app" }
    );

    expect(extraction.references.map(formatIssueReference)).toEqual(["owner/repo#456"]);
  });

  it("deduplicates references and caps multiple refs at three", () => {
    const extraction = extractSupportedIssueReferences(
      "Fixes #1. Resolves #1. Closes acme/app#2. owner/other#3. docs/site#4.",
      { owner: "acme", repo: "app" }
    );

    expect(extraction.references.map(formatIssueReference)).toEqual([
      "acme/app#1",
      "acme/app#2",
      "owner/other#3"
    ]);
    expect(extraction.totalSupportedReferences).toBe(4);
    expect(extraction.capped).toBe(true);
  });

  it("ignores standalone template placeholder issue refs when real refs are present", () => {
    const extraction = extractSupportedIssueReferences(
      [
        "### Linked issues",
        "Fixes #123.",
        "",
        "Fixes #94890."
      ].join("\n"),
      { owner: "acme", repo: "app" }
    );

    expect(extraction.references.map(formatIssueReference)).toEqual(["acme/app#94890"]);
    expect(extraction.totalSupportedReferences).toBe(1);
  });

  it("ignores issue reference examples inside PR template comments", () => {
    const extraction = extractSupportedIssueReferences(
      [
        "<!--",
        "- Reference the issues it solves (e.g. `fixes #123`).",
        "-->",
        "",
        "### Description",
        "Fixes #22242"
      ].join("\n"),
      { owner: "acme", repo: "app" }
    );

    expect(extraction.references.map(formatIssueReference)).toEqual(["acme/app#22242"]);
    expect(extraction.totalSupportedReferences).toBe(1);
  });

  it("ignores standalone placeholder issue refs even when they are the only supported-looking ref", () => {
    const extraction = extractSupportedIssueReferences(
      "Fixes #123.",
      { owner: "acme", repo: "app" }
    );

    expect(extraction.references.map(formatIssueReference)).toEqual([]);
    expect(extraction.totalSupportedReferences).toBe(0);
  });
});
