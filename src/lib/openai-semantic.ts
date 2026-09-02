import {
  buildLlmSemanticPackage,
  buildLlmSemanticPackageSubset,
  mergeLlmSemanticPackageCandidates,
  mergeLlmSemanticPackageValidationResults,
  validateLlmSemanticPackageCandidate,
  type LlmSemanticPackage
} from "./llm-semantic-package";
import { extractOpenAIResponseText } from "./openai-verifier";
import { HYBRID_PLANNER_MAX_OUTPUT_BYTES } from "./hybrid-planner";
import {
  GeneralPrSemanticProviderFailure,
  type GeneralPrSemanticObserverPackageV4
} from "./general-pr-semantic-observer";
import { redactSecrets } from "./redact";
import type {
  HybridPlannerTransportRequest,
  HybridPlannerTransportResult
} from "./hybrid-orchestrator";
import type { LlmSemanticOutput, LlmSemanticValidationResult } from "./llm-semantic-output";
import type { PullRequestInput, VerificationReport } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const OPENAI_TIMEOUT_MS = 30_000;
export const OPENAI_BACKGROUND_REQUEST_TIMEOUT_MS = 20_000;

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

/** Sends the already bounded observer package; validation remains with the observer. */
export async function submitGeneralPrSemanticObservationWithOpenAI(
  semanticPackage: GeneralPrSemanticObserverPackageV4,
  options: Pick<OpenAISemanticOptions, "apiKey" | "fetchFn">
): Promise<unknown> {
  try {
    const response = await fetchGeneralPrSemanticObservationResponse(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: openAIHeaders(options.apiKey),
      body: JSON.stringify({
        model: semanticPackage.request.model,
        input: [
          { role: "system", content: [{ type: "input_text", text: semanticPackage.system }] },
          { role: "user", content: [{ type: "input_text", text: JSON.stringify(semanticPackage.input) }] }
        ],
        text: { format: semanticPackage.request.responseFormat },
        store: false,
        max_output_tokens: semanticPackage.request.maxOutputTokens
      }),
      signal: AbortSignal.timeout(semanticPackage.request.timeoutMs)
    }, options.fetchFn);
    const text = extractOpenAIResponseText(await parseOpenAIResponseJson(response));
    if (!text) throw new OpenAISemanticError("openai_output_invalid", false, "OpenAI observer response did not contain text output.");
    try {
      return JSON.parse(text);
    } catch {
      throw new OpenAISemanticError("openai_output_invalid", false, "OpenAI observer response was not valid JSON.");
    }
  } catch (error) {
    throw toGeneralPrSemanticProviderFailure(error);
  }
}

/** This staged path intentionally never reads provider error bodies. */
async function fetchGeneralPrSemanticObservationResponse(
  url: string,
  init: RequestInit,
  fetchFn: typeof fetch | undefined
): Promise<Response> {
  try {
    const response = await (fetchFn ?? fetch)(url, init);
    if (response.ok) return response;

    const status = response.status;
    if (status === 408) throw new OpenAISemanticError("openai_timeout", true, "OpenAI semantic request timed out.", status);
    if (status === 409 || status === 429) throw new OpenAISemanticError("openai_rate_limited", true, "OpenAI semantic request was temporarily limited.", status);
    if (status >= 500) throw new OpenAISemanticError("openai_provider_unavailable", true, "OpenAI semantic provider is unavailable.", status);
    if (status === 401 || status === 403) throw new OpenAISemanticError("openai_auth_failed", false, "OpenAI semantic authorization failed.", status);
    throw new OpenAISemanticError("openai_request_invalid", false, "OpenAI semantic request was rejected.", status);
  } catch (error) {
    if (error instanceof OpenAISemanticError) throw error;
    const name = error instanceof Error ? error.name : "";
    if (name === "AbortError" || name === "TimeoutError") {
      throw new OpenAISemanticError("openai_timeout", true, "OpenAI semantic request timed out.");
    }
    throw new OpenAISemanticError("openai_network_error", true, "OpenAI semantic request could not reach the provider.");
  }
}

