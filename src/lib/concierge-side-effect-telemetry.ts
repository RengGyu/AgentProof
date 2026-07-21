const CHANNELS = ["llm", "comment", "slack", "share", "save", "webhook"] as const;
const TELEMETRY_KEYS = ["caseIdOrHash", "counts", "observation", "sourceHeadSha", "version"] as const;

export type ConciergeSideEffectChannel = typeof CHANNELS[number];
export interface ConciergeSideEffectTelemetryV1 {
  version: "concierge-side-effect-telemetry.v1";
  caseIdOrHash: string;
  sourceHeadSha: string;
  observation: "runtime_instrumented";
  counts: Record<ConciergeSideEffectChannel, number>;
}

export interface ConciergeSideEffectTelemetryRecorder {
  recordAttempt(channel: ConciergeSideEffectChannel): void;
  snapshot(): ConciergeSideEffectTelemetryV1;
}

/**
 * This recorder is request-local and response-only. It carries no task, code,
 * report, token, URL, or evidence text. Any future Concierge optional-effect
 * boundary must call recordAttempt before dispatching; nonzero counts are a
 * delivery failure, never a successful Concierge response.
 */
export function createConciergeSideEffectTelemetry(input: { caseIdOrHash: string; sourceHeadSha: string }): ConciergeSideEffectTelemetryRecorder {
  if (!isHash(input.caseIdOrHash, 64) || !isHash(input.sourceHeadSha, 40)) throw new Error("Invalid Concierge telemetry binding.");
  const counts: Record<ConciergeSideEffectChannel, number> = { llm: 0, comment: 0, slack: 0, share: 0, save: 0, webhook: 0 };
  return {
    recordAttempt(channel) { counts[channel] += 1; },
    snapshot() {
      return {
        version: "concierge-side-effect-telemetry.v1",
        caseIdOrHash: input.caseIdOrHash,
        sourceHeadSha: input.sourceHeadSha,
        observation: "runtime_instrumented",
        counts: { ...counts }
      };
    }
  };
}

export function validateZeroConciergeSideEffectTelemetry(
  value: unknown,
  expected: { caseIdOrHash: string; sourceHeadSha: string }
): value is ConciergeSideEffectTelemetryV1 {
  if (!isExactRecord(value, TELEMETRY_KEYS)) return false;
  const telemetry = value as unknown as ConciergeSideEffectTelemetryV1;
  if (telemetry.version !== "concierge-side-effect-telemetry.v1"
    || telemetry.observation !== "runtime_instrumented"
    || telemetry.caseIdOrHash !== expected.caseIdOrHash
    || telemetry.sourceHeadSha !== expected.sourceHeadSha
    || !isExactRecord(telemetry.counts, CHANNELS)) return false;
  return CHANNELS.every((channel) => telemetry.counts[channel] === 0);
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).sort().join("\0") === keys.slice().sort().join("\0");
}

function isHash(value: unknown, length: number) {
  return typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
}
