import { extractOpenAIResponseText } from "./openai-verifier";
import { compactText, containsSecretPattern, redactSecrets } from "./redact";
import type { CheckStatus, PriorityLevel, VerificationReport } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 20_000;
const MAX_COMPACT_TEXT = 600;
const MAX_PACKAGE_TEXT = 1200;

const PLANNER_ROLES = [
  "core_requirement",
  "problem_context",
  "reproduction_context",
  "environment_context",
  "visual_context",
  "external_reference",
  "solution_hint",
  "author_claim",
  "template_noise"
] as const;

const PRIORITY_NUDGES = ["no_change", "consider_higher", "consider_lower", "manual_review"] as const;
const SEMANTIC_CLARITY = ["clear", "needs_human_review", "unclear"] as const;
const SEMANTIC_HYPOTHESIS_REF = "semantic_hypothesis";
const PRIORITY_NARROW_REF = "priority_may_be_too_narrow";

export const LLM_PROOF_PLANNER_INPUT_SCHEMA_VERSION = 1 as const;
export const LLM_PROOF_PLANNER_OUTPUT_SCHEMA_VERSION = "2.1" as const;

export type LlmProofPlannerRole = (typeof PLANNER_ROLES)[number];
export type LlmProofPlannerPriorityNudge = (typeof PRIORITY_NUDGES)[number];
export type LlmProofPlannerSemanticClarity = (typeof SEMANTIC_CLARITY)[number];
export type LlmProofPlannerBasis = string;

export interface CompactProofPlannerRequirement {
  requirementId: string;
  text: string;
  sourceRole: "core_requirement";
  sourceQuality: string;
  sourceSection: string | null;
  status: string;
  confidence: number;
  implementationEvidenceCount: number;
  targetedTestEvidenceCount: number;
  gapKinds: string[];
  gapSeverities: string[];
  firstFiles: string[];
}

export interface CompactProofPlannerContext {
  id: string;
  role: Exclude<LlmProofPlannerRole, "core_requirement">;
  sourceQuality: string;
  sourceSection: string | null;
  text: string;
}

export interface CompactProofPlannerChangedFile {
  path: string;
  kind: "implementation" | "test" | "docs" | "config" | "ci" | "unknown";
  summary: string;
}

export interface CompactEvidencePackage {
  version: typeof LLM_PROOF_PLANNER_INPUT_SCHEMA_VERSION;
  packageId: string;
  candidateId: string | null;
  prUrl: string | null;
  sourceTitle: string;
  deterministic: {
    priority: PriorityLevel;
    evidenceCoverage: number;
    confidence: number;
    testBuildStatus: CheckStatus;
    requirementCounts: Record<string, number>;
    missingTestCount: number;
    firstReviewPriorityFiles: string[];
    topRisks: string[];
    limitations: string[];
    priorityMayBeTooNarrow: boolean;
  };
  diagnostics: {
    testBuildExecutionEvidenceFound: boolean;
    failedExecutionEvidenceFound: boolean;
    selfReportedTestingFound: boolean;
    changedTestFilesFound: boolean;
    nonExecutionStatusesFound: boolean;
    rawLogsFetched: boolean;
  };
  requirements: CompactProofPlannerRequirement[];
  context: CompactProofPlannerContext[];
  deterministicGapKinds: string[];
  plannerConstraints: {
    allowedBasisRefs: string[];
    requiredGapRefs: string[];
    requiredPriorityNudge: LlmProofPlannerPriorityNudge;
    allowedPriorityNudgeRefs: string[];
  };
  packageBounds?: {
    totalRequirementCount: number;
    includedRequirementCount: number;
    omittedRequirementCount: number;
    totalContextCount: number;
    includedContextCount: number;
    omittedContextCount: number;
  };
  privacyPolicy: {
    summaryOnly: true;
    noRawDiffs: true;
    noRawLogs: true;
    noTokens: true;
    noPrivateData: true;
  };
}

export interface LlmProofPlannerRequirementSuggestion {
  requirementId: string;
  rewrite: string;
  semanticClarity: LlmProofPlannerSemanticClarity;
  proofPlan: string[];
  proofPlanBasis: LlmProofPlannerBasis[];
  missingProof: string | null;
  missingProofBasis: LlmProofPlannerBasis | null;
}

export interface LlmProofPlannerContextClassification {
  sourceId: string;
  role: Exclude<LlmProofPlannerRole, "core_requirement">;
}

export interface LlmProofPlannerOutput {
  version: typeof LLM_PROOF_PLANNER_OUTPUT_SCHEMA_VERSION;
  mode: "openai" | "mock";
  plannerStatus: "completed" | "skipped" | "failed";
  requirementSuggestions: LlmProofPlannerRequirementSuggestion[];
  contextClassifications: LlmProofPlannerContextClassification[];
  reviewerSignals: {
    topRisks: string[];
    topRiskBasis: LlmProofPlannerBasis[];
    why: string;
    whyBasis: LlmProofPlannerBasis;
    reviewerQuestion: string;
    reviewerQuestionBasis: LlmProofPlannerBasis;
    priorityNudge: LlmProofPlannerPriorityNudge;
    priorityNudgeReason: string;
    priorityNudgeGapRef: string | null;
  };
  latencyMs: number;
}

export interface LlmProofPlannerValidationResult {
  valid: boolean;
  errors: string[];
}

export interface GuardrailMergeResult {
  accepted: boolean;
  validation: LlmProofPlannerValidationResult;
  deterministic: CompactEvidencePackage["deterministic"];
  suggestion: LlmProofPlannerOutput | null;
  mergedReviewerSignals: {
    semanticClarity: LlmProofPlannerSemanticClarity;
    topSemanticRisks: string[];
    reviewerWhy: string[];
    missingProofExplanations: string[];
    priorityNudge: LlmProofPlannerPriorityNudge;
    priorityNudgeReason: string;
    priorityNudgeGapRef: string | null;
  } | null;
  guardrails: {
    testBuildStatusChanged: false;
    failedExecutionEvidenceRemoved: boolean;
    deterministicGapsHidden: string[];
    deterministicTestBuildStatus: CheckStatus;
    deterministicFailedExecutionEvidenceFound: boolean;
    blockedMutationReasons: string[];
  };
}

export const llmProofPlannerJsonSchema = {
  name: "agentproof_llm_proof_planner",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "requirementSuggestions",
      "contextClassifications",
      "reviewerSignals"
    ],
    properties: {
      requirementSuggestions: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "requirementId",
            "rewrite",
            "semanticClarity",
            "proofPlan",
            "proofPlanBasis",
            "missingProof",
            "missingProofBasis"
          ],
          properties: {
            requirementId: { type: "string", maxLength: 120 },
            rewrite: { type: "string", maxLength: 280 },
            semanticClarity: { type: "string", enum: SEMANTIC_CLARITY },
            proofPlan: { type: "array", maxItems: 2, items: { type: "string", maxLength: 220 } },
            proofPlanBasis: { type: "array", maxItems: 2, items: plannerBasisSchema() },
            missingProof: { type: ["string", "null"], maxLength: 180 },
            missingProofBasis: { type: ["string", "null"], maxLength: 120 }
          }
        }
      },
      contextClassifications: {
        type: "array",
        maxItems: 30,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["sourceId", "role"],
          properties: {
            sourceId: { type: "string", maxLength: 120 },
            role: { type: "string", enum: PLANNER_ROLES.filter((role) => role !== "core_requirement") }
          }
        }
      },
      reviewerSignals: {
        type: "object",
        additionalProperties: false,
        required: [
          "topRisks",
          "topRiskBasis",
          "why",
          "whyBasis",
          "reviewerQuestion",
          "reviewerQuestionBasis",
          "priorityNudge",
          "priorityNudgeGapRef"
        ],
        properties: {
          topRisks: { type: "array", maxItems: 2, items: { type: "string", maxLength: 220 } },
          topRiskBasis: { type: "array", maxItems: 2, items: plannerBasisSchema() },
          why: { type: "string", maxLength: 220 },
          whyBasis: plannerBasisSchema(),
          reviewerQuestion: { type: "string", maxLength: 220 },
          reviewerQuestionBasis: plannerBasisSchema(),
          priorityNudge: { type: "string", enum: PRIORITY_NUDGES },
          priorityNudgeGapRef: { type: ["string", "null"], maxLength: 200 }
        }
      }
    }
  }
} as const;

