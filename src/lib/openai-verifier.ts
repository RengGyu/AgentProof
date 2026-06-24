import { buildLlmVerifierPackage } from "./llm-package";
import { validateVerificationReport } from "./report-validation";
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
    throw new Error(`OpenAI verifier failed with HTTP ${response.status}.`);
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

  const validation = validateVerificationReport(report);
  if (!validation.valid) {
    throw new Error(`OpenAI verifier output failed validation: ${validation.errors.join(" ")}`);
  }

  return report as VerificationReport;
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
