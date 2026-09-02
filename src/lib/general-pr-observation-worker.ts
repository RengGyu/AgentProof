import {
  runGeneralPrSemanticObserverV2,
  type GeneralPrSemanticObserverModelProfileV2,
  type GeneralPrSemanticObserverProviderV3,
  type GeneralPrSemanticObserverRunResultV3
} from "./general-pr-semantic-observer";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import {
  buildGeneralPrSemanticAggregateDiagnosticsV1,
  finalizeDeterministicGeneralPrObservationsV2,
  type GeneralPrObservationBundleV2,
  type GeneralPrSemanticProviderCallCountV1
} from "./general-pr-observation-service";
import type { PullRequestInput } from "./types";

const DEFAULT_MODEL_PROFILE: GeneralPrSemanticObserverModelProfileV2 = {
  model: "deployment-unconfigured",
  promptVersion: "general-pr-observer.v3",
  inputFieldPolicyVersion: "general-pr-observer-fields.v1"
};

/**
 * This record is intentionally JSON-serializable, so an existing durable
 * worker can own persistence without putting source text or a proposal in a
 * job row. One attempt is the first-release retry ceiling.
 */
export interface QueuedGeneralPrObservationV2 {
  version: 2;
  seedHash: string;
  attempt: 0 | 1;
  status: "pending" | "completed" | "stale" | "exhausted";
}

export interface AdvanceQueuedGeneralPrObservationOptionsV2 {
  mode: "disabled" | "shadow" | "advisory";
  input: PullRequestInput;
  current: QueuedGeneralPrObservationV2;
  provider?: GeneralPrSemanticObserverProviderV3;
  providerAvailable: boolean;
  privateRepository?: boolean;
  privateRepositoryConsent?: boolean;
  providerRetentionApproved?: boolean;
  readCurrentInput: () => Promise<PullRequestInput | null>;
  modelProfile?: GeneralPrSemanticObserverModelProfileV2;
}

export type AdvanceQueuedGeneralPrObservationResultV2 = {
  status: "completed" | "stale" | "terminal";
  current: QueuedGeneralPrObservationV2;
  bundle: GeneralPrObservationBundleV2 | null;
  /** Null means no observer invocation occurred; never synthesize a receipt. */
  semantic: GeneralPrSemanticObserverRunResultV3 | null;
};

/**
 * A pure, serializable worker adapter. It does not persist its return value:
 * the calling job system must fence and store `current` itself. The adapter
 * only accepts a response for the exact seed it was queued with.
 */
export async function advanceQueuedGeneralPrObservationV2(
  options: AdvanceQueuedGeneralPrObservationOptionsV2
): Promise<AdvanceQueuedGeneralPrObservationResultV2> {
  if (options.current.status !== "pending" || options.current.attempt !== 0) {
    return { status: "terminal", current: options.current, bundle: null, semantic: null };
  }

  // Default-off must mean no seed construction and no provider invocation.
  // A disabled rollout cannot leave an observation artifact behind.
  if (options.mode === "disabled") {
    return {
      status: "completed",
      current: { ...options.current, attempt: 1, status: "completed" },
      bundle: null,
      semantic: null
    };
  }

  const seed = buildGeneralPrObservationSeedV2(options.input);
  if (seed.seedHash !== options.current.seedHash || seed.parseState !== "complete") {
    return {
      status: "stale",
      current: { ...options.current, attempt: 1, status: "stale" },
      bundle: null,
      semantic: null
    };
  }

  let providerCallCount: GeneralPrSemanticProviderCallCountV1 = 0;
  const configuredProvider = options.provider;
  const semantic = await runGeneralPrSemanticObserverV2({
    mode: options.mode,
    input: options.input,
    seed,
    provider: configuredProvider ? {
      observe: (request) => {
        providerCallCount = providerCallCount === 0 ? 1 : providerCallCount === 1 ? 2 : "3_plus";
        return configuredProvider.observe(request);
      }
    } : undefined,
    providerAvailable: options.providerAvailable,
    privateRepository: options.privateRepository,
    privateRepositoryConsent: options.privateRepositoryConsent,
    providerRetentionApproved: options.providerRetentionApproved,
    readCurrentInput: options.readCurrentInput,
    modelProfile: options.modelProfile ?? DEFAULT_MODEL_PROFILE
  });
  if (semantic.state === "stale") {
    return {
      status: "stale",
      current: { ...options.current, attempt: 1, status: "stale" },
      bundle: null,
      semantic
    };
  }

  const aggregate = buildGeneralPrSemanticAggregateDiagnosticsV1(semantic, providerCallCount);

  return {
    status: "completed",
    current: { ...options.current, attempt: 1, status: "completed" },
    bundle: finalizeDeterministicGeneralPrObservationsV2(
      seed,
      semantic.proposal,
      semantic.state,
      semantic.semanticFailureStage,
      semantic.semanticPackageFailureReasons,
      aggregate.stageDiagnostics,
      aggregate.omittedReasonCounts
    ),
    semantic
  };
}
