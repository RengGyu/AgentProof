export const STRONG_EXECUTION_EVIDENCE_PATTERN =
  /\b(test|tests|spec|unit|integration|e2e|vitest|jest|playwright|cypress|pytest|tox)\b/i;
export const WEAK_EXECUTION_EVIDENCE_PATTERN = /\bbuild\b/i;
export const NON_EXECUTION_GATE_PATTERN =
  /\b(ai[- ]?review|allowed failure|allow failure|backport|changelog|change log|code[- ]owners?|codecov|coverage (?:gate|policy|report|threshold|upload)|coveralls|dependency|dependencies|deprecation|deploy|deployment|docs?|documentation|do not merge|label|license|licenses|merge[- ]?gate|non[- ]?blocking|optional|owners|patch coverage|policies|policy|preview|prevent merging|project coverage|provenance|readthedocs|read the docs|release notes?|required checks?|report|review|sast|scan|secret|secrets|security|semver|stats?|towncrier)\b/i;
const DIRECT_EXECUTION_COMMAND_PATTERN =
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|vitest|jest|playwright|cypress|build)\b|\buv\s+run\s+tox\b|\bcoverage\s+run\s+-m\s+pytest\b|\b(?:vitest|jest|pytest|tox|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\s+test|next\s+build)\b/i;
const STATIC_ONLY_CHECK_PATTERN =
  /\b(?:eslint|lint|typecheck|type-check|type check|tsc|static analysis|static check)\b/i;
const GITHUB_ACTIONS_JOB_URL_PATTERN = /github\.com\/[^/\s]+\/[^/\s]+\/actions\/runs\/\d+\/job\/\d+/i;
const GENERIC_ACTIONS_HOUSEKEEPING_PATTERN =
  /\b(checkout|setup|cache|install dependencies|upload|download|artifact|publish|preview|deploy|deployment|report|notify|label added|docs-only|changelog|change log|release notes?|towncrier|codecov|coverage (?:gate|policy|report|threshold|upload)|optional|non[- ]?blocking)\b/i;
const CANCELLED_OR_OPTIONAL_PATTERN =
  /\b(cancelled|canceled|skipped|optional|non[- ]?blocking|allowed failure|allow failure|neutral|not required|action required)\b/i;
const AMBIGUOUS_PROVIDER_PATTERN = /\b(buildkite|circleci|azure pipelines?|jenkins|travis|appveyor)\b|buildkite\//i;
const MATRIX_EXECUTION_JOB_PATTERN =
  /(?:^[A-Z][A-Z0-9_]{2,}=)|\b(?:ubuntu|linux|windows|macos|darwin|python|py\d|node|ruby|go|java|jdk|x86|x64|arm64|sqlite|postgres|mysql|mariadb|oracle|matrix)\b/i;

export function isExecutionSignalText(text: string): boolean {
  if (NON_EXECUTION_GATE_PATTERN.test(text) && !DIRECT_EXECUTION_COMMAND_PATTERN.test(text)) {
    return false;
  }

  if (STATIC_ONLY_CHECK_PATTERN.test(text) &&
    !STRONG_EXECUTION_EVIDENCE_PATTERN.test(text) &&
    !WEAK_EXECUTION_EVIDENCE_PATTERN.test(text) &&
    !DIRECT_EXECUTION_COMMAND_PATTERN.test(text)
  ) {
    return false;
  }

  if (STRONG_EXECUTION_EVIDENCE_PATTERN.test(text)) {
    return true;
  }

  return WEAK_EXECUTION_EVIDENCE_PATTERN.test(text) && !NON_EXECUTION_GATE_PATTERN.test(text);
}

export function isExecutionEvidenceSignal(label: string, text = "", locator = ""): boolean {
  const labelText = label.trim();

  if (NON_EXECUTION_GATE_PATTERN.test(labelText)) {
    return false;
  }

  if (STATIC_ONLY_CHECK_PATTERN.test(labelText) &&
    !STRONG_EXECUTION_EVIDENCE_PATTERN.test(labelText) &&
    !WEAK_EXECUTION_EVIDENCE_PATTERN.test(labelText) &&
    !DIRECT_EXECUTION_COMMAND_PATTERN.test(labelText)
  ) {
    return false;
  }

  if (STRONG_EXECUTION_EVIDENCE_PATTERN.test(labelText) || DIRECT_EXECUTION_COMMAND_PATTERN.test(labelText)) {
    return true;
  }

  const supportingText = text.trim();
  if (supportingText && NON_EXECUTION_GATE_PATTERN.test(supportingText)) {
    return false;
  }

  if (supportingText && STATIC_ONLY_CHECK_PATTERN.test(supportingText) &&
    !STRONG_EXECUTION_EVIDENCE_PATTERN.test(supportingText) &&
    !WEAK_EXECUTION_EVIDENCE_PATTERN.test(supportingText) &&
    !DIRECT_EXECUTION_COMMAND_PATTERN.test(supportingText)
  ) {
    return false;
  }

  if (
    AMBIGUOUS_PROVIDER_PATTERN.test(labelText) &&
    !STRONG_EXECUTION_EVIDENCE_PATTERN.test(labelText) &&
    !WEAK_EXECUTION_EVIDENCE_PATTERN.test(labelText) &&
    !DIRECT_EXECUTION_COMMAND_PATTERN.test(labelText) &&
    !STRONG_EXECUTION_EVIDENCE_PATTERN.test(supportingText) &&
    !WEAK_EXECUTION_EVIDENCE_PATTERN.test(supportingText) &&
    !DIRECT_EXECUTION_COMMAND_PATTERN.test(supportingText)
  ) {
    return false;
  }

  return isExecutionSignalText(`${labelText} ${supportingText}`);
}

export function isFailedAmbiguousActionsExecutionSignal(
  label: string,
  status: string | undefined,
  locator = "",
  text = ""
): boolean {
  const labelText = label.trim();
  const combined = `${labelText} ${text}`.trim();

  if (status !== "failed" && status !== "pending") {
    return false;
  }

  if (!GITHUB_ACTIONS_JOB_URL_PATTERN.test(locator)) {
    return false;
  }

  if (!labelText || GENERIC_ACTIONS_HOUSEKEEPING_PATTERN.test(labelText)) {
    return false;
  }

  if (
    NON_EXECUTION_GATE_PATTERN.test(combined) ||
    STATIC_ONLY_CHECK_PATTERN.test(combined) ||
    CANCELLED_OR_OPTIONAL_PATTERN.test(combined)
  ) {
    return false;
  }

  return isExecutionSignalText(combined) ||
    DIRECT_EXECUTION_COMMAND_PATTERN.test(combined) ||
    MATRIX_EXECUTION_JOB_PATTERN.test(labelText);
}

export function hasPassingEvidenceStatusPrefix(summary: string): boolean {
  return /^Status:\s*passed\b/i.test(summary.trim());
}
