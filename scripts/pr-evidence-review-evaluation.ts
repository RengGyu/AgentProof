import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ReviewNavigationDiagnostics, ReviewNavigationOptions } from "../src/lib/review-intent";
import { cpus } from "node:os";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportView } from "../src/components/ReportView";
import { resolveGeneralPrAssessmentRuntimePolicyV1 } from "../src/lib/general-pr-runtime-policy";
import { runGeneralPrObservationNowV2 } from "../src/lib/general-pr-observation-service";
import { buildPrEvidenceReview, type PrEvidenceReview } from "../src/lib/pr-evidence-review";
import { sanitizeReportForShare } from "../src/lib/report-share";
import { isVerificationReportV2 } from "../src/lib/requirement-presentation-v2";
import { resolveRuntimeReportValidation } from "../src/lib/report-runtime-validation";
import { prepareTenantDetailReportForStorage } from "../src/lib/server-report-store";
import { decodeTenantPersistedReport, projectTenantPersistedReport } from "../src/lib/tenant-report-validation";
import type { PullRequestInput, VerificationReport } from "../src/lib/types";
import { generateVerificationReportV2FromInput } from "../src/lib/verifier";

const SIGNING_SECRET = "pr-evidence-review-evaluation-signing-secret";
const EXACT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export interface PrEvidenceReviewEvaluationFixture {
  id: string;
  input: PullRequestInput;
  expected?: {
    mode: PrEvidenceReview["mode"];
    sourceKind: "linked_issue" | "pr_author_claim" | "mixed" | "provided_requirement" | null;
    displayedPaths: string[];
    headLinks: string[];
    baseLinks: string[];
    ciFailureVisible: boolean;
    purposeWarningVisible: boolean;
  };
  oracle?: unknown;
}

export type EvaluationProfile = "as_is" | "source_adapted";
export type DisplayedSourceKind = NonNullable<PrEvidenceReview["source"]>["kind"];

export interface FirstInspectionReference {
  id: string;
  goal: string;
  allowedPaths: string[];
  rationale: string;
  expectedSourceKind: DisplayedSourceKind;
}

export interface PrEvidenceReviewPrediction {
  id: string;
  rankedPaths: string[];
  sourceKind?: DisplayedSourceKind | null;
}

export interface NavigationEvaluationOptions {
  navigation?: ReviewNavigationOptions;
  /** Explicit local output root. Each public case execution gets a unique subdirectory. */
  diagnosticsDirectory?: string;
}

