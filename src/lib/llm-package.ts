import { llmBoundaryPrompt, verificationReportSchema } from "./structured-output";
import { compactText } from "./redact";
import type { PullRequestInput, VerificationReport } from "./types";

export interface LlmVerifierPackage {
  system: string;
  schema: typeof verificationReportSchema;
  input: {
    source: VerificationReport["source"];
    taskText: string;
    evidenceIndex: VerificationReport["evidenceIndex"];
    deterministicReport: VerificationReport;
    limitations: string[];
  };
}

export function buildLlmVerifierPackage(
  input: PullRequestInput,
  deterministicReport: VerificationReport
): LlmVerifierPackage {
  return {
    system: [
      llmBoundaryPrompt.trim(),
      "Use the deterministic report as a baseline. You may downgrade confidence when evidence is weak.",
      "Do not invent files, logs, tests, comments, or evidence IDs.",
      "Every evidenceRefs entry must refer to an ID present in evidenceIndex."
    ].join("\n"),
    schema: verificationReportSchema,
    input: {
      source: deterministicReport.source,
      taskText: compactText(input.taskText, 4000),
      evidenceIndex: deterministicReport.evidenceIndex,
      deterministicReport,
      limitations: deterministicReport.limitations
    }
  };
}
