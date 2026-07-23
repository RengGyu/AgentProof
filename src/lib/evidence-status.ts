/**
 * TypeScript-facing compatibility boundary for the shared JS classifier.
 * The smoke runner imports the same implementation directly.
 */
export {
  STRONG_EXECUTION_EVIDENCE_PATTERN,
  WEAK_EXECUTION_EVIDENCE_PATTERN,
  hasPassingEvidenceStatusPrefix,
  statusFromExecutionEvidenceSummary,
  isExecutionEvidenceSignal,
  isExecutionEvidenceItemSignal,
  isExecutionSignalText,
  isFailedAmbiguousActionsExecutionSignal
} from "./execution-evidence-classifier.mjs";
