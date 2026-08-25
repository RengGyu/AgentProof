import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decodeSharedReport, encodeReportForShare } from "./report-share";
import { prepareTenantDetailReportForStorage } from "./server-report-store";
import { projectTenantPersistedReport, validateTenantPersistedReport } from "./tenant-report-validation";
import {
  MAX_RELEASE_CANDIDATE_INPUT_BYTES,
  countSerializedProjectionLeaksV1,
  parseReleaseCandidateCorpusV1,
  runReleaseCandidateCorpusV1,
  type ReleaseCandidateCorpusV1
} from "./release-evaluation-runner";
import type { PullRequestInput } from "./types";
import * as verifier from "./verifier";

describe("release evaluation candidate runner", () => {
  it("runs a receipt-complete case through generated-private validation and emits opaque IDs", () => {
    const result = runReleaseCandidateCorpusV1(receiptCompleteDevelopmentCorpus());

    expect(result.cases).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("repositoryName");
    expect(result.cases[0]!.actual.requirements[0]!.testReceiptIds).toHaveLength(1);
    expect(result.cases[0]!.actual.requirements[0]!.executionReceiptIds).toHaveLength(1);
  });

  it("runs receipt-complete evaluation without mutating ambient promotion or signing state", () => {
    const promotionKey = "AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE";
    const signingKey = "AGENTPROOF_REPORT_SIGNING_SECRET";
    const originalEnv = process.env;
    const previousPromotion = originalEnv[promotionKey];
    const previousSigning = originalEnv[signingKey];
    originalEnv[promotionKey] = "off";
    originalEnv[signingKey] = "ambient-signing-sentinel";
    const mutations: string[] = [];
    process.env = new Proxy(originalEnv, {
      set(target, property, value) {
        if (property === promotionKey || property === signingKey) mutations.push(`set:${String(property)}`);
        return Reflect.set(target, property, value);
      },
      deleteProperty(target, property) {
        if (property === promotionKey || property === signingKey) mutations.push(`delete:${String(property)}`);
        return Reflect.deleteProperty(target, property);
      }
    });

    try {
      const result = runReleaseCandidateCorpusV1(receiptCompleteDevelopmentCorpus());

      expect(result.cases[0]!.actual.requirements[0]!.testReceiptIds).toHaveLength(1);
      expect(result.cases[0]!.actual.requirements[0]!.executionReceiptIds).toHaveLength(1);
      expect(process.env[promotionKey]).toBe("off");
      expect(process.env[signingKey]).toBe("ambient-signing-sentinel");
      expect(mutations).toEqual([]);
    } finally {
      process.env = originalEnv;
      restoreEnv(promotionKey, previousPromotion);
      restoreEnv(signingKey, previousSigning);
    }
  });

  it("prepares a valid private-free tenant projection with an explicit signing secret", () => {
    const signingKey = "AGENTPROOF_REPORT_SIGNING_SECRET";
    const previousSigning = process.env[signingKey];
    delete process.env[signingKey];
    const signingSecret = "explicit-projection-secret-that-is-long-enough";

    try {
      const report = verifier.generateVerificationReportV2FromInput(exactHeadInput());
      const tenantReport = prepareTenantDetailReportForStorage(report, "verified_agentproof", signingSecret);
      const tenantProjection = projectTenantPersistedReport(tenantReport, signingSecret);

      expect(validateTenantPersistedReport(tenantProjection, signingSecret)).toEqual({ valid: true, errors: [] });
      const serialized = JSON.stringify(tenantProjection);
      expect(serialized).not.toContain("privateReceiptBundleV2");
      expect(serialized).not.toContain("testRelationReceipts");
      expect(serialized).not.toContain("executionBindingReceipts");
    } finally {
      restoreEnv(signingKey, previousSigning);
    }
  });

  it("downgrades a receipt-less local positive rather than emitting a positive candidate axis", () => {
    const result = runReleaseCandidateCorpusV1(receiptlessDevelopmentCorpus());

    expect(result.cases[0]!.actual.requirements[0]!.axisStates.targeted_test).toBe("incomplete");
  });

  it("fails closed for duplicate case IDs, unknown payload keys, and invalid requirement ordinals", () => {
    expect(parseReleaseCandidateCorpusV1(duplicateCasePayload())).toBeNull();
    expect(parseReleaseCandidateCorpusV1(payloadWithUnknownKey())).toBeNull();
    expect(parseReleaseCandidateCorpusV1(payloadWithInvalidOrdinal())).toBeNull();
  });

  it("counts private material in real share and tenant projections without retaining it in output", () => {
    const result = runReleaseCandidateCorpusV1(receiptCompleteDevelopmentCorpus());

    expect(result.cases[0]!.actual.projection.privateReceiptLeakCount).toBe(0);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("privateReceiptBundleV2");
    expect(serialized).not.toContain("testRelationReceipts");
    expect(serialized).not.toContain("executionBindingReceipts");
  });

  it("allocates opaque receipt handles uniquely across every requirement in the run", () => {
    const first = receiptCompleteDevelopmentCorpus().cases[0]!;
    const result = runReleaseCandidateCorpusV1({
      version: 1,
      cases: [first, { ...first, caseId: "opaque-receipt-complete-2" }]
    });
    const handles = result.cases.flatMap((candidate) => candidate.actual.requirements.flatMap((requirement) => [
      ...requirement.testReceiptIds,
      ...requirement.executionReceiptIds
    ]));

    expect(handles).toHaveLength(4);
    expect(new Set(handles).size).toBe(handles.length);
    expect(handles.every((handle) => /^[A-Za-z0-9_-]{8,}$/.test(handle))).toBe(true);
    expect(handles.every((handle) => !handle.includes("opaque-receipt-complete") && !handle.includes("repositoryName"))).toBe(true);
  });

  it("rejects a replay input beyond the concrete UTF-8 byte limit", () => {
    const corpus = receiptCompleteDevelopmentCorpus();
    corpus.cases[0]!.input.taskText = "x".repeat(MAX_RELEASE_CANDIDATE_INPUT_BYTES);

    expect(parseReleaseCandidateCorpusV1(corpus)).toBeNull();
  });

  it("counts closed-contract, unknown-key, and private-handle projection violations", () => {
    const report = verifier.generateVerificationReportV2FromInput(exactHeadInput());
    const signingSecret = "projection-test-secret-that-is-long-enough";
    const sharePayload = encodeReportForShare(report);
    const previousSigningSecret = process.env.AGENTPROOF_REPORT_SIGNING_SECRET;
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = signingSecret;
    let tenantJson: string;
    try {
      const tenantReport = prepareTenantDetailReportForStorage(report, "verified_agentproof");
      tenantJson = JSON.stringify(projectTenantPersistedReport(tenantReport, signingSecret));
    } finally {
      if (previousSigningSecret === undefined) delete process.env.AGENTPROOF_REPORT_SIGNING_SECRET;
      else process.env.AGENTPROOF_REPORT_SIGNING_SECRET = previousSigningSecret;
    }

    expect(() => decodeSharedReport(sharePayload)).not.toThrow();
    expect(validateTenantPersistedReport(JSON.parse(tenantJson), signingSecret)).toEqual({ valid: true, errors: [] });
    expect(countSerializedProjectionLeaksV1(sharePayload, tenantJson, signingSecret, new Set())).toBe(0);

    const shareWithUnknownKey = mutateSharePayload(sharePayload, (share) => { share.harmless = true; });
    expect(countSerializedProjectionLeaksV1(shareWithUnknownKey, tenantJson, signingSecret, new Set())).toBeGreaterThan(0);

    const privateHandle = "private-receipt-handle";
    const shareWithPrivateHandle = mutateSharePayload(sharePayload, (share) => {
      (share.source as Record<string, unknown>).title = `embedded:${privateHandle}:value`;
    });
    expect(countSerializedProjectionLeaksV1(shareWithPrivateHandle, tenantJson, signingSecret, new Set([privateHandle]))).toBeGreaterThan(0);

    const tenantWithUnknownKey = { ...JSON.parse(tenantJson), harmless: true };
    expect(countSerializedProjectionLeaksV1(sharePayload, JSON.stringify(tenantWithUnknownKey), signingSecret, new Set())).toBeGreaterThan(0);
  });

  it("emits an opaque incomplete case, preserves mode, and continues after one generation failure", () => {
    const previousMode = process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE;
    process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE = "sentinel-mode";
    const original = verifier.generateVerificationReportV2FromInput;
    const generation = vi.spyOn(verifier, "generateVerificationReportV2FromInput").mockImplementation((input, options) => {
      if (options?.requirementLocalPromotionMode === "receipt_v2" && input.title === "generated-private failure") {
        throw new Error("raw private generation error");
      }
      return original(input, options);
    });
    const first = receiptCompleteDevelopmentCorpus().cases[0]!;
    const failing = { ...first, caseId: "opaque-failed", input: { ...first.input, title: "generated-private failure" } };
    const ordinary = { ...first, caseId: "opaque-ordinary" };

    try {
      const result = runReleaseCandidateCorpusV1({ version: 1, cases: [failing, ordinary] });

      expect(result.cases).toHaveLength(2);
      expect(result.cases[0]).toMatchObject({
        version: 1,
        caseId: "opaque-failed",
        actual: {
          sourceKind: "unknown",
          authority: "unknown",
          requirements: [{
            stableOracleId: "case:opaque-failed:ordinal:0",
            ordinal: 0,
            axisStates: { implementation: "incomplete", targeted_test: "incomplete", execution: "incomplete" },
            testReceiptIds: [],
            executionReceiptIds: [],
            localCiAssociation: "unknown",
            outcome: "unclear"
          }],
          projection: { privateReceiptLeakCount: 1 }
        },
        metrics: { unexpectedFailure: true }
      });
      expect(JSON.stringify(result.cases[0])).not.toContain("raw private generation error");
      expect(result.cases[1]!.metrics.unexpectedFailure).toBe(false);
      expect(process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE).toBe("sentinel-mode");
    } finally {
      generation.mockRestore();
      if (previousMode === undefined) delete process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE;
      else process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE = previousMode;
    }
  });
});

