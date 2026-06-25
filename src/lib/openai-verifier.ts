import { buildLlmVerifierPackage } from "./llm-package";
import { validateVerificationReport } from "./report-validation";
import { redactSecrets } from "./redact";
import type { PullRequestInput, VerificationReport } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 12_000;

export interface OpenAIVerifierOptions {
  apiKey: string;
  model?: string;
  fetchFn?: typeof fetch;
}

export async function verifyReportWithOpenAI(
  input: PullRequestInput,
  deterministicReport: VerificationReport,
  options: OpenAIVerifierOptions
): Promise<VerificationReport> {
  const llmPackage = buildLlmVerifierPackage(input, deterministicReport);
  const fetchImpl = options.fetchFn ?? fetch;
  const response = await fetchImpl(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: options.model ?? "gpt-5-mini",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: llmPackage.system }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: JSON.stringify(llmPackage.input) }]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: llmPackage.schema.name,
          schema: llmPackage.schema.schema,
          strict: true
        }
      },
      store: false
    }),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI verifier failed with HTTP ${response.status}: ${summarizeOpenAIError(errorText)}`);
  }

  const json = await response.json();
  const text = extractOpenAIResponseText(json);

  if (!text) {
    throw new Error("OpenAI verifier did not return text output.");
  }

  let report: unknown;
  try {
    report = JSON.parse(text);
  } catch {
    throw new Error("OpenAI verifier returned invalid JSON.");
  }

  report = normalizeOpenAIReport(report);

  const validation = validateVerificationReport(report, { mode: "full" });
  if (!validation.valid) {
    throw new Error(`OpenAI verifier output failed validation: ${validation.errors.join(" ")}`);
  }

  const baselineErrors = validateOutputEvidenceMatchesBaseline(report as VerificationReport, deterministicReport);
  if (baselineErrors.length > 0) {
    throw new Error(`OpenAI verifier output changed deterministic evidence: ${baselineErrors.join(" ")}`);
  }

  return report as VerificationReport;
}

function normalizeOpenAIReport(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }

  const report: Record<string, unknown> = { ...value };

  if (isRecord(report.source)) {
    const source: Record<string, unknown> = { ...report.source };
    for (const key of ["url", "author", "baseBranch", "headBranch"]) {
      if (source[key] === null) {
        delete source[key];
      }
    }
    report.source = source;
  }

  if (Array.isArray(report.evidenceIndex)) {
    report.evidenceIndex = report.evidenceIndex.map((item) => {
      if (!isRecord(item) || item.locator !== null) {
        return item;
      }

      const normalized: Record<string, unknown> = { ...item };
      delete normalized.locator;
      return normalized;
    });
  }

  return report;
}

function validateOutputEvidenceMatchesBaseline(
  report: VerificationReport,
  deterministicReport: VerificationReport
): string[] {
  const errors: string[] = [];
  const baselineById = new Map(deterministicReport.evidenceIndex.map((item) => [item.id, item]));

  if (report.evidenceIndex.length !== deterministicReport.evidenceIndex.length) {
    errors.push("evidenceIndex length changed.");
  }

  for (const item of report.evidenceIndex) {
    const baseline = baselineById.get(item.id);

    if (!baseline) {
      errors.push(`evidenceIndex includes non-baseline evidence ${item.id}.`);
      continue;
    }

    if (
      item.kind !== baseline.kind ||
      item.label !== baseline.label ||
      item.locator !== baseline.locator ||
      item.summary !== baseline.summary ||
      item.confidence !== baseline.confidence
    ) {
      errors.push(`evidenceIndex item ${item.id} differs from deterministic baseline.`);
    }
  }

  return errors;
}

function summarizeOpenAIError(value: string): string {
  const redacted = redactSecrets(value);

  try {
    const parsed = JSON.parse(redacted) as unknown;
    if (isRecord(parsed) && isRecord(parsed.error) && typeof parsed.error.message === "string") {
      return truncate(parsed.error.message, 500);
    }
  } catch {
    // Fall through to the plain-text body.
  }

  return truncate(redacted || "No error body returned.", 500);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

export function extractOpenAIResponseText(value: unknown): string | null {
  if (hasStringProperty(value, "output_text")) {
    return value.output_text;
  }

  if (!isRecord(value) || !Array.isArray(value.output)) {
    return null;
  }

  for (const item of value.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;

    for (const content of item.content) {
      if (!isRecord(content)) continue;
      if ((content.type === "output_text" || content.type === "text") && typeof content.text === "string") {
        return content.text;
      }
    }
  }

  return null;
}

function hasStringProperty<T extends string>(value: unknown, property: T): value is Record<T, string> {
  return isRecord(value) && typeof value[property] === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}
