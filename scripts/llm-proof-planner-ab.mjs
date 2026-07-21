#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildEvaluationReproducibility,
  hasCompleteReproducibilityMetadata,
  normalizeModelIdentifier,
  PLANNER_INPUT_SCHEMA_VERSION,
  PLANNER_OUTPUT_SCHEMA_VERSION
} from "./llm-proof-planner-eval-metadata.mjs";

const root = process.cwd();
const baselinePath = "eval/deterministic-baseline-blind-results.json";
const previousAbPath = "eval/llm-proof-planner-token-optimization-results.json";
const defaultResultsPath = "eval/llm-proof-planner-semantic-integrity-results.json";
const defaultReportPath = "eval/llm-proof-planner-semantic-integrity-report.md";
const resultsPath = safeEvaluationOutputPath(process.env.AGENTPROOF_LLM_PROOF_PLANNER_RESULTS_PATH, defaultResultsPath);
const reportPath = safeEvaluationOutputPath(process.env.AGENTPROOF_LLM_PROOF_PLANNER_REPORT_PATH, defaultReportPath);
const mode = process.env.AGENTPROOF_LLM_PROOF_PLANNER_MODE === "openai" ? "openai" : "dry-run";
const apiKey = process.env.OPENAI_API_KEY?.trim() || "";
const actualLlmAttempted = mode === "openai" && Boolean(apiKey);
const repeatCount = actualLlmAttempted ? boundedInteger(process.env.AGENTPROOF_LLM_PROOF_PLANNER_RUNS, 3, 1, 10) : 1;
const candidateLimit = boundedInteger(process.env.AGENTPROOF_LLM_PROOF_PLANNER_LIMIT, 0, 0, 1000);
const openaiTimeoutMs = boundedInteger(process.env.AGENTPROOF_LLM_PROOF_PLANNER_TIMEOUT_MS, 60_000, 5_000, 300_000);
const maxOutputTokens = boundedInteger(process.env.AGENTPROOF_LLM_PROOF_PLANNER_MAX_OUTPUT_TOKENS, 2600, 400, 5000);
const requestedModel = normalizeModelIdentifier(process.env.OPENAI_MODEL) || "gpt-5-mini";
const reasoningEffort = normalizeReasoningEffort(process.env.AGENTPROOF_LLM_PROOF_PLANNER_REASONING_EFFORT);
const promptVersion = "llm-proof-planner-v2-semantic-integrity";
const schemaVersion = PLANNER_OUTPUT_SCHEMA_VERSION;
const gitCommit = currentGitCommit();
const gitState = currentGitState();
const devTenSmokeMode = process.env.AGENTPROOF_LLM_PROOF_PLANNER_DEV10_SMOKE === "1";
const noClobberOutputs = process.env.AGENTPROOF_LLM_PROOF_PLANNER_NO_CLOBBER === "1";
const PRIORITY_NARROW_REF = "priority_may_be_too_narrow";
const SEMANTIC_HYPOTHESIS_REF = "semantic_hypothesis";

async function main() {
  if (process.env.AGENTPROOF_LLM_PROOF_PLANNER_REQUIRE_API_KEY === "1" && !apiKey) {
    throw new Error("OPENAI_API_KEY is required before any LLM evaluation network call or output write.");
  }
  if (noClobberOutputs && (existsSync(join(root, resultsPath)) || existsSync(join(root, reportPath)))) {
    throw new Error("Evaluation output already exists; no-clobber preflight refused to overwrite it.");
  }
  if (process.env.AGENTPROOF_LLM_PROOF_PLANNER_RENDER_EXISTING === "1") {
    const existing = readJson(join(root, resultsPath));
    refreshExistingSummary(existing);
    existing.humanAbReadiness = assessHumanAbReadiness(existing.summary, existing.modelSettings, existing.reproducibility);
    writeJson(resultsPath, existing);
    writeFileSync(join(root, reportPath), renderReport(existing));
    console.log(`Refreshed ${resultsPath}`);
    console.log(`Refreshed ${reportPath}`);
    return;
  }
  const baseline = readJson(join(root, baselinePath));
  const previousAb = readJsonIfExists(join(root, previousAbPath));
  const results = [];
  const baselineSchemaMeasurements = [];

  const baselineResults = candidateLimit > 0
    ? (baseline.results ?? []).slice(0, candidateLimit)
    : (baseline.results ?? []);

  if (devTenSmokeMode) assertDevTenSmokePreflight(baselineResults);

  for (let runIndex = 1; runIndex <= repeatCount; runIndex += 1) {
    for (const baselineResult of baselineResults) {
      results.push(await runCandidate(baselineResult, runIndex));
    }
  }

  const summary = summarizeResults(results, actualLlmAttempted, previousAb, baselineSchemaMeasurements);
  const reproducibility = buildEvaluationReproducibility({
    requestedModel: actualLlmAttempted ? requestedModel : null,
    resolvedModels: summary.tokenUsage.resolvedModels ?? [],
    promptVersion,
    sourceCommit: gitCommit,
    workingTreeDirty: gitState.dirty,
    workingTreeChangedPathCount: gitState.changedPathCount,
    promptText: plannerPrompt(),
    plannerSchema: plannerSchema(),
    harnessSource: readFileSync(join(root, "scripts/llm-proof-planner-ab.mjs"), "utf8"),
    baselineSource: readFileSync(join(root, baselinePath), "utf8"),
    previousAbSource: previousAb ? readFileSync(join(root, previousAbPath), "utf8") : null
  });
  const output = {
    privacy: "llm-proof-planner-semantic-integrity-summary-only",
    status: actualLlmAttempted
      ? "llm_proof_planner_ab_needs_human_review"
      : "harness_complete_real_ab_pending",
    evaluationState: {
      harness: "harness_complete",
      realAb: mode === "openai" && apiKey ? "real_ab_attempted" : "real_ab_pending",
      baselineSetRole: "regression_dev_set_not_holdout",
      mockResultsArePerformanceEvidence: false
    },
    generatedAt: new Date().toISOString(),
    baselineSource: baselinePath,
    previousAbSource: previousAb ? previousAbPath : null,
    mode,
    actualLlmAttempted,
    repeatCount,
    requestedCandidateCount: baselineResults.length,
    openaiTimeoutMs: actualLlmAttempted ? openaiTimeoutMs : null,
    modelSettings: {
      requestedModel: actualLlmAttempted ? requestedModel : null,
      reasoningEffort: actualLlmAttempted ? reasoningEffort : null,
      maxOutputTokens: actualLlmAttempted ? maxOutputTokens : null,
      promptVersion,
      schemaVersion,
      plannerInputSchemaVersion: PLANNER_INPUT_SCHEMA_VERSION,
      plannerOutputSchemaVersion: PLANNER_OUTPUT_SCHEMA_VERSION,
      modelSnapshot: reproducibility.modelSnapshot,
      resolvedModelSnapshots: reproducibility.resolvedModelSnapshots,
      modelSnapshotStatus: reproducibility.modelSnapshotStatus,
      sourceCommit: reproducibility.sourceCommit,
      workingTreeDirty: reproducibility.workingTreeDirty,
      workingTreeChangedPathCount: reproducibility.workingTreeChangedPathCount,
      gitCommit,
      gitDirty: gitState.dirty,
      gitChangedPathCount: gitState.changedPathCount
    },
    reproducibility,
    sourcePolicy: sourcePolicy(),
    baselineSchemaMeasurements,
    results,
    summary
  };
  output.humanAbReadiness = assessHumanAbReadiness(output.summary, output.modelSettings, output.reproducibility);

  writeJson(resultsPath, output);
  writeFileSync(join(root, reportPath), renderReport(output));

  console.log(`Wrote ${resultsPath}`);
  console.log(`Wrote ${reportPath}`);
  console.log(output.summary);
}

function refreshExistingSummary(output) {
  const results = Array.isArray(output.results) ? output.results : [];
  const completed = results.filter((item) => item.analysisStatus === "completed");
  const firstPassAcceptedCount = completed.filter((item) =>
    numeric(item.llmPlanner?.retry?.retryCount) === 0 && item.comparison?.guardrailAccepted === true
  ).length;
  const firstPassRejectedCount = results.filter((item) => numeric(item.llmPlanner?.retry?.retryCount) > 0).length;
  const afterRetryAcceptedCount = completed.filter((item) => item.comparison?.guardrailAccepted === true).length;
  for (const key of ["harnessMetrics", "performanceMetrics"]) {
    if (!isRecord(output.summary?.[key])) continue;
    output.summary[key].firstPassAcceptedCount = firstPassAcceptedCount;
    output.summary[key].firstPassRejectedCount = firstPassRejectedCount;
    output.summary[key].afterRetryAcceptedCount = afterRetryAcceptedCount;
  }
  output.summary.metricInterpretation = "These are final-output guardrail/preflight checks, not semantic quality labels or correctness metrics.";
}

function assessHumanAbReadiness(summary, modelSettings, reproducibility) {
  const expectedRunCount = summary.uniqueCandidateCount * summary.repeatCount;
  const criteria = {
    allRunsCompleted: summary.actualLlmCompletedCount === expectedRunCount && summary.failedCount === 0,
    schemaAndGuardrailAccepted: summary.harnessMetrics.guardrailAcceptedCount === expectedRunCount,
    noIncompleteOrMixedScript: summary.harnessMetrics.incompleteSentenceCount === 0 && summary.harnessMetrics.mixedScriptCount === 0,
    noSemanticContradictions: summary.harnessMetrics.semanticContradictionCount === 0 && summary.harnessMetrics.rawMaterialRequestCount === 0,
    noFalseAlarmReassuranceOrDownrank: summary.harnessMetrics.semanticFalseAlarmCount === 0 &&
      summary.harnessMetrics.semanticFalseReassuranceCount === 0 && summary.harnessMetrics.criticalGapDownrankCount === 0,
    averageOutputTokensAtMost1000: numeric(summary.tokenUsage.averageOutputTokens) <= 1000,
    averageTotalTokenIncreaseAtMost10Percent: summary.tokenReduction.available === true &&
      numeric(summary.tokenReduction.totalTokenReductionPercent) >= -10,
    truthIdsAndPriorityStable: ["truth", "ids", "priority"].every((axis) => summary.consistency.axes?.[axis]?.status === "stable")
  };
  const readyToBeginHumanLabeling = Object.values(criteria).every(Boolean);
  const controlledAbBlockers = [
    ...(summary.consistency.axes?.category?.status === "stable" ? [] : ["semantic_category_variation_requires_human_labels"]),
    ...((modelSettings?.workingTreeDirty ?? modelSettings?.gitDirty) === false ? [] : ["evaluation_source_is_dirty_or_untracked"]),
    ...(hasCompleteReproducibilityMetadata(reproducibility ?? null) ? [] : ["reproducibility_metadata_not_clean_and_complete"]),
    "human_labeling_protocol_not_bound_to_evaluation_artifact",
    "regression_dev_set_is_not_a_sealed_holdout"
  ];
  return {
    readyToBeginHumanLabeling,
    readyForControlledHumanAb: readyToBeginHumanLabeling && controlledAbBlockers.length === 0,
    readyForProductDefault: false,
    criteria,
    controlledAbBlockers,
    categoryVariationRequiresHumanReview: summary.consistency.axes?.category?.status !== "stable",
    wordingVariationIsFailure: false,
    note: readyToBeginHumanLabeling
      ? "The guardrail preflight is ready for blinded human labeling, but controlled A/B blockers must still be cleared."
      : "The guardrail preflight is not ready for labeling; do not treat harness output as semantic-quality evidence."
  };
}