export interface OpenAIProofPlannerOptions {
  apiKey: string;
  model?: string;
  maxOutputTokens?: number;
  reasoningEffort?: "minimal" | "low" | "medium" | "high";
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

export async function planProofWithOpenAI(
  evidencePackage: CompactEvidencePackage,
  options: OpenAIProofPlannerOptions
): Promise<LlmProofPlannerOutput> {
  const startedAt = Date.now();
  const fetchImpl = options.fetchFn ?? fetch;
  let firstErrors: string[] = [];

  try {
    return await requestOpenAIProofPlan(evidencePackage, options, fetchImpl, startedAt, []);
  } catch (error) {
    if (!(error instanceof LlmProofPlannerOutputError)) throw error;
    firstErrors = error.validationErrors;
  }

  return requestOpenAIProofPlan(evidencePackage, options, fetchImpl, startedAt, firstErrors);
}

class LlmProofPlannerOutputError extends Error {
  constructor(readonly validationErrors: string[]) {
    super(`OpenAI proof planner output failed validation: ${validationErrors.map(redactSecrets).join(" ")}`);
  }
}

async function requestOpenAIProofPlan(
  evidencePackage: CompactEvidencePackage,
  options: OpenAIProofPlannerOptions,
  fetchImpl: typeof fetch,
  startedAt: number,
  retryErrors: string[]
): Promise<LlmProofPlannerOutput> {
  const requestBody = {
    model: options.model ?? "gpt-5-mini",
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: llmProofPlannerSystemPrompt() }]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(evidencePackage) }]
      },
      ...(retryErrors.length > 0
        ? [{
          role: "user",
          content: [{
            type: "input_text",
            text: retryInstruction(retryErrors, evidencePackage)
          }]
        }]
        : [])
    ],
    text: {
      format: {
        type: "json_schema",
        name: llmProofPlannerJsonSchema.name,
        schema: llmProofPlannerJsonSchema.schema,
        strict: true
      }
    },
    max_output_tokens: options.maxOutputTokens ?? 2600,
    ...(options.reasoningEffort ? { reasoning: { effort: options.reasoningEffort } } : {}),
    store: false
  };

  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(options.timeoutMs ?? OPENAI_TIMEOUT_MS)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI proof planner failed with HTTP ${response.status}: ${compactText(redactSecrets(errorText), 500)}`);
  }

  const json = await response.json();
  const text = extractOpenAIResponseText(json);
  if (!text) {
    throw new LlmProofPlannerOutputError(["Planner output was missing text JSON."]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LlmProofPlannerOutputError(["Planner output was invalid or incomplete JSON."]);
  }

  const output = normalizePlannerOutput(parsed, Date.now() - startedAt, evidencePackage);
  const validation = validateLlmProofPlannerOutput(output, evidencePackage);
  if (!validation.valid) {
    throw new LlmProofPlannerOutputError(validation.errors);
  }

  return output as LlmProofPlannerOutput;
}

export function buildCompactEvidencePackageFromReport(
  report: VerificationReport,
  options: { candidateId?: string | null } = {}
): CompactEvidencePackage {
  const testBuildStatus = report.testing.ciStatus;
  const requirements = report.proofGraph.nodes.slice(0, 20).map((node) => ({
    requirementId: node.requirementId,
    text: safeText(node.requirementText, MAX_COMPACT_TEXT),
    sourceRole: node.sourceRole,
    sourceQuality: node.sourceQuality,
    sourceSection: node.sourceSection,
    status: node.status,
    confidence: clamp01(node.confidence),
    implementationEvidenceCount: node.implementationEvidenceRefs.length,
    targetedTestEvidenceCount: node.targetedTestEvidenceRefs.length,
    gapKinds: uniqueStrings(node.gapSignals.map((gap) => gap.kind)),
    gapSeverities: uniqueStrings(node.gapSignals.map((gap) => gap.severity)),
    firstFiles: boundedStrings(node.firstFiles, 6, 240)
  }));
  const evidence = report.evidenceIndex;
  const deterministicGapKinds = gapKindsFromRequirements(requirements);
  const context = report.proofGraph.context.slice(0, 30).map((item) => ({
    id: item.id,
    role: item.role,
    sourceQuality: item.sourceQuality,
    sourceSection: item.sourceSection,
    text: safeText(item.text, MAX_COMPACT_TEXT)
  }));

  return {
    version: LLM_PROOF_PLANNER_INPUT_SCHEMA_VERSION,
    packageId: `planner_${report.analysisId}`,
    candidateId: options.candidateId ?? null,
    prUrl: report.source.url ?? null,
    sourceTitle: safeText(report.source.title, 240),
    deterministic: {
      priority: report.summary.priority,
      evidenceCoverage: numeric(report.summary.evidenceCoverage),
      confidence: clamp01(report.summary.confidence),
      testBuildStatus,
      requirementCounts: requirementCounts(report.requirements.map((item) => item.status)),
      missingTestCount: report.testing.missingTests.length,
      firstReviewPriorityFiles: boundedStrings(report.reviewPriority.map((item) => item.path), 8, 240),
      topRisks: boundedStrings(report.summary.topRisks, 6, 360),
      limitations: plannerLimitations(report.limitations),
      priorityMayBeTooNarrow: false
    },
    diagnostics: {
      testBuildExecutionEvidenceFound: ["passed", "failed"].includes(testBuildStatus) || report.proofGraph.summary.requirementsWithExecution > 0,
      failedExecutionEvidenceFound: hasGapKind(requirements, "failed_execution"),
      selfReportedTestingFound: evidence.some((item) => item.kind === "pr_description" && /\btests?\b/i.test(item.summary)),
      changedTestFilesFound: evidence.some((item) => item.kind === "test"),
      nonExecutionStatusesFound: evidence.some((item) => item.kind === "check" && !/\b(test|build|pytest|tox|vitest|jest)\b/i.test(item.label)),
      rawLogsFetched: false
    },
    requirements,
    context,
    deterministicGapKinds,
    plannerConstraints: plannerConstraintsForPackage(
      report.summary.priority,
      testBuildStatus,
      false,
      hasGapKind(requirements, "failed_execution"),
      requirements,
      deterministicGapKinds
    ),
    packageBounds: {
      totalRequirementCount: report.proofGraph.nodes.length,
      includedRequirementCount: requirements.length,
      omittedRequirementCount: Math.max(0, report.proofGraph.nodes.length - requirements.length),
      totalContextCount: report.proofGraph.context.length,
      includedContextCount: context.length,
      omittedContextCount: Math.max(0, report.proofGraph.context.length - context.length)
    },
    privacyPolicy: privacyPolicy()
  };
}

export function buildCompactEvidencePackageFromBaselineResult(value: unknown): CompactEvidencePackage {
  if (!isRecord(value)) {
    throw new Error("Baseline result must be an object.");
  }

  const reportSummary = record(value.reportSummary);
  const diagnostics = record(value.diagnosticMetadata);
  const proof = record(value.proofGraphDiagnostics);
  const quickAssessment = record(value.quickAssessment);
  const requirementSignalSummary = Array.isArray(proof.requirementSignalSummary)
    ? proof.requirementSignalSummary
    : [];
  const requirements = requirementSignalSummary
    .filter(isRecord)
    .slice(0, 20)
    .map((item) => ({
      requirementId: stringValue(item.requirementId, "unknown_requirement"),
      text: safeText(item.requirementTextSummary ?? item.requirementText, MAX_COMPACT_TEXT),
      sourceRole: "core_requirement" as const,
      sourceQuality: stringValue(item.sourceQuality, "fallback"),
      sourceSection: nullableString(item.sourceSection),
      status: stringValue(item.status, "unclear"),
      confidence: clamp01(Number(item.confidence ?? 0)),
      implementationEvidenceCount: numeric(item.implementationEvidenceCount),
      targetedTestEvidenceCount: numeric(item.targetedTestEvidenceCount),
      gapKinds: boundedStrings(arrayOfStrings(item.gapKinds), 20, 80),
      gapSeverities: boundedStrings(arrayOfStrings(item.gapSeverities), 20, 80),
      firstFiles: boundedStrings(arrayOfStrings(item.firstFiles), 6, 240)
    }));
  const testBuildStatus = checkStatusValue(reportSummary.testBuildStatus);
  const deterministicGapKinds = gapKindsFromRequirements(requirements);

  return {
    version: LLM_PROOF_PLANNER_INPUT_SCHEMA_VERSION,
    packageId: `baseline_${stringValue(value.candidateId, "unknown")}`,
    candidateId: nullableString(value.candidateId),
    prUrl: nullableString(value.prUrl),
    sourceTitle: safeText(`${stringValue(value.repository, "unknown repository")}#${stringValue(value.prNumber, "?")}`, 240),
    deterministic: {
      priority: priorityValue(reportSummary.priority),
      evidenceCoverage: numeric(reportSummary.evidenceCoverage),
      confidence: clamp01(Number(reportSummary.confidence ?? 0)),
      testBuildStatus,
      requirementCounts: isRecord(reportSummary.requirementCounts) ? numericRecord(reportSummary.requirementCounts) : {},
      missingTestCount: numeric(reportSummary.missingTestCount),
      firstReviewPriorityFiles: boundedStrings(arrayOfStrings(reportSummary.firstReviewPriorityFiles), 8, 240),
      topRisks: boundedStrings(arrayOfStrings(reportSummary.topRisks), 6, 360),
      limitations: plannerLimitations(arrayOfStrings(reportSummary.limitations)),
      priorityMayBeTooNarrow: quickAssessment.priorityMayBeTooNarrow === true
    },
    diagnostics: {
      testBuildExecutionEvidenceFound: diagnostics.testBuildExecutionEvidenceFound === true || ["passed", "failed"].includes(testBuildStatus),
      failedExecutionEvidenceFound: diagnostics.failedExecutionEvidenceFound === true,
      selfReportedTestingFound: diagnostics.selfReportedTestingFound === true,
      changedTestFilesFound: diagnostics.changedTestFilesFound === true,
      nonExecutionStatusesFound: diagnostics.nonExecutionStatusesFound === true,
      rawLogsFetched: diagnostics.rawLogsFetched === true
    },
    requirements,
    context: contextFromCounts(record(proof.contextRoleCounts)),
    deterministicGapKinds,
    plannerConstraints: plannerConstraintsForPackage(
      priorityValue(reportSummary.priority),
      testBuildStatus,
      quickAssessment.priorityMayBeTooNarrow === true,
      diagnostics.failedExecutionEvidenceFound === true,
      requirements,
      deterministicGapKinds
    ),
    privacyPolicy: privacyPolicy()
  };
}

