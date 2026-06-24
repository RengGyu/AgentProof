export type CheckStatus = "passed" | "failed" | "pending" | "unknown";
export type RequirementStatus = "met" | "partial" | "missing" | "unclear";
export type PriorityLevel = "low" | "medium" | "high" | "blocker";
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
  changedFiles: ChangedFile[];
  checks: CheckRun[];
  logs: LogSnippet[];
  taskText: string;
  limitations?: string[];
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
}

export interface Requirement {
  id: string;
  source: "task" | "issue" | "pr_description" | "manual";
  text: string;
  keywords: string[];
  priority: "must" | "should" | "could";
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
}

export interface MissingTestFinding {
  path: string;
  why: string;
  evidenceRefs: string[];
}

export interface ReviewPriorityItem {
  path: string;
  reason: string;
  priority: PriorityLevel;
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
  reprompt: {
    targetAgent: "codex" | "claude_code" | "cursor" | "copilot";
    prompt: string;
  };
  evidenceIndex: EvidenceItem[];
  limitations: string[];
}