async function runCandidate(baselineResult, runIndex) {
  const evidencePackage = compactPackageFromBaselineResult(baselineResult);
  const deterministicOnly = deterministicSummary(baselineResult, evidencePackage);
  const startedAt = Date.now();
  let plannerOutput;
  let analysisStatus = "skipped";
  let failureReason = null;
  let actualLlmSkippedReason = null;
  let rejectedOutputErrors = [];
  let retryCount = 0;
  let retryReasonCategories = [];
  const attemptTokenMetrics = [];

  if (mode === "openai" && apiKey) {
    try {
      plannerOutput = await callOpenAIPlanner(evidencePackage, apiKey);
      if (plannerOutput.tokenMetrics) attemptTokenMetrics.push(plannerOutput.tokenMetrics);
      const firstValidation = validatePlannerOutput(plannerOutput, evidencePackage);
      if (!firstValidation.valid) {
        rejectedOutputErrors = firstValidation.errors.map((error) => safeText(error, 300));
        retryReasonCategories = uniqueStrings(firstValidation.errors.map(validationErrorCategory));
        retryCount = 1;
        plannerOutput = await callOpenAIPlanner(evidencePackage, apiKey, firstValidation.errors);
        if (plannerOutput.tokenMetrics) attemptTokenMetrics.push(plannerOutput.tokenMetrics);
      }
      analysisStatus = "completed";
    } catch (error) {
      if (error instanceof PlannerAttemptError && error.retryable && retryCount === 0) {
        if (error.tokenMetrics) attemptTokenMetrics.push(error.tokenMetrics);
        retryReasonCategories = [error.category];
        retryCount = 1;
        try {
          plannerOutput = await callOpenAIPlanner(evidencePackage, apiKey, [error.message]);
          if (plannerOutput.tokenMetrics) attemptTokenMetrics.push(plannerOutput.tokenMetrics);
          analysisStatus = "completed";
        } catch (retryError) {
          if (retryError instanceof PlannerAttemptError && retryError.tokenMetrics) attemptTokenMetrics.push(retryError.tokenMetrics);
          plannerOutput = mockPlannerOutput(evidencePackage, "failed");
          analysisStatus = "failed";
          failureReason = safeText(retryError instanceof Error ? retryError.message : "OpenAI proof planner retry failed.", 500);
        }
      } else {
        if (error instanceof PlannerAttemptError && error.tokenMetrics) attemptTokenMetrics.push(error.tokenMetrics);
        plannerOutput = mockPlannerOutput(evidencePackage, "failed");
        analysisStatus = "failed";
        failureReason = safeText(error instanceof Error ? error.message : "OpenAI proof planner failed.", 500);
      }
    }
  } else {
    plannerOutput = mockPlannerOutput(evidencePackage, "skipped");
    actualLlmSkippedReason = mode === "openai" && !apiKey
      ? "OPENAI_API_KEY was missing, so the actual LLM A/B call was skipped."
      : "Runner default is dry-run; set AGENTPROOF_LLM_PROOF_PLANNER_MODE=openai with OPENAI_API_KEY to attempt actual LLM A/B.";
  }

  plannerOutput.latencyMs = Math.max(plannerOutput.latencyMs ?? 0, Date.now() - startedAt);
  const combinedTokenMetrics = attemptTokenMetrics.length > 0 ? combineAttemptTokenMetrics(attemptTokenMetrics) : null;
  if (combinedTokenMetrics) plannerOutput.tokenMetrics = combinedTokenMetrics;
  let validation = validatePlannerOutput(plannerOutput, evidencePackage);
  if (!validation.valid) {
    rejectedOutputErrors = validation.errors.map((error) => safeText(error, 300));
    plannerOutput = mockPlannerOutput(evidencePackage, "failed");
    if (combinedTokenMetrics) plannerOutput.tokenMetrics = combinedTokenMetrics;
    analysisStatus = analysisStatus === "completed" ? "failed" : analysisStatus;
    failureReason = failureReason ?? "Planner output failed runtime validation before it could be stored.";
  }
  const merge = guardrailMerge(evidencePackage, plannerOutput, validation);
  const deterministicPlusLlm = {
    testBuildStatus: evidencePackage.deterministic.testBuildStatus,
    priority: evidencePackage.deterministic.priority,
    failedExecutionEvidencePreserved: !merge.guardrails.failedExecutionEvidenceRemoved,
    deterministicGapsHidden: merge.guardrails.deterministicGapsHidden,
    semanticClarity: merge.mergedReviewerSignals?.semanticClarity ?? "unclear",
    topSemanticRisks: merge.mergedReviewerSignals?.topSemanticRisks ?? [],
    reviewerWhy: merge.mergedReviewerSignals?.reviewerWhy ?? [],
    missingProofExplanations: merge.mergedReviewerSignals?.missingProofExplanations ?? [],
    priorityNudge: merge.mergedReviewerSignals?.priorityNudge ?? "no_change",
    priorityNudgeReason: merge.mergedReviewerSignals?.priorityNudgeReason ?? "",
    priorityNudgeGapRef: merge.mergedReviewerSignals?.priorityNudgeGapRef ?? null
  };

  return {
    candidateId: baselineResult.candidateId,
    runIndex,
    repository: baselineResult.repository,
    prNumber: baselineResult.prNumber,
    prUrl: baselineResult.prUrl,
    analysisStatus,
    failureReason,
    actualLlmSkippedReason,
    deterministicOnly,
    compactEvidencePackageSummary: summarizePackage(evidencePackage),
    llmPlanner: {
      mode: plannerOutput.mode,
      plannerStatus: plannerOutput.plannerStatus,
      schemaValidation: validation,
      rejectedOutputErrors,
      guardrailMerge: merge.guardrails,
      tokenMetrics: plannerOutput.tokenMetrics ?? unavailableTokenMetrics(),
      latencyMs: plannerOutput.latencyMs,
      retry: {
        retryCount,
        reasonCategories: retryReasonCategories,
        recovered: retryCount === 1 && analysisStatus === "completed"
      },
      suggestionSummary: {
        requirementSuggestionCount: plannerOutput.requirementSuggestions.length,
        requirementIds: plannerOutput.requirementSuggestions.map((item) => item.requirementId),
        requirementCategories: plannerOutput.requirementSuggestions.map((item) => ({
          requirementId: item.requirementId,
          semanticClarity: item.semanticClarity,
          proofPlanBasis: item.proofPlanBasis,
          missingProofBasis: item.missingProofBasis
        })),
        contextClassificationCount: plannerOutput.contextClassifications.length,
        contextClassifications: plannerOutput.contextClassifications,
        topSemanticRisks: plannerOutput.reviewerSignals.topRisks,
        reviewerWhy: [plannerOutput.reviewerSignals.why],
        reviewerQuestion: plannerOutput.reviewerSignals.reviewerQuestion,
        missingProofExplanations: plannerOutput.requirementSuggestions.map((item) => item.missingProof).filter(Boolean),
        priorityNudge: plannerOutput.reviewerSignals.priorityNudge,
        priorityNudgeReason: plannerOutput.reviewerSignals.priorityNudgeReason,
        priorityNudgeGapRef: plannerOutput.reviewerSignals.priorityNudgeGapRef,
        provenance: {
          topRiskBasis: plannerOutput.reviewerSignals.topRiskBasis,
          whyBasis: plannerOutput.reviewerSignals.whyBasis,
          reviewerQuestionBasis: plannerOutput.reviewerSignals.reviewerQuestionBasis
        },
        firstRequirementSuggestions: plannerOutput.requirementSuggestions.slice(0, 3).map((item) => ({
          requirementId: item.requirementId,
          rewrite: item.rewrite,
          semanticClarity: item.semanticClarity,
          proofPlan: item.proofPlan,
          proofPlanBasis: item.proofPlanBasis,
          missingProof: item.missingProof,
          missingProofBasis: item.missingProofBasis
        }))
      }
    },
    deterministicPlusLlm,
    comparison: compareDeterministicAndLlm(deterministicOnly, deterministicPlusLlm, evidencePackage, merge, plannerOutput),
    humanCheckNeeded: {
      requirementQualityImproved: true,
      proofPlanUsefulness: true,
      falsePassRisk: true,
      falseBlockerRisk: true,
      semanticFalseReassurance: true,
      semanticFalseAlarm: true,
      criticalGapDownrank: true,
      priorityNudgeUsefulness: true
    }
  };
}

async function runLegacySchemaMeasurement(baselineResult) {
  const evidencePackage = compactPackageFromBaselineResult(baselineResult);
  const startedAt = Date.now();
  try {
    const measurement = await callOpenAILegacyPlannerMeasurement(evidencePackage, apiKey);
    return {
      candidateId: baselineResult.candidateId,
      repository: baselineResult.repository,
      prNumber: baselineResult.prNumber,
      prUrl: baselineResult.prUrl,
      schemaVersion: "1-legacy-measurement",
      analysisStatus: "completed",
      failureReason: null,
      latencyMs: Math.max(measurement.latencyMs ?? 0, Date.now() - startedAt),
      tokenMetrics: measurement.tokenMetrics
    };
  } catch (error) {
    return {
      candidateId: baselineResult.candidateId,
      repository: baselineResult.repository,
      prNumber: baselineResult.prNumber,
      prUrl: baselineResult.prUrl,
      schemaVersion: "1-legacy-measurement",
      analysisStatus: "failed",
      failureReason: safeText(error instanceof Error ? error.message : "Legacy schema measurement failed.", 500),
      latencyMs: Date.now() - startedAt,
      tokenMetrics: unavailableTokenMetrics("1-legacy-measurement")
    };
  }
}

async function callOpenAILegacyPlannerMeasurement(evidencePackage, key) {
  const startedAt = Date.now();
  const requestBody = {
    model: requestedModel,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: legacyPlannerPrompt() }]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(evidencePackage) }]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "agentproof_llm_proof_planner_legacy_measurement",
        schema: legacyPlannerSchema(),
        strict: true
      }
    },
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    store: false
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(openaiTimeoutMs)
  });

  if (!response.ok) {
    throw new Error(`OpenAI legacy schema measurement failed with HTTP ${response.status}; response body omitted by privacy policy.`);
  }

  const json = await response.json();
  const text = extractResponseText(json);
  if (!text) throw new Error("OpenAI legacy schema measurement did not return text output.");
  JSON.parse(text);
  return {
    latencyMs: Date.now() - startedAt,
    tokenMetrics: usageMetricsFromResponse(json, {
      requestedModel,
      reasoningEffort,
      maxOutputTokens: null,
      serializedOutputChars: text.length,
      serializedOutputBytes: Buffer.byteLength(text, "utf8"),
      promptVersion: "llm-proof-planner-v1-legacy-measurement",
      schemaVersion: "1-legacy-measurement"
    })
  };
}

