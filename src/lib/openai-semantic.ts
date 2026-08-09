import { buildLlmSemanticPackage, validateLlmSemanticPackageCandidate } from "./llm-semantic-package";
import { extractOpenAIResponseText } from "./openai-verifier";
import { redactSecrets } from "./redact";
import type { LlmSemanticOutput, LlmSemanticValidationResult } from "./llm-semantic-output";
import type { PullRequestInput, VerificationReport } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 30_000;
const OPENAI_BACKGROUND_REQUEST_TIMEOUT_MS = 20_000;

export type OpenAISemanticFailureCode =
  | "openai_timeout"
  | "openai_network_error"
  | "openai_rate_limited"
  | "openai_provider_unavailable"
  | "openai_auth_failed"
  | "openai_request_invalid"
  | "openai_response_not_found"
  | "openai_response_invalid"
  | "openai_output_invalid"
  | "openai_output_rejected"
  | "openai_background_failed"
  | "openai_background_cancelled"
  | "openai_background_incomplete"
  | "openai_background_expired";

export class OpenAISemanticError extends Error {
  constructor(
    public readonly code: OpenAISemanticFailureCode,
    public readonly retryable: boolean,
    message: string,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = "OpenAISemanticError";
  }
}

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

export type OpenAIBackgroundSemanticResult =
  | {
      status: "pending";
      responseId: string;
      providerStatus: "queued" | "in_progress";
    }
  | ({
      status: "completed";
      responseId: string;
    } & OpenAISemanticResult);

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

export async function submitSemanticsWithOpenAIBackground(
  input: PullRequestInput,
  report: VerificationReport,
  options: OpenAISemanticOptions
): Promise<OpenAIBackgroundSemanticResult> {
  const llmPackage = buildLlmSemanticPackage(input, report, {
    outputLocale: options.outputLocale
  });
  const response = await fetchOpenAIResponse(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: openAIHeaders(options.apiKey),
    body: JSON.stringify({
      ...openAIRequestBody(llmPackage, options.model),
      background: true
    }),
    signal: AbortSignal.timeout(OPENAI_BACKGROUND_REQUEST_TIMEOUT_MS)
  }, options.fetchFn);
  const payload = await parseOpenAIResponseJson(response);
  return parseBackgroundSemanticPayload(payload, llmPackage);
}

export async function retrieveSemanticsWithOpenAIBackground(
  responseId: string,
  input: PullRequestInput,
  report: VerificationReport,
  options: OpenAISemanticOptions
): Promise<OpenAIBackgroundSemanticResult> {
  const safeResponseId = normalizeOpenAIResponseId(responseId);
  const llmPackage = buildLlmSemanticPackage(input, report, {
    outputLocale: options.outputLocale
  });
  const response = await fetchOpenAIResponse(`${OPENAI_RESPONSES_URL}/${encodeURIComponent(safeResponseId)}`, {
    method: "GET",
    headers: openAIHeaders(options.apiKey),
    signal: AbortSignal.timeout(OPENAI_BACKGROUND_REQUEST_TIMEOUT_MS)
  }, options.fetchFn, { retrieving: true });
  const payload = await parseOpenAIResponseJson(response);
  return parseBackgroundSemanticPayload(payload, llmPackage, safeResponseId);
}

function openAIRequestBody(
  llmPackage: ReturnType<typeof buildLlmSemanticPackage>,
  model: string | undefined
) {
  return {
    model: model ?? "gpt-5-mini",
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
  };
}

function openAIHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json"
  };
}

async function fetchOpenAIResponse(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch | undefined,
  options: { retrieving?: boolean } = {}
): Promise<Response> {
  let response: Response;
  try {
    response = await (fetchFn ?? fetch)(url, init);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      throw new OpenAISemanticError("openai_timeout", true, "OpenAI semantic request timed out.");
    }
    throw new OpenAISemanticError("openai_network_error", true, "OpenAI semantic request could not reach the provider.");
  }

  if (response.ok) return response;

  const detail = summarizeError(await response.text());
  const status = response.status;
  if (status === 408) {
    throw new OpenAISemanticError("openai_timeout", true, `OpenAI semantic request timed out: ${detail}`, status);
  }
  if (status === 409 || status === 429) {
    throw new OpenAISemanticError("openai_rate_limited", true, `OpenAI semantic request is temporarily limited: ${detail}`, status);
  }
  if (status >= 500) {
    throw new OpenAISemanticError("openai_provider_unavailable", true, `OpenAI semantic provider is unavailable: ${detail}`, status);
  }
  if (status === 401 || status === 403) {
    throw new OpenAISemanticError("openai_auth_failed", false, `OpenAI semantic authorization failed: ${detail}`, status);
  }
  if (options.retrieving && status === 404) {
    throw new OpenAISemanticError("openai_response_not_found", false, "OpenAI background response was not found.", status);
  }
  throw new OpenAISemanticError("openai_request_invalid", false, `OpenAI semantic request was rejected: ${detail}`, status);
}

async function parseOpenAIResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new OpenAISemanticError("openai_response_invalid", false, "OpenAI semantic response was not valid JSON.");
  }
}

function parseBackgroundSemanticPayload(
  payload: unknown,
  llmPackage: ReturnType<typeof buildLlmSemanticPackage>,
  expectedResponseId?: string
): OpenAIBackgroundSemanticResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new OpenAISemanticError("openai_response_invalid", false, "OpenAI semantic response was malformed.");
  }

  const record = payload as Record<string, unknown>;
  const responseId = normalizeOpenAIResponseId(record.id);
  if (expectedResponseId && responseId !== expectedResponseId) {
    throw new OpenAISemanticError("openai_response_invalid", false, "OpenAI semantic response id did not match the requested response.");
  }

  if (record.status === "queued" || record.status === "in_progress") {
    return { status: "pending", responseId, providerStatus: record.status };
  }
  if (record.status === "failed") {
    throw new OpenAISemanticError("openai_background_failed", false, "OpenAI background semantic analysis failed.");
  }
  if (record.status === "cancelled") {
    throw new OpenAISemanticError("openai_background_cancelled", false, "OpenAI background semantic analysis was cancelled.");
  }
  if (record.status === "incomplete") {
    throw new OpenAISemanticError("openai_background_incomplete", false, "OpenAI background semantic analysis was incomplete.");
  }
  if (record.status !== "completed") {
    throw new OpenAISemanticError("openai_response_invalid", false, "OpenAI background semantic analysis returned an unknown status.");
  }

  const text = extractOpenAIResponseText(payload);
  if (!text) {
    throw new OpenAISemanticError("openai_output_invalid", false, "OpenAI semantic analysis did not return text output.");
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    throw new OpenAISemanticError("openai_output_invalid", false, "OpenAI semantic analysis returned invalid JSON.");
  }

  const validation = validateLlmSemanticPackageCandidate(candidate, llmPackage);
  if (validation.disposition === "discarded" || !validation.candidate) {
    throw new OpenAISemanticError("openai_output_rejected", false, "OpenAI semantic output failed strict validation.");
  }

  return {
    status: "completed",
    responseId,
    output: validation.candidate,
    validation
  };
}

function normalizeOpenAIResponseId(value: unknown): string {
  if (typeof value !== "string" || !/^resp_[A-Za-z0-9_-]{1,180}$/.test(value)) {
    throw new OpenAISemanticError("openai_response_invalid", false, "OpenAI background response id was invalid.");
  }
  return value;
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
