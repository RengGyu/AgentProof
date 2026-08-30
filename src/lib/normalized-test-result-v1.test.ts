import { describe, expect, it } from "vitest";
import { parseAgentProofNormalizedTestResultV1 } from "./normalized-test-result-v1";

const subject = "a".repeat(64);

function validJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    subjectDigest: subject,
    declaredTestCount: 2,
    tests: [
      { id: "unit/one", outcome: "passed" },
      { id: "unit/two", outcome: "failed" }
    ],
    ...overrides
  });
}

describe("AgentProofNormalizedTestResultV1", () => {
  it("parses only a direct UTF-8 JSON value and returns observed rows", () => {
    const result = parseAgentProofNormalizedTestResultV1(validJson(), { expectedSubjectDigest: subject, mimeType: "application/json" });

    expect(result).toMatchObject({ valid: true, manifest: { declaredTestCount: 2, observationLevel: "observed" } });
  });

  it("rejects inputs above limits before normalization", () => {
    const tooLarge = new Uint8Array(4_194_305);
    const tooDeep = JSON.stringify({ version: 1, subjectDigest: subject, declaredTestCount: 0, tests: [], extra: Array.from({ length: 13 }, (_, index) => index).reduceRight<unknown>((child) => ({ child }), null) });
    const tooMany = validJson({ declaredTestCount: 10_001, tests: Array.from({ length: 10_001 }, (_, index) => ({ id: `t-${index}`, outcome: "passed" })) });

    expect(parseAgentProofNormalizedTestResultV1(tooLarge, { expectedSubjectDigest: subject })).toMatchObject({ valid: false });
    expect(parseAgentProofNormalizedTestResultV1(tooDeep, { expectedSubjectDigest: subject })).toMatchObject({ valid: false });
    expect(parseAgentProofNormalizedTestResultV1(tooMany, { expectedSubjectDigest: subject })).toMatchObject({ valid: false });
  });

  it("rejects unknown keys, duplicate IDs, invalid outcomes, subject mismatch, and count mismatch", () => {
    expect(parseAgentProofNormalizedTestResultV1(validJson({ unexpected: true }), { expectedSubjectDigest: subject })).toMatchObject({ valid: false });
    expect(parseAgentProofNormalizedTestResultV1(validJson({ tests: [{ id: "same", outcome: "passed" }, { id: "same", outcome: "failed" }] }), { expectedSubjectDigest: subject })).toMatchObject({ valid: false });
    expect(parseAgentProofNormalizedTestResultV1(validJson({ tests: [{ id: "one", outcome: "unknown" }, { id: "two", outcome: "passed" }] }), { expectedSubjectDigest: subject })).toMatchObject({ valid: false });
    expect(parseAgentProofNormalizedTestResultV1(validJson({ subjectDigest: "b".repeat(64) }), { expectedSubjectDigest: subject })).toMatchObject({ valid: false });
    expect(parseAgentProofNormalizedTestResultV1(validJson({ declaredTestCount: 1 }), { expectedSubjectDigest: subject })).toMatchObject({ valid: false });
  });

  it("rejects archives, paths, URLs, non-JSON MIME, and executable declarations without performing I/O", () => {
    for (const value of [
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      new Uint8Array([0x1f, 0x8b, 0x08]),
      "https://example.test/result.json",
      "/tmp/result.json",
      "result.exe"
    ]) {
      expect(parseAgentProofNormalizedTestResultV1(value, { expectedSubjectDigest: subject })).toMatchObject({ valid: false });
    }
    expect(parseAgentProofNormalizedTestResultV1(validJson(), { expectedSubjectDigest: subject, mimeType: "application/zip" })).toMatchObject({ valid: false });
  });
});