function toGeneralPrSemanticProviderFailure(error: unknown): GeneralPrSemanticProviderFailure {
  if (error instanceof GeneralPrSemanticProviderFailure) return error;
  if (error instanceof OpenAISemanticError) {
    if (error.code === "openai_timeout") return new GeneralPrSemanticProviderFailure("provider_request", true);
    const responseFailure = error.code === "openai_response_not_found" ||
      error.code === "openai_response_invalid" ||
      error.code === "openai_output_invalid" ||
      error.code === "openai_output_rejected";
    return new GeneralPrSemanticProviderFailure(responseFailure ? "provider_response" : "provider_request");
  }
  return new GeneralPrSemanticProviderFailure("provider_response");
}

/** One-shot hybrid planner POST. Validation/finalization stay in the shared orchestrator. */
export async function submitHybridPlannerWithOpenAI(
  request: HybridPlannerTransportRequest,
  options: OpenAISemanticOptions
): Promise<HybridPlannerTransportResult> {
  const response = await fetchOpenAIResponse(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: openAIHeaders(options.apiKey),
    body: JSON.stringify(hybridPlannerRequestBody(request)),
    signal: AbortSignal.timeout(request.background ? OPENAI_BACKGROUND_REQUEST_TIMEOUT_MS : OPENAI_TIMEOUT_MS)
  }, options.fetchFn);
  return parseHybridPlannerPayload(await parseOpenAIResponseJson(response), request.background);
}

/** Background continuation performs only a same-ID GET; it can never submit. */
export async function retrieveHybridPlannerWithOpenAI(
  responseId: string,
  request: HybridPlannerTransportRequest,
  options: OpenAISemanticOptions
): Promise<HybridPlannerTransportResult> {
  const safeResponseId = normalizeOpenAIResponseId(responseId);
  const response = await fetchOpenAIResponse(
    `${OPENAI_RESPONSES_URL}/${encodeURIComponent(safeResponseId)}`,
    {
      method: "GET",
      headers: openAIHeaders(options.apiKey),
      signal: AbortSignal.timeout(OPENAI_BACKGROUND_REQUEST_TIMEOUT_MS)
    },
    options.fetchFn,
    { retrieving: true }
  );
  return parseHybridPlannerPayload(await parseOpenAIResponseJson(response), true, safeResponseId);
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

type ParsedOpenAIBackgroundSemanticResult =
  | Extract<OpenAIBackgroundSemanticResult, { status: "pending" }>
  | {
      status: "completed";
      responseId: string;
      validation: LlmSemanticValidationResult;
    };

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
  const firstCandidate = await requestSynchronousSemanticCandidate(llmPackage, options);
  const firstValidation = validateLlmSemanticPackageCandidate(firstCandidate, llmPackage);
  if (firstValidation.disposition === "discarded" || !firstValidation.candidate) {
    throw new Error(`OpenAI semantic output failed validation: ${firstValidation.rejected_units.flatMap((item) => item.reason_codes).join(", ") || "no usable semantic units"}.`);
  }

  if (firstValidation.missing_requirement_ids.length === 0) {
    return { output: firstValidation.candidate, validation: firstValidation };
  }

  const retryPackage = buildLlmSemanticPackageSubset(
    llmPackage,
    firstValidation.missing_requirement_ids
  );
  const retryCandidate = await requestSynchronousSemanticCandidate(retryPackage, options);
  const validation = mergeLlmSemanticPackageCandidates(
    firstValidation,
    retryCandidate,
    llmPackage
  );
  return { output: validation.candidate ?? firstValidation.candidate, validation };
}

