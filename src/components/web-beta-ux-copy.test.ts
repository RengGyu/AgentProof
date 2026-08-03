import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("web beta guided reviewer UX copy", () => {
  it("starts first-time reviewers on the public PR URL flow, not a preloaded demo report", () => {
    const page = readFileSync(join(root, "src/app/page.tsx"), "utf8");
    const workspace = readFileSync(join(root, "src/components/AnalyzeWorkspace.tsx"), "utf8");

    expect(page).not.toContain("generateVerificationReport");
    expect(page).not.toContain("demoScenarios");
    expect(workspace).toContain('useState<"demo" | "manual">("manual")');
    expect(workspace).toContain("Start with a public PR URL");
    expect(workspace).toContain("Demo is optional");
    expect(workspace).toContain("private repos, tokens, raw code, and full logs are not needed");
  });

  it("moves mobile reviewers to the result card after generation", () => {
    const workspace = readFileSync(join(root, "src/components/AnalyzeWorkspace.tsx"), "utf8");

    expect(workspace).toContain("reportRegionRef");
    expect(workspace).toContain("scrollIntoView");
    expect(workspace).toContain("focus({ preventScroll: true })");
    expect(workspace).toContain("setFocusReportAfterLoad(true)");
  });

  it("keeps raw-code and raw-log warnings near manual intake fields", () => {
    const workspace = readFileSync(join(root, "src/components/AnalyzeWorkspace.tsx"), "utf8");

    expect(workspace).toContain("Optional context only");
    expect(workspace).toContain("not private code, secrets, tokens, or full logs");
    expect(workspace).toContain("Do not paste raw diffs, full logs, or secret-bearing output");
    expect(workspace).toContain("Short result summary only; no full logs");
  });

  it("keeps the 30-second card focused on reviewer decision signals plus uncertainty", () => {
    const reportView = readFileSync(join(root, "src/components/ReportView.tsx"), "utf8");

    for (const expected of [
      'aria-label="30-second reviewer card"',
      "Top risk",
      "Missing proof",
      "First files",
      "Test/build",
      "Ask agent next",
      "uncertainty-line",
      "getUncertaintyLine",
      "This is human decision support; it does not prove correctness, security, or merge readiness."
    ]) {
      expect(reportView).toContain(expected);
    }
  });

  it("renders generic priority fallbacks as reviewer-friendly labels", () => {
    const reportView = readFileSync(join(root, "src/components/ReportView.tsx"), "utf8");

    expect(reportView).toContain("formatReviewPriorityPath(item.path)");
    expect(reportView).toContain("Requirement-level gap (no concrete file cited)");
    expect(reportView).toContain("Changed-file spot check");
    expect(reportView).toContain("Test/build check");
  });
});
