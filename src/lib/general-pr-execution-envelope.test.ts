import { describe, expect, it } from "vitest";
import {
  assessGeneralPrExecutionEnvelopeV2,
  buildGeneralPrExecutionEnvelopeV2,
  deriveGeneralPrSubjectContextDigestV2
} from "./general-pr-execution-envelope";

const sha = (value: string) => value.repeat(40).slice(0, 40);

function completeInput() {
  const baseSha = sha("b");
  const headSha = sha("a");
  const subjectSha = sha("c");
  return {
    repositoryIdentityHash: "d".repeat(64),
    prNumber: 42,
    subjectKind: "test_merge" as const,
    subjectSha,
    baseSha,
    headSha,
    subjectParents: [baseSha, headSha],
    workflowPath: ".github/workflows/ci.yml",
    workflowRef: "refs/pull/42/merge",
    workflowBlobDigest: "e".repeat(64),
    workflowBlobSourceSha: subjectSha,
    runId: "100",
    runAttempt: 2,
    jobId: "200",
    producerAppId: "4138178",
    event: "pull_request" as const,
    jobPaginationComplete: true,
    collectionComplete: true,
    resultStatus: "passed" as const
  };
}

describe("GeneralPrExecutionEnvelopeV2", () => {
  it("creates a complete envelope only for a full immutable workflow and subject tuple", () => {
    const input = completeInput();
    const result = buildGeneralPrExecutionEnvelopeV2(input);

    expect(result.envelope).toMatchObject({ completeness: "complete", subjectKind: "test_merge", runAttempt: 2 });
    expect(result.envelope.subjectContextDigest).toBe(deriveGeneralPrSubjectContextDigestV2("test_merge", input.subjectParents));
    expect(JSON.stringify(result.envelope)).not.toContain(".github/workflows/ci.yml");
    expect(assessGeneralPrExecutionEnvelopeV2(result.envelope, input.resultStatus)).toBe("reported_pass");
  });

  it("downgrades missing identity, paginated jobs, stale heads, workflow blobs, and unsupported events to incomplete observation", () => {
    const base = completeInput();
    const cases = [
      { ...base, jobId: null },
      { ...base, jobPaginationComplete: false },
      { ...base, workflowBlobSourceSha: base.headSha },
      { ...base, event: "push" as const },
      { ...base, subjectParents: [base.headSha!, base.baseSha!] }
    ];

    for (const candidate of cases) {
      const result = buildGeneralPrExecutionEnvelopeV2(candidate);
      expect(result.envelope.completeness).toBe("incomplete");
      expect(assessGeneralPrExecutionEnvelopeV2(result.envelope, "passed")).toBe("reported_pass");
    }
  });

  it("keeps head, test-merge, and merge-group subject context distinct", () => {
    const parentA = sha("a");
    const parentB = sha("b");

    expect(deriveGeneralPrSubjectContextDigestV2("head", [parentA])).not.toBe(deriveGeneralPrSubjectContextDigestV2("test_merge", [parentA, parentB]));
    expect(deriveGeneralPrSubjectContextDigestV2("test_merge", [parentA, parentB])).not.toBe(deriveGeneralPrSubjectContextDigestV2("merge_group", [parentA, parentB]));
  });

  it("never treats display names, generic success, or a PR-controlled attestation as command or verified test proof", () => {
    const result = buildGeneralPrExecutionEnvelopeV2({
      ...completeInput(),
      jobDisplayName: "Run pnpm test",
      attestation: {
        predicateType: "https://slsa.dev/provenance/v1",
        bundleDigest: "f".repeat(64),
        signingIdentityDigest: "1".repeat(64),
        reporterActionDigest: "2".repeat(64),
        nativeReportDigest: "3".repeat(64),
        completeness: "complete" as const
      }
    });

    expect(result.envelope.attestation?.completeness).toBe("incomplete");
    expect(JSON.stringify(result.envelope)).not.toContain("Run pnpm test");
    expect(assessGeneralPrExecutionEnvelopeV2(result.envelope, "passed")).toBe("reported_pass");
  });
});
