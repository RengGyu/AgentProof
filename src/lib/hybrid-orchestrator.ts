import { extractRequirementSpanSeed } from "./extractors";
import type {
  HybridPlannerGateDecision,
  HybridPlannerGateReason
} from "./hybrid-planner-consent";
import {
  bindHybridPlannerSeedHash,
  buildHybridPlannerPackage,
  HYBRID_PLANNER_CONTRACT_VERSION,
  HYBRID_PLANNER_MAX_INPUT_BYTES,
  HYBRID_PLANNER_MAX_OUTPUT_BYTES,
  HYBRID_PLANNER_MAX_OUTPUT_TOKENS,
  HYBRID_PLANNER_MODEL,
  HYBRID_PLANNER_PROMPT_VERSION,
  HYBRID_PLANNER_SCHEMA_VERSION,
  validateHybridPlannerPlan,
  type HybridPlannerPackage
} from "./hybrid-planner";
import {
  finalizeHybridVerificationReport,
  generateHybridFallbackReport
} from "./hybrid-report-finalizer";
import type { PullRequestInput, RequirementSpanSeed, VerificationReport } from "./types";

export type { HybridPlannerGateDecision, HybridPlannerGateReason } from "./hybrid-planner-consent";

export type HybridPlannerOutcomeCode =
  | HybridPlannerGateReason
  | "no_spans"
  | "overflow"
  | "package_overflow"
  | "binding_failed"
  | "submission_uncertain"
  | "provider_failed"
  | "invalid_output"
  | "stale_source"
  | "stale_binding"
  | "pending"
  | "completed";

export interface HybridPlannerTelemetry {
  contractVersion: typeof HYBRID_PLANNER_CONTRACT_VERSION;
  schemaVersion: typeof HYBRID_PLANNER_SCHEMA_VERSION;
  promptVersion: typeof HYBRID_PLANNER_PROMPT_VERSION;
  model: typeof HYBRID_PLANNER_MODEL;
  inputBytes: number;
  outputBytes: number;
  outputTokens: number;
  elapsedMs: number;
  postCount: 0 | 1;
  outcomeCode: HybridPlannerOutcomeCode;
}

export interface HybridPlannerTransportRequest {
  package: HybridPlannerPackage;
  seed: RequirementSpanSeed;
  background: boolean;
}

export type HybridPlannerTransportResult =
  | {
      status: "pending";
      responseId: string;
      providerStatus: "queued" | "in_progress";
      outputBytes: number;
      outputTokens: number;
    }
  | {
      status: "completed";
      responseId?: string;
      candidate: unknown;
      outputBytes: number;
      outputTokens: number;
    };

export interface HybridPlannerTransport {
  submit: (request: HybridPlannerTransportRequest) => Promise<HybridPlannerTransportResult>;
  retrieve: (responseId: string, request: HybridPlannerTransportRequest) => Promise<HybridPlannerTransportResult>;
}

export type HybridPlannerBindingCheck = (input: {
  phase: "submit" | "response";
  rebuiltInputHash: string;
  responseInputHash?: string;
}) => { disposition: "ready" | "legacy" | "fallback"; inputHash?: string };

export interface RunHybridPlannerAnalysisOptions {
  phase: "sync" | "background_submit" | "background_retrieve";
  responseId?: string;
  input: PullRequestInput;
  /** Re-fetches normalized PR and authoritative task source; never cached. */
  readCurrentInput: () => Promise<PullRequestInput | null>;
  readGate: () => Promise<HybridPlannerGateDecision>;
  bindBeforeSubmit?: (binding: {
    contractVersion: typeof HYBRID_PLANNER_CONTRACT_VERSION;
    inputHash: string;
  }) => Promise<boolean>;
  /** Durable uncertain-submit marker written after the final gate and before POST. */
  beforePost?: () => Promise<boolean>;
  checkBinding?: HybridPlannerBindingCheck;
  transport: HybridPlannerTransport;
  telemetry?: (value: HybridPlannerTelemetry) => void | Promise<void>;
  clock?: () => Date;
}

export type HybridPlannerAnalysisResult =
  | {
      status: "ready";
      report: VerificationReport;
      telemetry: HybridPlannerTelemetry;
      publicationSuppressed?: true;
    }
  | {
      status: "pending";
      responseId: string;
      providerStatus: "queued" | "in_progress";
      telemetry: HybridPlannerTelemetry;
    };

/**
 * Shared sync/background state machine for the pilot. It is intentionally
 * ignorant of repository-grant storage and job persistence; callers supply
 * fresh gate and binding callbacks at every phase.
 */
