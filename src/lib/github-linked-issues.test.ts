import { describe, expect, it } from "vitest";
import { extractSupportedIssueReferences, formatIssueReference } from "./github-linked-issues";

describe("GitHub linked issue references", () => {
  it("extracts supported local closing refs and qualified refs", () => {
    const extraction = extractSupportedIssueReferences(
      "Fixes #123. Closes owner/other-repo#456. Also see docs/repo#789.",
      { owner: "acme", repo: "app" }
    );

    expect(extraction.references.map(formatIssueReference)).toEqual([
      "acme/app#123",
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
});
