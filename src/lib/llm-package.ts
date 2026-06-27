import { llmBoundaryPrompt, verificationReportSchema } from "./structured-output";
import { compactText, redactSecrets } from "./redact";
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
  const safeReport = sanitizeForLlm(deterministicReport);

  return {
    system: [
      llmBoundaryPrompt.trim(),
      "Use the deterministic report as a baseline. You may downgrade confidence when evidence is weak.",
      "Preserve analysisId, createdAt, source, evidenceIndex, extracted requirement IDs/text, extracted claim IDs/text, and testing status exactly.",
      "Do not invent files, logs, tests, comments, or evidence IDs.",
      "Every evidenceRefs entry must refer to an ID present in evidenceIndex."
    ].join("\n"),
    schema: verificationReportSchema,
    input: {
      source: safeReport.source,
      taskText: compactText(input.taskText, 4000),
      evidenceIndex: safeReport.evidenceIndex,
      deterministicReport: safeReport,
      limitations: safeReport.limitations
    }
  };
}

function sanitizeForLlm<T>(value: T): T {
  if (typeof value === "string") {
    return redactSecrets(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForLlm(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, sanitizeForLlm(nestedValue)])
    ) as T;
  }

  return value;
}