export async function runHybridPlannerAnalysis(
  options: RunHybridPlannerAnalysisOptions
): Promise<HybridPlannerAnalysisResult> {
  const startedAt = (options.clock ?? (() => new Date()))().getTime();
  let inputBytes = 0;
  let outputBytes = 0;
  let outputTokens = 0;
  let postCount: 0 | 1 = 0;

  const finish = async <T extends Omit<HybridPlannerAnalysisResult, "telemetry">>(
    value: T,
    outcomeCode: HybridPlannerOutcomeCode
  ): Promise<T & { telemetry: HybridPlannerTelemetry }> => {
    const telemetry: HybridPlannerTelemetry = {
      contractVersion: HYBRID_PLANNER_CONTRACT_VERSION,
      schemaVersion: HYBRID_PLANNER_SCHEMA_VERSION,
      promptVersion: HYBRID_PLANNER_PROMPT_VERSION,
      model: HYBRID_PLANNER_MODEL,
      inputBytes: boundedCount(inputBytes, HYBRID_PLANNER_MAX_INPUT_BYTES),
      outputBytes: boundedCount(outputBytes, HYBRID_PLANNER_MAX_OUTPUT_BYTES),
      outputTokens: boundedCount(outputTokens, HYBRID_PLANNER_MAX_OUTPUT_TOKENS),
      elapsedMs: boundedCount((options.clock ?? (() => new Date()))().getTime() - startedAt, 3_600_000),
      postCount,
      outcomeCode
    };
    await options.telemetry?.(telemetry);
    return { ...value, telemetry };
  };

  const firstGate = await options.readGate();
  if (!firstGate.enabled) {
    return finish({
      status: "ready",
      report: generateHybridFallbackReport(
        options.input,
        options.phase === "background_retrieve" ? "post_call_failure" : "disabled"
      )
    }, firstGate.reason);
  }

  const packageInput = await readCurrentInput(options);
  if (!packageInput) {
    return finish({
      status: "ready",
      report: generateHybridFallbackReport(options.input, "post_call_failure"),
      publicationSuppressed: true
    }, "stale_source");
  }
  const extracted = extractRequirementSpanSeed(
    packageInput.taskText,
    packageInput.description,
    packageInput.taskSource
  );
  if (extracted.overflow) {
    return finish({ status: "ready", report: generateHybridFallbackReport(options.input, "overflow") }, "overflow");
  }
  if (!extracted.eligible || !extracted.seed || !packageInput.sourceProvenance) {
    return finish({ status: "ready", report: generateHybridFallbackReport(packageInput, "no_spans") }, "no_spans");
  }

  const packageIdentity = selectedAuthorityIdentity(packageInput);
  if (!packageIdentity.valid) {
    return finish({
      status: "ready",
      report: generateHybridFallbackReport(packageInput, "post_call_failure"),
      publicationSuppressed: true
    }, "stale_source");
  }
  const seed = bindHybridPlannerSeedHash(
    extracted.seed,
    packageInput.sourceProvenance,
    packageIdentity.hash
  );
  if (!seed) {
    return finish({ status: "ready", report: generateHybridFallbackReport(packageInput, "post_call_failure") }, "binding_failed");
  }
  const plannerPackage = buildHybridPlannerPackage(
    seed,
    packageInput.sourceProvenance,
    packageIdentity.hash
  );
  if (!plannerPackage) {
    return finish({ status: "ready", report: generateHybridFallbackReport(options.input, "overflow") }, "package_overflow");
  }
  inputBytes = Buffer.byteLength(JSON.stringify(plannerPackage.input), "utf8");
  const request: HybridPlannerTransportRequest = {
    package: plannerPackage,
    seed,
    background: options.phase !== "sync"
  };

  if (options.phase === "background_submit") {
    const bound = await options.bindBeforeSubmit?.({
      contractVersion: HYBRID_PLANNER_CONTRACT_VERSION,
      inputHash: seed.seedHash
    });
    if (!bound || options.checkBinding?.({ phase: "submit", rebuiltInputHash: seed.seedHash }).disposition !== "ready") {
      return finish({ status: "ready", report: generateHybridFallbackReport(options.input, "post_call_failure") }, "binding_failed");
    }
  }

  if (options.phase === "background_retrieve") {
    if (!options.responseId || options.checkBinding?.({ phase: "submit", rebuiltInputHash: seed.seedHash }).disposition !== "ready") {
      return finish({ status: "ready", report: generateHybridFallbackReport(options.input, "post_call_failure") }, "stale_binding");
    }
  }

  const beforeProviderGate = await options.readGate();
  if (!beforeProviderGate.enabled) {
    return finish({
      status: "ready",
      report: generateHybridFallbackReport(
        options.input,
        options.phase === "sync" ? "disabled" : "post_call_failure"
      )
    }, beforeProviderGate.reason);
  }

  if (options.phase === "background_submit" && options.beforePost) {
    let marked = false;
    try {
      marked = await options.beforePost();
    } catch {
      marked = false;
    }
    if (!marked) {
      return finish({ status: "ready", report: generateHybridFallbackReport(options.input, "post_call_failure") }, "binding_failed");
    }
  }

  let providerResult: HybridPlannerTransportResult;
  try {
    if (options.phase === "background_retrieve") {
      providerResult = await options.transport.retrieve(options.responseId!, request);
    } else {
      postCount = 1;
      providerResult = await options.transport.submit(request);
    }
  } catch {
    return finish({ status: "ready", report: generateHybridFallbackReport(options.input, "post_call_failure") },
      postCount === 1 ? "submission_uncertain" : "provider_failed");
  }

  outputBytes = providerResult.outputBytes;
  outputTokens = providerResult.outputTokens;
  if (providerResult.status === "pending") {
    if (options.phase === "sync") {
      return finish({ status: "ready", report: generateHybridFallbackReport(options.input, "post_call_failure") }, "provider_failed");
    }
    return finish({
      status: "pending",
      responseId: providerResult.responseId,
      providerStatus: providerResult.providerStatus
    }, "pending");
  }

  const finalInput = await readCurrentInput(options);
  const current = finalInput ? currentSeed(finalInput) : null;
  if (!finalInput || !current || !sameSourceBinding(
    packageInput,
    finalInput
  ) || current.seed.seedHash !== seed.seedHash) {
    return finish({
      status: "ready",
      report: generateHybridFallbackReport(finalInput ?? packageInput, "post_call_failure"),
      publicationSuppressed: true
    }, "stale_source");
  }

  const responseHash = responseSeedHash(providerResult.candidate);
  if (options.phase === "background_retrieve") {
    const responseBinding = options.checkBinding?.({
      phase: "response",
      rebuiltInputHash: current.seed.seedHash,
      responseInputHash: responseHash
    });
    if (responseBinding?.disposition !== "ready") {
      return finish({ status: "ready", report: generateHybridFallbackReport(options.input, "post_call_failure") }, "stale_binding");
    }
  }

  const validation = validateHybridPlannerPlan(
    providerResult.candidate,
    current.seed,
    finalInput.sourceProvenance!,
    current.sourceIdentityHash
  );
  if (!validation.valid) {
    return finish({ status: "ready", report: generateHybridFallbackReport(options.input, "post_call_failure") }, "invalid_output");
  }
  if (options.phase === "background_retrieve" && options.checkBinding?.({
    phase: "response",
    rebuiltInputHash: current.seed.seedHash,
    responseInputHash: responseHash
  }).disposition !== "ready") {
    return finish({ status: "ready", report: generateHybridFallbackReport(options.input, "post_call_failure") }, "stale_binding");
  }
  const beforeFinalizeGate = await options.readGate();
  if (!beforeFinalizeGate.enabled) {
    return finish({
      status: "ready",
      report: generateHybridFallbackReport(
        finalInput,
        options.phase === "sync" ? "disabled" : "post_call_failure"
      )
    }, beforeFinalizeGate.reason);
  }
  const finalized = finalizeHybridVerificationReport({
    input: finalInput,
    seed: current.seed,
    provenance: finalInput.sourceProvenance!,
    requirementSourceIdentityHash: current.sourceIdentityHash,
    planValidation: validation
  });
  if (finalized.disposition !== "hybrid") {
    return finish({ status: "ready", report: finalized.report }, "invalid_output");
  }
  return finish({ status: "ready", report: finalized.report }, "completed");
}

