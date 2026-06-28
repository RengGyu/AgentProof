export const STRONG_EXECUTION_EVIDENCE_PATTERN =
  /\b(test|tests|spec|unit|integration|e2e|vitest|jest|playwright|cypress|pytest|coverage)\b/i;
export const WEAK_EXECUTION_EVIDENCE_PATTERN = /\b(ci|build)\b/i;
export const NON_EXECUTION_GATE_PATTERN =
  /\b(policy|policies|provenance|attestation|security|scan|sast|secret|secrets|dependency|dependencies|license|licenses|code owners?|owners|review|report|preview|deploy|deployment|merge[- ]?gate|required checks?)\b/i;
const DIRECT_EXECUTION_COMMAND_PATTERN =
  /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|vitest|jest|playwright|cypress|build|typecheck|lint)\b|\b(?:vitest|jest|pytest|go\s+test|cargo\s+test|dotnet\s+test|mvn\s+test|gradle\s+test|tsc|next\s+build)\b/i;

export function isExecutionSignalText(text: string): boolean {
  if (NON_EXECUTION_GATE_PATTERN.test(text) && !DIRECT_EXECUTION_COMMAND_PATTERN.test(text)) {
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

  if (STRONG_EXECUTION_EVIDENCE_PATTERN.test(labelText) || DIRECT_EXECUTION_COMMAND_PATTERN.test(labelText)) {
    return true;
  }

  const supportingText = text.trim();
  if (supportingText && NON_EXECUTION_GATE_PATTERN.test(supportingText) && !DIRECT_EXECUTION_COMMAND_PATTERN.test(supportingText)) {
    return false;
  }

  return isExecutionSignalText(`${labelText} ${supportingText}`);
}

export function hasPassingEvidenceStatusPrefix(summary: string): boolean {
  return /^Status:\s*passed\b/i.test(summary.trim());
}
