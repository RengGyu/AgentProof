/**
 * Shared, JS-compatible deterministic classifier for bounded CI metadata.
 * It classifies check/job identity only; provider status remains the source
 * of passed/failed/pending/unknown truth in the report pipeline.
 */
export const STRONG_EXECUTION_EVIDENCE_PATTERN =
  /\b(test|tests|spec|unit|integration|e2e|vitest|jest|playwright|cypress|pytest|tox)\b/i;
export const WEAK_EXECUTION_EVIDENCE_PATTERN = /\bbuild\b/i;

const GENERIC_NON_EXECUTION_GATE_PATTERN =
  /\b(ai[- ]?review|allowed failure|allow failure|backport|changelog|change log|code[- ]owners?|codecov|coveralls|deprecation|do not merge|license|licenses|merge[- ]?gate|non[- ]?blocking|owners|patch coverage|prevent merging|project coverage|provenance|readthedocs|read the docs|release notes?|required checks?|semver|stats?|towncrier)\b/i;
const CONTEXTUAL_NON_EXECUTION_TERM_PATTERN = /\b(?:label|labels|policy|policies)\b/i;
const LABEL_AUTOMATION_PATTERN =
  /\b(?:label|labels|labeler|labeling|labelling)\b[\s:/_-]*(?:automation|automated|bot|sync|synchroni[sz](?:e|ed|ation)?|apply|applied|add|added|manage(?:ment)?|workflow)\b|\b(?:automation|automated|bot|sync|synchroni[sz](?:e|ed|ation)?|apply|applied|add|added|manage(?:ment)?|workflow)\b[\s:/_-]*(?:label|labels|labeler|labeling|labelling)\b|\b(?:label|labels)\b.*\b(?:results?|report|summary|status)\b/i;
const POLICY_NARRATIVE_PATTERN = /\b(?:label|labels|policy|policies)\b\s+(?:note|annotation|summary|description|text|message)\b/i;
const STATIC_ARTIFACT_PATTERN =
  /\b(?:static|status|test|tests|coverage|security|policy|label|saved|summary|artifact)\b\s+report\b|\breport\b\s+(?:published|generated|uploaded|annotation|summary|only)\b|\b(?:coverage|security)\b\s+(?:gate|policy|threshold|upload)\b|\b(?:preview|deployment|deploy)\b\s+(?:published|deployed|available|url|link)\b|\b(?:docs?|documentation)[\s_-]*only\b|\b(?:sast|security)\s+(?:scan|report)\b/i;
const POLICY_OR_INTENT_PATTERN =
  /\b(?:policy|policies|require|requires|required|must|should|expected|expect|configured|configure|configuration|planned|plan|will|would|scheduled|schedule)\b(?:\s+\w+){0,5}\s+\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|vitest|jest|playwright|cypress|build)\b|\b(?:tests?|unit\s+tests?|integration\s+tests?|e2e\s+tests?)\b(?:\s+\w+){0,4}\s+\b(?:must|should|will|would)(?:\s+be)?\s+run\b|\b(?:tests?|unit\s+tests?|integration\s+tests?|e2e\s+tests?)\b(?:\s+\w+){0,4}\s+\b(?:need(?:s)?\s+to|expected\s+to|configured\s+to|plan(?:ned)?\s+to|scheduled\s+to|(?:are\s+)?required\s+to)(?:\s+be)?\s+run\b|\b(?:must|should|will|would)(?:\s+be)?\s+run\b(?:\s+\w+){0,4}\s+\b(?:tests?|unit\s+tests?|integration\s+tests?|e2e\s+tests?)\b|\b(?:need(?:s)?\s+to|expected\s+to|configured\s+to|plan(?:ned)?\s+to|scheduled\s+to|(?:are\s+)?required\s+to)(?:\s+be)?\s+run\b(?:\s+\w+){0,4}\s+\b(?:tests?|unit\s+tests?|integration\s+tests?|e2e\s+tests?)\b/i;
