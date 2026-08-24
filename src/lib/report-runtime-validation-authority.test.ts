import { describe, expect, it } from "vitest";
import { validateRuntimeReportBoundary } from "./report-runtime-validation";
import type { PullRequestInput, VerificationReportV2 } from "./types";
import { generateVerificationReportV2 } from "./verifier";

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

describe("inbound untrusted v2 authority", () => {
  it("rejects an authoritative artifact result without receipt-gated axes", () => {
    const report = authoritativeArtifactReport("raw-authoritative-artifact-marker");

    expect(report.verificationContract.state).toBe("authoritative");
    expect(report.verificationContract.objectives[0]?.criterionResults[0]?.state).toBe("satisfied");
    expect(hasSatisfiedReceiptGatedAxis(report)).toBe(false);
    expect(validateRuntimeReportBoundary({
      boundary: "inbound_untrusted_full",
      report
    })).toEqual({
      valid: false,
      errors: ["An inbound untrusted full report cannot carry active v2 contract authority."]
    });
  });

  it("rejects an author-claim absence result without receipt-gated axes", () => {
    const report = authorClaimAbsenceReport("raw-author-claim-absence-marker");

    expect(report.verificationContract.state).toBe("author_claim");
    expect(report.verificationContract.objectives[0]?.criterionResults[0]?.state).toBe("satisfied");
    expect(hasSatisfiedReceiptGatedAxis(report)).toBe(false);
    expect(validateRuntimeReportBoundary({
      boundary: "inbound_untrusted_full",
      report
    })).toEqual({
      valid: false,
      errors: ["An inbound untrusted full report cannot carry active v2 contract authority."]
    });
  });
});

function authoritativeArtifactReport(marker: string): VerificationReportV2 {
  const contract = {
    version: 2 as const,
    scope: "complete_objective_set" as const,
    objectives: [{
      id: "reset_doc",
      objective: "Document the local reset command.",
      criteria: [{
        id: "reset_literal",
        type: "artifact" as const,
        label: "The reset document includes the exact test command.",
        paths: ["docs/reset.md"],
        artifact: { kind: "documentation_literal" as const, literal: "Run pnpm test." }
      }]
    }]
  };
  return generateVerificationReportV2({
    input: criterionInput(marker, {
      artifactBlobs: [{ path: "docs/reset.md", content: "Stop the server.\nRun pnpm test." }]
    }),
    contractSource: { kind: "provided_requirement", contract },
    binding: bindingFor("provided_requirement", JSON.stringify(contract))
  });
}

function authorClaimAbsenceReport(marker: string): VerificationReportV2 {
  const contract = {
    version: 2 as const,
    scope: "complete_objective_set" as const,
    objectives: [{
      id: "runtime_scope",
      objective: marker,
      criteria: [{
        id: "no_runtime_change",
        type: "absence" as const,
        label: "No runtime path changes.",
        prohibitedKind: "path_change" as const,
        scope: [{ kind: "prefix" as const, path: "src/runtime/" }]
      }]
    }]
  };
  const sourceContent = `## AgentProof verification\n\n\`\`\`agentproof-verification\n${JSON.stringify(contract)}\n\`\`\``;
  return generateVerificationReportV2({
    input: criterionInput(marker),
    contractSource: {
      kind: "pr_description",
      title: "AgentProof verification contract",
      body: sourceContent
    },
    binding: bindingFor("pr_description", sourceContent)
  });
}

function criterionInput(
  marker: string,
  verificationCriterionEvidenceV2?: PullRequestInput["verificationCriterionEvidenceV2"]
): PullRequestInput {
  return {
    url: "https://github.com/example/agentproof/pull/7",
    title: marker,
    description: "Synthetic authority-boundary fixture.",
    taskText: marker,
    taskSource: "issue",
    changedFiles: [{ path: "docs/reset.md", status: "modified", patch: "+Run pnpm test." }],
    checks: [],
    logs: [],
    ...(verificationCriterionEvidenceV2 ? { verificationCriterionEvidenceV2 } : {}),
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
      changedFileInventory: { version: 1, completeness: "complete", headSha: HEAD_SHA },
      evidenceCapturedAt: "2026-08-22T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
    }
  };
}

function bindingFor(
  sourceKind: "provided_requirement" | "pr_description",
  sourceContent: string
) {
  return {
    sourceKind,
    sourceIdentity: "synthetic:authority-boundary:1",
    sourceContent,
    headSha: HEAD_SHA,
    baseSha: BASE_SHA
  } as const;
}

function hasSatisfiedReceiptGatedAxis(report: VerificationReportV2): boolean {
  return report.requirements.some((requirement) => requirement.proofAxes?.some((axis) =>
    (axis.subject === "targeted_test" || axis.subject === "execution") && axis.state === "satisfied"
  ));
}