export function createMockLlmProofPlan(evidencePackage: CompactEvidencePackage): LlmProofPlannerOutput {
  const startedAt = Date.now();
  const priorityNudge = priorityNudgeForPackage(evidencePackage);
  const requirementSuggestions = evidencePackage.requirements.map((requirement) =>
    requirementSuggestionForPackage(requirement, evidencePackage)
  );
  const topSemanticRisks = topSemanticRisksForPackage(evidencePackage);
  const topRiskBasis = topSemanticRiskBasisForPackage(evidencePackage, topSemanticRisks.length);
  const whyBasis = firstReviewerBasis(evidencePackage);

  return {
    version: LLM_PROOF_PLANNER_OUTPUT_SCHEMA_VERSION,
    mode: "mock",
    plannerStatus: "skipped",
    requirementSuggestions,
    contextClassifications: evidencePackage.context.map((item) => ({
      sourceId: item.id,
      role: item.role
    })),
    reviewerSignals: {
      topRisks: topSemanticRisks,
      topRiskBasis,
      why: reviewerWhyForPackage(evidencePackage, topSemanticRisks)[0] ?? "Use deterministic evidence first.",
      whyBasis,
      reviewerQuestion: reviewerQuestionForPackage(evidencePackage),
      reviewerQuestionBasis: firstReviewerBasis(evidencePackage),
      priorityNudge,
      priorityNudgeReason: priorityNudgeReason(priorityNudge, evidencePackage),
      priorityNudgeGapRef: priorityNudgeGapRef(priorityNudge, evidencePackage)
    },
    latencyMs: Math.max(0, Date.now() - startedAt)
  };
}

export function validateLlmProofPlannerOutput(
  value: unknown,
  evidencePackage?: CompactEvidencePackage
): LlmProofPlannerValidationResult {
  const errors: string[] = [];

  if (!isRecord(value)) {
    return { valid: false, errors: ["Planner output must be an object."] };
  }

  if (value.version !== LLM_PROOF_PLANNER_OUTPUT_SCHEMA_VERSION) {
    errors.push(`version must equal ${LLM_PROOF_PLANNER_OUTPUT_SCHEMA_VERSION}.`);
  }
  requireEnum(value.mode, "mode", ["openai", "mock"], errors);
  requireEnum(value.plannerStatus, "plannerStatus", ["completed", "skipped", "failed"], errors);
  validateRequirementSuggestions(value.requirementSuggestions, errors, evidencePackage);
  validateContextClassifications(value.contextClassifications, errors, evidencePackage);
  validateReviewerSignals(value.reviewerSignals, errors);
  requireNumber(value.latencyMs, "latencyMs", errors, { min: 0, max: 600000 });
  validateRequirementReferences(value.requirementSuggestions, errors, evidencePackage);
  validateExactRequirementCoverage(value.requirementSuggestions, errors, evidencePackage);
  validateExactContextCoverage(value.contextClassifications, errors, evidencePackage);
  validateSemanticGuardrails(value, errors, evidencePackage);

  return { valid: errors.length === 0, errors };
}

export function mergeLlmProofPlannerSuggestion(
  evidencePackage: CompactEvidencePackage,
  plannerOutput: unknown
): GuardrailMergeResult {
  const validation = validateLlmProofPlannerOutput(plannerOutput, evidencePackage);
  const output = validation.valid ? plannerOutput as LlmProofPlannerOutput : null;
  const deterministicGapsHidden = output ? hiddenRequirementGaps(evidencePackage, output) : evidencePackage.deterministicGapKinds;
  const acknowledgedGapRefs = new Set(output ? plannerBasisEntries(output)
    .filter(([, basis]) => basis !== SEMANTIC_HYPOTHESIS_REF)
    .map(([, basis]) => basis) : []);
  const failedExecutionEvidenceRemoved = evidencePackage.diagnostics.failedExecutionEvidenceFound &&
    !acknowledgedGapRefs.has("failed_execution");
  const blockedMutationReasons = [
    ...(!validation.valid ? validation.errors : []),
    ...(failedExecutionEvidenceRemoved ? ["LLM suggestion did not preserve deterministic failed execution evidence."] : []),
    ...deterministicGapsHidden.map((kind) => `LLM suggestion did not acknowledge deterministic gap: ${kind}.`)
  ];
  const accepted = validation.valid && !failedExecutionEvidenceRemoved && deterministicGapsHidden.length === 0;

  return {
    accepted,
    validation,
    deterministic: evidencePackage.deterministic,
    suggestion: output,
    mergedReviewerSignals: output && accepted
      ? {
        semanticClarity: summarizeSemanticClarity(output),
        topSemanticRisks: [...output.reviewerSignals.topRisks],
        reviewerWhy: [output.reviewerSignals.why],
        missingProofExplanations: output.requirementSuggestions.map((item) => item.missingProof).filter((item): item is string => Boolean(item)),
        priorityNudge: output.reviewerSignals.priorityNudge,
        priorityNudgeReason: output.reviewerSignals.priorityNudgeReason,
        priorityNudgeGapRef: output.reviewerSignals.priorityNudgeGapRef
      }
      : null,
    guardrails: {
      testBuildStatusChanged: false,
      failedExecutionEvidenceRemoved,
      deterministicGapsHidden,
      deterministicTestBuildStatus: evidencePackage.deterministic.testBuildStatus,
      deterministicFailedExecutionEvidenceFound: evidencePackage.diagnostics.failedExecutionEvidenceFound,
      blockedMutationReasons
    }
  };
}

function llmProofPlannerSystemPrompt(): string {
  return [
    "You are AgentProof's LLM proof planner. Produce semantic suggestions only.",
    "Return compact JSON only. Do not include summaries, token counts, costs, confidence self-scores, or implementation advice.",
    "Do not decide whether tests passed or failed. Deterministic testBuildStatus, priority, confidence, and gaps are immutable outside your output.",
    "Separate core requirements from context, author claims, solution hints, and template noise.",
    "For every requirement ID, provide one complete rewrite sentence, at most two complete proof-plan sentences, and at most one complete missing-proof sentence.",
    "Never cut a sentence to meet a length limit. Rewrite it as a shorter complete sentence ending in punctuation.",
    "Keep every reviewer-facing sentence under 140 characters even though the schema allows a safety margin.",
    "Write concise English for this evaluation and never mix Chinese, Japanese, or Korean characters into an English sentence.",
    "Every risk, why, question, proof-plan item, and missing-proof item must have an aligned basis string: an exact deterministic gap kind or semantic_hypothesis. Never use a basis object.",
    "missingProof must be null when its requirement has no deterministic gap; semantic_hypothesis is only for risks, why, questions, or proof-plan items.",
    "Follow plannerConstraints.allowedBasisRefs, requiredGapRefs, requiredPriorityNudge, and allowedPriorityNudgeRefs exactly; every requiredGapRef must appear in a basis field.",
    "For every context ID, provide exactly one role.",
    `Use consider_higher only for ${PRIORITY_NARROW_REF} or a high/blocker deterministic gap. Never raise blocker priority.`,
    "If deterministic priority is blocker or failed execution exists, priorityNudge must be no_change and priorityNudgeGapRef must be null.",
    "If deterministic testBuildStatus is passed and there is no missing_execution gap, do not claim tests were not run or that execution evidence is missing.",
    "Do not ask for raw CI logs, full logs, stdout, stderr, console output, or raw diff storage as missing proof.",
    "Do not invent files, checks, logs, screenshots, or private facts. Use only the compact evidence package.",
    "The output is not a merge decision and not a correctness label."
  ].join("\n");
}

