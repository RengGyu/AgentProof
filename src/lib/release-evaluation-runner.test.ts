import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { decodeSharedReport, encodeReportForShare } from "./report-share";
import { prepareTenantDetailReportForStorage } from "./server-report-store";
import { projectTenantPersistedReport, validateTenantPersistedReport } from "./tenant-report-validation";
import {
  MAX_RELEASE_CANDIDATE_INPUT_BYTES,
  countSerializedProjectionLeaksV1,
  parseReleaseCandidateCorpusV2,
  parseReleaseCandidateCorpusV1,
  runReleaseCandidateCorpusV2,
  runReleaseCandidateCorpusV1,
  type ReleaseCandidateCorpusV1
} from "./release-evaluation-runner";
import type { PullRequestInput } from "./types";
import * as verifier from "./verifier";

describe("release evaluation candidate runner", () => {
  it("projects every contract objective and criterion without authored ordinals", () => {
    const result = runReleaseCandidateCorpusV2(staticCapabilityV2Corpus());

    expect(result).toMatchObject({ version: 2, cases: [{ version: 2 }] });
    expect(result.cases[0]!.actual.objectives.map((item) => item.requirementId)).toEqual(["vc_o1", "vc_o2", "vc_o3"]);
    expect(result.cases[0]!.actual.objectives.flatMap((item) => item.criteria.map((criterion) => criterion.criterionId)))
      .toEqual(["vc_o1_c1", "vc_o2_c1", "vc_o3_c1"]);
  });

  it("keeps deferred criteria unavailable and exposes only opaque receipt handles", () => {
    const result = runReleaseCandidateCorpusV2(staticCapabilityV2Corpus());
    const actual = result.cases[0]!.actual;

    expect(actual.objectives[2]!.criteria[0]).toMatchObject({ capability: "test_case", state: "unavailable" });
    expect(actual.receipts.every((receipt) => /^receipt_[0-9a-z]{8}$/.test(receipt.id))).toBe(true);
    expect(JSON.stringify(actual)).not.toContain("repositoryName");
  });

  it("preserves criterion ownership and derives no local-CI result from observations", () => {
    const actual = runReleaseCandidateCorpusV2(staticCapabilityV2Corpus()).cases[0]!.actual;
    const criteria = new Map(actual.objectives.flatMap((objective) => objective.criteria.map((criterion) => [criterion.criterionId, criterion])));

    for (const axis of actual.axes) {
      if (axis.role === "observation") expect(axis.criterionId).toBeUndefined();
      else {
        const criterion = criteria.get(axis.criterionId!);
        expect(criterion).toBeDefined();
        expect(criterion!.requiredEvidence).toContain(axis.subject);
      }
    }
    expect(actual.criterionLocalCi).toEqual([]);
  });

  it("returns an opaque bounded failure when V2 report generation fails", () => {
    const original = verifier.generateVerificationReportV2FromInput;
    const generation = vi.spyOn(verifier, "generateVerificationReportV2FromInput").mockImplementation((input, options) => {
      if (options?.requirementLocalPromotionMode === "receipt_v2" && input.title === "v2 generation failure") throw new Error("private failure detail");
      return original(input, options);
    });
    const corpus = staticCapabilityV2Corpus();
    corpus.cases[0]!.input = { ...corpus.cases[0]!.input, title: "v2 generation failure" };

    try {
      const result = runReleaseCandidateCorpusV2(corpus);
      expect(result.cases[0]!.metrics).toMatchObject({ unexpectedFailure: true, failureStage: "report_generation" });
      expect(result.cases[0]!.actual).toMatchObject({ objectives: [], projection: { privateReceiptLeakCount: 1 } });
      expect(JSON.stringify(result)).not.toContain("private failure detail");
    } finally {
      generation.mockRestore();
    }
  });

  it("rejects closed V2 envelopes with authored expectations, ordinals, duplicates, unknown keys, or inactive contracts", () => {
    const corpus = staticCapabilityV2Corpus();
    expect(parseReleaseCandidateCorpusV2({ ...corpus, expected: {} })).toBeNull();
    expect(parseReleaseCandidateCorpusV2({ ...corpus, cases: [{ ...corpus.cases[0], requirementOrdinals: [0] }] })).toBeNull();
    expect(parseReleaseCandidateCorpusV2({ ...corpus, cases: [corpus.cases[0], corpus.cases[0]] })).toBeNull();
    expect(parseReleaseCandidateCorpusV2({ ...corpus, extra: true })).toBeNull();
    expect(parseReleaseCandidateCorpusV2({ ...corpus, cases: [{ ...corpus.cases[0], input: { ...corpus.cases[0]!.input, verificationContractSourceV2: undefined } }] })).toBeNull();
    expect(parseReleaseCandidateCorpusV2({ ...corpus, cases: [{ ...corpus.cases[0], input: { ...corpus.cases[0]!.input, verificationContractSourceV2: { ...corpus.cases[0]!.input.verificationContractSourceV2!, extra: true } } }] })).toBeNull();
    expect(parseReleaseCandidateCorpusV2({ ...corpus, cases: [{ ...corpus.cases[0], input: { ...corpus.cases[0]!.input, verificationContractBindingV2: { ...corpus.cases[0]!.input.verificationContractBindingV2!, headSha: "not-a-sha" } } }] })).toBeNull();
  });

  it("rejects V2 nested authored data, unknown fields, oversized values, and malformed evidence", () => {
    const corpus = staticCapabilityV2Corpus();
    const input = corpus.cases[0]!.input;
    const withInput = (next: object) => ({ ...corpus, cases: [{ ...corpus.cases[0], input: { ...input, ...next } }] });

    expect(parseReleaseCandidateCorpusV2(withInput({ expected: {} }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ requirementOrdinals: [0] }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ arbitrary: true }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ taskText: "x".repeat(8_001) }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ changedFiles: Array.from({ length: 121 }, () => input.changedFiles[0]) }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ changedFiles: [{ ...input.changedFiles[0], arbitrary: true }] }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ changedFiles: [{ ...input.changedFiles[0], path: 1 }] }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ sourceProvenance: { ...input.sourceProvenance!, inputFingerprint: { ...input.sourceProvenance!.inputFingerprint, value: "not-a-digest" } } }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ verificationCriterionEvidenceV2: { artifactBlobs: [{ ...input.verificationCriterionEvidenceV2!.artifactBlobs[0], content: "x".repeat(65_537) }] } }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ verificationCriterionEvidenceV2: { artifactBlobs: [{ ...input.verificationCriterionEvidenceV2!.artifactBlobs[0], arbitrary: true }] } }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(corpus)).not.toBeNull();
  });

  it("rejects unknown and oversized V2 values in every nested execution collection", () => {
    const corpus = staticCapabilityV2Corpus();
    const input = corpus.cases[0]!.input;
    const withInput = (next: object) => ({ ...corpus, cases: [{ ...corpus.cases[0], input: { ...input, ...next } }] });
    const suite = { headSha: "a".repeat(40), status: "passed", executionSource: "unit", runner: "node_test", scope: "explicit_paths", testPaths: ["test/unit.test.ts"] };
    const module = { version: 1, kind: "resolved_head_module", headSha: "a".repeat(40), path: "src/unit.ts", blobSha: "b".repeat(40), source: "export {};" };

    expect(parseReleaseCandidateCorpusV2(withInput({ checks: [{ name: "unit", status: "passed", expected: {} }] }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ checks: [{ name: "unit", status: "passed", summary: "x".repeat(8_001) }] }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ logs: [{ source: "unit", text: "ok", arbitrary: true }] }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ logs: [{ source: "unit", text: "x".repeat(24_001) }] }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ executionSuites: [{ ...suite, expected: {} }] }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ executionSuites: [{ ...suite, executionSource: "x".repeat(501) }] }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ resolvedHeadModules: [{ ...module, arbitrary: true }] }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ resolvedHeadModules: [{ ...module, source: "x".repeat(65_537) }] }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ sourceProvenance: { ...input.sourceProvenance!, executionSuites: [{ ...suite, expected: {} }] } }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ sourceProvenance: { ...input.sourceProvenance!, executionSuites: [{ ...suite, executionSource: "x".repeat(501) }] } }))).toBeNull();
    expect(runReleaseCandidateCorpusV2(corpus).cases).toHaveLength(1);
  });

  it("rejects NUL and UTF-8 oversized V2 contract source and binding text", () => {
    const corpus = staticCapabilityV2Corpus();
    const input = corpus.cases[0]!.input;
    const contract = (input.verificationContractSourceV2 as { contract: unknown }).contract;
    const body = `## AgentProof verification\n\n\`\`\`agentproof-verification\n${JSON.stringify(contract)}\n\`\`\``;
    const linked = {
      ...input,
      verificationContractSourceV2: { kind: "linked_issue" as const, title: "AgentProof verification contract", body },
      verificationContractBindingV2: { ...input.verificationContractBindingV2!, sourceKind: "linked_issue" as const, sourceContent: body }
    };
    const withInput = (next: object) => ({ ...corpus, cases: [{ ...corpus.cases[0], input: { ...linked, ...next } }] });

    expect(parseReleaseCandidateCorpusV2(withInput({ verificationContractSourceV2: { ...linked.verificationContractSourceV2, title: "AgentProof verification contract\0" } }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ verificationContractSourceV2: { ...linked.verificationContractSourceV2, body: `${body}${" ".repeat(24_001)}` } }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ verificationContractBindingV2: { ...linked.verificationContractBindingV2, sourceIdentity: "id\0" } }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2(withInput({ verificationContractBindingV2: { ...linked.verificationContractBindingV2, sourceContent: "😀".repeat(6_001) } }))).toBeNull();
    expect(parseReleaseCandidateCorpusV2({ ...corpus, cases: [{ ...corpus.cases[0], input: linked }] })).not.toBeNull();
  });

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

  it("pins the exact release static capabilities without mutating ambient capability state", () => {
    const capabilityKey = "AGENTPROOF_VERIFICATION_CAPABILITIES_V2";
    const originalEnv = process.env;
    const previousCapabilities = originalEnv[capabilityKey];
    originalEnv[capabilityKey] = "test_case";
    const mutations: string[] = [];
    process.env = new Proxy(originalEnv, {
      set(target, property, value) {
        if (property === capabilityKey) mutations.push(`set:${String(property)}`);
        return Reflect.set(target, property, value);
      },
      deleteProperty(target, property) {
        if (property === capabilityKey) mutations.push(`delete:${String(property)}`);
        return Reflect.deleteProperty(target, property);
      }
    });

    try {
      const result = runReleaseCandidateCorpusV1(staticCapabilityDevelopmentCorpus());

      expect(result.cases[0]!.actual.requirements.map((requirement) => requirement.outcome)).toEqual(["met", "met", "unclear"]);
      expect(result.cases[0]!.actual.requirements[1]!.axisStates.implementation).toBe("violated");
      expect(result.cases[0]!.actual.requirements[2]!.axisStates.targeted_test).toBe("incomplete");
      expect(result.cases[0]!.metrics).toMatchObject({
        github: { requests: 0, pages: 0, retries: 0 },
        providerCallCount: 0
      });
      expect(process.env[capabilityKey]).toBe("test_case");
      expect(mutations).toEqual([]);
    } finally {
      process.env = originalEnv;
      restoreEnv(capabilityKey, previousCapabilities);
    }
  });

  it("keeps a PR-description author claim in the report source vocabulary", () => {
    const corpus = staticCapabilityDevelopmentCorpus();
    const input = corpus.cases[0]!.input;
    const contractSource = input.verificationContractSourceV2;
    if (contractSource?.kind !== "provided_requirement") throw new Error("Expected the development contract fixture.");
    const sourceContent = [
      "## AgentProof verification",
      "",
      "```agentproof-verification",
      JSON.stringify(contractSource.contract),
      "```"
    ].join("\n");
    input.verificationContractSourceV2 = {
      kind: "pr_description",
      title: "AgentProof verification contract",
      body: sourceContent
    };
    input.verificationContractBindingV2 = {
      ...input.verificationContractBindingV2!,
      sourceKind: "pr_description",
      sourceContent
    };

    const result = runReleaseCandidateCorpusV1(corpus);

    expect(result.cases[0]!.actual.sourceKind).toBe("unlinked_pr");
  });

  it("uses report source vocabulary when a PR-description contract is invalid", () => {
    const corpus = staticCapabilityDevelopmentCorpus();
    const input = corpus.cases[0]!.input;
    input.taskSource = undefined;
    input.taskText = "";
    input.description = "Acceptance criteria: document the local reset command.";
    input.verificationContractSourceV2 = {
      kind: "pr_description",
      title: "AgentProof verification contract",
      body: "This description does not contain a typed verification contract."
    };
    input.verificationContractBindingV2 = {
      ...input.verificationContractBindingV2!,
      sourceKind: "pr_description",
      sourceContent: input.verificationContractSourceV2.body
    };
    corpus.cases[0]!.requirementOrdinals = [0];

    const result = runReleaseCandidateCorpusV1(corpus);

    expect(result.cases[0]!.actual.sourceKind).toBe("unlinked_pr");
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
        metrics: { unexpectedFailure: true, failureStage: "report_generation" }
      });
      const serializedFailure = JSON.stringify(result.cases[0]);
      expect(serializedFailure).not.toContain("raw private generation error");
      expect(serializedFailure).not.toMatch(/"(?:error|message|stack)"/);
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

