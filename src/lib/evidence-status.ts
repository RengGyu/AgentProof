export const STRONG_EXECUTION_EVIDENCE_PATTERN =
  /\b(test|tests|spec|unit|integration|e2e|vitest|jest|playwright|cypress|coverage)\b/i;
export const WEAK_EXECUTION_EVIDENCE_PATTERN = /\b(ci|build)\b/i;
export const NON_EXECUTION_GATE_PATTERN =
  /\b(policy|policies|provenance|attestation|security|scan|sast|secret|secrets|dependency|dependencies|license|licenses|code owners?|owners|review|report|preview|deploy|deployment|merge[- ]?gate|required checks?)\b/i;

export function isExecutionSignalText(text: string): boolean {
  if (STRONG_EXECUTION_EVIDENCE_PATTERN.test(text)) {
    return true;
  }

  return WEAK_EXECUTION_EVIDENCE_PATTERN.test(text) && !NON_EXECUTION_GATE_PATTERN.test(text);
}

export function isExecutionEvidenceSignal(label: string, text = "", locator = ""): boolean {
  if (NON_EXECUTION_GATE_PATTERN.test(label)) {
    return false;
  }

  return isExecutionSignalText(`${label} ${text}`);
}

export function hasPassingEvidenceStatusPrefix(summary: string): boolean {
  return /^Status:\s*passed\b/i.test(summary.trim());
}