function normalizePlannerOutput(
  value: unknown,
  latencyMs: number,
  evidencePackage: CompactEvidencePackage
): unknown {
  if (!isRecord(value)) return value;
  const reviewerSignals = record(value.reviewerSignals);
  const priorityNudge = PRIORITY_NUDGES.includes(reviewerSignals.priorityNudge as LlmProofPlannerPriorityNudge)
    ? reviewerSignals.priorityNudge as LlmProofPlannerPriorityNudge
    : "manual_review";

  return {
    ...value,
    version: LLM_PROOF_PLANNER_OUTPUT_SCHEMA_VERSION,
    mode: "openai",
    plannerStatus: "completed",
    reviewerSignals: {
      ...reviewerSignals,
      priorityNudgeReason: priorityNudgeReason(priorityNudge, evidencePackage)
    },
    latencyMs
  };
}

function requirementSuggestionForPackage(
  requirement: CompactProofPlannerRequirement,
  evidencePackage: CompactEvidencePackage
): LlmProofPlannerRequirementSuggestion {
  const proofPlan = proofPlanForRequirement(requirement, evidencePackage);
  const proofPlanBasis = proofPlanBasisForRequirement(requirement, proofPlan.length);
  const missingGapRef = requirement.gapKinds[0] ?? null;
  const missingProof = missingGapRef ? missingProofText(missingGapRef) : null;

  return {
    requirementId: requirement.requirementId,
    rewrite: rewriteRequirement(requirement),
    semanticClarity: requirement.sourceQuality === "manual_check" || requirement.sourceQuality === "fallback"
      ? "needs_human_review"
      : "clear",
    proofPlan,
    proofPlanBasis,
    missingProof,
    missingProofBasis: missingGapRef ? deterministicGapBasis(missingGapRef) : null
  };
}

