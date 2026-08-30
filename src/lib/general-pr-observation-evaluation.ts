export type GeneralPrObservationEvaluationAxisV1 =
  | "source_selection"
  | "span_role"
  | "relation"
  | "observation";

export type GeneralPrObservationBlindDecisionV1 = "positive" | "negative" | "abstain";
export type GeneralPrObservationKindV1 = "test_coverage" | "scope_mapping";
export type GeneralPrTestObservationStateV1 =
  | "covered_by_verified_relation"
  | "verified_test_failed"
  | "related_test_observed"
  | "missing_targeted_test"
  | "test_not_applicable"
  | "relation_unresolved"
  | "execution_unresolved"
  | "collection_unavailable";
export type GeneralPrScopeObservationStateV1 =
  | "mapped_by_verified_relation"
  | "plausibly_mapped"
  | "unmapped"
  | "out_of_scope_by_contract"
  | "collection_unavailable";

export interface GeneralPrObservationBinaryLabelV1 {
  version: 1;
  reviewerId: string;
  decision: GeneralPrObservationBlindDecisionV1;
  rubricHash: string;
}

export interface GeneralPrObservationStateLabelV1 {
  version: 1;
  reviewerId: string;
  observationKind: GeneralPrObservationKindV1;
  state: GeneralPrTestObservationStateV1 | GeneralPrScopeObservationStateV1;
  rubricHash: string;
}

export type GeneralPrObservationBlindLabelV1 =
  | GeneralPrObservationBinaryLabelV1
  | GeneralPrObservationStateLabelV1;

export interface GeneralPrObservationGoldCaseV1 {
  version: 1;
  caseId: string;
  cohort: "calibration" | "holdout";
  repositoryFamilyHash: string;
  taskFamilyHash: string;
  timeWindowHash: string;
  sourceHash: string;
  contentHash: string;
  headHash: string;
  inventoryHash: string;
  normalizerHash: string;
  axis: GeneralPrObservationEvaluationAxisV1;
  labels: GeneralPrObservationBlindLabelV1[];
  adjudication?: GeneralPrObservationBlindLabelV1;
}

export interface GeneralPrObservationGoldCorpusV1 {
  version: 1;
  cases: GeneralPrObservationGoldCaseV1[];
}

