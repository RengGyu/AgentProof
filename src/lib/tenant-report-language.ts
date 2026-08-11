import type { ProofGapKind, VerificationReport } from "./types";
import type { LlmSemanticOutput } from "./llm-semantic-output";

export type TenantReportAnalysisContext = "linked_issue" | "unlinked_pr" | "provided_requirement";

const LEGACY_GAP = "Evidence gap recorded.";
const LEGACY_REMEDIATION = "Address missing or unclear verification evidence, then rerun the relevant checks.";

const GAP_TEXT: Record<ProofGapKind, string> = {
  missing_implementation: "Implementation evidence is missing for this requirement.",
  missing_targeted_test: "Targeted test evidence is missing for this requirement.",
  missing_execution: "Check or runtime execution evidence is missing for this requirement.",
  failed_execution: "A relevant Check reported failure; review the failed Check evidence.",
  ambiguous_requirement: "The requirement needs clarification before its evidence can be assessed.",
  self_reported_test_gap: "The PR indicates its targeted test evidence may be incomplete.",
  evidence_unavailable: "Required evidence was unavailable during collection.",
  visual_proof_missing: "Visual or browser evidence is missing for this requirement."
};

const REMEDIATION_TEXT: Record<ProofGapKind, string> = {
  missing_implementation: "Add or link implementation evidence for the requirement.",
  missing_targeted_test: "Add or link a targeted test and its Check result for the requirement.",
  missing_execution: "Run or link the relevant Check for the requirement.",
  failed_execution: "Investigate the failed Check and provide updated execution evidence.",
  ambiguous_requirement: "Clarify the requirement, then link evidence to the agreed interpretation.",
  self_reported_test_gap: "Complete or link the targeted test evidence described by the PR.",
  evidence_unavailable: "Collect the unavailable evidence and run the analysis again.",
  visual_proof_missing: "Add visual or browser evidence for the requirement."
};

const REMEDIATION_PRIORITY: ProofGapKind[] = [
  "failed_execution",
  "ambiguous_requirement",
  "missing_targeted_test",
  "missing_implementation",
  "missing_execution",
  "evidence_unavailable",
  "visual_proof_missing",
  "self_reported_test_gap"
];

export const ALLOWED_TENANT_GAP_TEXTS = new Set<string>([
  ...Object.values(GAP_TEXT),
  LEGACY_GAP
]);

export const ALLOWED_TENANT_REMEDIATION_TEXTS = new Set<string>([
  ...Object.values(REMEDIATION_TEXT),
  LEGACY_REMEDIATION
]);

export function tenantGapText(kind: ProofGapKind): string {
  return GAP_TEXT[kind];
}

export function tenantGapKind(text: string): ProofGapKind {
  const match = Object.entries(GAP_TEXT).find(([, value]) => value === text);
  return (match?.[0] as ProofGapKind | undefined) ?? "evidence_unavailable";
}

export function tenantRemediationText(kinds: readonly ProofGapKind[]): string {
  const selected = REMEDIATION_PRIORITY.find((kind) => kinds.includes(kind));
  return REMEDIATION_TEXT[selected ?? "evidence_unavailable"];
}

export function tenantProofGapKindForSemanticGap(
  gapType: LlmSemanticOutput["evidence_gaps"][number]["gap_type"]
): ProofGapKind {
  switch (gapType) {
    case "missing_implementation_evidence":
      return "missing_implementation";
    case "missing_test_evidence":
      return "missing_targeted_test";
    case "missing_check_evidence":
    case "missing_runtime_evidence":
      return "missing_execution";
    case "ambiguous_requirement":
      return "ambiguous_requirement";
    default:
      return "evidence_unavailable";
  }
}

export function tenantReportAnalysisContext(report: VerificationReport): TenantReportAnalysisContext {
  if (report.proofGraph.nodes.some((node) => node.sourceQuality === "author_claim")) return "unlinked_pr";
  if (report.proofGraph.context.some((context) => context.source === "pr_description" && context.role === "author_claim")) return "unlinked_pr";
  if (report.proofGraph.nodes.some((node) => node.sourceQuality !== "manual_check" && node.sourceQuality !== "fallback")) return "linked_issue";
  return "provided_requirement";
}
