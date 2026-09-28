import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequirementEvidenceList } from "./RequirementEvidenceList";
import { PublicGitHubDashboard } from "./PublicGitHubDashboard";
import { PublicGitHubEntry } from "./PublicGitHubEntry";
import type { DashboardRequirementViewModel } from "@/lib/dashboard-requirement-view-model";

const requirement: DashboardRequirementViewModel = {
  requirementId: "reading-layout-fixture",
  objectiveText: "Reject expired reset tokens.",
  status: "partial",
  coverageLabel: "Partial evidence",
  coverageMeaning: "An implementation candidate is not execution evidence.",
  evidenceRefs: ["ev-code", "ev-test"],
  deterministicGaps: ["Execution was not observed."],
  explanation: { state: "guidance", text: "Inspect the expiry branch before changing the implementation." },
  primaryGap: "Execution was not observed.",
  nextAction: "Inspect the referenced test.",
  actionIncluded: false,
  semanticEvidenceIds: [],
  uncertainties: ["Runtime behavior remains unconfirmed."]
};

describe("reading workspace", () => {
  it("keeps the objective, uncertainty and next action ahead of the provenance disclosure", () => {
    const html = renderToStaticMarkup(createElement(RequirementEvidenceList, { requirements: [requirement] }));
    const disclosure = html.indexOf("<details");
    expect(html.indexOf("Reject expired reset tokens.")).toBeLessThan(disclosure);
    expect(html.indexOf("Execution was not observed.")).toBeLessThan(disclosure);
    expect(html.indexOf("Inspect the referenced test.")).toBeLessThan(disclosure);
    expect(html).toContain("ev-code, ev-test");
    expect(html).toContain("Runtime behavior remains unconfirmed.");
    expect(html).not.toMatch(/<details\b[^>]*\bopen(?:=|\s|>)/);
  });

  it("server-renders a sign-in action without marketing examples or a preview-mode bypass", () => {
    const html = renderToStaticMarkup(createElement(PublicGitHubEntry));
    expect(html).toContain("Sign in to AgentProof");
    expect(html).toContain("Continue with GitHub");
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain("requirement satisfaction, or merge readiness");
    expect(html).not.toContain("Preview dashboard");
    expect(html).not.toContain("Code candidate");
    expect(html).not.toContain("github-entry-aside");
  });

  it("retains the explicitly enabled sample dashboard", () => {
    const html = renderToStaticMarkup(createElement(PublicGitHubEntry, { previewDemoAvailable: true }));
    expect(html).toContain('href="/dashboard?demo=1"');
  });

  it("shows the sample-data warning once in the preview dashboard", () => {
    const html = renderToStaticMarkup(createElement(PublicGitHubDashboard, { previewDemoEnabled: true }));
    expect(html.match(/Preview demo/g)).toHaveLength(1);
  });

  it("keeps the evidence gap and next actions ahead of snapshot fields in reading order", () => {
    const html = renderToStaticMarkup(createElement(PublicGitHubDashboard, { previewDemoEnabled: true }));
    expect(html.indexOf('class="summary-callout"')).toBeLessThan(html.indexOf('class="summary-status-grid"'));
    expect(html.indexOf('class="summary-actions"')).toBeLessThan(html.indexOf('class="summary-status-grid"'));
  });
});