async function readCurrentInput(options: RunHybridPlannerAnalysisOptions): Promise<PullRequestInput | null> {
  try {
    return await options.readCurrentInput();
  } catch {
    return null;
  }
}

function currentSeed(input: PullRequestInput): {
  seed: RequirementSpanSeed;
  sourceIdentityHash?: string;
} | null {
  if (!input.sourceProvenance) return null;
  const identity = selectedAuthorityIdentity(input);
  if (!identity.valid) return null;
  const extracted = extractRequirementSpanSeed(input.taskText, input.description, input.taskSource);
  if (extracted.overflow || !extracted.eligible || !extracted.seed) return null;
  const seed = bindHybridPlannerSeedHash(
    extracted.seed,
    input.sourceProvenance,
    identity.hash
  );
  return seed ? { seed, sourceIdentityHash: identity.hash } : null;
}

function sameSourceBinding(
  leftInput: PullRequestInput,
  rightInput: PullRequestInput
): boolean {
  const left = leftInput.sourceProvenance;
  const right = rightInput.sourceProvenance;
  const leftIdentity = selectedAuthorityIdentity(leftInput);
  const rightIdentity = selectedAuthorityIdentity(rightInput);
  return Boolean(left && right &&
    leftIdentity.valid && rightIdentity.valid &&
    leftIdentity.hash === rightIdentity.hash &&
    left.origin === right.origin &&
    left.headSha === right.headSha &&
    left.baseSha === right.baseSha);
}

function selectedAuthorityIdentity(input: PullRequestInput): {
  valid: boolean;
  hash?: string;
} {
  const hash = input.requirementSourceIdentityHash;
  if (hash === undefined) {
    return { valid: input.sourceProvenance?.origin !== "github_snapshot" };
  }
  return typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)
    ? { valid: true, hash }
    : { valid: false };
}

function responseSeedHash(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const hash = (value as { seed_hash?: unknown }).seed_hash;
  return typeof hash === "string" ? hash : undefined;
}

function boundedCount(value: number, maximum: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(maximum, Math.round(value));
}