async function requestSynchronousSemanticCandidate(
  llmPackage: LlmSemanticPackage,
  options: OpenAISemanticOptions
): Promise<unknown> {
  const response = await (options.fetchFn ?? fetch)(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: openAIHeaders(options.apiKey),
    body: JSON.stringify(openAIRequestBody(llmPackage, options.model)),
    signal: AbortSignal.timeout(OPENAI_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`OpenAI semantic analysis failed with HTTP ${response.status}: ${summarizeError(await response.text())}`);
  }

  const text = extractOpenAIResponseText(await response.json());
  if (!text) throw new Error("OpenAI semantic analysis did not return text output.");

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("OpenAI semantic analysis returned invalid JSON.");
  }
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
  return acceptedBackgroundSemanticResult(parseBackgroundSemanticPayload(payload, llmPackage));
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
  return acceptedBackgroundSemanticResult(parseBackgroundSemanticPayload(payload, llmPackage, safeResponseId));
}

export async function submitMissingSemanticsWithOpenAIBackground(
  input: PullRequestInput,
  report: VerificationReport,
  firstValidation: LlmSemanticValidationResult,
  options: OpenAISemanticOptions
): Promise<OpenAIBackgroundSemanticResult> {
  const llmPackage = buildLlmSemanticPackage(input, report, {
    outputLocale: options.outputLocale
  });
  const retryPackage = missingSemanticPackage(llmPackage, firstValidation);
  const response = await fetchOpenAIResponse(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: openAIHeaders(options.apiKey),
    body: JSON.stringify({
      ...openAIRequestBody(retryPackage, options.model),
      background: true
    }),
    signal: AbortSignal.timeout(OPENAI_BACKGROUND_REQUEST_TIMEOUT_MS)
  }, options.fetchFn);
  const payload = await parseOpenAIResponseJson(response);
  return mergeBackgroundRetryResult(
    parseBackgroundSemanticPayload(payload, retryPackage),
    firstValidation,
    llmPackage
  );
}

export async function retrieveMissingSemanticsWithOpenAIBackground(
  responseId: string,
  input: PullRequestInput,
  report: VerificationReport,
  firstValidation: LlmSemanticValidationResult,
  options: OpenAISemanticOptions
): Promise<OpenAIBackgroundSemanticResult> {
  const safeResponseId = normalizeOpenAIResponseId(responseId);
  const llmPackage = buildLlmSemanticPackage(input, report, {
    outputLocale: options.outputLocale
  });
  const retryPackage = missingSemanticPackage(llmPackage, firstValidation);
  const response = await fetchOpenAIResponse(`${OPENAI_RESPONSES_URL}/${encodeURIComponent(safeResponseId)}`, {
    method: "GET",
    headers: openAIHeaders(options.apiKey),
    signal: AbortSignal.timeout(OPENAI_BACKGROUND_REQUEST_TIMEOUT_MS)
  }, options.fetchFn, { retrieving: true });
  const payload = await parseOpenAIResponseJson(response);
  return mergeBackgroundRetryResult(
    parseBackgroundSemanticPayload(payload, retryPackage, safeResponseId),
    firstValidation,
    llmPackage
  );
}

function missingSemanticPackage(
  llmPackage: LlmSemanticPackage,
  firstValidation: LlmSemanticValidationResult
): LlmSemanticPackage {
  if (!firstValidation.candidate || firstValidation.missing_requirement_ids.length === 0) {
    throw new OpenAISemanticError(
      "openai_output_rejected",
      false,
      "OpenAI semantic coverage retry requires a validator-approved incomplete candidate."
    );
  }
  return buildLlmSemanticPackageSubset(llmPackage, firstValidation.missing_requirement_ids);
}

function mergeBackgroundRetryResult(
  result: ParsedOpenAIBackgroundSemanticResult,
  firstValidation: LlmSemanticValidationResult,
  llmPackage: LlmSemanticPackage
): OpenAIBackgroundSemanticResult {
  if (result.status === "pending") return result;
  const validation = mergeLlmSemanticPackageValidationResults(
    firstValidation,
    result.validation,
    llmPackage
  );
  return {
    status: "completed",
    responseId: result.responseId,
    output: validation.candidate ?? firstValidation.candidate!,
    validation
  };
}