export function validateGeneralPrObservationGoldCorpusV1(
  corpus: unknown,
  visibleRegressionCaseIds: ReadonlySet<string>
): { valid: boolean; errors: string[] } {
  if (!isRecord(corpus) || corpus.version !== 1 || !Array.isArray(corpus.cases) || corpus.cases.length === 0) {
    return { valid: false, errors: ["gold corpus shape is invalid"] };
  }

  const errors: string[] = [];
  const caseIds = new Set<string>();
  const repositoryCounts = new Map<string, number>();
  const taskTimeFamilies = new Set<string>();
  for (const value of corpus.cases) {
    if (!isGoldCase(value)) {
      errors.push("gold case shape is invalid");
      continue;
    }
    if (caseIds.has(value.caseId)) errors.push("duplicate case ID is not allowed");
    caseIds.add(value.caseId);
    if (value.cohort === "holdout" && visibleRegressionCaseIds.has(value.caseId)) {
      errors.push("visible regression cases cannot enter protected holdout");
    }
    const repositoryCount = (repositoryCounts.get(value.repositoryFamilyHash) ?? 0) + 1;
    repositoryCounts.set(value.repositoryFamilyHash, repositoryCount);
    if (repositoryCount > 2) errors.push("more than two cases from one repository family is not allowed");
    const taskTimeKey = `${value.taskFamilyHash}:${value.timeWindowHash}`;
    if (taskTimeFamilies.has(taskTimeKey)) errors.push("duplicate task/time family is not allowed");
    taskTimeFamilies.add(taskTimeKey);
    validateLabels(value, errors);
  }
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

export function evaluateGeneralPrObservationLabelsV1(options: {
  corpus: unknown;
  visibleRegressionCaseIds: ReadonlySet<string>;
  goldSealHash: string | null;
  /** Candidate import must name the exact, pre-existing gold seal. */
  importedGoldSealHash: string | null;
}):
  | { status: "unavailable" }
  | { status: "ready"; totals: { calibration: number; holdout: number; positive: number; negative: number; abstain: number; observationState: number; adjudicated: number } } {
  const validation = validateGeneralPrObservationGoldCorpusV1(options.corpus, options.visibleRegressionCaseIds);
  if (!validation.valid || !isHash(options.goldSealHash) || options.goldSealHash !== options.importedGoldSealHash) {
    return { status: "unavailable" };
  }
  const cases = (options.corpus as GeneralPrObservationGoldCorpusV1).cases;
  const totals = { calibration: 0, holdout: 0, positive: 0, negative: 0, abstain: 0, observationState: 0, adjudicated: 0 };
  for (const item of cases) {
    totals[item.cohort] += 1;
    const label = item.adjudication ?? item.labels[0]!;
    if (isBinaryLabel(label)) totals[label.decision] += 1;
    else totals.observationState += 1;
    if (item.adjudication) totals.adjudicated += 1;
  }
  return { status: "ready", totals };
}

function validateLabels(value: GeneralPrObservationGoldCaseV1, errors: string[]): void {
  const isObservation = value.axis === "observation";
  const validLabel = isObservation ? isStateLabel : isBinaryLabel;
  if (value.labels.length !== 2 || !value.labels.every(validLabel)) {
    errors.push("exactly two independent blind labels are required");
    return;
  }
  if (value.labels[0]!.reviewerId === value.labels[1]!.reviewerId) {
    errors.push("blind labels must come from independent reviewers");
  }
  const disagreement = labelDisagrees(value.labels[0]!, value.labels[1]!);
  if (!disagreement) {
    if (value.adjudication) errors.push("matching blind labels must not be adjudicated");
    return;
  }
  if (!validLabel(value.adjudication) || value.labels.some((label) => label.reviewerId === value.adjudication?.reviewerId)) {
    errors.push("label disagreement requires an independent adjudication");
  } else if (isObservation && !sameObservationKind(value.labels[0]!, value.adjudication)) {
    errors.push("observation adjudication must keep the same observation kind");
  }
}

function isGoldCase(value: unknown): value is GeneralPrObservationGoldCaseV1 {
  if (!isRecord(value) || value.version !== 1 || !isHash(value.caseId) ||
    (value.cohort !== "calibration" && value.cohort !== "holdout") ||
    !isAxis(value.axis) || !Array.isArray(value.labels)) return false;
  return [
    value.repositoryFamilyHash,
    value.taskFamilyHash,
    value.timeWindowHash,
    value.sourceHash,
    value.contentHash,
    value.headHash,
    value.inventoryHash,
    value.normalizerHash
  ].every(isHash);
}

function isBinaryLabel(value: unknown): value is GeneralPrObservationBinaryLabelV1 {
  return isRecord(value) && value.version === 1 && isHash(value.reviewerId) && isHash(value.rubricHash) &&
    (value.decision === "positive" || value.decision === "negative" || value.decision === "abstain");
}

function isStateLabel(value: unknown): value is GeneralPrObservationStateLabelV1 {
  if (!isRecord(value) || value.version !== 1 || !isHash(value.reviewerId) || !isHash(value.rubricHash)) return false;
  if (value.observationKind === "test_coverage") return isTestObservationState(value.state);
  if (value.observationKind === "scope_mapping") return isScopeObservationState(value.state);
  return false;
}

function labelDisagrees(left: GeneralPrObservationBlindLabelV1, right: GeneralPrObservationBlindLabelV1): boolean {
  return isBinaryLabel(left) && isBinaryLabel(right)
    ? left.decision !== right.decision
    : isStateLabel(left) && isStateLabel(right)
      ? left.observationKind !== right.observationKind || left.state !== right.state
      : true;
}

function sameObservationKind(left: GeneralPrObservationBlindLabelV1, right: GeneralPrObservationBlindLabelV1): boolean {
  return isStateLabel(left) && isStateLabel(right) && left.observationKind === right.observationKind;
}

function isTestObservationState(value: unknown): value is GeneralPrTestObservationStateV1 {
  return value === "covered_by_verified_relation" || value === "verified_test_failed" || value === "related_test_observed" ||
    value === "missing_targeted_test" || value === "test_not_applicable" || value === "relation_unresolved" ||
    value === "execution_unresolved" || value === "collection_unavailable";
}

function isScopeObservationState(value: unknown): value is GeneralPrScopeObservationStateV1 {
  return value === "mapped_by_verified_relation" || value === "plausibly_mapped" || value === "unmapped" ||
    value === "out_of_scope_by_contract" || value === "collection_unavailable";
}

function isAxis(value: unknown): value is GeneralPrObservationEvaluationAxisV1 {
  return value === "source_selection" || value === "span_role" || value === "relation" || value === "observation";
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
