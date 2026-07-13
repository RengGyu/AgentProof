export type CheckStatus = "passed" | "failed" | "pending" | "unknown";
export type RequirementStatus = "met" | "partial" | "missing" | "unclear";
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
  changedFiles: ChangedFile[];
  checks: CheckRun[];
  logs: LogSnippet[];
  taskText: string;
  limitations?: string[];
  sourceProvenance?: SourceProvenance;
}

/**
 * Metadata-only capture information for an evidence input. It deliberately
 * excludes task text, PR bodies, patches, check summaries, and log text.
 */
export interface SourceProvenance {
  version: 1;
  origin: "github_snapshot" | "pasted_evidence" | "demo";
  headSha?: string;
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
    reportSchemaVersion: "verification-report.v1";
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
  evidenceRefs: string[];
  gaps: string[];
  reviewerNote: string;
  confidence: number;
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
  | "ambiguous_requirement"
  | "self_reported_test_gap"
  | "evidence_unavailable"
  | "visual_proof_missing";

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
  authenticity?: ReportAuthenticity;
}