const COMMAND_INTENT_PATTERN =
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|vitest|jest|playwright|cypress|build)\b(?:\s+\w+){0,4}\s+\b(?:is|are)?\s*(?:required|planned|expected|configured|scheduled)\b|\bplease\s+run\s+\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|vitest|jest|playwright|cypress|build)\b/i;
const DIRECT_EXECUTION_COMMAND_PATTERN =
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|vitest|jest|playwright|cypress|build)\b|\buv\s+run\s+tox\b|\bcoverage\s+run\s+-m\s+pytest\b|\b(?:vitest|jest|pytest|tox|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\s+test|next\s+build)\b/i;
const EXECUTION_RESULT_PATTERN =
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|vitest|jest|playwright|cypress|build)\b(?:\s+\S+){0,8}\s+\b(?:completed|complete|passed|failed|failure|succeeded|success|timed\s+out|cancelled|canceled)\b|\b(?:test|tests|spec|unit(?:\s+test)?|integration(?:\s+test)?|e2e|vitest|jest|playwright|cypress|pytest|tox)\b(?:\s+\S+){0,8}\s+\b(?:completed|complete|passed|failed|failure|succeeded|success|timed\s+out|cancelled|canceled)\b|\b(?:completed|complete|passed|failed|failure|succeeded|success|timed\s+out|cancelled|canceled)\b(?:\s+\S+){0,8}\s+\b(?:test|tests|spec|unit(?:\s+test)?|integration(?:\s+test)?|e2e|vitest|jest|playwright|cypress|pytest|tox)\b/i;
const DOMAIN_CONTEXT_PATTERN = /\b(?:preview|dependency|dependencies|optional)\b/i;
const SPECIFIC_EXECUTION_KIND_PATTERN = /\b(?:unit|integration|e2e|vitest|jest|playwright|cypress|pytest|tox)\b/i;
const STATIC_ONLY_CHECK_PATTERN = /\b(?:eslint|lint|typecheck|type-check|type check|tsc|static analysis|static check)\b/i;
const GITHUB_ACTIONS_JOB_URL_PATTERN = /github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/\d+\/job\/\d+/i;
const GENERIC_ACTIONS_HOUSEKEEPING_PATTERN =
  /\b(checkout|setup|cache|install dependencies|upload|download|artifact|publish|preview|deploy|deployment|report|notify|label added|docs-only|changelog|change log|release notes?|towncrier|codecov|coverage (?:gate|policy|report|threshold|upload)|optional|non[- ]?blocking)\b/i;
const CANCELLED_OR_OPTIONAL_PATTERN =
  /\b(cancelled|canceled|skipped|optional|non[- ]?blocking|allowed failure|allow failure|neutral|not required|action required)\b/i;
const AMBIGUOUS_PROVIDER_PATTERN = /\b(buildkite|circleci|azure pipelines?|jenkins|travis|appveyor)\b|buildkite\//i;
const MATRIX_EXECUTION_JOB_PATTERN =
  /(?:^[A-Z][A-Z0-9_]{2,}=)|\b(?:ubuntu|linux|windows|macos|darwin|python|py\d|node|ruby|go|java|jdk|x86|x64|arm64|sqlite|postgres|mysql|mariadb|oracle|matrix)\b/i;

export function isExecutionSignalText(text) {
  const normalized = normalizeClassificationText(text);
  if (isUnambiguousNonExecutionArtifact(normalized) || isPolicyOrIntentOnly(normalized)) return false;
  if (hasStrongExecutionSignal(normalized)) return true;
  if (hasContextualNonExecutionTerm(normalized) || isStaticOnlyCheck(normalized)) return false;
  return WEAK_EXECUTION_EVIDENCE_PATTERN.test(normalized);
}

export function isExecutionEvidenceSignal(label, text = "", _locator = "") {
  const rawLabel = String(label ?? "").trim();
  const labelText = normalizeClassificationText(rawLabel);
  const supportingText = normalizeClassificationText(String(text ?? "").trim());
  const combined = `${labelText} ${supportingText}`.trim();

  if (isUnambiguousNonExecutionArtifact(labelText) || isAlwaysNonExecutionSupportingText(supportingText) || isPolicyOrIntentOnly(combined)) return false;
  const labelHasStrongSignal = hasStrongExecutionSignal(labelText);
  const textHasStrongSignal = hasStrongExecutionSignal(supportingText);

  if (hasDomainContext(combined) && !hasSpecificExecutionSignal(combined)) return false;
  if (labelHasStrongSignal) {
    if (isStaticArtifactContextWithoutConcreteResult(supportingText)) return false;
    if (hasDomainContext(combined) && !hasSpecificExecutionSignal(combined)) return false;
    return !(isStaticArtifactLead(supportingText) && !hasExplicitExecutionResult(supportingText));
  }
  if (hasExplicitExecutionResult(supportingText) && !isStaticArtifactLead(supportingText)) return true;
  if (textHasStrongSignal) {
    // A command mention without an observed outcome is commonly a policy,
    // instruction, or documentation example—not a completed execution.
    if (DIRECT_EXECUTION_COMMAND_PATTERN.test(supportingText)) return false;
    return !isUnambiguousNonExecutionArtifact(supportingText);
  }
  if (isStaticArtifactLead(supportingText) || isUnambiguousNonExecutionArtifact(supportingText)) return false;
  if (hasContextualNonExecutionTerm(combined) || isStaticOnlyCheck(combined)) return false;
  if (AMBIGUOUS_PROVIDER_PATTERN.test(labelText)) return false;
  return WEAK_EXECUTION_EVIDENCE_PATTERN.test(combined);
}

