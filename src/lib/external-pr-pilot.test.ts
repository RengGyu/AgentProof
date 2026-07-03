import { describe, expect, it } from "vitest";
import {
  EXTERNAL_PR_PILOT_REQUIRED_CATEGORIES,
  loadExternalPrPilotFixture,
  validateExternalPrPilotFixture
} from "./external-pr-pilot";
import type { ExternalPrPilotFixture } from "./external-pr-pilot";

describe("external PR pilot fixture", () => {
  it("loads exactly 5 external PR pilot cases with the required coverage", () => {
    const fixture = loadExternalPrPilotFixture();

    expect(fixture.schemaVersion).toBe("external-pr-pilot.v1");
    expect(fixture.privacy).toBe("external-pr-pilot-metadata-only");
    expect(fixture.cases).toHaveLength(5);
    expect(new Set(fixture.cases.map((testCase) => testCase.category))).toEqual(
      new Set(EXTERNAL_PR_PILOT_REQUIRED_CATEGORIES)
    );
    expect(fixture.scaleRule).toMatch(/do not expand to 20/i);

    for (const testCase of fixture.cases) {
      expect(testCase.source.repository).not.toMatch(/agentproof/i);
      expect(testCase.source.url).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/);
      expect(testCase.source.url).not.toMatch(/RengGyu\/AgentProof/i);
    }
  });

  it("keeps manual labels structurally separate from report generation input", () => {
    const fixture = loadExternalPrPilotFixture();

    for (const testCase of fixture.cases) {
      const reportInputText = JSON.stringify(testCase.reportInput);

      expect(testCase.manualLabels.labelStatus).toBe("pending_reviewer_confirmation");
      expect(reportInputText).not.toContain("manualLabels");
      expect(reportInputText).not.toContain("requirementStatus");
      expect(reportInputText).not.toContain("missingTargetedTestEvidence");
      expect(reportInputText).not.toContain("scopeCreep");
      expect(reportInputText).not.toContain("topFilesReviewerShouldInspect");
      expect(reportInputText).not.toMatch(/\bmet\b|\bpartial\b|\bmissing\b|\bunclear\b/);
    }
  });

  it("rejects oracle or manual label keys inside reportInput", () => {
    const fixture = cloneFixture(loadExternalPrPilotFixture());
    fixture.cases[0].reportInput = {
      ...fixture.cases[0].reportInput,
      scopeCreep: true
    } as typeof fixture.cases[0]["reportInput"];

    expect(() => validateExternalPrPilotFixture(fixture)).toThrow(/leaked manual\/oracle key/i);
  });

  it("rejects AgentProof self PRs", () => {
    const fixture = cloneFixture(loadExternalPrPilotFixture());
    fixture.cases[0].source.repository = "RengGyu/AgentProof";
    fixture.cases[0].source.url = "https://github.com/RengGyu/AgentProof/pull/70";
    fixture.cases[0].reportInput.repository = "RengGyu/AgentProof";
    fixture.cases[0].reportInput.pullRequestUrl = "https://github.com/RengGyu/AgentProof/pull/70";

    expect(() => validateExternalPrPilotFixture(fixture)).toThrow(/must not use an AgentProof PR/i);
  });

  it("rejects raw payload fields and secret-looking fixture values", () => {
    const fixture = cloneFixture(loadExternalPrPilotFixture());
    fixture.cases[0].reportInput.knownPublicSignals = {
      ...fixture.cases[0].reportInput.knownPublicSignals,
      rawDiff: "diff --git a/file b/file"
    } as typeof fixture.cases[0]["reportInput"]["knownPublicSignals"];

    expect(() => validateExternalPrPilotFixture(fixture)).toThrow(/forbidden raw\/private field/i);
  });
});

function cloneFixture(fixture: ExternalPrPilotFixture): ExternalPrPilotFixture {
  return JSON.parse(JSON.stringify(fixture)) as ExternalPrPilotFixture;
}