export async function evaluatePrEvidenceReviewCase(
  fixture: Pick<PrEvidenceReviewEvaluationFixture, "id" | "input">,
  profile: EvaluationProfile = "as_is",
  options: NavigationEvaluationOptions = {}
) {
  const input = inputForProfile(fixture.input, profile);
  const events: ReviewNavigationDiagnostics[] = [];
  const navigation = options.navigation ? { ...options.navigation, onDiagnostics: (event: ReviewNavigationDiagnostics) => {
    events.push(structuredClone(event));
    options.navigation?.onDiagnostics?.(event);
  } } : undefined;
  let navigationDiagnosticsPath: string | undefined;
  if (navigation && options.diagnosticsDirectory && input.repositoryPrivate === false) {
    const root = resolve(options.diagnosticsDirectory);
    mkdirSync(root, { recursive: true });
    navigationDiagnosticsPath = join(mkdtempSync(join(root, "navigation-run-")), "diagnostics.json");
  }
  let produced: Awaited<ReturnType<typeof produceValidatedReport>>;
  let status = "failed";
  try {
    produced = await produceValidatedReport(input, navigation);
    status = produced.valid ? "complete" : "invalid";
  } finally {
    // Write outside the fail-soft observer callback: a storage failure must fail the local run.
    if (navigationDiagnosticsPath) writeFileSync(navigationDiagnosticsPath, JSON.stringify({
      schema: "agentproof.navigation-diagnostics.v1",
      caseIdHash: createHash("sha256").update(fixture.id).digest("hex"),
      profile, status, completedAt: new Date().toISOString(), events
    }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  }
  const diagnosticOutput = navigationDiagnosticsPath ? { navigationDiagnosticsPath } : {};
  if (!produced.valid) {
    return {
      id: fixture.id,
      profile,
      status: "invalid" as const,
      ...diagnosticOutput,
      validationErrors: produced.errors,
      sourceLimitations: sourceLimitations(input)
    };
  }

  const report = produced.report;
  const assessment = isVerificationReportV2(report) ? report.generalPrAssessmentSummary : undefined;
  const review = buildPrEvidenceReview(report);
  const allItems = reviewItems(review);
  const firstInspectionPath = firstDisplayedInspectionPath(review, input.changedFiles.map((file) => file.path));
  const displayedPaths = input.changedFiles.map((file) => file.path).filter((path) => allItems.some((item) => item.label === path));
  const codeLinks = allItems.filter((item) => item.kind !== "execution" && item.url).map((item) => item.url!);
  const executionItems = allItems.filter((item) => item.kind === "execution");
  const evidenceById = new Map(report.evidenceIndex.map((item) => [item.id, item]));
  const passingExecutionEvidence = new Set(report.evidenceIndex
    .filter((item) => (item.kind === "check" || item.kind === "log") && /Status: passed\./i.test(item.summary))
    .map((item) => item.id));
  const html = renderToStaticMarkup(createElement(ReportView, { report }));
  const stored = prepareTenantDetailReportForStorage(report, "verified_agentproof", SIGNING_SECRET);
  const persisted = projectTenantPersistedReport(stored, SIGNING_SECRET);
  const decoded = decodeTenantPersistedReport(persisted, { signingSecret: SIGNING_SECRET, createdAt: report.createdAt });
  const hydratedItems = decoded.status === "valid"
    ? reviewItems(buildPrEvidenceReview(decoded.report, {
        repositoryFullName: repositoryFromUrl(input.url),
        headSha: input.sourceProvenance?.headSha,
        baseSha: input.sourceProvenance?.baseSha
      }))
    : [];
  const hydratedPaths = hydratedItems.map((item) => item.label).filter((path) => input.changedFiles.some((file) => file.path === path));
  const hydratedCodeLinks = hydratedItems.filter((item) => item.kind !== "execution" && item.url).map((item) => item.url!);

  return {
    id: fixture.id,
    profile,
    status: "complete" as const,
    ...diagnosticOutput,
    validationUsedDeterministicFallback: produced.usedDeterministicFallback,
    advisorySourceState: produced.advisorySourceState,
    validatedSourceState: isVerificationReportV2(report) ? report.generalPrAssessmentSummary?.sourceState ?? null : null,
    analysisContext: report.analysisContext,
    generatedRequirementCount: report.requirements.length,
    observationBundleObjectiveCount: produced.observationBundleObjectiveCount,
    assessmentOverallConclusion: assessment?.overallConclusion ?? null,
    assessmentTargetCount: assessment ? Object.values(assessment.counts).reduce((sum, count) => sum + count, 0) : null,
    changeSummaryConditions: [
      ...(report.requirements.length === 0 ? ["no_generated_requirements"] : [])
    ],
    mode: review.mode,
    sourceKind: review.source?.kind ?? null,
    objectiveCount: review.objectives.length,
    reviewItemCount: allItems.length,
    objectiveEvidenceCounts: review.objectives.map((objective) => ({
      objectiveId: objective.id,
      codeCandidates: objective.code.length,
      testCandidates: objective.tests.length,
      executionCandidates: objective.execution.length
    })),
    inputChangedFileCount: input.changedFiles.length,
    displayedPaths,
    displayedFileCoverage: {
      numerator: displayedPaths.length,
      denominator: input.changedFiles.length,
      rate: input.changedFiles.length === 0 ? null : displayedPaths.length / input.changedFiles.length,
      interpretation: "structural input-file display coverage; not semantic relevance accuracy"
    },
    reportDirectCodeUrlCount: report.evidenceIndex.filter((item) => isCodeEvidence(item.kind) && isHttpUrl(item.locator)).length,
    projectionDirectCodeUrlCount: codeLinks.length,
    projectionCodeLinks: codeLinks,
    firstInspectionPath,
    directLinkComparisonBoundary: "same generated report only; not a legacy-UI or human-time comparison",
    execution: {
      itemCount: executionItems.length,
      verifiedRelationCount: executionItems.filter((item) => item.relation === "verified").length,
      unbackedItemCount: executionItems.filter((item) => {
        const evidence = evidenceById.get(item.evidenceId);
        return !evidence || (evidence.kind !== "check" && evidence.kind !== "log");
      }).length,
      passingLanguageWithoutPassingEvidenceCount: executionItems.filter((item) =>
        /passed/i.test(item.executionMeaning ?? "") && !passingExecutionEvidence.has(item.evidenceId)
      ).length
    },
    sourceLimitations: sourceLimitations(input),
    storageRoundTrip: {
      valid: decoded.status === "valid",
      displayedPathsPreserved: decoded.status === "valid" && sameStrings(displayedPaths, unique(hydratedPaths)),
      codeLinksPreserved: decoded.status === "valid" && sameStrings(codeLinks, hydratedCodeLinks)
    },
    portableSummaryContainsCodeLocation: JSON.stringify(sanitizeReportForShare(report)).includes("codeLocation"),
    ssr: {
      rendered: html.includes("PR-to-Evidence Review"),
      ciFailureVisible: html.includes("FAILED"),
      collectedChangesVisible: html.includes("Collected changes"),
      purposeWarningVisible: /No original task text was provided|missing description|unknown purpose/i.test(html),
      inputLimitationsPreserved: (input.limitations ?? []).every((limitation) => html.includes(limitation))
    }
  };
}

export async function evaluatePrEvidenceReviewCorpus(
  fixtures: Array<Pick<PrEvidenceReviewEvaluationFixture, "id" | "input">>,
  options: { warmupRuns?: number; measuredRuns?: number; profile?: EvaluationProfile } & NavigationEvaluationOptions = {}
) {
  const profile = options.profile ?? "as_is";
  const warmupRuns = options.warmupRuns ?? 1;
  const measuredRuns = options.measuredRuns ?? 3;
  const originalFetch = globalThis.fetch;
  let externalCallCount = 0;
  globalThis.fetch = (async () => {
    externalCallCount += 1;
    throw new Error("External calls are forbidden during PR-to-Evidence evaluation.");
  }) as typeof fetch;
  try {
    const cases = [];
    for (const fixture of fixtures) cases.push(await evaluatePrEvidenceReviewCase(fixture, profile, options));

    // Existing latency samples stay deterministic; navigation runs once per case above.
    for (let run = 0; run < warmupRuns; run += 1) {
      for (const fixture of fixtures) await measureCase(fixture.input, profile);
    }
    const pipelineMs: number[] = [];
    const projectionAndSsrMs: number[] = [];
    let failedMeasuredSamples = 0;
    for (let run = 0; run < measuredRuns; run += 1) {
      for (const fixture of fixtures) {
        const timing = await measureCase(fixture.input, profile);
        if (!timing.valid) {
          failedMeasuredSamples += 1;
          continue;
        }
        pipelineMs.push(timing.pipelineMs);
        projectionAndSsrMs.push(timing.projectionAndSsrMs);
      }
    }

    return {
      schemaVersion: 1,
      profile,
      profileChange: profile === "source_adapted" ? "taskSource set to issue for every case; all other input fields unchanged" : "none",
      caseCount: fixtures.length,
      externalCallCount,
      externalCallEvidence: "global fetch was replaced by a rejecting guard for the complete corpus and timing run",
      performance: {
        environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model ?? "unknown" },
        warmupRuns,
        measuredRuns,
        expectedMeasuredSamples: fixtures.length * measuredRuns,
        failedMeasuredSamples,
        scope: {
          pipelineMs: "advisory no-provider report generation plus generated-private-full validation",
          projectionAndSsrMs: "PR-to-Evidence projection plus full ReportView server rendering; excludes persistence"
        },
        pipelineMs: timingSummary(pipelineMs, failedMeasuredSamples),
        projectionAndSsrMs: timingSummary(projectionAndSsrMs, failedMeasuredSamples)
      },
      semanticRelevanceAccuracy: null,
      humanTaskCompletionTime: null,
      humanLinkArrivalSuccess: null,
      notEvaluatedReasons: [
        "fixture oracle is not PR-to-evidence relevance gold",
        "fixtures are bounded development excerpts, not a holdout",
        "no human reviewer timing or link-arrival study was run"
      ],
      cases
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export function inputForProfile(input: PullRequestInput, profile: EvaluationProfile): PullRequestInput {
  return profile === "source_adapted" ? { ...input, taskSource: "issue" } : input;
}

export function firstDisplayedInspectionPath(review: PrEvidenceReview, availablePaths: string[]): string | null {
  const available = new Set(availablePaths);
  if (review.mode === "change_summary") {
    const displayedPaths = review.changes
      .filter((item) => item.kind !== "execution" && available.has(item.label))
      .map((item) => item.label);
    return displayedPaths.find((path) => review.nextInspection.includes(path)) ?? null;
  }
  for (const objective of review.objectives) {
    const displayedPaths = [...objective.code, ...objective.tests]
      .filter((item) => available.has(item.label))
      .map((item) => item.label);
    const match = displayedPaths.find((path) => objective.nextInspection.includes(path));
    if (match) return match;
  }
  return null;
}

export function scoreFirstInspection(
  references: FirstInspectionReference[],
  predictions: PrEvidenceReviewPrediction[]
) {
  validateScoringInputs(references, predictions);
  const predictionById = new Map(predictions.map((item) => [item.id, item]));
  const perCase = references.map((reference) => {
    const prediction = predictionById.get(reference.id);
    const firstPath = prediction?.rankedPaths[0] ?? null;
    return {
      id: reference.id,
      firstPath,
      hitAt1: firstPath !== null && reference.allowedPaths.includes(firstPath),
      presented: firstPath !== null,
      rankedPathCount: prediction?.rankedPaths.length ?? 0,
      allowedPaths: [...reference.allowedPaths],
      rationale: reference.rationale,
      selectionLimitation: "AI-reviewed provisional file-level proxy; secondary omissions are not scored as irrelevance"
    };
  });
  const hits = perCase.filter((item) => item.hitAt1).length;
  const presented = perCase.filter((item) => item.presented).length;
  return {
    hitAt1: ratio(hits, references.length),
    precisionWhenPresented: ratio(hits, presented),
    coverage: ratio(presented, references.length),
    missingCount: references.length - presented,
    perCase
  };
}

export function scoreDisplayedSource(
  references: FirstInspectionReference[],
  predictions: PrEvidenceReviewPrediction[]
) {
  validateScoringInputs(references, predictions);
  const predictionById = new Map(predictions.map((item) => [item.id, item]));
  const perCase = references.map((reference) => {
    const sourceKind = predictionById.get(reference.id)?.sourceKind ?? null;
    return {
      id: reference.id,
      expectedSourceKind: reference.expectedSourceKind,
      sourceKind,
      presented: sourceKind !== null,
      correct: sourceKind === reference.expectedSourceKind
    };
  });
  const correct = perCase.filter((item) => item.correct).length;
  const presented = perCase.filter((item) => item.presented).length;
  return {
    correctOverAll: ratio(correct, references.length),
    accuracyWhenPresented: ratio(correct, presented),
    coverage: ratio(presented, references.length),
    unpresentedCount: references.length - presented,
    perCase
  };
}

function validateScoringInputs(references: FirstInspectionReference[], predictions: PrEvidenceReviewPrediction[]): void {
  const referenceIds = new Set<string>();
  for (const reference of references) {
    assertKeys(reference, ["id", "goal", "allowedPaths", "rationale", "expectedSourceKind"]);
    if (referenceIds.has(reference.id)) throw new Error(`Duplicate reference case id: ${reference.id}`);
    if (!reference.id || reference.allowedPaths.length === 0) throw new Error("Reference ids and allowed paths are required.");
    referenceIds.add(reference.id);
  }
  const predictionIds = new Set<string>();
  for (const prediction of predictions) {
    assertKeys(prediction, ["id", "rankedPaths", "sourceKind"]);
    if (predictionIds.has(prediction.id)) throw new Error(`Duplicate prediction case id: ${prediction.id}`);
    if (!referenceIds.has(prediction.id)) throw new Error(`Unknown prediction case id: ${prediction.id}`);
    predictionIds.add(prediction.id);
  }
}

function assertKeys(value: object, allowed: string[]): void {
  const unsupported = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unsupported.length > 0) throw new Error(`Unsupported scoring input field: ${unsupported.join(", ")}`);
}

function ratio(numerator: number, denominator: number) {
  return { numerator, denominator, rate: denominator === 0 ? null : numerator / denominator };
}

function timingSummary(values: number[], excludedCount: number) {
  return {
    count: values.length,
    excludedCount,
    unit: "ms",
    method: "nearest-rank",
    p50: nearestRank(values, 0.5),
    p95: nearestRank(values, 0.95)
  };
}

export function nearestRank(values: number[], quantile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)]!;
}

async function measureCase(input: PullRequestInput, profile: EvaluationProfile) {
  const profiledInput = inputForProfile(input, profile);
  const pipelineStarted = performance.now();
  const produced = await produceValidatedReport(profiledInput);
  const pipelineFinished = performance.now();
  if (!produced.valid) return { valid: false as const };
  const projectionStarted = performance.now();
  buildPrEvidenceReview(produced.report);
  renderToStaticMarkup(createElement(ReportView, { report: produced.report }));
  return { valid: true as const, pipelineMs: pipelineFinished - pipelineStarted, projectionAndSsrMs: performance.now() - projectionStarted };
}

async function produceValidatedReport(input: PullRequestInput, navigation?: ReviewNavigationOptions): Promise<
  { valid: true; report: VerificationReport; usedDeterministicFallback: boolean; advisorySourceState: string | null; observationBundleObjectiveCount: number | null } | { valid: false; errors: string[] }
> {
  const observed = await runGeneralPrObservationNowV2({
    policy: resolveGeneralPrAssessmentRuntimePolicyV1("advisory"),
    input,
    ...(navigation ? { navigation } : {}),
    generateReport: generateVerificationReportV2FromInput,
    validateDeterministicReport: (candidateInput, report) => resolveRuntimeReportValidation({
      boundary: "generated_private_full",
      input: candidateInput,
      report,
      requireV2: true
    }).valid
  });
  const validation = resolveRuntimeReportValidation({
    boundary: "generated_private_full",
    input,
    report: observed.report,
    requireV2: true
  });
  const advisorySourceState = isVerificationReportV2(observed.report)
    ? observed.report.generalPrAssessmentSummary?.sourceState ?? null
    : null;
  return validation.valid
    ? { valid: true, report: validation.report, usedDeterministicFallback: validation.usedDeterministicFallback, advisorySourceState, observationBundleObjectiveCount: observed.bundle?.objectives.length ?? null }
    : { valid: false, errors: validation.errors };
}

function reviewItems(review: PrEvidenceReview) {
  return [
    ...review.objectives.flatMap((objective) => [...objective.code, ...objective.tests, ...objective.execution]),
    ...review.changes
  ];
}

function sourceLimitations(input: PullRequestInput): string[] {
  const limitations: string[] = [];
  if (!input.taskSource) limitations.push("task_source_not_recorded");
  if (!isPullRequestUrl(input.url)) limitations.push("pull_request_url_not_available");
  if (!EXACT_SHA.test(input.sourceProvenance?.headSha ?? "")) limitations.push("exact_head_sha_not_available");
  if (!EXACT_SHA.test(input.sourceProvenance?.baseSha ?? "")) limitations.push("exact_base_sha_not_available");
  return limitations;
}

function isPullRequestUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && /^\/[^/]+\/[^/]+\/pull\/[1-9]\d*$/.test(url.pathname);
  } catch {
    return false;
  }
}

function repositoryFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parts = new URL(value).pathname.split("/").filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : undefined;
  } catch {
    return undefined;
  }
}

function isCodeEvidence(kind: VerificationReport["evidenceIndex"][number]["kind"]): boolean {
  return kind === "diff" || kind === "changed_file" || kind === "artifact" || kind === "test";
}

function isHttpUrl(value: string | undefined): boolean {
  return Boolean(value && /^https?:\/\//.test(value));
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
