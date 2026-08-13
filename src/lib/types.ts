import type { RequirementProofCollectionBasis, RequirementProofSubject } from "./proof-contract";
import type { VerificationBindingInputV2, VerificationContractSourceInputV2 } from "./verification-contract-v2";
export type { RequirementProofCollectionBasis, RequirementProofSubject } from "./proof-contract";

export type CheckStatus = "passed" | "failed" | "pending" | "unknown";
export type RequirementStatus = "met" | "partial" | "missing" | "unclear";
/** Present only when the requirement is derived from the PR description. */
export type RequirementAuthority = "pr_description";
export type PriorityLevel = "low" | "medium" | "high" | "blocker";
export type RequirementSourceRole =
  | "core_requirement"
  | "problem_context"
  | "reproduction_context"
  | "environment_context"
  | "visual_context"
  | "external_reference"
  | "solution_hint"
  | "author_claim"
  | "template_noise";
export type RequirementSourceQuality =
  | "linked_issue"
  | "explicit_acceptance_criteria"
  | "expected_behavior"
  | "requirement_language"
  | "problem_statement"
  | "solution_hint"
  | "author_claim"
  | "manual_check"
  | "fallback";
export type EvidenceKind =
  | "task"
  | "pr_description"
  | "diff"
  | "changed_file"
  | "check"
  | "log"
  | "test"
  | "inference";

export interface AnalyzeRequest {
  prUrl?: string;
  githubToken?: string;
  taskText?: string;
  prDescription?: string;
  changedFiles?: string;
  checks?: string;
  logs?: string;
  demoScenario?: DemoScenarioId;
  inputLimitations?: string[];
}

export interface PostGitHubCommentRequest {
  prUrl: string;
  githubToken: string;
  report: VerificationReport;
}

export interface PostGitHubCommentResponse {
  action: "created" | "updated";
  url: string;
  warning?: string;
}

export type DemoScenarioId =
  | "clean"
  | "scope-creep"
  | "missing-tests"
  | "failed-ci"
  | "vague-task";

export interface PullRequestInput {
  url?: string;
  title: string;
  description: string;
  author?: string;
  baseBranch?: string;
  headBranch?: string;
  taskSource?: "task" | "issue";
  /** Transient SHA-256 identity for the selected requirement-authority object. */
  requirementSourceIdentityHash?: string;
  /** Transient authoritative contract source; never persisted in reports or telemetry. */
  verificationContractSourceV2?: VerificationContractSourceInputV2;
  /** Transient binding source; only its digest can enter a private v2 report. */
  verificationContractBindingV2?: VerificationBindingInputV2;
  changedFiles: ChangedFile[];
  checks: CheckRun[];
  logs: LogSnippet[];
  /** Bounded, normalized Actions suite metadata. Raw commands and logs are excluded. */
  executionSuites?: ExecutionSuiteObservation[];
  taskText: string;
  limitations?: string[];
  sourceProvenance?: SourceProvenance;
}

export type ExecutionSuiteRunner = "node_test" | "pytest" | "go_test" | "cargo_test";
export type ExecutionSuiteScope = "repository_discovery" | "explicit_paths" | "unknown";

export interface ExecutionSuiteObservation {
  headSha: string;
  status: CheckStatus;
  executionSource: string;
  runner: ExecutionSuiteRunner;
  scope: ExecutionSuiteScope;
  /** Changed test paths deterministically covered by the normalized scope. */
  testPaths: string[];
}

/**
 * Metadata-only capture information for an evidence input. It deliberately
 * excludes task text, PR bodies, patches, check summaries, and log text.
 */
export interface SourceProvenance {
  version: 1;
  origin: "github_snapshot" | "pasted_evidence" | "demo";
  headSha?: string;
  baseSha?: string;
  /** Deterministic inventory authority for absence proof. Optional for v1 compatibility. */
  changedFileInventory?: {
    version: 1;
    completeness: "complete" | "incomplete";
    headSha?: string;
  };
  /** Normalized suite coverage captured from GitHub Actions; no raw job output. */
  executionSuites?: ExecutionSuiteObservation[];
  evidenceCapturedAt: string;
  inputFingerprint: {
    version: 1;
    algorithm: "sha256";
    value: string;
    coverage: "github_metadata" | "pasted_metadata" | "demo_fixture";
  };
}

