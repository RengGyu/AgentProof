import { buildLlmSemanticPackage, validateLlmSemanticPackageCandidate } from "./llm-semantic-package";
import { extractOpenAIResponseText } from "./openai-verifier";
import { redactSecrets } from "./redact";
import type { LlmSemanticOutput, LlmSemanticValidationResult } from "./llm-semantic-output";
import type { PullRequestInput, VerificationReport } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 30_000;

export interface OpenAISemanticOptions {
  apiKey: string;
  model?: string;
  outputLocale?: string;
  fetchFn?: typeof fetch;
}

export interface OpenAISemanticResult {
  output: LlmSemanticOutput;
  validation: LlmSemanticValidationResult;
}

/**
 * Calls the Responses API with an ephemeral semantic package. This adapter
 * neither writes the package nor the provider response; callers may retain
 * only the already validator-approved semantic output.
 */
export async function analyzeSemanticsWithOpenAI(
  input: PullRequestInput,
  report: VerificationReport,
  options: OpenAISemanticOptions
): Promise<OpenAISemanticResult> {
  const llmPackage = buildLlmSemanticPackage(input, report, {
    outputLocale: options.outputLocale
  });
  const response = await (options.fetchFn ?? fetch)(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: options.model ?? "gpt-5-mini",
      input: [
        { role: "system", content: [{ type: "input_text", text: llmPackage.system }] },
        { role: "user", content: [{ type: "input_text", text: JSON.stringify(llmPackage.input) }] }
      ],
      text: {
        format: {
          type: "json_schema",
          name: llmPackage.schema.name,
          schema: llmPackage.schema.schema,
          strict: llmPackage.schema.strict
        }
      },
      store: false
    }),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`OpenAI semantic analysis failed with HTTP ${response.status}: ${summarizeError(await response.text())}`);
  }

  const text = extractOpenAIResponseText(await response.json());
  if (!text) throw new Error("OpenAI semantic analysis did not return text output.");

  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    throw new Error("OpenAI semantic analysis returned invalid JSON.");
  }

  const validation = validateLlmSemanticPackageCandidate(candidate, llmPackage);
  if (validation.disposition === "discarded" || !validation.candidate) {
    throw new Error(`OpenAI semantic output failed validation: ${validation.rejected_units.flatMap((item) => item.reason_codes).join(", ") || "no usable semantic units"}.`);
  }

  return { output: validation.candidate, validation };
}

function summarizeError(value: string): string {
  const redacted = redactSecrets(value);
  try {
    const parsed = JSON.parse(redacted) as { error?: { message?: unknown } };
    if (typeof parsed.error?.message === "string") return truncate(parsed.error.message, 500);
  } catch {
    // Keep a bounded redacted plain-text fallback.
  }
  return truncate(redacted || "No error body returned.", 500);
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