function compactPackageFromBaselineResult(result) {
  const reportSummary = record(result.reportSummary);
  const diagnostics = record(result.diagnosticMetadata);
  const proof = record(result.proofGraphDiagnostics);
  const quickAssessment = record(result.quickAssessment);
  const requirementSignals = Array.isArray(proof.requirementSignalSummary) ? proof.requirementSignalSummary : [];
  const requirements = requirementSignals.filter(isRecord).slice(0, 20).map((item) => ({
    requirementId: stringValue(item.requirementId, "unknown_requirement"),
    text: safeText(item.requirementTextSummary ?? item.requirementText, 600),
    sourceRole: "core_requirement",
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
  const deterministicGapKinds = uniqueStrings(requirements.flatMap((item) => item.gapKinds));

  return {
    version: PLANNER_INPUT_SCHEMA_VERSION,
    packageId: `baseline_${stringValue(result.candidateId, "unknown")}`,
    candidateId: nullableString(result.candidateId),
    prUrl: nullableString(result.prUrl),
    sourceTitle: safeText(`${stringValue(result.repository, "unknown repository")}#${stringValue(result.prNumber, "?")}`, 240),
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
    privacyPolicy: {
      summaryOnly: true,
      noRawDiffs: true,
      noRawLogs: true,
      noTokens: true,
      noPrivateData: true
    }
  };
}

function deterministicSummary(result, evidencePackage) {
  return {
    priority: evidencePackage.deterministic.priority,
    evidenceCoverage: evidencePackage.deterministic.evidenceCoverage,
    confidence: evidencePackage.deterministic.confidence,
    testBuildStatus: evidencePackage.deterministic.testBuildStatus,
    requirementCounts: evidencePackage.deterministic.requirementCounts,
    topRisks: evidencePackage.deterministic.topRisks,
    missingTestCount: evidencePackage.deterministic.missingTestCount,
    firstReviewPriorityFiles: evidencePackage.deterministic.firstReviewPriorityFiles,
    limitations: evidencePackage.deterministic.limitations,
    priorityMayBeTooNarrow: evidencePackage.deterministic.priorityMayBeTooNarrow,
    possibleFalsePass: result.quickAssessment?.possibleFalsePass === true,
    possibleFalseBlocker: result.quickAssessment?.possibleFalseBlocker === true
  };
}

function summarizePackage(evidencePackage) {
  return {
    packageId: evidencePackage.packageId,
    summaryOnly: evidencePackage.privacyPolicy.summaryOnly,
    requirementCount: evidencePackage.requirements.length,
    contextCount: evidencePackage.context.length,
    deterministicGapKinds: evidencePackage.deterministicGapKinds,
    deterministicTestBuildStatus: evidencePackage.deterministic.testBuildStatus,
    failedExecutionEvidenceFound: evidencePackage.diagnostics.failedExecutionEvidenceFound,
    rawLogsFetched: evidencePackage.diagnostics.rawLogsFetched
  };
}

function mockPlannerOutput(evidencePackage, plannerStatus) {
  const topSemanticRisks = topSemanticRisksForPackage(evidencePackage);
  const priorityNudge = priorityNudgeForPackage(evidencePackage);

  return {
    version: PLANNER_OUTPUT_SCHEMA_VERSION,
    mode: "mock",
    plannerStatus,
    requirementSuggestions: evidencePackage.requirements.map((requirement) => requirementSuggestion(requirement, evidencePackage)),
    contextClassifications: evidencePackage.context.map((item) => ({
      sourceId: item.id,
      role: item.role
    })),
    reviewerSignals: {
      topRisks: topSemanticRisks,
      topRiskBasis: topSemanticRiskBasisForPackage(evidencePackage, topSemanticRisks.length),
      why: `Deterministic test/build status remains ${evidencePackage.deterministic.testBuildStatus}.`,
      whyBasis: firstReviewerBasis(evidencePackage),
      reviewerQuestion: reviewerQuestionForPackage(evidencePackage),
      reviewerQuestionBasis: firstReviewerBasis(evidencePackage),
      priorityNudge,
      priorityNudgeReason: priorityNudgeReason(priorityNudge, evidencePackage),
      priorityNudgeGapRef: priorityNudgeGapRef(priorityNudge, evidencePackage)
    },
    latencyMs: 0,
    tokenMetrics: unavailableTokenMetrics()
  };
}

function rejectedPlannerOutput(evidencePackage, plannerStatus) {
  return {
    ...mockPlannerOutput(evidencePackage, plannerStatus),
    requirementSuggestions: [],
    contextClassifications: [],
    reviewerSignals: {
      topRisks: ["Planner output failed validation; use deterministic report only."],
      why: `Deterministic test/build status remains ${evidencePackage.deterministic.testBuildStatus}.`,
      reviewerQuestion: "Which deterministic finding should be reviewed without LLM suggestions?",
      priorityNudge: "manual_review",
      priorityNudgeReason: "LLM suggestion was rejected before storage.",
      priorityNudgeGapRef: null
    }
  };
}

class PlannerAttemptError extends Error {
  constructor(message, { retryable = false, category = "api_or_schema_failure", tokenMetrics = null } = {}) {
    super(message);
    this.retryable = retryable;
    this.category = category;
    this.tokenMetrics = tokenMetrics;
  }
}

async function callOpenAIPlanner(evidencePackage, key, retryErrors = []) {
  const startedAt = Date.now();
  const requestBody = {
    model: requestedModel,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: plannerPrompt() }]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: JSON.stringify(evidencePackage) }]
      },
      ...(retryErrors.length > 0 ? [{
        role: "user",
        content: [{ type: "input_text", text: retryInstruction(retryErrors, evidencePackage) }]
      }] : [])
    ],
    text: {
      format: {
        type: "json_schema",
        name: "agentproof_llm_proof_planner",
        schema: plannerSchema(),
        strict: true
      }
    },
    max_output_tokens: maxOutputTokens,
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    store: false
  };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(openaiTimeoutMs)
  });

  if (!response.ok) {
    throw new PlannerAttemptError(`OpenAI proof planner failed with HTTP ${response.status}; response body omitted by privacy policy.`, {
      retryable: [408, 429].includes(response.status) || response.status >= 500,
      category: `http_${response.status}`
    });
  }

  const json = await response.json();
  const text = extractResponseText(json);
  const tokenMetrics = usageMetricsFromResponse(json, {
    requestedModel,
    reasoningEffort,
    maxOutputTokens,
    serializedOutputChars: text?.length ?? null,
    serializedOutputBytes: typeof text === "string" ? Buffer.byteLength(text, "utf8") : null
  });
  if (!text) {
    throw new PlannerAttemptError("OpenAI proof planner did not return text output.", {
      retryable: true,
      category: "missing_output_text",
      tokenMetrics
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new PlannerAttemptError("OpenAI proof planner returned invalid or incomplete JSON.", {
      retryable: true,
      category: "invalid_json",
      tokenMetrics
    });
  }
  parsed.version = PLANNER_OUTPUT_SCHEMA_VERSION;
  parsed.mode = "openai";
  parsed.plannerStatus = "completed";
  parsed.latencyMs = Date.now() - startedAt;
  parsed.reviewerSignals = {
    ...record(parsed.reviewerSignals),
    priorityNudgeReason: priorityNudgeReason(record(parsed.reviewerSignals).priorityNudge, evidencePackage)
  };
  parsed.tokenMetrics = tokenMetrics;
  return parsed;
}

function validatePlannerOutput(value, evidencePackage) {
  const errors = [];

  if (!isRecord(value)) {
    return { valid: false, errors: ["Planner output must be an object."] };
  }

  if (value.version !== PLANNER_OUTPUT_SCHEMA_VERSION) errors.push(`version must equal ${PLANNER_OUTPUT_SCHEMA_VERSION}.`);
  if (!["openai", "mock"].includes(value.mode)) errors.push("mode must be openai or mock.");
  if (!["completed", "skipped", "failed"].includes(value.plannerStatus)) errors.push("plannerStatus is invalid.");
  if (!Array.isArray(value.requirementSuggestions) || value.requirementSuggestions.length > 20) errors.push("requirementSuggestions must be a bounded array.");
  if (!Array.isArray(value.contextClassifications) || value.contextClassifications.length > 30) errors.push("contextClassifications must be a bounded array.");
  validateRequirementSuggestions(value.requirementSuggestions, evidencePackage, errors);
  validateContextClassifications(value.contextClassifications, evidencePackage, errors);
  validateReviewerSignals(value.reviewerSignals, errors);
  if (typeof value.latencyMs !== "number" || value.latencyMs < 0) errors.push("latencyMs must be a non-negative number.");
  validateSemanticGuardrails(value, evidencePackage, errors);

  return { valid: errors.length === 0, errors };
}

function validateRequirementSuggestions(value, evidencePackage, errors) {
  if (!Array.isArray(value)) return;

  const requirementIds = new Set(evidencePackage.requirements.map((item) => item.requirementId));
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`requirementSuggestions[${index}] must be an object.`);
      continue;
    }
    validateSafeString(item.requirementId, `requirementSuggestions[${index}].requirementId`, 120, errors);
    validateNarrativeString(item.rewrite, `requirementSuggestions[${index}].rewrite`, 280, errors);
    if (!["clear", "needs_human_review", "unclear"].includes(item.semanticClarity)) {
      errors.push(`requirementSuggestions[${index}].semanticClarity is invalid.`);
    }
    validateNarrativeStringArray(item.proofPlan, `requirementSuggestions[${index}].proofPlan`, 2, 220, errors);
    validateBasisArray(item.proofPlanBasis, `requirementSuggestions[${index}].proofPlanBasis`, 2, errors);
    if (Array.isArray(item.proofPlan) && Array.isArray(item.proofPlanBasis) && item.proofPlan.length !== item.proofPlanBasis.length) {
      errors.push(`requirementSuggestions[${index}].proofPlanBasis must align one-to-one with proofPlan.`);
    }
    if (item.missingProof !== null) {
      validateNarrativeString(item.missingProof, `requirementSuggestions[${index}].missingProof`, 180, errors);
      validateBasis(item.missingProofBasis, `requirementSuggestions[${index}].missingProofBasis`, errors);
    } else if (item.missingProofBasis !== null) {
      errors.push(`requirementSuggestions[${index}].missingProofBasis must be null when missingProof is null.`);
    }
    const requirement = evidencePackage.requirements.find((candidate) => candidate.requirementId === item.requirementId);
    if (requirement) {
      if (Array.isArray(item.proofPlanBasis)) {
        item.proofPlanBasis.forEach((basis, basisIndex) => {
          if (typeof basis === "string" && basis !== SEMANTIC_HYPOTHESIS_REF && !requirement.gapKinds.includes(basis)) {
            errors.push(`requirementSuggestions[${index}].proofPlanBasis[${basisIndex}] must reference a gap on the same deterministic requirement.`);
          }
        });
      }
      if (requirement.gapKinds.length === 0 && item.missingProof !== null) {
        errors.push(`requirementSuggestions[${index}].missingProof must be null when no deterministic requirement gap exists.`);
      }
      if (requirement.gapKinds.length > 0 && item.missingProof === null) {
        errors.push(`requirementSuggestions[${index}].missingProof must explain one deterministic requirement gap.`);
      }
      if (typeof item.missingProofBasis === "string" && !requirement.gapKinds.includes(item.missingProofBasis)) {
        errors.push(`requirementSuggestions[${index}].missingProofBasis must reference a gap on the same deterministic requirement.`);
      }
    }
    if (typeof item.requirementId === "string" && !requirementIds.has(item.requirementId)) {
      errors.push(`requirementSuggestions[${index}].requirementId must reference a deterministic requirement.`);
    }
  }
  pushSetDiffErrors([...requirementIds], value.filter(isRecord).map((item) => item.requirementId).filter((id) => typeof id === "string"), "requirementSuggestions.requirementId", errors);
}

function validateContextClassifications(value, evidencePackage, errors) {
  if (!Array.isArray(value)) return;

  const contextIds = new Set(evidencePackage.context.map((item) => item.id));
  const allowedRoles = [
    "problem_context",
    "reproduction_context",
    "environment_context",
    "visual_context",
    "external_reference",
    "solution_hint",
    "author_claim",
    "template_noise"
  ];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      errors.push(`contextClassifications[${index}] must be an object.`);
      continue;
    }
    validateSafeString(item.sourceId, `contextClassifications[${index}].sourceId`, 120, errors);
    if (!allowedRoles.includes(item.role)) {
      errors.push(`contextClassifications[${index}].role is invalid.`);
    }
    if (typeof item.sourceId === "string" && !contextIds.has(item.sourceId)) {
      errors.push(`contextClassifications[${index}].sourceId must reference a deterministic context signal.`);
    }
  }
  pushSetDiffErrors([...contextIds], value.filter(isRecord).map((item) => item.sourceId).filter((id) => typeof id === "string"), "contextClassifications.sourceId", errors);
}

function validateReviewerSignals(value, errors) {
  if (!isRecord(value)) {
    errors.push("reviewerSignals must be an object.");
    return;
  }
  validateNarrativeStringArray(value.topRisks, "topRisks", 2, 220, errors);
  validateBasisArray(value.topRiskBasis, "topRiskBasis", 2, errors);
  if (Array.isArray(value.topRisks) && Array.isArray(value.topRiskBasis) && value.topRisks.length !== value.topRiskBasis.length) {
    errors.push("topRiskBasis must align one-to-one with topRisks.");
  }
  validateNarrativeString(value.why, "why", 220, errors);
  validateBasis(value.whyBasis, "whyBasis", errors);
  validateNarrativeString(value.reviewerQuestion, "reviewerQuestion", 220, errors);
  validateBasis(value.reviewerQuestionBasis, "reviewerQuestionBasis", errors);
  validateNarrativeString(value.priorityNudgeReason, "priorityNudgeReason", 180, errors);
  if (value.priorityNudgeGapRef !== null) {
    validateSafeString(value.priorityNudgeGapRef, "priorityNudgeGapRef", 200, errors);
  }
  if (!["no_change", "consider_higher", "consider_lower", "manual_review"].includes(value.priorityNudge)) errors.push("priorityNudge is invalid.");
}