function mutateSharePayload(payload: string, mutate: (share: Record<string, unknown>) => void): string {
  const share = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  mutate(share);
  return Buffer.from(JSON.stringify(share), "utf8").toString("base64url");
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function receiptCompleteDevelopmentCorpus(): ReleaseCandidateCorpusV1 {
  return {
    version: 1,
    cases: [{ version: 1, caseId: "opaque-receipt-complete", input: exactHeadInput(), requirementOrdinals: [0] }]
  };
}

function receiptlessDevelopmentCorpus(): ReleaseCandidateCorpusV1 {
  const input = exactHeadInput();
  input.resolvedHeadModules = [];
  return {
    version: 1,
    cases: [{ version: 1, caseId: "opaque-receiptless", input, requirementOrdinals: [0] }]
  };
}

function duplicateCasePayload(): unknown {
  const corpus = receiptCompleteDevelopmentCorpus();
  return { ...corpus, cases: [corpus.cases[0], corpus.cases[0]] };
}

function payloadWithUnknownKey(): unknown {
  return { ...receiptCompleteDevelopmentCorpus(), extra: true };
}

function payloadWithInvalidOrdinal(): unknown {
  const corpus = receiptCompleteDevelopmentCorpus();
  return { ...corpus, cases: [{ ...corpus.cases[0], requirementOrdinals: [99] }] };
}

function exactHeadInput(): PullRequestInput {
  const headSha = "a".repeat(40);
  const source = "export function repositoryName(value) { return String(value).toLowerCase(); }";
  const testPath = "test/repository-name.test.js";
  return {
    title: "Add repository name regression coverage",
    description: "",
    taskText: "Acceptance criteria: add a regression test for repositoryName(value) formatting.",
    taskSource: "issue",
    changedFiles: [{
      path: testPath,
      status: "added",
      patch: [
        "+import { repositoryName } from '../src/repositories/name.js';",
        "+test('formats names', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });"
      ].join("\n")
    }],
    checks: [{ name: "unit-tests", status: "passed", summary: "Unit tests passed." }],
    logs: [{ source: "GitHub Actions job: unit-tests", status: "passed", text: "npm test passed." }],
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha,
      baseSha: "b".repeat(40),
      changedFileInventory: { version: 1, completeness: "complete", headSha },
      evidenceCapturedAt: "2026-08-19T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
    },
    executionSuites: [{
      headSha,
      status: "passed",
      executionSource: "GitHub Actions job: unit-tests",
      runner: "node_test",
      scope: "repository_discovery",
      testPaths: [testPath]
    }],
    resolvedHeadModules: [{
      version: 1,
      kind: "resolved_head_module",
      headSha,
      path: "src/repositories/name.js",
      blobSha: createHash("sha1").update(`blob ${Buffer.byteLength(source, "utf8")}\0`).update(source).digest("hex"),
      source
    }]
  };
}