function acceptedBackgroundSemanticResult(
  result: ParsedOpenAIBackgroundSemanticResult
): OpenAIBackgroundSemanticResult {
  if (result.status === "pending") return result;
  if (result.validation.disposition === "discarded" || !result.validation.candidate) {
    throw new OpenAISemanticError("openai_output_rejected", false, "OpenAI semantic output failed strict validation.");
  }
  return {
    status: "completed",
    responseId: result.responseId,
    output: result.validation.candidate,
    validation: result.validation
  };
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

function hybridPlannerRequestBody(request: HybridPlannerTransportRequest) {
  const plannerPackage = request.package;
  return {
    model: plannerPackage.request.model,
    input: [
      { role: "system", content: [{ type: "input_text", text: plannerPackage.system }] },
      { role: "user", content: [{ type: "input_text", text: JSON.stringify(plannerPackage.input) }] }
    ],
    text: {
      format: {
        type: plannerPackage.request.response_format.type,
        name: plannerPackage.request.response_format.json_schema.name,
        schema: plannerPackage.request.response_format.json_schema.schema,
        strict: plannerPackage.request.response_format.json_schema.strict
      }
    },
    store: plannerPackage.request.store,
    max_output_tokens: plannerPackage.request.max_output_tokens,
    ...(request.background ? { background: true } : {})
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
): ParsedOpenAIBackgroundSemanticResult {
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
  return {
    status: "completed",
    responseId,
    validation
  };
}

function parseHybridPlannerPayload(
  payload: unknown,
  background: boolean,
  expectedResponseId?: string
): HybridPlannerTransportResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new OpenAISemanticError("openai_response_invalid", false, "OpenAI hybrid planner response was malformed.");
  }
  const record = payload as Record<string, unknown>;
  const responseId = normalizeOpenAIResponseId(record.id);
  if (expectedResponseId && responseId !== expectedResponseId) {
    throw new OpenAISemanticError("openai_response_invalid", false, "OpenAI hybrid planner response id did not match the requested response.");
  }
  if (record.status === "queued" || record.status === "in_progress") {
    if (!background) {
      throw new OpenAISemanticError("openai_response_invalid", false, "OpenAI synchronous hybrid planner response was not complete.");
    }
    return {
      status: "pending",
      responseId,
      providerStatus: record.status,
      outputBytes: 0,
      outputTokens: 0
    };
  }
  if (record.status === "failed") {
    throw new OpenAISemanticError("openai_background_failed", false, "OpenAI hybrid planner response failed.");
  }
  if (record.status === "cancelled") {
    throw new OpenAISemanticError("openai_background_cancelled", false, "OpenAI hybrid planner response was cancelled.");
  }
  if (record.status === "incomplete") {
    throw new OpenAISemanticError("openai_background_incomplete", false, "OpenAI hybrid planner response was incomplete.");
  }
  if (record.status !== "completed") {
    throw new OpenAISemanticError("openai_response_invalid", false, "OpenAI hybrid planner response returned an unknown status.");
  }
  const text = extractOpenAIResponseText(payload);
  if (!text) {
    throw new OpenAISemanticError("openai_output_invalid", false, "OpenAI hybrid planner response did not contain JSON output.");
  }
  const outputBytes = Buffer.byteLength(text, "utf8");
  if (outputBytes > HYBRID_PLANNER_MAX_OUTPUT_BYTES) {
    throw new OpenAISemanticError("openai_output_invalid", false, "OpenAI hybrid planner output exceeded the byte limit.");
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    throw new OpenAISemanticError("openai_output_invalid", false, "OpenAI hybrid planner response was not valid JSON.");
  }
  const outputTokens = safeProviderOutputTokens(record.usage);
  return {
    status: "completed",
    ...(background ? { responseId } : {}),
    candidate,
    outputBytes,
    outputTokens
  };
}

function safeProviderOutputTokens(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  const tokens = (value as { output_tokens?: unknown }).output_tokens;
  return typeof tokens === "number" && Number.isSafeInteger(tokens) && tokens >= 0
    ? Math.min(tokens, 1_000_000)
    : 0;
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