function validateSemanticGuardrails(value, evidencePackage, errors) {
  const reviewerSignals = record(value.reviewerSignals);
  const priorityNudge = reviewerSignals.priorityNudge;
  const priorityNudgeGapRef = reviewerSignals.priorityNudgeGapRef;
  const criticalRefs = new Set(criticalGapRefs(evidencePackage));
  const allowedPriorityRefs = new Set([
    ...criticalRefs,
    ...(evidencePackage.deterministic.priorityMayBeTooNarrow ? [PRIORITY_NARROW_REF] : [])
  ]);
  if (priorityNudge !== evidencePackage.plannerConstraints.requiredPriorityNudge) {
    errors.push(`priorityNudge must equal plannerConstraints.requiredPriorityNudge (${evidencePackage.plannerConstraints.requiredPriorityNudge}).`);
  }

  if (evidencePackage.deterministic.priority === "blocker" && priorityNudge === "consider_higher") {
    errors.push("priorityNudge cannot be consider_higher when deterministic priority is blocker.");
  }
  if (
    priorityNudge === "consider_lower" &&
    (evidencePackage.deterministic.priority === "blocker" || evidencePackage.diagnostics.failedExecutionEvidenceFound)
  ) {
    errors.push("priorityNudge cannot be consider_lower for blocker priority or failed execution evidence.");
  }

  if (priorityNudge === "consider_higher") {
    if (typeof priorityNudgeGapRef !== "string" || !allowedPriorityRefs.has(priorityNudgeGapRef)) {
      errors.push(`priorityNudgeGapRef must reference ${PRIORITY_NARROW_REF} or a high/blocker deterministic gap.`);
    }
  } else if (priorityNudgeGapRef !== null) {
    errors.push("priorityNudgeGapRef must be null unless priorityNudge is consider_higher.");
  }

  if (
    evidencePackage.deterministic.priorityMayBeTooNarrow &&
    evidencePackage.deterministic.priority !== "blocker" &&
    evidencePackage.deterministic.testBuildStatus !== "failed" &&
    !evidencePackage.diagnostics.failedExecutionEvidenceFound &&
    priorityNudge !== "consider_higher"
  ) {
    errors.push(`priorityNudge must be consider_higher when deterministic ${PRIORITY_NARROW_REF} is true.`);
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

function validateSafeStringArray(value, path, maxItems, maxLength, errors) {
  if (!Array.isArray(value) || value.length > maxItems) return;
  value.forEach((item, index) => validateSafeString(item, `${path}[${index}]`, maxLength, errors));
}

function validateNarrativeStringArray(value, path, maxItems, maxLength, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return;
  }
  if (value.length > maxItems) errors.push(`${path} must contain at most ${maxItems} item(s).`);
  value.forEach((item, index) => validateNarrativeString(item, `${path}[${index}]`, maxLength, errors));
}

function validateBasisArray(value, path, maxItems, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array.`);
    return;
  }
  if (value.length > maxItems) errors.push(`${path} must contain at most ${maxItems} item(s).`);
  value.forEach((item, index) => validateBasis(item, `${path}[${index}]`, errors));
}

function validateBasis(value, path, errors) {
  validateSafeString(value, path, 120, errors);
}

function validateSafeString(value, path, maxLength, errors) {
  if (typeof value !== "string") {
    errors.push(`${path} must be a string.`);
    return;
  }
  if (value.length > maxLength) {
    errors.push(`${path} must be at most ${maxLength} characters.`);
  }
  if (containsSecretLike(value)) {
    errors.push(`${path} must not contain secret-like material.`);
  }
  if (containsPromptInjectionOrUnsupportedClaim(value)) {
    errors.push(`${path} must not echo prompt-injection or unsupported merge/correctness claims.`);
  }
}

function validateNarrativeString(value, path, maxLength, errors) {
  validateSafeString(value, path, maxLength, errors);
  if (typeof value !== "string") return;
  if (!/[.!?](?:[\"')\]]*)$/.test(value.trim())) {
    errors.push(`${path} must be a complete sentence ending in punctuation.`);
  }
  if (containsMixedLatinCjk(value)) {
    errors.push(`${path} must not contain mixed Latin and Chinese, Japanese, or Korean script.`);
  }
}

function pushSetDiffErrors(expectedIds, actualIds, path, errors) {
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

function stringsInPlannerOutput(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsInPlannerOutput);
  if (isRecord(value)) return Object.values(value).flatMap(stringsInPlannerOutput);
  return [];
}

function reviewerFacingTextEntries(value) {
  const entries = [];
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
  for (const key of ["why", "reviewerQuestion", "priorityNudgeReason"]) {
    if (typeof signals[key] === "string") entries.push([`reviewerSignals.${key}`, signals[key]]);
  }
  return entries;
}

function plannerBasisEntries(value) {
  if (!isRecord(value)) return [];
  const entries = [];
  const suggestions = Array.isArray(value.requirementSuggestions) ? value.requirementSuggestions : [];
  suggestions.forEach((item, index) => {
    if (!isRecord(item)) return;
    if (Array.isArray(item.proofPlanBasis)) {
      item.proofPlanBasis.forEach((basis, basisIndex) => {
        if (isPlannerBasis(basis)) entries.push([`requirementSuggestions[${index}].proofPlanBasis[${basisIndex}]`, basis]);
      });
    }
    if (isPlannerBasis(item.missingProofBasis)) entries.push([`requirementSuggestions[${index}].missingProofBasis`, item.missingProofBasis]);
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

function isPlannerBasis(value) {
  return typeof value === "string" && value.length > 0;
}

function claimsMissingExecution(value) {
  const normalized = normalizeSemanticText(value);
  return /\b(?:no|missing|without|lack(?:s|ing)?|absent|unavailable)\b.{0,55}\b(?:execution|ci|test\/build|test or build|test and build)\b.{0,30}\b(?:evidence|proof|run|result|status)?\b/i.test(normalized) ||
    /\b(?:tests?|build|ci)\b.{0,30}\b(?:not|never|weren't|were not|hasn't|has not|haven't|have not)\b.{0,20}\b(?:run|executed|available)\b/i.test(normalized) ||
    /\bexecution\b.{0,25}\b(?:not|never|wasn't|was not)\b.{0,20}\b(?:shown|demonstrated|proven|available)\b/i.test(normalized) ||
    /\b(?:provide|add|attach|show|supply|rerun|run)\b.{0,45}\b(?:ci|test\/build|test or build|test and build)\b.{0,30}\b(?:run|execution|evidence|result|status)\b/i.test(normalized);
}

function claimsPassingExecution(value) {
  const normalized = normalizeSemanticText(value);
  return !hasNegatedExecutionVerdict(normalized, "passed|passing|succeeded|successful|green") &&
    /(?:^|[.!?]\s+)(?:the\s+)?(?:all\s+)?(?:public\s+)?(?:tests?|suite|pipeline|build|ci|checks?|workflows?)\s+(?:have\s+|has\s+|were\s+|was\s+|are\s+|is\s+)?(?:passed|passing|succeeded|successful|green)\b/i.test(normalized);
}

function claimsFailedExecution(value) {
  const normalized = normalizeSemanticText(value);
  return !hasNegatedExecutionVerdict(normalized, "failed|failing|broken|red") &&
    /(?:^|[.!?]\s+)(?:the\s+)?(?:all\s+)?(?:public\s+)?(?:tests?|suite|pipeline|build|ci|checks?|workflows?)\s+(?:have\s+|has\s+|were\s+|was\s+|are\s+|is\s+)?(?:failed|failing|broken|red)\b/i.test(normalized);
}

function requestsRawExecutionMaterial(value) {
  const normalized = normalizeSemanticText(value);
  return /\b(?:provide|attach|show|supply|store|retain|upload|include|need|required|request|ask for)\b.{0,50}\b(?:(?:raw|full|complete)\s+(?:ci\s+)?logs?|stdout|stderr|console output)\b/i.test(normalized) ||
    /\b(?:provide|attach|show|supply|store|retain|upload|include)\b.{0,50}\braw\s+(?:workflow|execution|pipeline)\s+(?:trace|artifact|output)\b/i.test(normalized) ||
    /\b(?:raw|full|complete)\s+(?:ci\s+)?(?:logs?|stdout|stderr|console output)\b.{0,40}\b(?:proof|required|needed|missing)\b/i.test(normalized);
}

function hasNegatedExecutionVerdict(value, verdictPattern) {
  return new RegExp(`\\b(?:no|not|without|missing|unavailable|cannot confirm|does not show)\\b.{0,55}\\b(?:tests?|build|ci|checks?|workflows?)\\b.{0,25}\\b(?:${verdictPattern})\\b`, "i").test(value);
}

function falselyReassuresAboutGaps(value) {
  const normalized = normalizeSemanticText(value);
  return /\bno\s+(?:remaining|deterministic|material|meaningful|proof)?\s*gaps?\b/i.test(normalized) ||
    /\ball\s+requirements?\b.{0,30}\b(?:met|covered|proven|satisfied|verified)\b/i.test(normalized) ||
    /\bfully\s+(?:proven|verified|covered|satisfied)\b/i.test(normalized) ||
    /\bno additional semantic risk\b/i.test(normalized);
}

function containsMixedLatinCjk(value) {
  const normalized = value.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
  return /[A-Za-z]/.test(normalized) && /[\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/u.test(normalized);
}

function normalizeSemanticText(value) {
  return value.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/g, " ").replace(/\s+/g, " ").trim();
}

function guardrailMerge(evidencePackage, plannerOutput, validation) {
  const acknowledged = new Set(plannerBasisEntries(plannerOutput)
    .filter(([, basis]) => basis !== SEMANTIC_HYPOTHESIS_REF)
    .map(([, basis]) => basis));
  const deterministicGapsHidden = evidencePackage.deterministicGapKinds.filter((kind) => !acknowledged.has(kind));
  const failedExecutionEvidenceRemoved = evidencePackage.diagnostics.failedExecutionEvidenceFound &&
    !acknowledged.has("failed_execution");
  const accepted = validation.valid && deterministicGapsHidden.length === 0 && !failedExecutionEvidenceRemoved;

  return {
    accepted,
    mergedReviewerSignals: accepted ? {
      semanticClarity: summarizeSemanticClarity(plannerOutput),
      topSemanticRisks: [...plannerOutput.reviewerSignals.topRisks],
      reviewerWhy: [plannerOutput.reviewerSignals.why],
      missingProofExplanations: plannerOutput.requirementSuggestions.map((item) => item.missingProof).filter(Boolean),
      priorityNudge: plannerOutput.reviewerSignals.priorityNudge,
      priorityNudgeReason: plannerOutput.reviewerSignals.priorityNudgeReason,
      priorityNudgeGapRef: plannerOutput.reviewerSignals.priorityNudgeGapRef
    } : null,
    guardrails: {
      testBuildStatusChanged: false,
      failedExecutionEvidenceRemoved,
      deterministicGapsHidden,
      deterministicTestBuildStatus: evidencePackage.deterministic.testBuildStatus,
      deterministicFailedExecutionEvidenceFound: evidencePackage.diagnostics.failedExecutionEvidenceFound,
      blockedMutationReasons: [
        ...validation.errors,
        ...(failedExecutionEvidenceRemoved ? ["LLM suggestion did not preserve deterministic failed execution evidence."] : []),
        ...deterministicGapsHidden.map((kind) => `LLM suggestion did not acknowledge deterministic gap: ${kind}.`)
      ]
    }
  };
}

function summarizeSemanticClarity(plannerOutput) {
  if (plannerOutput.requirementSuggestions.some((item) => item.semanticClarity === "unclear")) {
    return "unclear";
  }
  if (plannerOutput.requirementSuggestions.some((item) => item.semanticClarity === "needs_human_review")) {
    return "needs_human_review";
  }
  return "clear";
}

function compareDeterministicAndLlm(deterministicOnly, deterministicPlusLlm, evidencePackage, merge, plannerOutput) {
  const integrity = semanticIntegrityFindings(plannerOutput, evidencePackage);
  const falsePassIncrease = deterministicPlusLlm.testBuildStatus !== deterministicOnly.testBuildStatus ||
    (evidencePackage.diagnostics.failedExecutionEvidenceFound && deterministicPlusLlm.testBuildStatus === "passed");
  const falseBlockerIncrease = deterministicOnly.priority !== "blocker" &&
    deterministicPlusLlm.priority === "blocker";
  const priorityMayBeTooNarrowImproved = deterministicOnly.priorityMayBeTooNarrow &&
    deterministicPlusLlm.priorityNudge === "consider_higher";
  const semanticFalseReassurance = integrity.falseReassurancePaths.length > 0;
  const semanticFalseAlarm = integrity.executionContradictionPaths.length > 0 || integrity.rawMaterialRequestPaths.length > 0 ||
    (evidencePackage.deterministicGapKinds.length === 0 && deterministicOnly.testBuildStatus === "passed" && deterministicPlusLlm.priorityNudge === "consider_higher");
  const criticalGapDownrank = evidencePackage.deterministicGapKinds.some((kind) =>
    ["failed_execution", "missing_implementation", "missing_targeted_test", "missing_execution"].includes(kind)
  ) && deterministicPlusLlm.priorityNudge === "consider_lower";

  return {
    requirementNoiseReduction: requirementNoiseAssessment(evidencePackage),
    coreRequirementQuality: evidencePackage.requirements.some((item) => item.sourceQuality === "manual_check")
      ? "manual_check_still_needed"
      : "semantic_rewrite_available_for_human_review",
    sourceAuthorityBoundary: "deterministic_source_quality_unchanged_llm_uses_semantic_metrics_only",
    proofPlanQuality: merge.accepted ? "proof_plan_generated_for_review" : "proof_plan_rejected_by_guardrail",
    topSemanticRiskReviewerWhyQuality: deterministicPlusLlm.topSemanticRisks.length > 0 ? "available" : "not_available",
    falsePassIncrease,
    falseBlockerIncrease,
    semanticFalseReassurance,
    semanticFalseAlarm,
    criticalGapDownrank,
    priorityMayBeTooNarrowImproved,
    semanticIntegrity: integrity,
    deterministicStatusPreserved: deterministicPlusLlm.testBuildStatus === deterministicOnly.testBuildStatus,
    guardrailAccepted: merge.accepted
  };
}

function semanticIntegrityFindings(plannerOutput, evidencePackage) {
  const incompleteSentencePaths = [];
  const mixedScriptPaths = [];
  const executionContradictionPaths = [];
  const rawMaterialRequestPaths = [];
  const falseReassurancePaths = [];
  for (const [path, text] of reviewerFacingTextEntries(plannerOutput)) {
    if (!/[.!?](?:[\"')\]]*)$/.test(text.trim())) incompleteSentencePaths.push(path);
    if (containsMixedLatinCjk(text)) mixedScriptPaths.push(path);
    if (
      (evidencePackage.deterministic.testBuildStatus === "passed" && !evidencePackage.deterministicGapKinds.includes("missing_execution") && claimsMissingExecution(text)) ||
      ((evidencePackage.deterministic.testBuildStatus === "failed" || evidencePackage.diagnostics.failedExecutionEvidenceFound) && claimsPassingExecution(text)) ||
      (["unknown", "pending"].includes(evidencePackage.deterministic.testBuildStatus) && (claimsPassingExecution(text) || claimsFailedExecution(text)))
    ) executionContradictionPaths.push(path);
    if (requestsRawExecutionMaterial(text)) rawMaterialRequestPaths.push(path);
    if (evidencePackage.deterministicGapKinds.length > 0 && falselyReassuresAboutGaps(text)) falseReassurancePaths.push(path);
  }
  const basisEntries = plannerBasisEntries(plannerOutput);
  const invalidBasisPaths = basisEntries.filter(([, basis]) =>
    basis !== SEMANTIC_HYPOTHESIS_REF && !evidencePackage.deterministicGapKinds.includes(basis)
  ).map(([path]) => path);
  return {
    incompleteSentencePaths,
    mixedScriptPaths,
    executionContradictionPaths,
    rawMaterialRequestPaths,
    falseReassurancePaths,
    invalidBasisPaths
  };
}

function requirementNoiseAssessment(evidencePackage) {
  const noisy = evidencePackage.requirements.filter((item) =>
    item.sourceQuality === "manual_check" || item.sourceQuality === "fallback" || /^Original requirement is too vague/i.test(item.text)
  ).length;
  if (noisy === 0) return "no_obvious_noise_in_summary";
  return "semantic_planner_can_flag_noise_but_not_replace_source_of_truth";
}

function requirementSuggestion(requirement, evidencePackage) {
  const proofPlan = proofPlanForRequirement(requirement, evidencePackage);
  const gapRef = requirement.gapKinds[0] ?? null;
  return {
    requirementId: requirement.requirementId,
    rewrite: rewriteRequirement(requirement),
    semanticClarity: requirement.sourceQuality === "manual_check" || requirement.sourceQuality === "fallback"
      ? "needs_human_review"
      : "clear",
    proofPlan,
    proofPlanBasis: proofPlanBasisForRequirement(requirement, proofPlan.length),
    missingProof: gapRef ? missingProofText(gapRef) : null,
    missingProofBasis: gapRef ? deterministicGapBasis(gapRef) : null
  };
}

function rewriteRequirement(requirement) {
  if (requirement.sourceQuality === "manual_check") {
    return "Manually map the PR claim back to a concrete linked task before treating requirement coverage as verified.";
  }
  const text = String(requirement.text ?? "").replace(/\s+/g, " ").trim();
  if (text.length > 259 || /\btruncated\b/i.test(text)) {
    return "Review the full deterministic requirement text; this semantic planner does not replace the source of truth.";
  }
  if (/[.!?](?:[\"')\]]*)$/.test(text)) return text;
  if (text.length <= 259) return `${text}.`;
  return "Review the full deterministic requirement text; this semantic planner does not replace the source of truth.";
}

function whyRequirementMatters(requirement, evidencePackage) {
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

function proofPlanForRequirement(requirement, evidencePackage) {
  const gapPlan = requirement.gapKinds.map(proofPlanTextForGap);
  const supportingPlan = [
    requirement.implementationEvidenceCount > 0
      ? "Inspect mapped implementation files for the specific behavior change."
      : "Ask for concrete implementation evidence tied to this requirement.",
    requirement.targetedTestEvidenceCount > 0
      ? "Inspect targeted test files or test artifacts that map to this requirement."
      : "Ask for a targeted test or explain why one is not practical.",
    evidencePackage.deterministic.testBuildStatus === "passed"
      ? "Treat public passing execution as broad evidence, not requirement correctness proof."
      : evidencePackage.deterministic.testBuildStatus === "failed"
        ? "Review failed test/build execution before semantic coverage."
        : "Ask for public test/build execution evidence or note why it is unavailable."
  ];
  return uniqueStrings([...gapPlan, ...supportingPlan]).slice(0, 2);
}

function proofPlanTextForGap(kind) {
  const map = {
    missing_implementation: "Ask for concrete implementation evidence mapped to this requirement.",
    missing_targeted_test: "Ask for a targeted test or a concise explanation of why one is impractical.",
    missing_execution: "Ask for public test/build execution evidence or record why it is unavailable.",
    failed_execution: "Inspect the failed deterministic test/build signal before reviewing semantic coverage.",
    ambiguous_requirement: "Ask a human to identify the exact source-of-truth sentence for this requirement.",
    evidence_unavailable: "Record which evidence source was unavailable before interpreting the proof gap.",
    evidence_insufficient: "Ask for the smallest additional deterministic proof tied to this requirement.",
    visual_proof_missing: "Ask for bounded visual proof that demonstrates the changed behavior."
  };
  return map[kind] || `Review the deterministic ${kind} gap before accepting the requirement mapping.`;
}

function topSemanticRisksForPackage(evidencePackage) {
  const risks = [];
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

function missingProofForPackage(evidencePackage) {
  const messages = evidencePackage.deterministicGapKinds.map(missingProofText);
  if (!evidencePackage.diagnostics.testBuildExecutionEvidenceFound) {
    messages.push("No deterministic public test/build execution evidence was collected.");
  }
  if (evidencePackage.deterministic.missingTestCount > 0) {
    messages.push(`${evidencePackage.deterministic.missingTestCount} deterministic missing-test finding(s) remain visible.`);
  }
  return boundedStrings(messages.length > 0 ? messages : ["No deterministic missing-proof gap was summarized."], 8, 360);
}

function missingProofText(kind) {
  const map = {
    missing_implementation: "Implementation evidence is not mapped to this requirement.",
    missing_targeted_test: "Targeted test evidence is missing or not mapped.",
    missing_execution: "Execution proof is missing even if test files or self-reported testing exist.",
    failed_execution: "Relevant test/build execution failed and must stay visible.",
    ambiguous_requirement: "Requirement wording or source of truth is ambiguous.",
    evidence_unavailable: "Required evidence could not be fetched and should not be treated as missing implementation.",
    evidence_insufficient: "Collected evidence only partially supports this requirement and is not sufficient proof.",
    visual_proof_missing: "Visual proof or screenshot evidence is missing."
  };
  return map[kind] || `Deterministic gap remains: ${kind}.`;
}

function deterministicGapBasis(gapRef) {
  return gapRef;
}

function semanticHypothesisBasis() {
  return SEMANTIC_HYPOTHESIS_REF;
}

function proofPlanBasisForRequirement(requirement, itemCount) {
  return [
    ...requirement.gapKinds.map(deterministicGapBasis),
    semanticHypothesisBasis(),
    semanticHypothesisBasis(),
    semanticHypothesisBasis()
  ].slice(0, itemCount);
}

function topSemanticRiskBasisForPackage(evidencePackage, itemCount) {
  const bases = [];
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

function firstReviewerBasis(evidencePackage) {
  return evidencePackage.deterministicGapKinds[0]
    ? deterministicGapBasis(evidencePackage.deterministicGapKinds[0])
    : semanticHypothesisBasis();
}

function criticalGapRefs(evidencePackage) {
  return criticalGapRefsFromRequirements(evidencePackage.requirements);
}

function criticalGapRefsFromRequirements(requirements) {
  const refs = [];
  for (const requirement of requirements) {
    if (requirement.gapSeverities.some((severity) => severity === "high" || severity === "blocker")) {
      refs.push(...requirement.gapKinds);
    }
  }
  return uniqueStrings(refs);
}

function plannerConstraintsForPackage(priority, testBuildStatus, priorityMayBeTooNarrow, failedExecutionEvidenceFound, requirements, deterministicGapKinds) {
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
    allowedPriorityNudgeRefs: uniqueStrings([
      ...(priorityMayBeTooNarrow ? [PRIORITY_NARROW_REF] : []),
      ...criticalGapRefsFromRequirements(requirements)
    ])
  };
}

function priorityNudgeForPackage(evidencePackage) {
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

function priorityNudgeReason(nudge, evidencePackage) {
  if (nudge === "consider_higher") {
    return "Semantic risk language plus deterministic gaps may deserve reviewer attention, but this does not change deterministic priority.";
  }
  return `No semantic priority nudge; deterministic priority remains ${evidencePackage.deterministic.priority}.`;
}

function priorityNudgeGapRef(nudge, evidencePackage) {
  if (nudge !== "consider_higher") return null;
  if (evidencePackage.deterministic.priorityMayBeTooNarrow) return PRIORITY_NARROW_REF;
  return criticalGapRefs(evidencePackage)[0] ?? null;
}

function reviewerQuestionForPackage(evidencePackage) {
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

function summarizeResults(results, actualLlmAttempted, previousAb, baselineSchemaMeasurements) {
  const attempted = results.filter((item) => item.analysisStatus === "completed");
  const attemptedOrFailed = results.filter((item) => item.analysisStatus === "completed" || item.analysisStatus === "failed");
  const dryRunSkipped = results.filter((item) => item.analysisStatus === "skipped");
  const failed = results.filter((item) => item.analysisStatus === "failed");
  const completedLatencies = attempted.map((item) => numeric(item.llmPlanner.latencyMs)).filter((value) => value >= 0);
  const operationalLatencies = attemptedOrFailed.map((item) => numeric(item.llmPlanner.latencyMs)).filter((value) => value >= 0);
  const tokenUsage = summarizeTokenUsage(results);
  const baselineSchemaTokenUsage = summarizeMeasurementTokenUsage(baselineSchemaMeasurements);
  const previousTokenUsage = normalizePreviousTokenUsage(previousAb?.summary?.tokenUsage ?? null, previousAb?.summary?.candidateCount);
  const completedMetrics = {
    guardrailAcceptedCount: attempted.filter((item) => item.llmPlanner.guardrailMerge.blockedMutationReasons.length === 0).length,
    firstPassAcceptedCount: attempted.filter((item) => numeric(item.llmPlanner.retry?.retryCount) === 0 && item.comparison.guardrailAccepted).length,
    firstPassRejectedCount: attemptedOrFailed.filter((item) => numeric(item.llmPlanner.retry?.retryCount) > 0).length,
    afterRetryAcceptedCount: attempted.filter((item) => item.comparison.guardrailAccepted).length,
    falsePassIncreaseCount: attempted.filter((item) => item.comparison.falsePassIncrease).length,
    falseBlockerIncreaseCount: attempted.filter((item) => item.comparison.falseBlockerIncrease).length,
    semanticFalseReassuranceCount: attempted.filter((item) => item.comparison.semanticFalseReassurance).length,
    semanticFalseAlarmCount: attempted.filter((item) => item.comparison.semanticFalseAlarm).length,
    criticalGapDownrankCount: attempted.filter((item) => item.comparison.criticalGapDownrank).length,
    priorityMayBeTooNarrowImprovedCount: attempted.filter((item) => item.comparison.priorityMayBeTooNarrowImproved).length,
    incompleteSentenceCount: attempted.reduce((sum, item) => sum + item.comparison.semanticIntegrity.incompleteSentencePaths.length, 0),
    mixedScriptCount: attempted.reduce((sum, item) => sum + item.comparison.semanticIntegrity.mixedScriptPaths.length, 0),
    semanticContradictionCount: attempted.reduce((sum, item) => sum + item.comparison.semanticIntegrity.executionContradictionPaths.length, 0),
    rawMaterialRequestCount: attempted.reduce((sum, item) => sum + item.comparison.semanticIntegrity.rawMaterialRequestPaths.length, 0),
    invalidProvenanceCount: attempted.reduce((sum, item) => sum + item.comparison.semanticIntegrity.invalidBasisPaths.length, 0),
    retryCount: attemptedOrFailed.reduce((sum, item) => sum + numeric(item.llmPlanner.retry?.retryCount), 0),
    recoveredRetryCount: attemptedOrFailed.filter((item) => item.llmPlanner.retry?.recovered).length
  };

  return {
    candidateCount: results.length,
    uniqueCandidateCount: new Set(results.map((item) => item.candidateId)).size,
    repeatCount,
    actualLlmCompletedCount: attempted.length,
    actualLlmSkippedCount: dryRunSkipped.length,
    failedCount: failed.length,
    fallbackSafetyRecordCount: failed.filter((item) => item.llmPlanner.mode === "mock" && item.llmPlanner.plannerStatus === "failed").length,
    harnessMetrics: completedMetrics,
    performanceMetrics: actualLlmAttempted
      ? completedMetrics
      : {
        guardrailAcceptedCount: null,
        falsePassIncreaseCount: null,
        falseBlockerIncreaseCount: null,
        semanticFalseReassuranceCount: null,
        semanticFalseAlarmCount: null,
        criticalGapDownrankCount: null,
        priorityMayBeTooNarrowImprovedCount: null,
        reason: "Actual LLM A/B was not attempted; dry-run/mock harness counts are not performance evidence."
    },
    metricInterpretation: "These are final-output guardrail/preflight checks, not semantic quality labels or correctness metrics.",
    consistency: actualLlmAttempted ? consistencySummary(attempted) : {
      status: "not_measured",
      reason: "Actual LLM A/B was not attempted."
    },
    latency: {
      completedP50Ms: percentile(completedLatencies, 0.5),
      completedP95Ms: percentile(completedLatencies, 0.95),
      operationalP50Ms: percentile(operationalLatencies, 0.5),
      operationalP95Ms: percentile(operationalLatencies, 0.95),
      totalMs: results.reduce((sum, item) => sum + numeric(item.llmPlanner.latencyMs), 0)
    },
    tokenUsage,
    baselineSchemaTokenUsage,
    previousTokenUsage,
    tokenReduction: tokenReductionSummary(baselineSchemaTokenUsage.available ? baselineSchemaTokenUsage : previousTokenUsage, tokenUsage),
    tokenReductionVsPreviousAb: tokenReductionSummary(previousTokenUsage, tokenUsage),
    runLevel: {
      completedCount: attempted.length,
      failedCount: failed.length,
      semanticFalseAlarmCount: completedMetrics.semanticFalseAlarmCount,
      semanticFalseReassuranceCount: completedMetrics.semanticFalseReassuranceCount,
      criticalGapDownrankCount: completedMetrics.criticalGapDownrankCount
    },
    uniquePrLevel: uniquePrMetrics(attempted),
    totalEstimatedUsd: tokenUsage.estimatedUsd,
    totalLatencyMs: results.reduce((sum, item) => sum + numeric(item.llmPlanner.latencyMs), 0)
  };
}

function usageMetricsFromResponse(responseJson, requestMeta = {}) {
  const usage = responseJson?.usage ?? {};
  const inputTokens = nullableNumber(usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens);
  const outputTokens = nullableNumber(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens);
  const totalTokens = nullableNumber(usage.total_tokens ?? usage.totalTokens);
  const cachedInputTokens = nullableNumber(usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens);
  const reasoningTokens = nullableNumber(usage.output_tokens_details?.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens);
  const visibleOutputTokens = outputTokens === null || reasoningTokens === null ? null : Math.max(0, outputTokens - reasoningTokens);
  const inputUsdPer1m = nullableNumber(process.env.AGENTPROOF_LLM_INPUT_USD_PER_1M);
  const outputUsdPer1m = nullableNumber(process.env.AGENTPROOF_LLM_OUTPUT_USD_PER_1M);
  const estimatedUsd = inputTokens !== null && outputTokens !== null && inputUsdPer1m !== null && outputUsdPer1m !== null
    ? round((inputTokens / 1_000_000) * inputUsdPer1m + (outputTokens / 1_000_000) * outputUsdPer1m, 6)
    : null;

  const resolvedModel = normalizeModelIdentifier(responseJson?.model);
  return {
    requestedModel: requestMeta.requestedModel ?? null,
    resolvedModel,
    resolvedModelSnapshots: resolvedModel ? [resolvedModel] : [],
    reasoningEffort: requestMeta.reasoningEffort ?? null,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    visibleOutputTokens,
    totalTokens: totalTokens ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
    maxOutputTokens: requestMeta.maxOutputTokens ?? null,
    serializedOutputChars: requestMeta.serializedOutputChars ?? null,
    serializedOutputBytes: requestMeta.serializedOutputBytes ?? null,
    estimatedUsd,
    pricingConfigured: inputUsdPer1m !== null && outputUsdPer1m !== null,
    promptVersion: requestMeta.promptVersion ?? promptVersion,
    schemaVersion: requestMeta.schemaVersion ?? schemaVersion,
    gitCommit
  };
}

function summarizeTokenUsage(results) {
  const measured = results.map((item) => item.llmPlanner.tokenMetrics).filter((metrics) =>
    isRecord(metrics) && metrics.inputTokens !== null && metrics.outputTokens !== null
  );
  return summarizeTokenMetrics(measured);
}

function summarizeMeasurementTokenUsage(measurements) {
  const measured = measurements.map((item) => item.tokenMetrics).filter((metrics) =>
    isRecord(metrics) && metrics.inputTokens !== null && metrics.outputTokens !== null
  );
  return summarizeTokenMetrics(measured);
}

function summarizeTokenMetrics(measured) {
  if (measured.length === 0) {
    return {
      available: false,
      measuredRunCount: 0,
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      visibleOutputTokens: null,
      totalTokens: null,
      averageInputTokens: null,
      averageOutputTokens: null,
      averageReasoningTokens: null,
      averageVisibleOutputTokens: null,
      estimatedUsd: null,
      pricingConfigured: false,
      pricingNote: "Token usage was unavailable; do not interpret missing metrics as zero."
    };
  }

  const totals = measured.reduce(
    (acc, item) => {
      acc.inputTokens += item.inputTokens;
      acc.cachedInputTokens = nullableSum(acc.cachedInputTokens, item.cachedInputTokens);
      acc.outputTokens += item.outputTokens;
      acc.reasoningTokens = nullableSum(acc.reasoningTokens, item.reasoningTokens);
      acc.visibleOutputTokens = nullableSum(acc.visibleOutputTokens, item.visibleOutputTokens);
      acc.totalTokens += item.totalTokens ?? item.inputTokens + item.outputTokens;
      acc.estimatedUsd = nullableSum(acc.estimatedUsd, item.estimatedUsd);
      if (item.pricingConfigured) acc.pricingConfigured = true;
      return acc;
    },
    { inputTokens: 0, cachedInputTokens: null, outputTokens: 0, reasoningTokens: null, visibleOutputTokens: null, totalTokens: 0, estimatedUsd: null, pricingConfigured: false }
  );

  return {
    available: true,
    measuredRunCount: measured.length,
    requestedModels: uniqueStrings(measured.map((item) => item.requestedModel).filter(Boolean)),
    resolvedModels: uniqueStrings(measured.flatMap((item) =>
      Array.isArray(item.resolvedModelSnapshots) ? item.resolvedModelSnapshots : [item.resolvedModel]
    ).filter(Boolean)),
    reasoningEfforts: uniqueStrings(measured.map((item) => item.reasoningEffort).filter(Boolean)),
    maxOutputTokens: uniqueStrings(measured.map((item) => item.maxOutputTokens).filter((value) => value !== null).map(String)),
    inputTokens: totals.inputTokens,
    cachedInputTokens: totals.cachedInputTokens,
    outputTokens: totals.outputTokens,
    reasoningTokens: totals.reasoningTokens,
    visibleOutputTokens: totals.visibleOutputTokens,
    totalTokens: totals.totalTokens,
    averageInputTokens: round(totals.inputTokens / measured.length, 2),
    averageOutputTokens: round(totals.outputTokens / measured.length, 2),
    averageReasoningTokens: totals.reasoningTokens === null ? null : round(totals.reasoningTokens / measured.length, 2),
    averageVisibleOutputTokens: totals.visibleOutputTokens === null ? null : round(totals.visibleOutputTokens / measured.length, 2),
    averageTotalTokens: round(totals.totalTokens / measured.length, 2),
    estimatedUsd: totals.estimatedUsd === null ? null : round(totals.estimatedUsd, 6),
    pricingConfigured: totals.pricingConfigured,
    pricingNote: totals.pricingConfigured
      ? "Estimated from AGENTPROOF_LLM_INPUT_USD_PER_1M and AGENTPROOF_LLM_OUTPUT_USD_PER_1M."
      : "Pricing env vars were not configured; estimated cost is unavailable, not zero."
  };
}

function uniquePrMetrics(results) {
  const groups = new Map();
  for (const result of results) {
    const items = groups.get(result.candidateId) ?? [];
    items.push(result);
    groups.set(result.candidateId, items);
  }
  const values = [...groups.values()];
  return {
    uniqueCandidateCount: groups.size,
    anySemanticFalseAlarmCount: values.filter((items) => items.some((item) => item.comparison.semanticFalseAlarm)).length,
    anySemanticFalseReassuranceCount: values.filter((items) => items.some((item) => item.comparison.semanticFalseReassurance)).length,
    anyCriticalGapDownrankCount: values.filter((items) => items.some((item) => item.comparison.criticalGapDownrank)).length,
    anySchemaOrGuardrailFailureCount: values.filter((items) => items.some((item) => item.analysisStatus !== "completed" || !item.comparison.guardrailAccepted)).length
  };
}

function tokenReductionSummary(previous, current) {
  if (!previous || !current.available || typeof previous.inputTokens !== "number" || typeof previous.outputTokens !== "number") {
    return {
      available: false,
      reason: "Previous or current measured token usage was unavailable."
    };
  }
  const previousRunCount = numeric(previous.measuredRunCount) || 1;
  const currentRunCount = numeric(current.measuredRunCount) || 1;
  const previousInputAverage = typeof previous.averageInputTokens === "number"
    ? previous.averageInputTokens
    : previous.inputTokens / previousRunCount;
  const currentInputAverage = typeof current.averageInputTokens === "number"
    ? current.averageInputTokens
    : current.inputTokens / currentRunCount;
  const previousOutputAverage = typeof previous.averageOutputTokens === "number"
    ? previous.averageOutputTokens
    : previous.outputTokens / previousRunCount;
  const currentOutputAverage = typeof current.averageOutputTokens === "number"
    ? current.averageOutputTokens
    : current.outputTokens / currentRunCount;
  const previousTotalAverage = typeof previous.averageTotalTokens === "number"
    ? previous.averageTotalTokens
    : numeric(previous.totalTokens) / previousRunCount;
  const currentTotalAverage = typeof current.averageTotalTokens === "number"
    ? current.averageTotalTokens
    : numeric(current.totalTokens) / currentRunCount;
  return {
    available: true,
    comparisonBasis: "average_tokens_per_run",
    previousMeasuredRunCount: previousRunCount,
    currentMeasuredRunCount: currentRunCount,
    previousInputTokensPerRun: round(previousInputAverage, 2),
    currentInputTokensPerRun: round(currentInputAverage, 2),
    inputTokenReductionPercent: percentReduction(previousInputAverage, currentInputAverage),
    previousOutputTokensPerRun: round(previousOutputAverage, 2),
    currentOutputTokensPerRun: round(currentOutputAverage, 2),
    outputTokenReductionPercent: percentReduction(previousOutputAverage, currentOutputAverage),
    previousTotalTokensPerRun: round(previousTotalAverage, 2),
    currentTotalTokensPerRun: round(currentTotalAverage, 2),
    totalTokenReductionPercent: percentReduction(previousTotalAverage, currentTotalAverage)
  };
}

function normalizePreviousTokenUsage(value, measuredRunCount) {
  if (!isRecord(value)) return null;
  const pricingConfigured = value.pricingConfigured === true;
  const runCount = numeric(measuredRunCount) || numeric(value.measuredRunCount) || null;
  return {
    ...value,
    measuredRunCount: runCount,
    averageInputTokens: runCount ? round(numeric(value.inputTokens) / runCount, 2) : value.averageInputTokens,
    averageOutputTokens: runCount ? round(numeric(value.outputTokens) / runCount, 2) : value.averageOutputTokens,
    averageTotalTokens: runCount ? round(numeric(value.totalTokens) / runCount, 2) : value.averageTotalTokens,
    estimatedUsd: pricingConfigured ? nullableNumber(value.estimatedUsd) : null,
    pricingConfigured,
    pricingNote: pricingConfigured
      ? String(value.pricingNote ?? "Estimated from configured pricing.")
      : "Previous run had token counts, but pricing env vars were not configured; estimated cost is unavailable, not zero."
  };
}

function consistencySummary(results) {
  if (results.length === 0) {
    return {
      status: "no_completed_runs",
      repeatedCandidateCount: 0,
      axes: {}
    };
  }

  const groups = new Map();
  for (const result of results) {
    const items = groups.get(result.candidateId) ?? [];
    items.push(result);
    groups.set(result.candidateId, items);
  }

  const axes = {
    truth: consistencyAxis(groups, truthConsistencySignature),
    ids: consistencyAxis(groups, idConsistencySignature),
    category: consistencyAxis(groups, categoryConsistencySignature),
    priority: consistencyAxis(groups, priorityConsistencySignature),
    wording: consistencyAxis(groups, wordingConsistencySignature)
  };
  const semanticAxes = [axes.truth, axes.ids, axes.category, axes.priority];
  const semanticUnstableCandidates = uniqueStrings(semanticAxes.flatMap((axis) => axis.unstableCandidates));

  return {
    status: semanticUnstableCandidates.length === 0 ? "semantically_stable" : "semantic_instability_detected",
    repeatedCandidateCount: groups.size,
    semanticUnstableCandidateCount: semanticUnstableCandidates.length,
    semanticUnstableCandidates: semanticUnstableCandidates.slice(0, 20),
    wordingVariationIsFailure: false,
    axes
  };
}

function consistencyAxis(groups, signatureFn) {
  const unstableCandidates = [];
  for (const [candidateId, items] of groups) {
    if (new Set(items.map(signatureFn)).size > 1) unstableCandidates.push(candidateId);
  }
  return {
    status: unstableCandidates.length === 0 ? "stable" : "varied",
    unstableCandidateCount: unstableCandidates.length,
    unstableCandidates: unstableCandidates.slice(0, 20)
  };
}

function truthConsistencySignature(result) {
  return JSON.stringify({
    analysisStatus: result.analysisStatus,
    schemaValid: result.llmPlanner.schemaValidation.valid,
    guardrailBlocks: result.llmPlanner.guardrailMerge.blockedMutationReasons,
    falsePassIncrease: result.comparison.falsePassIncrease,
    falseBlockerIncrease: result.comparison.falseBlockerIncrease,
    semanticFalseReassurance: result.comparison.semanticFalseReassurance,
    semanticFalseAlarm: result.comparison.semanticFalseAlarm,
    criticalGapDownrank: result.comparison.criticalGapDownrank,
    deterministicStatusPreserved: result.comparison.deterministicStatusPreserved
  });
}

function idConsistencySignature(result) {
  return JSON.stringify({
    requirementIds: [...result.llmPlanner.suggestionSummary.requirementIds].sort(),
    requirementSuggestionCount: result.llmPlanner.suggestionSummary.requirementSuggestionCount,
    contextIds: result.llmPlanner.suggestionSummary.contextClassifications.map((item) => item.sourceId).sort(),
    contextClassificationCount: result.llmPlanner.suggestionSummary.contextClassificationCount
  });
}

function categoryConsistencySignature(result) {
  const provenance = result.llmPlanner.suggestionSummary.provenance;
  return JSON.stringify({
    semanticClarity: result.deterministicPlusLlm.semanticClarity,
    requirementCategories: [...result.llmPlanner.suggestionSummary.requirementCategories]
      .map((item) => ({
        requirementId: item.requirementId,
        semanticClarity: item.semanticClarity,
        proofPlanBasisRefs: uniqueStrings(item.proofPlanBasis).sort(),
        missingProofBasis: item.missingProofBasis
      }))
      .sort((left, right) => left.requirementId.localeCompare(right.requirementId)),
    contextCategories: result.llmPlanner.suggestionSummary.contextClassifications
      .map((item) => [item.sourceId, item.role]).sort(([left], [right]) => left.localeCompare(right)),
    reviewerBasisRefs: uniqueStrings([
      ...(provenance.topRiskBasis ?? []),
      provenance.whyBasis,
      provenance.reviewerQuestionBasis
    ].filter(Boolean)).sort()
  });
}

function priorityConsistencySignature(result) {
  return JSON.stringify({
    priorityNudge: result.deterministicPlusLlm.priorityNudge,
    priorityNudgeGapRef: result.deterministicPlusLlm.priorityNudgeGapRef
  });
}

function wordingConsistencySignature(result) {
  return JSON.stringify({
    topSemanticRisks: result.deterministicPlusLlm.topSemanticRisks,
    reviewerWhy: result.deterministicPlusLlm.reviewerWhy,
    missingProofExplanations: result.deterministicPlusLlm.missingProofExplanations,
    requirements: result.llmPlanner.suggestionSummary.firstRequirementSuggestions.map((item) => ({
      requirementId: item.requirementId,
      rewrite: item.rewrite,
      proofPlan: item.proofPlan,
      missingProof: item.missingProof
    }))
  });
}

function percentile(values, percentileValue) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * percentileValue) - 1));
  return sorted[index];
}

function sourcePolicy() {
  return {
    publicOnly: true,
    noPrivateRepos: true,
    noTokensStored: true,
    noRawFullLogs: true,
    noRawDiffs: true,
    noPrivateUserData: true,
    noRawPrompts: true,
    correctnessLabelsCompleted: false,
    notes: [
      "A/B results compare deterministic-only summaries with deterministic plus LLM semantic suggestions.",
      "LLM suggestions are not treated as truth or final reviewer labels.",
      "Mock/dry-run results are harness validation only and are not LLM performance evidence.",
      "The 10-case baseline is now a regression/dev set, not a fresh holdout.",
      "Deterministic testBuildStatus, failed execution evidence, and deterministic gaps cannot be overridden.",
      "The baseline source is summary-only; source diffs and CI archives are not stored."
    ]
  };
}

function renderReport(output) {
  const lines = [
    "# AgentProof LLM Proof Planner Semantic Integrity Report",
    "",
    `Generated: ${output.generatedAt}`,
    `Status: ${output.status}`,
    `Mode: ${output.mode}`,
    `Actual LLM attempted: ${output.actualLlmAttempted}`,
    `Evaluation state: ${output.evaluationState.harness} / ${output.evaluationState.realAb}`,
    `Baseline set role: ${output.evaluationState.baselineSetRole}`,
    `Evaluation artifact schema: ${output.reproducibility?.evaluationArtifactSchemaVersion ?? "legacy/unavailable"}`,
    `Planner input/output schema: ${output.modelSettings.plannerInputSchemaVersion ?? "legacy/unavailable"} / ${output.modelSettings.plannerOutputSchemaVersion ?? output.modelSettings.schemaVersion}`,
    `Prompt/schema: ${output.modelSettings.promptVersion} / ${output.modelSettings.schemaVersion}`,
    `Requested/resolved snapshot: ${output.modelSettings.requestedModel ?? "unavailable"} / ${output.modelSettings.modelSnapshot ?? ((output.summary.tokenUsage.resolvedModels ?? []).join(", ") || "unavailable")}`,
    `Reasoning effort: ${output.modelSettings.reasoningEffort ?? "default/unavailable"}`,
    `Max output tokens: ${output.modelSettings.maxOutputTokens ?? "unavailable"}`,
    `Source commit: ${output.modelSettings.sourceCommit ?? output.modelSettings.gitCommit ?? "unavailable"}`,
    `Working tree dirty: ${output.modelSettings.workingTreeDirty ?? output.modelSettings.gitDirty ?? "unavailable"} (${output.modelSettings.workingTreeChangedPathCount ?? output.modelSettings.gitChangedPathCount ?? "unavailable"} changed paths)`,
    `Prompt/schema/harness/baseline digests: ${output.reproducibility?.digests?.promptSha256 ?? "unavailable"} / ${output.reproducibility?.digests?.plannerSchemaSha256 ?? "unavailable"} / ${output.reproducibility?.digests?.evaluationHarnessSha256 ?? "unavailable"} / ${output.reproducibility?.digests?.baselineSourceSha256 ?? "unavailable"}`,
    "",
    "## Summary",
    "",
    `- Candidate count: ${output.summary.candidateCount}`,
    `- Unique candidates: ${output.summary.uniqueCandidateCount}`,
    `- Repeat count: ${output.summary.repeatCount}`,
    `- Actual LLM completed: ${output.summary.actualLlmCompletedCount}`,
    `- Actual LLM skipped: ${output.summary.actualLlmSkippedCount}`,
    `- Failed: ${output.summary.failedCount}`,
    `- Fallback safety records: ${output.summary.fallbackSafetyRecordCount}`,
    `- Harness guardrail accepted: ${output.summary.harnessMetrics.guardrailAcceptedCount}`,
    `- First-pass accepted/rejected: ${output.summary.harnessMetrics.firstPassAcceptedCount} / ${output.summary.harnessMetrics.firstPassRejectedCount}`,
    `- Accepted after one retry: ${output.summary.harnessMetrics.afterRetryAcceptedCount}`,
    `- Harness false pass increase: ${output.summary.harnessMetrics.falsePassIncreaseCount}`,
    `- Harness false blocker increase: ${output.summary.harnessMetrics.falseBlockerIncreaseCount}`,
    `- Harness semantic false reassurance: ${output.summary.harnessMetrics.semanticFalseReassuranceCount}`,
    `- Harness semantic false alarm: ${output.summary.harnessMetrics.semanticFalseAlarmCount}`,
    `- Harness critical gap downrank: ${output.summary.harnessMetrics.criticalGapDownrankCount}`,
    `- Harness priority-may-be-too-narrow nudge: ${output.summary.harnessMetrics.priorityMayBeTooNarrowImprovedCount}`,
    `- Incomplete/truncated sentence findings: ${output.summary.harnessMetrics.incompleteSentenceCount}`,
    `- Mixed-script findings: ${output.summary.harnessMetrics.mixedScriptCount}`,
    `- Execution contradiction findings: ${output.summary.harnessMetrics.semanticContradictionCount}`,
    `- Raw log/stdout request findings: ${output.summary.harnessMetrics.rawMaterialRequestCount}`,
    `- Invalid provenance findings: ${output.summary.harnessMetrics.invalidProvenanceCount}`,
    `- Retry/recovered count: ${output.summary.harnessMetrics.retryCount} / ${output.summary.harnessMetrics.recoveredRetryCount}`,
    `- Real performance metrics: ${output.actualLlmAttempted ? "available" : "pending; actual LLM was not attempted"}`,
    `- Consistency: ${output.summary.consistency.status}`,
    `- Truth/ID/category/priority/wording consistency: ${["truth", "ids", "category", "priority", "wording"].map((axis) => `${axis}=${output.summary.consistency.axes?.[axis]?.status ?? "unavailable"}`).join(", ")}`,
    `- Completed latency p50/p95 ms: ${output.summary.latency.completedP50Ms} / ${output.summary.latency.completedP95Ms}`,
    `- Operational latency p50/p95 ms: ${output.summary.latency.operationalP50Ms} / ${output.summary.latency.operationalP95Ms}`,
    `- Token usage total: input ${output.summary.tokenUsage.inputTokens}, output ${output.summary.tokenUsage.outputTokens}, visible output ${output.summary.tokenUsage.visibleOutputTokens}, reasoning ${output.summary.tokenUsage.reasoningTokens}, total ${output.summary.tokenUsage.totalTokens}`,
    `- Average tokens/run: input ${output.summary.tokenUsage.averageInputTokens}, output ${output.summary.tokenUsage.averageOutputTokens}, visible ${output.summary.tokenUsage.averageVisibleOutputTokens}, reasoning ${output.summary.tokenUsage.averageReasoningTokens}, total ${output.summary.tokenUsage.averageTotalTokens}`,
    `- Estimated cost: ${output.summary.totalEstimatedUsd === null ? "unavailable" : `$${output.summary.totalEstimatedUsd}`}`,
    `- Total-token change vs v2 token baseline: ${output.summary.tokenReduction.available ? tokenChangeLabel(output.summary.tokenReduction.totalTokenReductionPercent) : output.summary.tokenReduction.reason}`,
    `- Total latency ms: ${output.summary.totalLatencyMs}`,
    `- Human labeling preflight ready: ${output.humanAbReadiness?.readyToBeginHumanLabeling ?? false}`,
    `- Controlled Human A/B ready: ${output.humanAbReadiness?.readyForControlledHumanAb ?? false}`,
    `- Product default ready: ${output.humanAbReadiness?.readyForProductDefault ?? false}`,
    `- Category variation requires human review: ${output.humanAbReadiness?.categoryVariationRequiresHumanReview ?? true}`,
    "",
    "## Guardrails",
    "",
    "- Deterministic test/build status is copied through unchanged.",
    "- Failed execution evidence and deterministic gaps are copied from deterministic evidence, not model self-attestation.",
    "- LLM suggestion uses semanticClarity and compact reviewer signals, not deterministic sourceQuality/sourceAuthority.",
    "- Token/cost metrics come from API response usage, not model-authored JSON.",
    "- Dry-run/mock output is not reported as real LLM quality, cost, or latency.",
    "",
    "## Candidate Notes",
    ""
  ];

  for (const result of output.results) {
    const riskBasis = result.llmPlanner.suggestionSummary.provenance?.topRiskBasis ?? [];
    const groundedRisks = result.deterministicPlusLlm.topSemanticRisks.map((risk, index) =>
      `${risk} [basis: ${riskBasis[index] ?? "unavailable"}]`
    );
    lines.push(
      `### ${result.candidateId} ${result.repository}#${result.prNumber}`,
      "",
      `- Deterministic priority/test: ${result.deterministicOnly.priority} / ${result.deterministicOnly.testBuildStatus}`,
      `- LLM status: ${result.analysisStatus}${result.actualLlmSkippedReason ? ` (${result.actualLlmSkippedReason})` : ""}`,
      `- Priority nudge: ${result.deterministicPlusLlm.priorityNudge}`,
      `- False pass increase: ${result.comparison.falsePassIncrease}`,
      `- False blocker increase: ${result.comparison.falseBlockerIncrease}`,
      `- Semantic false reassurance: ${result.comparison.semanticFalseReassurance}`,
      `- Semantic false alarm: ${result.comparison.semanticFalseAlarm}`,
      `- Critical gap downrank: ${result.comparison.criticalGapDownrank}`,
      `- Requirement noise assessment: ${result.comparison.requirementNoiseReduction}`,
      `- Top semantic risks: ${groundedRisks.join(" | ") || "none"}`,
      ""
    );
  }

  lines.push(
    "## Human Review Caveat",
    "",
    "This report validates the A/B pathway and guardrails. It does not complete manual labels and does not prove PR correctness."
  );

  return `${lines.join("\n")}\n`;
}

