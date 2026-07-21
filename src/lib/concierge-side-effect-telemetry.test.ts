import { describe, expect, it } from "vitest";
import { createConciergeSideEffectTelemetry, validateZeroConciergeSideEffectTelemetry } from "./concierge-side-effect-telemetry";

const binding = { caseIdOrHash: "a".repeat(64), sourceHeadSha: "b".repeat(40) };

describe("Concierge side-effect telemetry", () => {
  it("creates an exact zero-count response-only telemetry record", () => {
    const telemetry = createConciergeSideEffectTelemetry(binding).snapshot();
    expect(validateZeroConciergeSideEffectTelemetry(telemetry, binding)).toBe(true);
    expect(JSON.stringify(telemetry)).not.toMatch(/token|diff|report|prompt|log/i);
  });

  it("fails closed on missing, extra, mismatched, or nonzero counter fields", () => {
    const telemetry = createConciergeSideEffectTelemetry(binding).snapshot();
    expect(validateZeroConciergeSideEffectTelemetry({ ...telemetry, counts: { ...telemetry.counts, llm: 1 } }, binding)).toBe(false);
    expect(validateZeroConciergeSideEffectTelemetry({ ...telemetry, sourceHeadSha: "c".repeat(40) }, binding)).toBe(false);
    expect(validateZeroConciergeSideEffectTelemetry({ ...telemetry, counts: { ...telemetry.counts, rawEvidence: "diff --git" } }, binding)).toBe(false);
    expect(validateZeroConciergeSideEffectTelemetry({ ...telemetry, safe: true }, binding)).toBe(false);
  });

  it("records a forbidden attempt so a response cannot pass the zero-call gate", () => {
    const recorder = createConciergeSideEffectTelemetry(binding);
    recorder.recordAttempt("comment");
    expect(validateZeroConciergeSideEffectTelemetry(recorder.snapshot(), binding)).toBe(false);
  });
});