function staticCapabilityDevelopmentCorpus(): ReleaseCandidateCorpusV1 {
  const headSha = "d".repeat(40);
  const baseSha = "e".repeat(40);
  const contract = {
    version: 2,
    scope: "complete_objective_set",
    objectives: [
      {
        id: "reset_doc",
        objective: "Document the local reset command.",
        criteria: [{
          id: "reset_literal",
          type: "artifact",
          label: "The reset document includes the exact test command.",
          paths: ["docs/reset.md"],
          artifact: { kind: "documentation_literal", literal: "Run npm test." }
        }]
      },
      {
        id: "runtime_scope",
        objective: "Preserve the declared runtime scope.",
        criteria: [{
          id: "no_runtime_change",
          type: "absence",
          label: "No runtime path changes.",
          prohibitedKind: "path_change",
          scope: [{ kind: "prefix", path: "src/runtime/" }]
        }]
      },
      {
        id: "targeted_test",
        objective: "Add a targeted regression test.",
        criteria: [{
          id: "targeted_case",
          type: "artifact",
          label: "The exact targeted test case is present.",
          paths: ["test/reset.test.ts"],
          artifact: { kind: "test_case", testId: "reset command regression" }
        }]
      }
    ]
  } as const;
  const sourceContent = JSON.stringify(contract);
  const input: PullRequestInput = {
    title: "Document reset without runtime changes",
    description: "Documents the reset command.",
    taskText: "Document the reset command and do not modify runtime code.",
    taskSource: "issue",
    changedFiles: [{ path: "docs/reset.md", status: "modified", patch: "+Run npm test." }],
    checks: [],
    logs: [],
    verificationCriterionEvidenceV2: {
      artifactBlobs: [{ path: "docs/reset.md", headSha, content: "Stop the server.\nRun npm test." }]
    },
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha,
      baseSha,
      changedFileInventory: { version: 1, completeness: "complete", headSha },
      evidenceCapturedAt: "2026-08-26T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "f".repeat(64), coverage: "github_metadata" }
    },
    verificationContractSourceV2: { kind: "provided_requirement", contract },
    verificationContractBindingV2: {
      sourceKind: "provided_requirement",
      sourceIdentity: "manual:release-static-capabilities:1",
      sourceContent,
      headSha,
      baseSha
    }
  };
  return {
    version: 1,
    cases: [{ version: 1, caseId: "opaque-static-capabilities", input, requirementOrdinals: [0, 1, 2] }]
  };
}

function staticCapabilityV2Corpus() {
  const development = staticCapabilityDevelopmentCorpus();
  return {
    version: 2 as const,
    cases: development.cases.map(({ input }) => ({ version: 2 as const, caseId: "1".repeat(64), input }))
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