function tokenChangeLabel(reductionPercent) {
  const value = numeric(reductionPercent);
  return value >= 0 ? `${value}% reduction` : `${Math.abs(value)}% increase`;
}

function plannerPrompt() {
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

function plannerSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["requirementSuggestions", "contextClassifications", "reviewerSignals"],
    properties: {
      requirementSuggestions: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["requirementId", "rewrite", "semanticClarity", "proofPlan", "proofPlanBasis", "missingProof", "missingProofBasis"],
          properties: {
            requirementId: { type: "string", maxLength: 120 },
            rewrite: { type: "string", maxLength: 280 },
            semanticClarity: { type: "string", enum: ["clear", "needs_human_review", "unclear"] },
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
            role: { type: "string", enum: ["problem_context", "reproduction_context", "environment_context", "visual_context", "external_reference", "solution_hint", "author_claim", "template_noise"] }
          }
        }
      },
      reviewerSignals: {
        type: "object",
        additionalProperties: false,
        required: ["topRisks", "topRiskBasis", "why", "whyBasis", "reviewerQuestion", "reviewerQuestionBasis", "priorityNudge", "priorityNudgeGapRef"],
        properties: {
          topRisks: { type: "array", maxItems: 2, items: { type: "string", maxLength: 220 } },
          topRiskBasis: { type: "array", maxItems: 2, items: plannerBasisSchema() },
          why: { type: "string", maxLength: 220 },
          whyBasis: plannerBasisSchema(),
          reviewerQuestion: { type: "string", maxLength: 220 },
          reviewerQuestionBasis: plannerBasisSchema(),
          priorityNudge: { type: "string", enum: ["no_change", "consider_higher", "consider_lower", "manual_review"] },
          priorityNudgeGapRef: { type: ["string", "null"], maxLength: 200 }
        }
      }
    }
  };
}