export function isFailedAmbiguousActionsExecutionSignal(label, status, locator = "", text = "") {
  const rawLabel = String(label ?? "").trim();
  const labelText = normalizeClassificationText(rawLabel);
  const combined = `${labelText} ${normalizeClassificationText(String(text ?? "")).trim()}`.trim();

  if ((status !== "failed" && status !== "pending") || !GITHUB_ACTIONS_JOB_URL_PATTERN.test(locator)) return false;
  if (!labelText || GENERIC_ACTIONS_HOUSEKEEPING_PATTERN.test(labelText)) return false;
  if (isUnambiguousNonExecutionArtifact(combined) || isPolicyOrIntentOnly(combined)) return false;
  if (hasContextualNonExecutionTerm(combined) && !hasStrongExecutionSignal(combined)) return false;
  if (isStaticOnlyCheck(combined) || CANCELLED_OR_OPTIONAL_PATTERN.test(combined)) return false;

  return isExecutionSignalText(combined) || DIRECT_EXECUTION_COMMAND_PATTERN.test(labelText) || MATRIX_EXECUTION_JOB_PATTERN.test(rawLabel);
}

export function isExecutionEvidenceItemSignal(label, status, locator = "", text = "") {
  return isExecutionEvidenceSignal(label, text, locator) ||
    isFailedAmbiguousActionsExecutionSignal(label, status, locator, text);
}

export function hasPassingEvidenceStatusPrefix(summary) {
  return /^Status:\s*passed\b/i.test(String(summary ?? "").trim());
}

function hasStrongExecutionSignal(text) {
  return STRONG_EXECUTION_EVIDENCE_PATTERN.test(text) || DIRECT_EXECUTION_COMMAND_PATTERN.test(text);
}

function hasExplicitExecutionResult(text) {
  return EXECUTION_RESULT_PATTERN.test(text);
}

function hasSpecificExecutionSignal(text) {
  return SPECIFIC_EXECUTION_KIND_PATTERN.test(text) || DIRECT_EXECUTION_COMMAND_PATTERN.test(text);
}

function hasDomainContext(text) {
  return DOMAIN_CONTEXT_PATTERN.test(text);
}

function isStaticArtifactContextWithoutConcreteResult(text) {
  return STATIC_ARTIFACT_PATTERN.test(text) && !hasExplicitExecutionResult(text);
}

function isPolicyOrIntentOnly(text) {
  // A policy/plan sentence may quote a command and even a generic outcome
  // word. Without a distinct execution record, that is still not evidence
  // that the command ran for this check.
  return POLICY_OR_INTENT_PATTERN.test(text) || COMMAND_INTENT_PATTERN.test(text);
}

function isUnambiguousNonExecutionArtifact(text) {
  return GENERIC_NON_EXECUTION_GATE_PATTERN.test(text) || LABEL_AUTOMATION_PATTERN.test(text) || POLICY_NARRATIVE_PATTERN.test(text) || STATIC_ARTIFACT_PATTERN.test(text);
}

function isAlwaysNonExecutionSupportingText(text) {
  return GENERIC_NON_EXECUTION_GATE_PATTERN.test(text) || LABEL_AUTOMATION_PATTERN.test(text) || POLICY_NARRATIVE_PATTERN.test(text) || isStaticArtifactLead(text);
}

function isStaticArtifactLead(text) {
  return /^(?:status\s+(?:passed|failed|pending|unknown)[.!;:]?\s*)?(?:security\s+report|coverage\s+report|static\s+(?:test\s+)?report|label\s+(?:automation|test\s+(?:results?|report))|preview\s+(?:deployment\s+)?(?:published|deployed|available)|deployment\s+(?:published|deployed|available)|docs?\s*only)\b/i.test(text);
}

function hasContextualNonExecutionTerm(text) {
  return CONTEXTUAL_NON_EXECUTION_TERM_PATTERN.test(text);
}

function isStaticOnlyCheck(text) {
  return STATIC_ONLY_CHECK_PATTERN.test(text) && !hasStrongExecutionSignal(text);
}

function normalizeClassificationText(text) {
  return String(text ?? "").replace(/[_:/-]+/g, " ");
}