/**
 * A trust label for a report artifact. This is deliberately separate from the
 * deterministic findings themselves: it says who produced the stored summary,
 * not whether a requirement was satisfied.
 */
export interface ReportAuthenticity {
  version: 1;
  trust: "verified_agentproof" | "imported_unverified" | "legacy_unverified" | "portable_unverified";
  generator: {
    reportSchemaVersion: "verification-report.v1" | "verification-report.v2";
    deterministicEngineVersion: string;
  };
  canonicalDigest?: string;
  signingKeyId?: string;
  signature?: string;
}

export interface ChangedFile {
  path: string;
  additions?: number;
  deletions?: number;
  status?: "added" | "modified" | "removed" | "renamed";
  patch?: string;
}

export interface CheckRun {
  name: string;
  status: CheckStatus;
  summary?: string;
  url?: string;
}

export interface LogSnippet {
  source: string;
  text: string;
  status?: CheckStatus;
  url?: string;
}

export interface Requirement {
  id: string;
  source: "task" | "issue" | "pr_description" | "manual";
  text: string;
  keywords: string[];
  priority: "must" | "should" | "could";
  role: "core_requirement";
  sourceQuality: RequirementSourceQuality;
  sourceSection: string | null;
  contextRoles: RequirementSourceRole[];
}

export interface RequirementContextSignal {
  id: string;
  source: "task" | "issue" | "pr_description" | "manual";
  role: Exclude<RequirementSourceRole, "core_requirement" | "template_noise">;
  sourceQuality: RequirementSourceQuality;
  sourceSection: string | null;
  text: string;
}

export type HybridAnalysisContext = "linked_issue" | "unlinked_pr" | "provided_requirement";
export type RequirementSpanId = `sp_${number}_${number}`;

export interface RequirementSourceSpan {
  id: RequirementSpanId;
  groupId: `grp_${number}`;
  ordinal: number;
  immediateParentSpanId: RequirementSpanId | null;
  source: Requirement["source"];
  authority: "authoritative" | "pr_author_claim";
  sourceQuality: RequirementSourceQuality;
  sourceSection: string | null;
  start: number;
  end: number;
  text: string;
  priority: Requirement["priority"];
}

export interface RequirementSpanSeed {
  version: 1;
  analysisContext: HybridAnalysisContext;
  spans: RequirementSourceSpan[];
  contexts: RequirementContextSignal[];
  seedHash: string;
}

export interface RequirementSpanSeedExtractionResult {
  eligible: boolean;
  overflow: boolean;
  seed: RequirementSpanSeed | null;
}

export interface AgentClaim {
  id: string;
  text: string;
  evidenceRefs: string[];
  supported: boolean;
}

export interface EvidenceItem {
  id: string;
  kind: EvidenceKind;
  label: string;
  summary: string;
  locator?: string;
  confidence: number;
}

export interface FindingProvenance {
  evidenceRef: string;
  sourceType: EvidenceKind;
  locator?: string;
  confidence: number;
  evidenceText: string;
}

export interface RequirementFinding {
  requirementId: string;
  requirementText: string;
  status: RequirementStatus;
  /** Evidence-only status. It can be met while the PR-description origin still needs review. */
  evidenceStatus?: RequirementStatus;
  /** Optional PR-description provenance, displayed separately from evidence status. */
  sourceAuthority?: RequirementAuthority;
  evidenceRefs: string[];
  gaps: string[];
  reviewerNote: string;
  confidence: number;
  /** Deterministic, independently evaluated proof obligations. Optional for v1 compatibility. */
  proofAxes?: RequirementProofAxis[];
  /** Optional neutral classification provenance for the enhanced-planning pilot. */
  classificationBasis?: "deterministic" | "enhanced_plan";
  /** Subjects added by the neutral enhanced-planning policy, never source text. */
  plannerAxisSubjects?: RequirementProofSubject[];
}

export type RequirementProofPolarity = "present" | "absent";
export type RequirementProofState = "satisfied" | "violated" | "incomplete";

export interface RequirementProofAxis {
  subject: RequirementProofSubject;
  polarity: RequirementProofPolarity;
  state: RequirementProofState;
  evidenceRefs: string[];
  collectionBasis?: RequirementProofCollectionBasis;
}

export interface ScopeFinding {
  suspected: boolean;
  outOfScopeFiles: string[];
  reasons: string[];
  evidenceRefs?: string[];
  provenance?: FindingProvenance[];
}