function plannerBasisSchema() {
  return { type: "string", maxLength: 120 };
}

function legacyPlannerPrompt() {
  return [
    "You are AgentProof's LLM proof planner. Produce semantic suggestions only.",
    "Do not decide whether tests passed or failed. Preserve deterministic testBuildStatus exactly.",
    "Do not remove failed execution evidence or hide deterministic proof gaps.",
    "Separate core requirements from context, author claims, solution hints, and template noise.",
    "Create concise proof plans and reviewer-facing why/missing-proof explanations.",
    "Do not invent files, checks, logs, screenshots, or private facts. Use only the compact evidence package.",
    "The output is not a merge decision and not a correctness label."
  ].join("\n");
}

function legacyPlannerSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "version",
      "mode",
      "plannerStatus",
      "summary",
      "requirementSuggestions",
      "contextClassifications",
      "reviewerSignals",
      "deterministicAcknowledgement",
      "cost",
      "latencyMs",
      "suggestionConfidence",
      "limitations"
    ],
    properties: {
      version: { type: "number", enum: [1] },
      mode: { type: "string", enum: ["openai", "mock"] },
      plannerStatus: { type: "string", enum: ["completed", "skipped", "failed"] },
      summary: { type: "string", maxLength: 1000 },
      requirementSuggestions: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "requirementId",
            "rewrittenCoreRequirement",
            "role",
            "semanticClarity",
            "sourceFidelity",
            "suggestionConfidence",
            "whyThisMatters",
            "proofPlan",
            "missingProof",
            "deterministicGapKindsAcknowledged",
            "sourceRequirementIds"
          ],
          properties: {
            requirementId: { type: "string", maxLength: 120 },
            rewrittenCoreRequirement: { type: "string", maxLength: 600 },
            role: { type: "string", enum: ["core_requirement", "problem_context", "reproduction_context", "environment_context", "visual_context", "external_reference", "solution_hint", "author_claim", "template_noise"] },
            semanticClarity: { type: "string", enum: ["clear", "needs_human_review", "unclear"] },
            sourceFidelity: { type: "string", enum: ["preserves_deterministic_source", "needs_human_review"] },
            suggestionConfidence: { type: "number", minimum: 0, maximum: 0.75 },
            whyThisMatters: { type: "string", maxLength: 600 },
            proofPlan: { type: "array", maxItems: 8, items: { type: "string", maxLength: 360 } },
            missingProof: { type: "array", maxItems: 8, items: { type: "string", maxLength: 360 } },
            deterministicGapKindsAcknowledged: { type: "array", maxItems: 20, items: { type: "string", maxLength: 80 } },
            sourceRequirementIds: { type: "array", maxItems: 10, items: { type: "string", maxLength: 120 } }
          }
        }
      },
      contextClassifications: {
        type: "array",
        maxItems: 30,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["sourceId", "role", "reason"],
          properties: {
            sourceId: { type: "string", maxLength: 120 },
            role: { type: "string", enum: ["core_requirement", "problem_context", "reproduction_context", "environment_context", "visual_context", "external_reference", "solution_hint", "author_claim", "template_noise"] },
            reason: { type: "string", maxLength: 360 }
          }
        }
      },
      reviewerSignals: {
        type: "object",
        additionalProperties: false,
        required: ["topSemanticRisks", "reviewerWhy", "missingProofExplanations", "priorityNudge", "priorityNudgeReason"],
        properties: {
          topSemanticRisks: { type: "array", maxItems: 6, items: { type: "string", maxLength: 360 } },
          reviewerWhy: { type: "array", maxItems: 6, items: { type: "string", maxLength: 360 } },
          missingProofExplanations: { type: "array", maxItems: 8, items: { type: "string", maxLength: 360 } },
          priorityNudge: { type: "string", enum: ["none", "consider_higher", "consider_lower", "manual_review"] },
          priorityNudgeReason: { type: "string", maxLength: 500 }
        }
      },
      deterministicAcknowledgement: {
        type: "object",
        additionalProperties: false,
        required: ["testBuildStatusMustRemain", "failedExecutionEvidencePreserved", "deterministicGapKinds", "cannotOverrideExecutionStatus", "cannotHideDeterministicGaps"],
        properties: {
          testBuildStatusMustRemain: { type: "string", enum: ["passed", "failed", "pending", "unknown"] },
          failedExecutionEvidencePreserved: { type: "boolean" },
          deterministicGapKinds: { type: "array", maxItems: 20, items: { type: "string", maxLength: 80 } },
          cannotOverrideExecutionStatus: { type: "boolean", enum: [true] },
          cannotHideDeterministicGaps: { type: "boolean", enum: [true] }
        }
      },
      cost: {
        type: "object",
        additionalProperties: false,
        required: ["inputTokens", "outputTokens", "totalTokens", "estimatedUsd"],
        properties: {
          inputTokens: { type: "number", minimum: 0, maximum: 2000000 },
          outputTokens: { type: "number", minimum: 0, maximum: 2000000 },
          totalTokens: { type: "number", minimum: 0, maximum: 4000000 },
          estimatedUsd: { type: "number", minimum: 0, maximum: 1000 }
        }
      },
      latencyMs: { type: "number", minimum: 0, maximum: 600000 },
      suggestionConfidence: { type: "number", minimum: 0, maximum: 0.75 },
      limitations: { type: "array", maxItems: 12, items: { type: "string", maxLength: 500 } }
    }
  };
}