function rewriteRequirement(requirement: CompactProofPlannerRequirement): string {
  if (requirement.sourceQuality === "manual_check") {
    return "Manually map the PR claim back to a concrete linked task before treating requirement coverage as verified.";
  }

  const text = redactSecrets(requirement.text).replace(/\s+/g, " ").trim();
  if (text.length > 259 || /\btruncated\b/i.test(text)) {
    return "Review the full deterministic requirement text; this semantic planner does not replace the source of truth.";
  }
  if (/[.!?](?:[\"')\]]*)$/.test(text)) return text;
  if (text.length <= 259) return `${text}.`;
  return "Review the full deterministic requirement text; this semantic planner does not replace the source of truth.";
}

function whyRequirementMatters(
  requirement: CompactProofPlannerRequirement,
  evidencePackage: CompactEvidencePackage
): string {
  if (requirement.gapKinds.includes("failed_execution")) {
    return "A relevant deterministic test/build signal failed, so reviewer attention should stay on execution evidence first.";
  }

  if (isSecurityOrCrashText(requirement.text)) {
    return "The requirement references crash, security, traversal, corruption, or regression risk; missing targeted proof is more consequential.";
  }

  if (!evidencePackage.diagnostics.testBuildExecutionEvidenceFound) {
    return "No deterministic public test/build execution evidence was found, so the reviewer should ask for execution proof.";
  }

  return "This is a semantic rewrite only; deterministic proofGraph signals remain the source of truth.";
}

function proofPlanForRequirement(
  requirement: CompactProofPlannerRequirement,
  evidencePackage: CompactEvidencePackage
): string[] {
  const gapPlan = requirement.gapKinds.map(proofPlanTextForGap);
  const supportingPlan = [
    requirement.implementationEvidenceCount > 0
      ? "Inspect the mapped implementation files for the specific behavior change."
      : "Ask for concrete implementation evidence tied to this requirement.",
    requirement.targetedTestEvidenceCount > 0
      ? "Inspect targeted test files or test artifacts that map to this requirement."
      : "Ask for a targeted test or explain why a targeted test is not practical.",
    evidencePackage.deterministic.testBuildStatus === "passed"
      ? "Keep public passing test/build execution as broad execution evidence, not proof of requirement correctness."
      : evidencePackage.deterministic.testBuildStatus === "failed"
        ? "Review failed test/build execution before considering semantic requirement coverage."
        : "Ask for public test/build execution evidence or note why it is unavailable."
  ];

  return uniqueStrings([...gapPlan, ...supportingPlan]).slice(0, 2);
}

function proofPlanTextForGap(kind: string): string {
  switch (kind) {
    case "missing_implementation":
      return "Ask for concrete implementation evidence mapped to this requirement.";
    case "missing_targeted_test":
      return "Ask for a targeted test or a concise explanation of why one is impractical.";
    case "missing_execution":
      return "Ask for public test/build execution evidence or record why it is unavailable.";
    case "failed_execution":
      return "Inspect the failed deterministic test/build signal before reviewing semantic coverage.";
    case "ambiguous_requirement":
      return "Ask a human to identify the exact source-of-truth sentence for this requirement.";
    case "evidence_unavailable":
      return "Record which evidence source was unavailable before interpreting the proof gap.";
    case "visual_proof_missing":
      return "Ask for bounded visual proof that demonstrates the changed behavior.";
    default:
      return `Review the deterministic ${kind} gap before accepting the requirement mapping.`;
  }
}

function missingProofText(kind: string): string {
  switch (kind) {
    case "missing_implementation":
      return "Implementation evidence is not mapped to this requirement.";
    case "missing_targeted_test":
      return "Targeted test evidence is missing or not mapped.";
    case "missing_execution":
      return "Execution proof is missing even if test files or self-reported testing exist.";
    case "failed_execution":
      return "Relevant test/build execution failed and must stay visible.";
    case "ambiguous_requirement":
      return "Requirement wording or source of truth is ambiguous.";
    case "evidence_unavailable":
      return "Required evidence could not be fetched and should not be treated as missing implementation.";
    case "visual_proof_missing":
      return "Visual proof or screenshot evidence is missing.";
    default:
      return `Deterministic gap remains: ${kind}.`;
  }
}

function plannerBasisSchema() {
  return { type: "string", maxLength: 120 } as const;
}

function deterministicGapBasis(gapRef: string): LlmProofPlannerBasis {
  return gapRef;
}

function semanticHypothesisBasis(): LlmProofPlannerBasis {
  return SEMANTIC_HYPOTHESIS_REF;
}

function proofPlanBasisForRequirement(
  requirement: CompactProofPlannerRequirement,
  itemCount: number
): LlmProofPlannerBasis[] {
  const gapBases = requirement.gapKinds.map(deterministicGapBasis);
  return [...gapBases, semanticHypothesisBasis(), semanticHypothesisBasis(), semanticHypothesisBasis()].slice(0, itemCount);
}

function topSemanticRiskBasisForPackage(
  evidencePackage: CompactEvidencePackage,
  itemCount: number
): LlmProofPlannerBasis[] {
  const bases: LlmProofPlannerBasis[] = [];
  if (evidencePackage.diagnostics.failedExecutionEvidenceFound) {
    bases.push(evidencePackage.deterministicGapKinds.includes("failed_execution")
      ? deterministicGapBasis("failed_execution")
      : semanticHypothesisBasis());
  }
  if (evidencePackage.deterministic.priorityMayBeTooNarrow) bases.push(semanticHypothesisBasis());
  if (evidencePackage.deterministicGapKinds.includes("missing_execution")) bases.push(deterministicGapBasis("missing_execution"));
  if (evidencePackage.deterministicGapKinds.includes("missing_targeted_test")) bases.push(deterministicGapBasis("missing_targeted_test"));
  if (evidencePackage.deterministicGapKinds.length > 0) bases.push(deterministicGapBasis(evidencePackage.deterministicGapKinds[0]));
  if (evidencePackage.requirements.some((item) => isSecurityOrCrashText(item.text))) bases.push(semanticHypothesisBasis());
  if (bases.length === 0) bases.push(semanticHypothesisBasis());
  return bases.slice(0, itemCount);
}

function firstReviewerBasis(evidencePackage: CompactEvidencePackage): LlmProofPlannerBasis {
  return evidencePackage.deterministicGapKinds[0]
    ? deterministicGapBasis(evidencePackage.deterministicGapKinds[0])
    : semanticHypothesisBasis();
}

function criticalGapRefs(evidencePackage: CompactEvidencePackage): string[] {
  return criticalGapRefsFromRequirements(evidencePackage.requirements);
}

function criticalGapRefsFromRequirements(requirements: CompactProofPlannerRequirement[]): string[] {
  const refs: string[] = [];
  for (const requirement of requirements) {
    if (requirement.gapSeverities.some((severity) => severity === "high" || severity === "blocker")) {
      refs.push(...requirement.gapKinds);
    }
  }
  return uniqueStrings(refs);
}

function plannerConstraintsForPackage(
  priority: PriorityLevel,
  testBuildStatus: CheckStatus,
  priorityMayBeTooNarrow: boolean,
  failedExecutionEvidenceFound: boolean,
  requirements: CompactProofPlannerRequirement[],
  deterministicGapKinds: string[]
): CompactEvidencePackage["plannerConstraints"] {
  const allowedPriorityNudgeRefs = [
    ...(priorityMayBeTooNarrow ? [PRIORITY_NARROW_REF] : []),
    ...criticalGapRefsFromRequirements(requirements)
  ];
  const criticalRefs = criticalGapRefsFromRequirements(requirements);
  return {
    allowedBasisRefs: [...deterministicGapKinds, SEMANTIC_HYPOTHESIS_REF],
    requiredGapRefs: [...deterministicGapKinds],
    requiredPriorityNudge: priority === "blocker" || testBuildStatus === "failed" || failedExecutionEvidenceFound
      ? "no_change"
      : priorityMayBeTooNarrow
        ? "consider_higher"
        : ["low", "medium"].includes(priority) && criticalRefs.length > 0
          ? "consider_higher"
          : "no_change",
    allowedPriorityNudgeRefs: uniqueStrings(allowedPriorityNudgeRefs)
  };
}

function retryInstruction(errors: string[], evidencePackage: CompactEvidencePackage): string {
  const categories = uniqueStrings(errors.map(validationErrorCategory));
  return [
    "Retry exactly once. Return the same strict JSON shape with shorter complete sentences.",
    "Do not copy the rejected text. Fix only these validation categories:",
    ...categories.map((category) => `- ${category}`),
    `Required requirement IDs: ${evidencePackage.requirements.map((item) => item.requirementId).join(", ") || "none"}.`,
    `Required context IDs: ${evidencePackage.context.map((item) => item.id).join(", ") || "none"}.`,
    `Allowed basis strings: ${[...evidencePackage.deterministicGapKinds, SEMANTIC_HYPOTHESIS_REF].join(", ")}.`,
    `Allowed consider_higher refs: ${[
      ...(evidencePackage.deterministic.priorityMayBeTooNarrow ? [PRIORITY_NARROW_REF] : []),
      ...criticalGapRefs(evidencePackage)
    ].join(", ") || "none"}.`,
    `Required priority behavior: ${requiredPriorityInstruction(evidencePackage)}`,
    "Never mention raw/full logs, stdout, stderr, or console output; request public workflow/check metadata instead.",
    "Every narrative sentence must end with punctuation and remain within its schema limit.",
    "Preserve every deterministic ID and use only valid deterministic gap refs or semantic_hypothesis."
  ].join("\n");
}

function requiredPriorityInstruction(evidencePackage: CompactEvidencePackage): string {
  if (evidencePackage.plannerConstraints.requiredPriorityNudge === "consider_higher") {
    return `use consider_higher with ${evidencePackage.plannerConstraints.allowedPriorityNudgeRefs[0]}.`;
  }
  return `use ${evidencePackage.plannerConstraints.requiredPriorityNudge} with a null priorityNudgeGapRef.`;
}

function validationErrorCategory(error: string): string {
  if (/characters|length/i.test(error)) return "length_exceeded";
  if (/complete sentence|punctuation/i.test(error)) return "incomplete_sentence";
  if (/mixed script|Chinese|Japanese|Korean/i.test(error)) return "mixed_script";
  if (/raw CI logs|full logs|stdout|stderr|console output/i.test(error)) return "raw_execution_material_request";
  if (/execution evidence|test\/build|CI|stdout|stderr|raw log/i.test(error)) return "execution_claim_contradiction";
  if (/basis|gapRef|deterministic gap|provenance/i.test(error)) return "missing_or_invalid_provenance";
  return "schema_or_guardrail_violation";
}

function priorityNudgeForPackage(evidencePackage: CompactEvidencePackage): LlmProofPlannerPriorityNudge {
  if (
    evidencePackage.deterministic.priority === "blocker" ||
    evidencePackage.deterministic.testBuildStatus === "failed" ||
    evidencePackage.diagnostics.failedExecutionEvidenceFound
  ) {
    return "no_change";
  }

  if (evidencePackage.deterministic.priorityMayBeTooNarrow) {
    return "consider_higher";
  }

  if (["low", "medium"].includes(evidencePackage.deterministic.priority) && criticalGapRefs(evidencePackage).length > 0) {
    return "consider_higher";
  }

  return "no_change";
}

function priorityNudgeReason(
  nudge: LlmProofPlannerPriorityNudge,
  evidencePackage: CompactEvidencePackage
): string {
  if (nudge === "consider_higher") {
    return "Semantic risk language plus deterministic gaps may deserve reviewer attention, but this does not change deterministic priority.";
  }

  if (nudge === "consider_lower") {
    return "LLM semantic suggestion sees lower urgency, but deterministic priority remains unchanged.";
  }

  if (nudge === "manual_review") {
    return "Source-of-truth ambiguity requires human review before trusting semantic priority.";
  }

  return `No semantic priority nudge; deterministic priority remains ${evidencePackage.deterministic.priority}.`;
}

function priorityNudgeGapRef(
  nudge: LlmProofPlannerPriorityNudge,
  evidencePackage: CompactEvidencePackage
): string | null {
  if (nudge !== "consider_higher") return null;
  if (evidencePackage.deterministic.priorityMayBeTooNarrow) return PRIORITY_NARROW_REF;
  return criticalGapRefs(evidencePackage)[0] ?? null;
}

function reviewerQuestionForPackage(evidencePackage: CompactEvidencePackage): string {
  if (evidencePackage.diagnostics.failedExecutionEvidenceFound) {
    return "Which failing test/build signal must be resolved before review continues?";
  }
  if (evidencePackage.deterministicGapKinds.includes("missing_targeted_test")) {
    return "Which targeted test or artifact proves the changed behavior for the core requirement?";
  }
  if (evidencePackage.deterministicGapKinds.includes("ambiguous_requirement")) {
    return "Which linked task sentence should be treated as the source of truth?";
  }
  return "Which first file should the reviewer inspect to confirm the requirement mapping?";
}

function topSemanticRisksForPackage(evidencePackage: CompactEvidencePackage): string[] {
  const risks: string[] = [];

  if (evidencePackage.diagnostics.failedExecutionEvidenceFound) {
    risks.push("Failed deterministic test/build evidence remains the first reviewer signal.");
  }

  if (evidencePackage.deterministic.priorityMayBeTooNarrow) {
    risks.push("Deterministic priority may be too narrow for the semantic risk and proof gaps.");
  }

  if (evidencePackage.deterministicGapKinds.includes("missing_execution")) {
    risks.push("Targeted artifacts may exist, but public execution evidence is still missing.");
  }

  if (evidencePackage.deterministicGapKinds.includes("missing_targeted_test")) {
    risks.push("At least one requirement has implementation evidence without targeted test proof.");
  }

  if (evidencePackage.deterministicGapKinds.length > 0) {
    risks.push("Deterministic proof gaps remain and must stay visible in review.");
  }

  if (evidencePackage.requirements.some((item) => isSecurityOrCrashText(item.text))) {
    risks.push("Crash, security, traversal, corruption, or regression wording raises reviewer attention needs.");
  }

  return risks.length > 0
    ? uniqueStrings(risks).slice(0, 2)
    : ["No additional semantic risk appears above the deterministic signals."];
}

function reviewerWhyForPackage(evidencePackage: CompactEvidencePackage, risks: string[]): string[] {
  return boundedStrings([
    `Deterministic test/build status remains ${evidencePackage.deterministic.testBuildStatus}.`,
    ...risks,
    `LLM suggestion confidence is capped below deterministic confidence and cannot change execution status.`
  ], 6, 360);
}

function missingProofForPackage(evidencePackage: CompactEvidencePackage): string[] {
  const messages = evidencePackage.deterministicGapKinds.map((kind) => missingProofText(kind));
  if (!evidencePackage.diagnostics.testBuildExecutionEvidenceFound) {
    messages.push("No deterministic public test/build execution evidence was collected.");
  }
  if (evidencePackage.deterministic.missingTestCount > 0) {
    messages.push(`${evidencePackage.deterministic.missingTestCount} deterministic missing-test finding(s) remain visible.`);
  }

  return boundedStrings(messages.length > 0 ? messages : ["No deterministic missing-proof gap was summarized."], 8, 360);
}

function changedFilesFromReport(report: VerificationReport): CompactProofPlannerChangedFile[] {
  const byPath = new Map<string, CompactProofPlannerChangedFile>();

  for (const item of report.evidenceIndex) {
    if (!["changed_file", "diff", "test"].includes(item.kind)) continue;
    const path = item.locator || item.label;
    if (!path || byPath.has(path)) continue;
    byPath.set(path, {
      path: safeText(path, 240),
      kind: item.kind === "test" ? "test" : inferFileKind(path),
      summary: safeText(item.summary, 360)
    });
  }

  for (const item of report.reviewPriority) {
    if (!byPath.has(item.path)) {
      byPath.set(item.path, {
        path: safeText(item.path, 240),
        kind: inferFileKind(item.path),
        summary: safeText(item.reason, 360)
      });
    }
  }

  return [...byPath.values()].slice(0, 30);
}

function contextFromCounts(counts: Record<string, unknown>): CompactProofPlannerContext[] {
  return Object.entries(counts)
    .filter(([role, count]) => PLANNER_ROLES.includes(role as LlmProofPlannerRole) && role !== "core_requirement" && numeric(count) > 0)
    .slice(0, 20)
    .map(([role, count], index) => ({
      id: `context_count_${index + 1}`,
      role: role as Exclude<LlmProofPlannerRole, "core_requirement">,
      sourceQuality: "fallback",
      sourceSection: null,
      text: `${numeric(count)} deterministic context signal(s) were classified as ${role}.`
    }));
}

function summarizeRequirementsAsSourceTruth(requirements: CompactProofPlannerRequirement[]): string {
  if (requirements.length === 0) {
    return "No requirement candidates were retained in the deterministic summary-only baseline.";
  }

  return compactText(requirements.map((item) => `- ${item.text}`).join("\n"), MAX_PACKAGE_TEXT);
}

function validateRequirementSuggestions(
  value: unknown,
  errors: string[],
  evidencePackage?: CompactEvidencePackage
) {
  const items = validateArray(value, "requirementSuggestions", errors, 20);
  if (!items) return;

  items.forEach((item, index) => {
    const path = `requirementSuggestions[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    requireString(item.requirementId, `${path}.requirementId`, errors, 120);
    requireNarrativeString(item.rewrite, `${path}.rewrite`, errors, 280);
    requireEnum(item.semanticClarity, `${path}.semanticClarity`, SEMANTIC_CLARITY, errors);
    validateNarrativeStringArray(item.proofPlan, `${path}.proofPlan`, errors, 2, 220);
    validateBasisArray(item.proofPlanBasis, `${path}.proofPlanBasis`, errors, 2);
    if (Array.isArray(item.proofPlan) && Array.isArray(item.proofPlanBasis) && item.proofPlan.length !== item.proofPlanBasis.length) {
      errors.push(`${path}.proofPlanBasis must align one-to-one with proofPlan.`);
    }
    if (item.missingProof !== null) {
      requireNarrativeString(item.missingProof, `${path}.missingProof`, errors, 180);
      validateBasis(item.missingProofBasis, `${path}.missingProofBasis`, errors);
    } else if (item.missingProofBasis !== null) {
      errors.push(`${path}.missingProofBasis must be null when missingProof is null.`);
    }
    const requirement = evidencePackage?.requirements.find((candidate) => candidate.requirementId === item.requirementId);
    if (requirement) {
      if (Array.isArray(item.proofPlanBasis)) {
        item.proofPlanBasis.forEach((basis, basisIndex) => {
          if (typeof basis === "string" && basis !== SEMANTIC_HYPOTHESIS_REF && !requirement.gapKinds.includes(basis)) {
            errors.push(`${path}.proofPlanBasis[${basisIndex}] must reference a gap on the same deterministic requirement.`);
          }
        });
      }
      if (requirement.gapKinds.length === 0 && item.missingProof !== null) {
        errors.push(`${path}.missingProof must be null when no deterministic requirement gap exists.`);
      }
      if (requirement.gapKinds.length > 0 && item.missingProof === null) {
        errors.push(`${path}.missingProof must explain one deterministic requirement gap.`);
      }
      if (typeof item.missingProofBasis === "string" && !requirement.gapKinds.includes(item.missingProofBasis)) {
        errors.push(`${path}.missingProofBasis must reference a gap on the same deterministic requirement.`);
      }
    }
  });
}

function validateContextClassifications(
  value: unknown,
  errors: string[],
  evidencePackage?: CompactEvidencePackage
) {
  const items = validateArray(value, "contextClassifications", errors, 30);
  if (!items) return;
  const contextIds = new Set(evidencePackage?.context.map((item) => item.id) ?? []);

  items.forEach((item, index) => {
    const path = `contextClassifications[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${path} must be an object.`);
      return;
    }
    requireString(item.sourceId, `${path}.sourceId`, errors, 120);
    requireEnum(item.role, `${path}.role`, PLANNER_ROLES.filter((role) => role !== "core_requirement"), errors);
    if (evidencePackage && typeof item.sourceId === "string" && !contextIds.has(item.sourceId)) {
      errors.push(`${path}.sourceId must reference a deterministic context signal.`);
    }
  });
}

function validateReviewerSignals(value: unknown, errors: string[]) {
  if (!isRecord(value)) {
    errors.push("reviewerSignals must be an object.");
    return;
  }

  validateNarrativeStringArray(value.topRisks, "reviewerSignals.topRisks", errors, 2, 220);
  validateBasisArray(value.topRiskBasis, "reviewerSignals.topRiskBasis", errors, 2);
  if (Array.isArray(value.topRisks) && Array.isArray(value.topRiskBasis) && value.topRisks.length !== value.topRiskBasis.length) {
    errors.push("reviewerSignals.topRiskBasis must align one-to-one with topRisks.");
  }
  requireNarrativeString(value.why, "reviewerSignals.why", errors, 220);
  validateBasis(value.whyBasis, "reviewerSignals.whyBasis", errors);
  requireNarrativeString(value.reviewerQuestion, "reviewerSignals.reviewerQuestion", errors, 220);
  validateBasis(value.reviewerQuestionBasis, "reviewerSignals.reviewerQuestionBasis", errors);
  requireEnum(value.priorityNudge, "reviewerSignals.priorityNudge", PRIORITY_NUDGES, errors);
  requireNarrativeString(value.priorityNudgeReason, "reviewerSignals.priorityNudgeReason", errors, 180);
  if (value.priorityNudgeGapRef !== null) {
    requireString(value.priorityNudgeGapRef, "reviewerSignals.priorityNudgeGapRef", errors, 200);
  }
}

function validateStringArray(value: unknown, path: string, errors: string[], maxItems: number, maxLength: number) {
  const items = validateArray(value, path, errors, maxItems);
  if (!items) return;

  items.forEach((item, index) => requireString(item, `${path}[${index}]`, errors, maxLength));
}

function validateNarrativeStringArray(value: unknown, path: string, errors: string[], maxItems: number, maxLength: number) {
  const items = validateArray(value, path, errors, maxItems);
  if (!items) return;
  items.forEach((item, index) => requireNarrativeString(item, `${path}[${index}]`, errors, maxLength));
}

function validateBasisArray(value: unknown, path: string, errors: string[], maxItems: number) {
  const items = validateArray(value, path, errors, maxItems);
  if (!items) return;
  items.forEach((item, index) => validateBasis(item, `${path}[${index}]`, errors));
}

function validateBasis(value: unknown, path: string, errors: string[]) {
  requireString(value, path, errors, 120);
}

function validateArray(value: unknown, path: string, errors: string[], maxItems: number): unknown[] | null {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return null;
  }
  if (value.length > maxItems) {
    errors.push(`${path} must contain at most ${maxItems} item(s).`);
  }
  return value;
}

function requireString(value: unknown, path: string, errors: string[], maxLength: number) {
  if (typeof value !== "string") {
    errors.push(`${path} must be a string.`);
    return;
  }
  if (value.length > maxLength) {
    errors.push(`${path} must be at most ${maxLength} characters.`);
  }
  if (containsSecretPattern(value)) {
    errors.push(`${path} must not contain secret-like material.`);
  }
  if (containsPromptInjectionOrUnsupportedClaim(value)) {
    errors.push(`${path} must not echo prompt-injection or unsupported merge/correctness claims.`);
  }
}

function requireNarrativeString(value: unknown, path: string, errors: string[], maxLength: number) {
  requireString(value, path, errors, maxLength);
  if (typeof value !== "string") return;
  if (!/[.!?](?:[\"')\]]*)$/.test(value.trim())) {
    errors.push(`${path} must be a complete sentence ending in punctuation.`);
  }
  if (containsMixedLatinCjk(value)) {
    errors.push(`${path} must not contain mixed Latin and Chinese, Japanese, or Korean script.`);
  }
}

function requireEnum<T extends readonly string[]>(value: unknown, path: string, allowed: T, errors: string[]) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push(`${path} must be one of ${allowed.join(", ")}.`);
  }
}

function requireNumber(
  value: unknown,
  path: string,
  errors: string[],
  options: { min?: number; max?: number; equals?: number } = {}
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${path} must be a finite number.`);
    return;
  }

  if (options.equals !== undefined && value !== options.equals) {
    errors.push(`${path} must equal ${options.equals}.`);
  }
  if (options.min !== undefined && value < options.min) {
    errors.push(`${path} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && value > options.max) {
    errors.push(`${path} must be at most ${options.max}.`);
  }
}

function gapKindsFromRequirements(requirements: CompactProofPlannerRequirement[]): string[] {
  return uniqueStrings(requirements.flatMap((item) => item.gapKinds));
}

function hasGapKind(requirements: CompactProofPlannerRequirement[], gapKind: string): boolean {
  return requirements.some((item) => item.gapKinds.includes(gapKind));
}

function validateRequirementReferences(
  value: unknown,
  errors: string[],
  evidencePackage?: CompactEvidencePackage
) {
  if (!evidencePackage || !Array.isArray(value)) return;

  const requirementIds = new Set(evidencePackage.requirements.map((item) => item.requirementId));
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) continue;
    const path = `requirementSuggestions[${index}]`;
    if (typeof item.requirementId === "string" && !requirementIds.has(item.requirementId)) {
      errors.push(`${path}.requirementId must reference a deterministic requirement.`);
    }
  }
}

function validateExactRequirementCoverage(
  value: unknown,
  errors: string[],
  evidencePackage?: CompactEvidencePackage
) {
  if (!evidencePackage || !Array.isArray(value)) return;
  const expectedIds = evidencePackage.requirements.map((item) => item.requirementId);
  const actualIds = value
    .filter(isRecord)
    .map((item) => item.requirementId)
    .filter((id): id is string => typeof id === "string");
  pushSetDiffErrors(expectedIds, actualIds, "requirementSuggestions.requirementId", errors);
}

function validateExactContextCoverage(
  value: unknown,
  errors: string[],
  evidencePackage?: CompactEvidencePackage
) {
  if (!evidencePackage || !Array.isArray(value)) return;
  const expectedIds = evidencePackage.context.map((item) => item.id);
  const actualIds = value
    .filter(isRecord)
    .map((item) => item.sourceId)
    .filter((id): id is string => typeof id === "string");
  pushSetDiffErrors(expectedIds, actualIds, "contextClassifications.sourceId", errors);
}

function validateSemanticGuardrails(
  value: Record<string, unknown>,
  errors: string[],
  evidencePackage?: CompactEvidencePackage
) {
  if (!evidencePackage) return;
  const reviewerSignals = record(value.reviewerSignals);
  const priorityNudge = reviewerSignals.priorityNudge;
  const priorityNudgeGapRef = reviewerSignals.priorityNudgeGapRef;
  const criticalRefs = new Set(criticalGapRefs(evidencePackage));
  const allowedPriorityRefs = new Set([
    ...criticalRefs,
    ...(evidencePackage.deterministic.priorityMayBeTooNarrow ? [PRIORITY_NARROW_REF] : [])
  ]);
  if (priorityNudge !== evidencePackage.plannerConstraints.requiredPriorityNudge) {
    errors.push(`reviewerSignals.priorityNudge must equal plannerConstraints.requiredPriorityNudge (${evidencePackage.plannerConstraints.requiredPriorityNudge}).`);
  }

  if (evidencePackage.deterministic.priority === "blocker" && priorityNudge === "consider_higher") {
    errors.push("reviewerSignals.priorityNudge cannot be consider_higher when deterministic priority is blocker.");
  }
  if (
    priorityNudge === "consider_lower" &&
    (evidencePackage.deterministic.priority === "blocker" || evidencePackage.diagnostics.failedExecutionEvidenceFound)
  ) {
    errors.push("reviewerSignals.priorityNudge cannot be consider_lower for blocker priority or failed execution evidence.");
  }

  if (priorityNudge === "consider_higher") {
    if (typeof priorityNudgeGapRef !== "string" || !allowedPriorityRefs.has(priorityNudgeGapRef)) {
      errors.push(`reviewerSignals.priorityNudgeGapRef must reference ${PRIORITY_NARROW_REF} or a high/blocker deterministic gap.`);
    }
  } else if (priorityNudgeGapRef !== null) {
    errors.push("reviewerSignals.priorityNudgeGapRef must be null unless priorityNudge is consider_higher.");
  }

  if (
    evidencePackage.deterministic.priorityMayBeTooNarrow &&
    evidencePackage.deterministic.priority !== "blocker" &&
    evidencePackage.deterministic.testBuildStatus !== "failed" &&
    !evidencePackage.diagnostics.failedExecutionEvidenceFound &&
    priorityNudge !== "consider_higher"
  ) {
    errors.push(`reviewerSignals.priorityNudge must be consider_higher when deterministic ${PRIORITY_NARROW_REF} is true.`);
  }

  for (const [path, basis] of plannerBasisEntries(value)) {
    if (basis !== SEMANTIC_HYPOTHESIS_REF && !evidencePackage.deterministicGapKinds.includes(basis)) {
      errors.push(`${path} must reference an existing deterministic gap or semantic_hypothesis.`);
    }
  }
  const acknowledgedGapRefs = new Set(plannerBasisEntries(value)
    .map(([, basis]) => basis)
    .filter((basis) => basis !== SEMANTIC_HYPOTHESIS_REF));
  for (const gapRef of evidencePackage.deterministicGapKinds) {
    if (!acknowledgedGapRefs.has(gapRef)) errors.push(`Planner output must acknowledge deterministic gap ${gapRef}.`);
  }
  if (evidencePackage.diagnostics.failedExecutionEvidenceFound && !acknowledgedGapRefs.has("failed_execution")) {
    errors.push("Planner output must keep failed_execution visible in reviewer-facing provenance.");
  }

  for (const [path, text] of reviewerFacingTextEntries(value)) {
    if (
      evidencePackage.deterministic.testBuildStatus === "passed" &&
      !evidencePackage.deterministicGapKinds.includes("missing_execution") &&
      claimsMissingExecution(text)
    ) {
      errors.push(`${path} cannot claim or request execution evidence when deterministic test/build status passed and no missing_execution gap exists.`);
    }
    if (
      (evidencePackage.deterministic.testBuildStatus === "failed" || evidencePackage.diagnostics.failedExecutionEvidenceFound) &&
      claimsPassingExecution(text)
    ) {
      errors.push(`${path} cannot claim passing execution when deterministic failed execution evidence exists.`);
    }
    if (
      ["unknown", "pending"].includes(evidencePackage.deterministic.testBuildStatus) &&
      (claimsPassingExecution(text) || claimsFailedExecution(text))
    ) {
      errors.push(`${path} cannot decide execution status when deterministic test/build status is ${evidencePackage.deterministic.testBuildStatus}.`);
    }
    if (requestsRawExecutionMaterial(text)) {
      errors.push(`${path} cannot request raw CI logs, full logs, stdout, stderr, or console output.`);
    }
    if (evidencePackage.deterministicGapKinds.length > 0 && falselyReassuresAboutGaps(text)) {
      errors.push(`${path} cannot claim full proof or no remaining gaps while deterministic gaps exist.`);
    }
  }
}

function hiddenRequirementGaps(
  evidencePackage: CompactEvidencePackage,
  output: LlmProofPlannerOutput
): string[] {
  const acknowledged = new Set(plannerBasisEntries(output)
    .filter(([, basis]) => basis !== SEMANTIC_HYPOTHESIS_REF)
    .map(([, basis]) => basis));
  return evidencePackage.deterministicGapKinds.filter((kind) => !acknowledged.has(kind));
}

function pushSetDiffErrors(expectedIds: string[], actualIds: string[], path: string, errors: string[]) {
  const expected = new Set(expectedIds);
  const actual = new Set(actualIds);
  const duplicates = actualIds.filter((id, index) => actualIds.indexOf(id) !== index);
  const missing = expectedIds.filter((id) => !actual.has(id));
  const unknown = actualIds.filter((id) => !expected.has(id));

  if (duplicates.length > 0) {
    errors.push(`${path} contains duplicate ID(s): ${uniqueStrings(duplicates).join(", ")}.`);
  }
  if (missing.length > 0) {
    errors.push(`${path} is missing deterministic ID(s): ${missing.join(", ")}.`);
  }
  if (unknown.length > 0) {
    errors.push(`${path} contains unknown deterministic ID(s): ${uniqueStrings(unknown).join(", ")}.`);
  }
}

function stringsInPlannerOutput(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsInPlannerOutput);
  if (isRecord(value)) return Object.values(value).flatMap(stringsInPlannerOutput);
  return [];
}

function reviewerFacingTextEntries(value: Record<string, unknown>): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const suggestions = Array.isArray(value.requirementSuggestions) ? value.requirementSuggestions : [];
  suggestions.forEach((item, index) => {
    if (!isRecord(item)) return;
    if (typeof item.rewrite === "string") entries.push([`requirementSuggestions[${index}].rewrite`, item.rewrite]);
    if (Array.isArray(item.proofPlan)) {
      item.proofPlan.forEach((text, planIndex) => {
        if (typeof text === "string") entries.push([`requirementSuggestions[${index}].proofPlan[${planIndex}]`, text]);
      });
    }
    if (typeof item.missingProof === "string") entries.push([`requirementSuggestions[${index}].missingProof`, item.missingProof]);
  });
  const signals = record(value.reviewerSignals);
  if (Array.isArray(signals.topRisks)) {
    signals.topRisks.forEach((text, index) => {
      if (typeof text === "string") entries.push([`reviewerSignals.topRisks[${index}]`, text]);
    });
  }
  for (const key of ["why", "reviewerQuestion", "priorityNudgeReason"] as const) {
    if (typeof signals[key] === "string") entries.push([`reviewerSignals.${key}`, signals[key]]);
  }
  return entries;
}

function plannerBasisEntries(value: unknown): Array<[string, LlmProofPlannerBasis]> {
  if (!isRecord(value)) return [];
  const entries: Array<[string, LlmProofPlannerBasis]> = [];
  const suggestions = Array.isArray(value.requirementSuggestions) ? value.requirementSuggestions : [];
  suggestions.forEach((item, index) => {
    if (!isRecord(item)) return;
    if (Array.isArray(item.proofPlanBasis)) {
      item.proofPlanBasis.forEach((basis, basisIndex) => {
        if (isPlannerBasis(basis)) entries.push([`requirementSuggestions[${index}].proofPlanBasis[${basisIndex}]`, basis]);
      });
    }
    if (isPlannerBasis(item.missingProofBasis)) {
      entries.push([`requirementSuggestions[${index}].missingProofBasis`, item.missingProofBasis]);
    }
  });
  const signals = record(value.reviewerSignals);
  if (Array.isArray(signals.topRiskBasis)) {
    signals.topRiskBasis.forEach((basis, index) => {
      if (isPlannerBasis(basis)) entries.push([`reviewerSignals.topRiskBasis[${index}]`, basis]);
    });
  }
  if (isPlannerBasis(signals.whyBasis)) entries.push(["reviewerSignals.whyBasis", signals.whyBasis]);
  if (isPlannerBasis(signals.reviewerQuestionBasis)) entries.push(["reviewerSignals.reviewerQuestionBasis", signals.reviewerQuestionBasis]);
  return entries;
}

function isPlannerBasis(value: unknown): value is LlmProofPlannerBasis {
  return typeof value === "string" && value.length > 0;
}

function claimsMissingExecution(value: string): boolean {
  const normalized = normalizeSemanticText(value);
  return /\b(?:no|missing|without|lack(?:s|ing)?|absent|unavailable)\b.{0,55}\b(?:execution|ci|test\/build|test or build|test and build)\b.{0,30}\b(?:evidence|proof|run|result|status)?\b/i.test(normalized) ||
    /\b(?:tests?|build|ci)\b.{0,30}\b(?:not|never|weren't|were not|hasn't|has not|haven't|have not)\b.{0,20}\b(?:run|executed|available)\b/i.test(normalized) ||
    /\bexecution\b.{0,25}\b(?:not|never|wasn't|was not)\b.{0,20}\b(?:shown|demonstrated|proven|available)\b/i.test(normalized) ||
    /\b(?:provide|add|attach|show|supply|rerun|run)\b.{0,45}\b(?:ci|test\/build|test or build|test and build)\b.{0,30}\b(?:run|execution|evidence|result|status)\b/i.test(normalized);
}

function claimsPassingExecution(value: string): boolean {
  const normalized = normalizeSemanticText(value);
  return !hasNegatedExecutionVerdict(normalized, "passed|passing|succeeded|successful|green") &&
    /(?:^|[.!?]\s+)(?:the\s+)?(?:all\s+)?(?:public\s+)?(?:tests?|suite|pipeline|build|ci|checks?|workflows?)\s+(?:have\s+|has\s+|were\s+|was\s+|are\s+|is\s+)?(?:passed|passing|succeeded|successful|green)\b/i.test(normalized);
}

function claimsFailedExecution(value: string): boolean {
  const normalized = normalizeSemanticText(value);
  return !hasNegatedExecutionVerdict(normalized, "failed|failing|broken|red") &&
    /(?:^|[.!?]\s+)(?:the\s+)?(?:all\s+)?(?:public\s+)?(?:tests?|suite|pipeline|build|ci|checks?|workflows?)\s+(?:have\s+|has\s+|were\s+|was\s+|are\s+|is\s+)?(?:failed|failing|broken|red)\b/i.test(normalized);
}

function requestsRawExecutionMaterial(value: string): boolean {
  const normalized = normalizeSemanticText(value);
  return /\b(?:provide|attach|show|supply|store|retain|upload|include|need|required|request|ask for)\b.{0,50}\b(?:(?:raw|full|complete)\s+(?:ci\s+)?logs?|stdout|stderr|console output)\b/i.test(normalized) ||
    /\b(?:provide|attach|show|supply|store|retain|upload|include)\b.{0,50}\braw\s+(?:workflow|execution|pipeline)\s+(?:trace|artifact|output)\b/i.test(normalized) ||
    /\b(?:raw|full|complete)\s+(?:ci\s+)?(?:logs?|stdout|stderr|console output)\b.{0,40}\b(?:proof|required|needed|missing)\b/i.test(normalized);
}

function hasNegatedExecutionVerdict(value: string, verdictPattern: string): boolean {
  return new RegExp(`\\b(?:no|not|without|missing|unavailable|cannot confirm|does not show)\\b.{0,55}\\b(?:tests?|build|ci|checks?|workflows?)\\b.{0,25}\\b(?:${verdictPattern})\\b`, "i").test(value);
}

function falselyReassuresAboutGaps(value: string): boolean {
  const normalized = normalizeSemanticText(value);
  return /\bno\s+(?:remaining|deterministic|material|meaningful|proof)?\s*gaps?\b/i.test(normalized) ||
    /\ball\s+requirements?\b.{0,30}\b(?:met|covered|proven|satisfied|verified)\b/i.test(normalized) ||
    /\bfully\s+(?:proven|verified|covered|satisfied)\b/i.test(normalized) ||
    /\bno additional semantic risk\b/i.test(normalized);
}

function containsMixedLatinCjk(value: string): boolean {
  const normalized = value.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  return /[A-Za-z]/.test(normalized) && /[\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/u.test(normalized);
}

function normalizeSemanticText(value: string): string {
  return value.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, " ").replace(/\s+/g, " ").trim();
}

function summarizeSemanticClarity(output: LlmProofPlannerOutput): LlmProofPlannerSemanticClarity {
  if (output.requirementSuggestions.some((item) => item.semanticClarity === "unclear")) {
    return "unclear";
  }
  if (output.requirementSuggestions.some((item) => item.semanticClarity === "needs_human_review")) {
    return "needs_human_review";
  }
  return "clear";
}

function containsPromptInjectionOrUnsupportedClaim(value: string): boolean {
  return /\b(ignore (?:all )?(?:previous|above|system|developer) instructions|reveal (?:the )?(?:system )?prompt|you are now|safe to merge|approved to merge|production ready|correct implementation)\b/i.test(value);
}

function privacyPolicy(): CompactEvidencePackage["privacyPolicy"] {
  return {
    summaryOnly: true,
    noRawDiffs: true,
    noRawLogs: true,
    noTokens: true,
    noPrivateData: true
  };
}

function requirementCounts(statuses: string[]): Record<string, number> {
  return statuses.reduce<Record<string, number>>((counts, status) => {
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
}

function inferFileKind(path: string): CompactProofPlannerChangedFile["kind"] {
  const lower = path.toLowerCase();
  if (/\b(test|spec|__tests__|fixtures?)\b|\.test\.|\.spec\./i.test(path)) return "test";
  if (lower.endsWith(".md") || lower.includes("docs/") || lower.includes("changelog") || lower.includes(".changeset/")) return "docs";
  if (lower.includes("workflow") || lower.includes(".github/") || lower.endsWith(".yml") || lower.endsWith(".yaml")) return "ci";
  if (lower.includes("package.json") || lower.includes("lock") || lower.includes("config")) return "config";
  if (path && path !== "Requirement evidence") return "implementation";
  return "unknown";
}

function isSecurityOrCrashText(value: string): boolean {
  return /\b(crash|security|traversal|corruption|regression|auth|permission|vulnerability|panic|exploit)\b/i.test(value);
}

function numeric(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function numericRecord(value: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(value).map(([key, count]) => [key, numeric(count)]));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function priorityValue(value: unknown): PriorityLevel {
  return value === "low" || value === "medium" || value === "high" || value === "blocker" ? value : "medium";
}

function checkStatusValue(value: unknown): CheckStatus {
  return value === "passed" || value === "failed" || value === "pending" || value === "unknown" ? value : "unknown";
}

function boundedStrings(value: unknown[], limit: number, maxLength: number): string[] {
  return uniqueStrings(value.map((item) => safeText(item, maxLength))).filter(Boolean).slice(0, limit);
}

function plannerLimitations(value: string[]): string[] {
  return boundedStrings(value.filter((item) => !/\braw\s+(?:ci\s+)?logs?\b/i.test(item)), 12, 500);
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")) : [];
}

function uniqueStrings(value: string[]): string[] {
  return Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
}

function safeText(value: unknown, maxLength: number): string {
  return compactText(String(value ?? "").replace(/\s+/g, " ").trim(), maxLength);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
