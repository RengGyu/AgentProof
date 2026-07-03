import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runExternalPrPilotLabelsCli } from "./external-pr-pilot-labels.mjs";

describe("external-pr-pilot-labels CLI", () => {
  it("prints pending manual-label summary without report input or oracle payloads", () => {
    const writes = [];
    const result = runExternalPrPilotLabelsCli(["summary"], {
      fixturePath: "fixture.json",
      readFile: () => JSON.stringify(fixture()),
      writeFile: (path, body) => writes.push({ path, body })
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      privacy: "external-pr-pilot-label-summary-only",
      status: "manual_labels_pending",
      next: "record_manual_labels_after_reviewer_sessions"
    }));
    expect(result.counts).toEqual(expect.objectContaining({
      cases: 5,
      reviewed: 0,
      pending: 5,
      requiredCategories: 5,
      coveredCategories: 5
    }));
    expect(JSON.stringify(result)).not.toContain("publicTaskContext");
    expect(JSON.stringify(result)).not.toContain("knownPublicSignals");
    expect(JSON.stringify(result)).not.toContain("rawDiff");
    expect(JSON.stringify(result)).not.toContain("github_pat_");
    expect(writes).toEqual([]);
  });

  it("shows one case with bounded metadata and without reportInput", () => {
    const result = runExternalPrPilotLabelsCli([
      "show",
      "--case-id", "external-pr-pilot-clean-nextjs-95403"
    ], {
      fixturePath: "fixture.json",
      readFile: () => JSON.stringify(fixture()),
      writeFile: vi.fn()
    });

    expect(result).toEqual(expect.objectContaining({
      privacy: "external-pr-pilot-label-summary-only",
      id: "external-pr-pilot-clean-nextjs-95403",
      category: "clean_pr",
      prUrl: "https://github.com/vercel/next.js/pull/95403",
      manualLabelStatus: "pending_reviewer_confirmation",
      topFileCount: 2,
      next: "record_manual_labels_after_reviewer_session"
    }));
    expect(JSON.stringify(result)).not.toContain("requirementStatus");
    expect(JSON.stringify(result)).not.toContain("scopeCreep");
    expect(JSON.stringify(result)).not.toContain("reportInput");
    expect(JSON.stringify(result)).not.toContain("knownPublicSignals");
  });

  it("records reviewer-confirmed labels without mutating reportInput", () => {
    const currentFixture = fixture();
    const originalReportInput = JSON.stringify(currentFixture.cases[0].reportInput);
    const writes = [];
    const result = runExternalPrPilotLabelsCli([
      "record-labels",
      "--case-id", "external-pr-pilot-clean-nextjs-95403",
      "--requirement-status", "met",
      "--missing-targeted-test-evidence", "no",
      "--scope-creep", "no",
      "--top-files", "packages/next/src/next-devtools/dev-overlay/segment-explorer-trie.ts,packages/next/src/next-devtools/dev-overlay/segment-explorer-trie.test.tsx",
      "--notes", "Reviewer confirmed the bounded first-inspection labels."
    ], {
      fixturePath: "fixture.json",
      readFile: () => JSON.stringify(currentFixture),
      writeFile: (path, body) => writes.push({ path, body })
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      status: "manual_labels_pending"
    }));
    expect(result.counts).toEqual(expect.objectContaining({
      reviewed: 1,
      pending: 4
    }));
    expect(writes).toHaveLength(1);

    const written = JSON.parse(writes[0].body);
    expect(JSON.stringify(written.cases[0].reportInput)).toBe(originalReportInput);
    expect(written.cases[0].manualLabels).toEqual({
      labelStatus: "reviewed",
      requirementStatus: "met",
      missingTargetedTestEvidence: false,
      scopeCreep: false,
      topFilesReviewerShouldInspect: [
        "packages/next/src/next-devtools/dev-overlay/segment-explorer-trie.ts",
        "packages/next/src/next-devtools/dev-overlay/segment-explorer-trie.test.tsx"
      ],
      notes: "Reviewer confirmed the bounded first-inspection labels."
    });
    expect(JSON.stringify(written.cases[0].reportInput)).not.toContain("requirementStatus");
  });

  it("reports ready only after all five cases are reviewed", () => {
    let currentFixture = fixture();
    const writeFile = vi.fn((_path, body) => {
      currentFixture = JSON.parse(body);
    });

    for (const testCase of currentFixture.cases) {
      runExternalPrPilotLabelsCli([
        "record-labels",
        "--case-id", testCase.id,
        "--requirement-status", "unclear",
        "--missing-targeted-test-evidence", "yes",
        "--scope-creep", "no",
        "--top-files", firstInspectionFiles(testCase),
        "--notes", "Reviewer confirmed bounded labels after reading the generated report."
      ], {
        fixturePath: "fixture.json",
        readFile: () => JSON.stringify(currentFixture),
        writeFile
      });
    }

    const summary = runExternalPrPilotLabelsCli(["summary"], {
      fixturePath: "fixture.json",
      readFile: () => JSON.stringify(currentFixture),
      writeFile
    });

    expect(summary).toEqual(expect.objectContaining({
      ok: true,
      status: "ready_for_pilot_review",
      next: "run_p0_beta_readiness"
    }));
    expect(summary.counts).toEqual(expect.objectContaining({
      reviewed: 5,
      pending: 0
    }));
  });

  it("rejects unsafe paths, raw payloads, and secret-looking notes before writing", () => {
    const writeFile = vi.fn();

    expect(() => runExternalPrPilotLabelsCli([
      "record-labels",
      "--case-id", "external-pr-pilot-clean-nextjs-95403",
      "--requirement-status", "met",
      "--missing-targeted-test-evidence", "no",
      "--scope-creep", "no",
      "--top-files", "../secret.ts",
      "--notes", "Reviewer confirmed the bounded first-inspection labels."
    ], {
      fixturePath: "fixture.json",
      readFile: () => JSON.stringify(fixture()),
      writeFile
    })).toThrow(/bounded relative repository paths/i);

    expect(() => runExternalPrPilotLabelsCli([
      "record-labels",
      "--case-id", "external-pr-pilot-visual-proof-nextjs-95054",
      "--requirement-status", "unclear",
      "--missing-targeted-test-evidence", "yes",
      "--scope-creep", "no",
      "--top-files", "",
      "--notes", "Reviewer could not identify a first inspection file yet."
    ], {
      fixturePath: "fixture.json",
      readFile: () => JSON.stringify(fixture()),
      writeFile
    })).toThrow(/at least one first inspection file/i);

    expect(() => runExternalPrPilotLabelsCli([
      "record-labels",
      "--case-id", "external-pr-pilot-clean-nextjs-95403",
      "--requirement-status", "met",
      "--missing-targeted-test-evidence", "no",
      "--scope-creep", "no",
      "--top-files", "https://example.com/file.ts",
      "--notes", "Reviewer confirmed the bounded first-inspection labels."
    ], {
      fixturePath: "fixture.json",
      readFile: () => JSON.stringify(fixture()),
      writeFile
    })).toThrow(/bounded relative repository paths/i);

    expect(() => runExternalPrPilotLabelsCli([
      "record-labels",
      "--case-id", "external-pr-pilot-clean-nextjs-95403",
      "--requirement-status", "met",
      "--missing-targeted-test-evidence", "no",
      "--scope-creep", "no",
      "--top-files", "packages/next/src/file.ts",
      "--notes", "github_pat_secret_should_not_leak"
    ], {
      fixturePath: "fixture.json",
      readFile: () => JSON.stringify(fixture()),
      writeFile
    })).toThrow(/private or secret-looking value/i);

    expect(writeFile).not.toHaveBeenCalled();
  });
});

function fixture() {
  return JSON.parse(readFileSync(
    join(process.cwd(), "eval/fixtures/external-pr-pilot.v1.json"),
    "utf8"
  ));
}

function firstInspectionFiles(testCase) {
  const changedFiles = testCase.reportInput.knownPublicSignals.changedFiles;
  if (changedFiles.length > 0) {
    return changedFiles.slice(0, 2).join(",");
  }

  return "examples/visual-proof-placeholder.tsx";
}