export interface MissingTestFinding {
  path: string;
  why: string;
  evidenceRefs: string[];
  provenance?: FindingProvenance[];
}

export interface ReviewPriorityItem {
  path: string;
  reason: string;
  priority: PriorityLevel;
  evidenceRefs?: string[];
}

export type ProofGapKind =
  | "missing_implementation"
  | "missing_targeted_test"
  | "missing_execution"
  | "failed_execution"
  | "interaction_proof_missing"
  | "ambiguous_requirement"
  | "self_reported_test_gap"
  | "evidence_unavailable"
  | "forbidden_implementation_present"
  | "visual_proof_missing";

export type ReportAnalysisContext = "linked_issue" | "unlinked_pr" | "provided_requirement";

export interface ProofGapSignal {
  kind: ProofGapKind;
  severity: PriorityLevel;
  message: string;
  evidenceRefs: string[];
}

export interface RequirementProofNode {
  requirementId: string;
  requirementText: string;
  sourceRole: "core_requirement";
  sourceQuality: RequirementSourceQuality;
  sourceSection: string | null;
  contextRoles: RequirementSourceRole[];
  status: RequirementStatus;
  confidence: number;
  implementationEvidenceRefs: string[];
  targetedTestEvidenceRefs: string[];
  executionEvidenceRefs: string[];
  gapSignals: ProofGapSignal[];
  firstFiles: string[];
  /** Mirrors the requirement classification basis when enhanced planning applied. */
  classificationBasis?: "deterministic" | "enhanced_plan";
}

export interface ProofGraph {
  version: 1;
  nodes: RequirementProofNode[];
  context: RequirementContextSignal[];
  summary: {
    requirementCount: number;
    requirementsWithImplementation: number;
    requirementsWithTargetedTests: number;
    requirementsWithExecution: number;
    requirementsWithGaps: number;
    gapCount: number;
  };
}

export interface VerificationReport {
  analysisId: string;
  createdAt: string;
  /** Deterministic requirement-authority classification. */
  analysisContext?: ReportAnalysisContext;
  source: {
    title: string;
    url?: string;
    author?: string;
    baseBranch?: string;
    headBranch?: string;
    provenance?: SourceProvenance;
  };
  summary: {
    oneLine: string;
    confidence: number;
    priority: PriorityLevel;
    evidenceCoverage: number;
    topRisks: string[];
  };
  requirements: RequirementFinding[];
  claims: AgentClaim[];
  scope: ScopeFinding;
  testing: {
    ciStatus: CheckStatus;
    lintStatus: CheckStatus;
    typecheckStatus: CheckStatus;
    missingTests: MissingTestFinding[];
  };
  reviewPriority: ReviewPriorityItem[];
  proofGraph: ProofGraph;
  reprompt: {
    targetAgent: "codex" | "claude_code" | "cursor" | "copilot";
    prompt: string;
  };
  evidenceIndex: EvidenceItem[];
  limitations: string[];
  /** Validator-approved semantic interpretation. Deterministic evidence remains the source of truth. */
  semantic?: import("./llm-semantic-output").LlmSemanticOutput;
  /** Bounded runtime state for enhanced analysis; it never contains provider errors or payloads. */
  semanticAnalysis?: {
    status: "included" | "unavailable";
    attempts: 1 | 2;
  };
  /** Signed, bounded planner metadata only; it contains no plan or source content. */
  planner?: HybridPlannerProvenance;
  authenticity?: ReportAuthenticity;
}

/** A newly generated strict-contract report. Legacy v1 reports never gain this field. */
export interface VerificationReportV2 extends VerificationReport {
  reportSchemaVersion: "verification-report.v2";
  verificationContract: import("./verification-contract-v2").VerificationContractReportV2;
}

export type DecodedVerificationReport = VerificationReport | VerificationReportV2;

export interface HybridPlannerProvenance {
  version: 1;
  contractVersion: "hybrid_requirement_planner.v1";
  schemaVersion: "agentproof_requirement_span_plan_v1";
  promptVersion: "2026-08-12.v1";
  model: "gpt-5-mini";
  /** Required for full/private reports; public summaries deliberately omit it. */
  inputHash?: string;
}

/** Public summary provenance. It deliberately cannot carry the private seed binding. */
export type PortableHybridPlannerProvenance = Omit<HybridPlannerProvenance, "inputHash">;