function extractResponseText(value) {
  if (typeof value?.output_text === "string") return value.output_text;
  for (const item of value?.output ?? []) {
    for (const content of item?.content ?? []) {
      if ((content?.type === "output_text" || content?.type === "text") && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return null;
}

function contextFromCounts(counts) {
  return Object.entries(counts)
    .filter(([role, count]) => role !== "core_requirement" && numeric(count) > 0)
    .slice(0, 20)
    .map(([role, count], index) => ({
      id: `context_count_${index + 1}`,
      role,
      sourceQuality: "fallback",
      sourceSection: null,
      text: `${numeric(count)} deterministic context signal(s) were classified as ${role}.`
    }));
}

function summarizeRequirements(requirements) {
  if (requirements.length === 0) {
    return "No requirement candidates were retained in the deterministic summary-only baseline.";
  }
  return safeText(requirements.map((item) => `- ${item.text}`).join("\n"), 1200);
}

function isSecurityOrCrashText(value) {
  return /\b(crash|security|traversal|corruption|regression|auth|permission|vulnerability|panic|exploit)\b/i.test(value);
}

function inferFileKind(path) {
  const lower = path.toLowerCase();
  if (/\b(test|spec|__tests__|fixtures?)\b|\.test\.|\.spec\./i.test(path)) return "test";
  if (lower.endsWith(".md") || lower.includes("docs/") || lower.includes("changelog") || lower.includes(".changeset/")) return "docs";
  if (lower.includes("workflow") || lower.includes(".github/") || lower.endsWith(".yml") || lower.endsWith(".yaml")) return "ci";
  if (lower.includes("package.json") || lower.includes("lock") || lower.includes("config")) return "config";
  if (path && path !== "Requirement evidence") return "implementation";
  return "unknown";
}

function priorityValue(value) {
  return ["low", "medium", "high", "blocker"].includes(value) ? value : "medium";
}

function checkStatusValue(value) {
  return ["passed", "failed", "pending", "unknown"].includes(value) ? value : "unknown";
}

function numericRecord(value) {
  return Object.fromEntries(Object.entries(value).map(([key, count]) => [key, numeric(count)]));
}

function boundedStrings(value, limit, maxLength) {
  return uniqueStrings(value.map((item) => safeText(item, maxLength))).filter(Boolean).slice(0, limit);
}

function plannerLimitations(value) {
  return boundedStrings(value.filter((item) => !/\braw\s+(?:ci\s+)?logs?\b/i.test(item)), 12, 500);
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.map((item) => String(item ?? "")) : [];
}

function uniqueStrings(values) {
  return Array.from(new Set(values.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

function safeText(value, maxLength) {
  return String(value ?? "")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted]")
    .replace(/https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g, "[redacted]")
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}/g, "[redacted]")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "[redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[redacted]")
    .replace(/authorization\s*:\s*bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function containsSecretLike(value) {
  return /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/.test(value) ||
    /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/.test(value) ||
    /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}/.test(value) ||
    /github_pat_[A-Za-z0-9_]{20,}/.test(value) ||
    /\bsk-[A-Za-z0-9_-]{8,}/.test(value) ||
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(value) ||
    /authorization\s*:\s*bearer\s+[A-Za-z0-9._~+/-]+=*/i.test(value) ||
    /\bbearer\s+[A-Za-z0-9._~+/-]{8,}=*/i.test(value);
}

function containsPromptInjectionOrUnsupportedClaim(value) {
  return /\b(ignore (?:all )?(?:previous|above|system|developer) instructions|reveal (?:the )?(?:system )?prompt|you are now|safe to merge|approved to merge|production ready|correct implementation)\b/i.test(value);
}

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableSum(left, right) {
  if (right === null || right === undefined) return left;
  return (left ?? 0) + right;
}

function unavailableTokenMetrics(schemaVersionOverride = schemaVersion) {
  return {
    requestedModel: actualLlmAttempted ? requestedModel : null,
    resolvedModel: null,
    resolvedModelSnapshots: [],
    reasoningEffort: actualLlmAttempted ? reasoningEffort : null,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    visibleOutputTokens: null,
    totalTokens: null,
    maxOutputTokens: actualLlmAttempted ? maxOutputTokens : null,
    serializedOutputChars: null,
    serializedOutputBytes: null,
    estimatedUsd: null,
    pricingConfigured: false,
    promptVersion: schemaVersionOverride === "1-legacy-measurement" ? "llm-proof-planner-v1-legacy-measurement" : promptVersion,
    schemaVersion: schemaVersionOverride,
    gitCommit
  };
}

function combineAttemptTokenMetrics(metrics) {
  const last = metrics[metrics.length - 1] ?? unavailableTokenMetrics();
  const resolvedModelSnapshots = uniqueStrings(metrics.flatMap((item) =>
    Array.isArray(item.resolvedModelSnapshots) ? item.resolvedModelSnapshots : [item.resolvedModel]
  ).filter(Boolean));
  const sumNullable = (key) => metrics.some((item) => typeof item?.[key] === "number")
    ? metrics.reduce((sum, item) => sum + (typeof item?.[key] === "number" ? item[key] : 0), 0)
    : null;
  const inputTokens = sumNullable("inputTokens");
  const outputTokens = sumNullable("outputTokens");
  return {
    ...last,
    resolvedModel: resolvedModelSnapshots.length === 1 ? resolvedModelSnapshots[0] : null,
    resolvedModelSnapshots,
    inputTokens,
    cachedInputTokens: sumNullable("cachedInputTokens"),
    outputTokens,
    reasoningTokens: sumNullable("reasoningTokens"),
    visibleOutputTokens: sumNullable("visibleOutputTokens"),
    totalTokens: sumNullable("totalTokens") ?? (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null),
    serializedOutputChars: sumNullable("serializedOutputChars"),
    serializedOutputBytes: sumNullable("serializedOutputBytes"),
    estimatedUsd: metrics.some((item) => item.pricingConfigured) ? sumNullable("estimatedUsd") : null,
    pricingConfigured: metrics.some((item) => item.pricingConfigured),
    attemptCount: metrics.length
  };
}

function retryInstruction(errors, evidencePackage) {
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

function requiredPriorityInstruction(evidencePackage) {
  if (evidencePackage.plannerConstraints.requiredPriorityNudge === "consider_higher") {
    return `use consider_higher with ${evidencePackage.plannerConstraints.allowedPriorityNudgeRefs[0]}.`;
  }
  return `use ${evidencePackage.plannerConstraints.requiredPriorityNudge} with a null priorityNudgeGapRef.`;
}

function validationErrorCategory(error) {
  if (/characters|length/i.test(error)) return "length_exceeded";
  if (/complete sentence|punctuation/i.test(error)) return "incomplete_sentence";
  if (/mixed script|Chinese|Japanese|Korean/i.test(error)) return "mixed_script";
  if (/raw CI logs|full logs|stdout|stderr|console output/i.test(error)) return "raw_execution_material_request";
  if (/execution evidence|test\/build|CI|stdout|stderr|raw log/i.test(error)) return "execution_claim_contradiction";
  if (/basis|gapRef|deterministic gap|provenance/i.test(error)) return "missing_or_invalid_provenance";
  return "schema_or_guardrail_violation";
}

function percentReduction(previous, current) {
  if (!Number.isFinite(previous) || previous <= 0 || !Number.isFinite(current)) return null;
  return round(((previous - current) / previous) * 100, 2);
}

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function stringValue(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function nullableString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function record(value) {
  return isRecord(value) ? value : {};
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonIfExists(path) {
  try {
    return readJson(path);
  } catch {
    return null;
  }
}

function writeJson(path, value) {
  writeFileSync(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

function normalizeReasoningEffort(value) {
  return ["minimal", "low", "medium", "high"].includes(value) ? value : null;
}

function safeEvaluationOutputPath(value, fallback) {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const normalized = value.trim().replaceAll("\\", "/");
  if (!normalized.startsWith("outputs/controlled-human-ab-v1/dev10-smoke/") || normalized.includes("..")) {
    throw new Error("LLM planner output override must stay inside outputs/controlled-human-ab-v1/dev10-smoke/.");
  }
  return normalized;
}

function assertDevTenSmokePreflight(baselineResults) {
  const expectedIds = Array.from({ length: 10 }, (_, index) => `roleproof-blind-${String(index + 1).padStart(3, "0")}`);
  const actualIds = baselineResults.map((item) => item?.candidateId);
  const isolatedResults = resultsPath !== defaultResultsPath;
  const isolatedReport = reportPath !== defaultReportPath;
  if (mode !== "openai" || !apiKey) throw new Error("Dev-10 smoke requires openai mode and OPENAI_API_KEY.");
  if (process.env.AGENTPROOF_LLM_PROOF_PLANNER_EXECUTION_AUTHORIZED !== "1") {
    throw new Error("Dev-10 smoke execution requires a separate explicit authorization flag.");
  }
  if (requestedModel !== "gpt-5.6-luna") throw new Error("Dev-10 smoke requires OPENAI_MODEL=gpt-5.6-luna.");
  if (repeatCount !== 1 || candidateLimit !== 10) throw new Error("Dev-10 smoke requires exactly 10 candidates and one run.");
  if (!isolatedResults || !isolatedReport || !noClobberOutputs) throw new Error("Dev-10 smoke requires isolated no-clobber outputs.");
  if (!existsSync(join(root, dirname(resultsPath))) || !existsSync(join(root, dirname(reportPath)))) {
    throw new Error("Dev-10 smoke output directories must exist before any network call.");
  }
  if (actualIds.length !== expectedIds.length || actualIds.some((id, index) => id !== expectedIds[index])) {
    throw new Error("Dev-10 smoke baseline must be the fixed ordered roleproof dev set.");
  }
}

function currentGitCommit() {
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return /^[0-9a-f]{40}$/i.test(commit) ? commit.toLowerCase() : null;
  } catch {
    return null;
  }
}

function currentGitState() {
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const changedPathCount = output.split("\n").filter(Boolean).length;
    return { dirty: changedPathCount > 0, changedPathCount };
  } catch {
    return { dirty: null, changedPathCount: null };
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
