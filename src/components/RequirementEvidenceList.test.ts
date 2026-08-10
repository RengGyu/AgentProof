import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RequirementEvidenceList } from "./RequirementEvidenceList";
import type { DashboardRequirementViewModel } from "@/lib/dashboard-requirement-view-model";

describe("RequirementEvidenceList", () => {
  it("renders compact requirement cards with a closed native evidence disclosure", () => {
    const markup = renderToStaticMarkup(createElement(RequirementEvidenceList, { requirements: [{
      requirementId: "req_checkout",
      status: "partial",
      coverageLabel: "Partially supported",
      coverageMeaning: "Deterministic evidence references only partially support this requirement.",
      evidenceRefs: ["ev_1", "ev_2"],
      deterministicGaps: ["Focused edge-case coverage is missing."],
      explanation: { state: "assessment", text: "The normal validation path has evidence." },
      nextAction: "Add focused edge-case coverage.",
      actionIncluded: false,
      semanticEvidenceIds: ["ev_1"],
      uncertainties: ["medium"]
    }] }));

    expect(markup).toContain("req_checkout");
    expect(markup).toContain("AI explanation");
    expect(markup).toContain("The normal validation path has evidence.");
    expect(markup).toContain("<strong>Next:</strong> Add focused edge-case coverage.");
    expect(markup).toMatch(/<details\b[^>]*name="requirement-evidence"/);
    expect(markup).not.toMatch(/<details\b[^>]*\bopen(?:=|\s|>)/);
    expect(markup).toContain("Coverage is based on deterministic evidence captured for this requirement.");
    expect(markup).toContain("Deterministic evidence references only partially support this requirement.");
    expect(markup).toContain("2 evidence references");
    expect(markup).toContain("ev_1, ev_2");
    expect(markup).toContain("Semantic evidence IDs: ev_1");
    expect(markup).toContain("AI uncertainty: medium");
    expect(markup).toContain('aria-hidden="true"');
  });

  it("gives missing coverage a distinct icon and labels unavailable AI explanation", () => {
    const markup = renderToStaticMarkup(createElement(RequirementEvidenceList, { requirements: [{
      requirementId: "req_missing",
      status: "missing",
      coverageLabel: "Evidence missing",
      coverageMeaning: "No deterministic evidence references support this requirement.",
      evidenceRefs: [],
      deterministicGaps: ["No evidence is available."],
      explanation: { state: "unavailable", text: "AI explanation is unavailable. Deterministic evidence is shown below." },
      actionIncluded: false,
      semanticEvidenceIds: [],
      uncertainties: []
    }] }));

    expect(markup).toContain("AI explanation unavailable");
    expect(markup).toContain("lucide-circle-x");
  });

  it("does not render a Next label when the requirement has no actionable request", () => {
    const markup = renderToStaticMarkup(createElement(RequirementEvidenceList, { requirements: [{
      requirementId: "req_no_action",
      status: "met",
      coverageLabel: "Supported",
      coverageMeaning: "Deterministic evidence references support this requirement.",
      evidenceRefs: [],
      deterministicGaps: [],
      explanation: { state: "none", text: "No additional AI explanation is available for this requirement." },
      actionIncluded: false,
      semanticEvidenceIds: [],
      uncertainties: []
    }] }));

    expect(markup).toContain("No additional AI explanation is available for this requirement.");
    expect(markup).toContain("No AI explanation");
    expect(markup).not.toContain("Next:");
  });

  it("labels compact AI guidance separately from deterministic coverage", () => {
    const markup = renderToStaticMarkup(createElement(RequirementEvidenceList, { requirements: [{
      requirementId: "req_guidance",
      status: "partial",
      coverageLabel: "Partially supported",
      coverageMeaning: "Deterministic evidence references only partially support this requirement.",
      evidenceRefs: ["ev_3"],
      deterministicGaps: [],
      explanation: { state: "guidance", text: "A focused path needs more evidence." },
      nextAction: "Provide a focused test result.",
      actionIncluded: false,
      semanticEvidenceIds: ["ev_3"],
      uncertainties: []
    }] }));

    expect(markup).toContain("AI guidance");
    expect(markup).toContain("<strong>Next:</strong> Provide a focused test result.");
  });

  it("labels a normalized duplicate explanation as the next action without rendering a second Next line", () => {
    const requirement = {
      requirementId: "req_combined",
      status: "partial",
      coverageLabel: "Partially supported",
      coverageMeaning: "Deterministic evidence references only partially support this requirement.",
      evidenceRefs: [],
      deterministicGaps: [],
      explanation: { state: "assessment" as const, text: "Add focused test coverage." },
      semanticEvidenceIds: [],
      uncertainties: [],
      actionIncluded: true
    } satisfies DashboardRequirementViewModel;
    const markup = renderToStaticMarkup(createElement(RequirementEvidenceList, { requirements: [requirement] }));

    expect(markup).toContain("AI explanation · Next action");
    expect(markup).toContain("Add focused test coverage.");
    expect(markup).not.toContain("<strong>Next:</strong>");
  });
});
