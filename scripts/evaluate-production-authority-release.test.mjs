import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import * as acorn from "acorn";
import ts from "typescript";
import {
  evaluateProductionAuthorityRelease,
  verifyAndEvaluateProductionAuthorityRelease,
  signedEvidencePayload,
  validateRequirementAggregate,
  validateBoundaryAggregate
} from "./evaluate-production-authority-release.mjs";
import { runAuthorityCli } from "./evaluate-production-authority-release-cli.mjs";

const RUBRIC = JSON.parse(readFileSync(new URL(
  "../docs/superpowers/specs/2026-08-22-production-authority-blind-evaluation-rubric.v2.json",
  import.meta.url
), "utf8"));
const HISTORICAL_RUBRIC_V1 = JSON.parse(readFileSync(new URL(
  "../docs/superpowers/specs/2026-08-22-production-authority-blind-evaluation-rubric.v1.json", import.meta.url
), "utf8"));
const V2_COVERAGE_NAMES = [
  "absence:current_path_violated", "absence:previous_path_violated", "absence:satisfied", "absence:unavailable",
  "boundary:empty_override_live", "boundary:inbound_author_claim_rejected", "boundary:inbound_authoritative_rejected", "boundary:incomplete_live_conservative",
  "boundary:pasted_changed_files", "boundary:pasted_checks", "boundary:pasted_logs", "boundary:privacy_zero", "boundary:text_only_override_live",
  "contract:multi_objective", "deferred:return_value", "deferred:test_case", "deferred:workflow_job",
  "documentation:satisfied", "documentation:unavailable", "documentation:violated",
  "source:linked_authoritative", "source:pr_author_claim", "source:provided_authoritative"
];

describe("evaluate-production-authority-release", () => {
  it("emits a bounded JSON failure envelope from the authority CLI", () => {
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("./evaluate-production-authority-release-cli.mjs", import.meta.url))
    ], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stderr), {
      version: 1,
      ok: false,
      errorCode: "MANIFEST_BINDING_INVALID"
    });
  });

  it("bounds a failure while loading the parser-dependent authority module", async () => {
    const writes = [];
    const previousExitCode = process.exitCode;
    try {
      const result = await runAuthorityCli({
        argv: [],
        loadImplementation: async () => { throw new Error("parser file /private/path is unavailable"); },
        writeError: (value) => writes.push(value)
      });
      assert.equal(result, false);
      assert.deepEqual(JSON.parse(writes.join("")), {
        version: 1,
        ok: false,
        errorCode: "MANIFEST_BINDING_INVALID"
      });
      assert.equal(writes.join("").includes("/private/path"), false);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("requires an independently reconstructed closure before authority evaluation", () => {
    const value = fixture();
    assert.throws(() => verifyAndEvaluateProductionAuthorityRelease({
      rubric: value.rubric,
      evidence: value.evidence,
      frozenManifest: value.manifest,
      trustedSigners: value.trustedSigners,
      toolchainRoot: process.cwd(),
      toolchainConfig: {}
    }), (error) => error?.code === "MANIFEST_BINDING_INVALID");
  });

  it("rejects missing, duplicate, and unknown evidence sources", () => {
    const missing = fixture();
    missing.evidence.evidenceSources.pop();
    assert.throws(() => assess(missing), /missing evidence source/);

    const duplicate = fixture();
    duplicate.evidence.evidenceSources.push(structuredClone(duplicate.evidence.evidenceSources[0]));
    assert.throws(() => assess(duplicate), /duplicate evidence source/);

    const unknown = fixture();
    unknown.evidence.evidenceSources[0].content = "not aggregate evidence";
    assert.throws(() => assess(unknown), /unknown evidence field/);
  });

  it("rejects stale signed evidence", () => {
    const value = fixture();
    value.evidence.assessedAt = "2026-08-23T00:00:01.000Z";
    assert.throws(() => assess(value), /stale evidence/);
  });

  it("rejects a signed evidence source bound to a stale tooling-closure hash", () => {
    const value = fixture();
    mutateAndResign(value, "freeze_manifest", (source) => {
      source.bindings.evaluationToolchainSourceClosureSha256 = hex("f");
    });

    assert.throws(() => assess(value), /stale evidence binding/);
  });

  it("rejects a V1 manifest and every stale V2 static-closure binding", () => {
    const names = [
      "referencePolicySha256", "referencePolicySealSha256", "evidenceCorpusSha256", "boundaryCorpusSha256",
      "coverageSummarySha256", "requirementEvaluatorBundleSha256", "boundaryEvaluatorBundleSha256", "evaluatorSandboxProfileSha256"
    ];
    const required = RUBRIC.evidenceSources.find((source) => source.id === "freeze_manifest").requiredBindings;
    assert.ok(names.every((name) => required.includes(name)));

    const legacy = fixture();
    legacy.manifest.version = 1;
    assert.throws(() => assess(legacy), (error) => error?.code === "MANIFEST_BINDING_INVALID");

    for (const name of names) {
      const value = fixture();
      mutateAndResign(value, "freeze_manifest", (source) => { source.bindings[name] = hex("f"); });
      assertNoAuthority(value);
    }
  });

  it("rejects historical V1 rubric and aggregate evidence before release scoring", () => {
    const historicalRubric = fixture(HISTORICAL_RUBRIC_V1);
    assert.throws(() => assess(historicalRubric), /release rubric schema/);

    const historicalAggregate = fixture();
    historicalAggregate.evidence.version = 1;
    assert.throws(() => assess(historicalAggregate), /assessment evidence schema/);
  });

  it("rejects parser-artifact and tooling built-in mutations before scoring", () => {
    assert.equal(assess(fixture()).decision, "eligible_for_deployment_approval");
    for (const mutate of [
      (manifest) => { delete manifest.parserArtifacts; },
      (manifest) => { manifest.parserArtifacts.reverse(); },
      (manifest) => { manifest.parserArtifacts[0].version = "8.16.0"; },
      (manifest) => { manifest.parserArtifacts[0].entrySha256 = hex("f"); },
      (manifest) => { delete manifest.toolingBuiltinImports; },
      (manifest) => { manifest.toolingBuiltinImports = ["node:child_process"]; },
      (manifest) => { manifest.toolingBuiltinImports = ["node:fs", "node:crypto"]; },
      (manifest) => { manifest.toolingBuiltinImports = ["node:crypto", "node:crypto"]; },
      (manifest) => { manifest.evaluationToolchainBuiltinAllowlistSha256 = hex("f"); }
    ]) {
      const value = fixture();
      mutate(value.manifest);
      assert.throws(() => assess(value), (error) => error?.code === "MANIFEST_BINDING_INVALID");
    }
  });

  it("rejects a re-signed source whose V2 policy, corpus, bundle, result, or mount hash diverges from the freeze", () => {
    for (const [sourceId, binding, expectedError] of [
      ["protected_aggregate", "evidenceCorpusSha256", /inconsistent shared evidence binding/],
      ["protected_aggregate", "referencePolicySealSha256", /inconsistent shared evidence binding/],
      ["runner_isolation_attestation", "requirementRunnerBundleSha256", /inconsistent shared evidence binding/],
      ["runner_isolation_attestation", "requirementEvaluatorMountSetSha256", /inconsistent shared evidence binding/],
      ["protected_aggregate", "requirementResultSha256", /aggregate result hash/],
      ["protected_boundary_aggregate", "boundaryResultSha256", /aggregate result hash/]
    ]) {
      const value = fixture();
      mutateAndResign(value, sourceId, (source) => {
        source.bindings[binding] = source.bindings[binding] === hex("f") ? hex("e") : hex("f");
      });
      try {
        assess(value);
        assert.fail(`accepted divergent ${binding}`);
      } catch (error) {
        assert.match(String(error), /inconsistent shared evidence binding|aggregate result hash|stale evidence binding/);
      }
    }
  });

  it("rejects malformed requirement aggregate nested groups and boundary scalar counters", () => {
    const aggregate = requirementAggregate();
    aggregate.durationMs.extra = 0;
    assert.throws(() => validateRequirementAggregate(aggregate), /requirement aggregate schema/);

    const boundary = boundaryAggregate();
    boundary.boundaryPrivacyLeakCount = { count: 0 };
    assert.throws(() => validateBoundaryAggregate(boundary), /boundary aggregate schema/);
  });

  it("rejects a re-signed aggregate whose result binding hashes a different payload", () => {
    const value = fixture();
    mutateAndResign(value, "protected_aggregate", (source) => {
      source.result.aggregate.durationMs.p95 = 21;
    });

    assert.throws(() => assess(value), /aggregate result hash/);
  });

  it("rejects impossible aggregate cardinality and count/rate arithmetic", () => {
    for (const mutate of [
      (aggregate) => { aggregate.totalCases = 5; },
      (aggregate) => { aggregate.structuralMismatchCount = 5; },
      (aggregate) => { aggregate.unexpectedFailure.rate = 0.25; },
      (aggregate) => { aggregate.unexpectedFailure = { count: 5, rate: 1 }; }
    ]) {
      const aggregate = requirementAggregate();
      mutate(aggregate);
      assert.throws(() => validateRequirementAggregate(aggregate), /requirement aggregate schema/);
    }
  });

  it("binds V2 policy, named coverage, corpus hashes, and seal case counts", () => {
    const passing = fixture();
    assert.equal(assess(passing).decision, "eligible_for_deployment_approval");

    for (const mutate of [
      (seal) => { seal.evidenceCorpusSha256 = hex("f"); },
      (seal) => { seal.coverageSummary.entries[0].count = 0; },
      (seal) => { seal.evidenceCaseCount = 4; }
    ]) {
      const tampered = fixture();
      mutateAndResign(tampered, "freeze_manifest", (source) => mutate(source.result.seal));
      assertNoAuthority(tampered);
    }

    const selfConsistentShrink = fixture();
    const shrunkenSeal = selfConsistentShrink.evidence.evidenceSources.find((source) => source.id === "freeze_manifest").result.seal;
    shrunkenSeal.evidenceCaseCount = 1;
    shrunkenSeal.boundaryCaseCount = 1;
    shrunkenSeal.coverageSummary.evidenceCaseCount = 1;
    shrunkenSeal.coverageSummary.boundaryCaseCount = 1;
    shrunkenSeal.coverageSummarySha256 = canonicalSha(shrunkenSeal.coverageSummary);
    resignAll(selfConsistentShrink, (source) => {
      if (Object.hasOwn(source.bindings, "coverageSummarySha256")) source.bindings.coverageSummarySha256 = shrunkenSeal.coverageSummarySha256;
      if (Object.hasOwn(source.bindings, "referencePolicySealSha256")) source.bindings.referencePolicySealSha256 = canonicalSha(shrunkenSeal);
    });
    assert.throws(() => assess(selfConsistentShrink), /freeze manifest evidence schema/);

    const arbitraryCoverage = fixture();
    const arbitrarySeal = arbitraryCoverage.evidence.evidenceSources.find((source) => source.id === "freeze_manifest").result.seal;
    arbitrarySeal.coverageSummary.entries[0].name = "untrusted:coverage";
    arbitrarySeal.coverageSummarySha256 = canonicalSha(arbitrarySeal.coverageSummary);
    resignAll(arbitraryCoverage, (source) => {
      if (Object.hasOwn(source.bindings, "coverageSummarySha256")) source.bindings.coverageSummarySha256 = arbitrarySeal.coverageSummarySha256;
      if (Object.hasOwn(source.bindings, "referencePolicySealSha256")) source.bindings.referencePolicySealSha256 = canonicalSha(arbitrarySeal);
    });
    assert.throws(() => assess(arbitraryCoverage), /freeze manifest evidence schema/);
  });

  it("fails sandbox isolation for network, forbidden mounts, writable input, missing result hash, and wrong candidate SHA", () => {
    for (const mutate of [
      (attestation) => { attestation.networkMode = "enabled"; },
      (attestation) => { attestation.readOnlyMounts.push({ kind: "oracle", binding: hex("d") }); },
      (attestation) => { attestation.writableMounts.push({ kind: "protected_input" }); },
      (attestation) => { attestation.candidateSha = hex("e", 40); }
    ]) {
      const value = fixture();
      mutateAndResign(value, "runner_isolation_attestation", (source) => mutate(source.result.attestations[0]));
      assertNoAuthority(value);
    }

    const missingHash = fixture();
    mutateAndResign(missingHash, "runner_isolation_attestation", (source) => {
      delete source.result.attestations[0].resultSha256;
    });
    assert.throws(() => assess(missingHash), /sandbox attestation schema/);
  });

  it("does not allow a failed release aggregate to establish authority", () => {
    const rubric = structuredClone(RUBRIC);
    for (const category of rubric.scoreCategories) {
      for (const criterion of category.criteria) {
        criterion.requiredEvidenceSourceIds = criterion.requiredEvidenceSourceIds.filter((id) => id !== "protected_aggregate");
      }
    }
    const value = fixture(rubric);
    mutateAndResign(value, "protected_aggregate", (source) => {
      source.result.aggregate.falseSupportedCount = 1;
    });
    synchronizeRequirementResultHash(value);

    const result = assess(value);
    assert.equal(result.score, 0);
    assert.equal(result.binaryGates.find((gate) => gate.id === "protected_release_gate").state, "failed");
    assert.equal(result.decision, "no_go");
  });

  it("returns an aggregate-only V2 decision when every exact gate passes", () => {
    const value = fixture();
    const parserHashes = value.manifest.parserArtifacts.map((artifact) => artifact.entrySha256);
    const result = assess(value);
    assert.equal(result.score, 100);
    assert.ok(result.binaryGates.every((gate) => gate.state === "passed"));
    assert.equal(result.decision, "eligible_for_deployment_approval");
    assert.deepEqual(Object.keys(result), [
      "version", "rubricId", "candidateSha", "score", "maximumScore", "categoryScores", "binaryGates", "decision"
    ]);
    assert.ok(!JSON.stringify(result).includes("commands"));
    assert.ok(!JSON.stringify(result).includes("attestations"));
    assert.ok(!JSON.stringify(result).includes("coverageSummary"));
    assert.ok(!JSON.stringify(result).includes("referencePolicySeal"));
    assert.ok(!JSON.stringify(result).includes("parserArtifacts"));
    assert.ok(!JSON.stringify(result).includes("entrySha256"));
    assert.ok(parserHashes.every((hash) => !JSON.stringify(result).includes(hash)));
  });
});

function assess(value) {
  return evaluateProductionAuthorityRelease({
    rubric: value.rubric,
    evidence: value.evidence,
    frozenManifest: value.manifest,
    trustedSigners: value.trustedSigners
  });
}

function assertNoAuthority(value) {
  try {
    assert.equal(assess(value).decision, "no_go");
  } catch (error) {
    assert.match(String(error), /schema|binding|stale|attestation/);
  }
}

function fixture(rubric = structuredClone(RUBRIC)) {
  const candidateSha = hex("a", 40);
  const rubricSha256 = canonicalSha(rubric);
  const manifest = frozenManifest(rubricSha256, candidateSha);
  const toolchainManifestSha256 = canonicalSha(manifest);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const context = { candidateSha, manifest, toolchainManifestSha256, rubricSha256 };
  context.seal = referencePolicySeal(context);
  const evidenceSources = rubric.evidenceSources.map((definition) => signedSource(definition, context, privateKey));
  return {
    rubric,
    manifest,
    privateKey,
    trustedSigners: {
      version: 1,
      signers: [{ keyId: "ci-key", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) }]
    },
    evidence: {
      version: 2,
      candidateSha,
      assessedAt: "2026-08-22T12:00:00.000Z",
      rubricSha256,
      toolchainManifestSha256,
      evidenceSources
    }
  };
}

function signedSource(definition, context, privateKey) {
  const source = {
    id: definition.id,
    kind: definition.kind,
    candidateSha: context.candidateSha,
    toolchainManifestSha256: context.toolchainManifestSha256,
    issuedAt: "2026-08-22T11:00:00.000Z",
    validUntil: "2026-08-23T00:00:00.000Z",
    bindings: Object.fromEntries((definition.requiredBindings ?? []).map((name) => [name, bindingValue(name, context)])),
    result: evidenceResult(definition, context),
    signerKeyId: "ci-key",
    signature: ""
  };
  source.signature = sign(null, Buffer.from(stableJson(signedEvidencePayload(source))), privateKey).toString("base64");
  return source;
}

function mutateAndResign(value, id, mutate) {
  const source = value.evidence.evidenceSources.find((item) => item.id === id);
  mutate(source);
  source.signature = sign(null, Buffer.from(stableJson(signedEvidencePayload(source))), value.privateKey).toString("base64");
}

function resignAll(value, mutate) {
  for (const source of value.evidence.evidenceSources) {
    mutate(source);
    source.signature = sign(null, Buffer.from(stableJson(signedEvidencePayload(source))), value.privateKey).toString("base64");
  }
}

function synchronizeRequirementResultHash(value) {
  const aggregate = value.evidence.evidenceSources.find((source) => source.id === "protected_aggregate");
  const resultSha256 = canonicalSha(aggregate.result);
  for (const id of ["freeze_manifest", "protected_aggregate", "runner_isolation_attestation"]) {
    mutateAndResign(value, id, (source) => {
      source.bindings.requirementResultSha256 = resultSha256;
      if (id === "runner_isolation_attestation") {
        source.result.attestations.filter((attestation) => attestation.role.startsWith("requirement")).forEach((attestation) => {
          attestation.resultSha256 = resultSha256;
          const candidate = attestation.readOnlyMounts.find((mount) => mount.kind === "candidate_result");
          if (candidate) candidate.binding = resultSha256;
        });
      }
    });
  }
}

function corpusSummary(inputSha256, categoryCounts) {
  return {
    inputSha256,
    categoryCounts,
    summarySha256: canonicalSha({ version: 1, inputSha256, categoryCounts })
  };
}

function referencePolicySeal(context) {
  const coverageSummary = {
    version: 2,
    evidenceCaseCount: 12,
    boundaryCaseCount: 8,
    entries: V2_COVERAGE_NAMES.map((name) => ({ name, count: 1 }))
  };
  return {
    version: 2,
    policyId: "agentproof-static-reference.v1",
    capabilities: ["documentation_literal", "path_change_absence"],
    referencePolicySha256: context.manifest.referencePolicy.sha256,
    evidenceCorpusSha256: hex("e"),
    evidenceCaseCount: 12,
    boundaryCorpusSha256: hex("b"),
    boundaryCaseCount: 8,
    coverageSummary,
    coverageSummarySha256: canonicalSha(coverageSummary)
  };
}

function bindingValue(name, context) {
  const bundles = Object.fromEntries(context.manifest.bundles.map((bundle) => [bundle.id, bundle.sha256]));
  const exact = {
    candidateSha: context.candidateSha,
    referencePolicySha256: context.manifest.referencePolicy.sha256,
    referencePolicySealSha256: canonicalSha(context.seal),
    evidenceCorpusSha256: context.seal.evidenceCorpusSha256,
    boundaryCorpusSha256: context.seal.boundaryCorpusSha256,
    coverageSummarySha256: context.seal.coverageSummarySha256,
    toolingEntrySetSha256: context.manifest.toolingEntrySetSha256,
    moduleEdgeSetSha256: context.manifest.moduleEdgeSetSha256,
    nodeBuiltinAllowlistSha256: context.manifest.nodeBuiltinAllowlistSha256,
    approvedNodeBuiltinUniverseSha256: context.manifest.approvedNodeBuiltinUniverseSha256,
    parserArtifactBindingSha256: canonicalSha(context.manifest.parserArtifacts),
    resolutionPolicySha256: context.manifest.resolutionPolicySha256,
    evaluationToolchainSourceClosureSha256: context.manifest.evaluationToolchainSourceClosureSha256,
    evaluationToolchainBundleSetSha256: context.manifest.evaluationToolchainBundleSetSha256,
    sutExternalImportAllowlistSha256: context.manifest.sutExternalImportAllowlistSha256,
    runnerSandboxProfileSha256: context.manifest.runnerSandboxProfile.sha256,
    evaluatorSandboxProfileSha256: context.manifest.evaluatorSandboxProfile.sha256,
    packageScriptsSha256: context.manifest.packageScripts.sha256,
    lockfileSha256: context.manifest.lockfile.sha256,
    nodeVersion: context.manifest.runtime.nodeVersion,
    pnpmVersion: context.manifest.runtime.pnpmVersion,
    runtimeImageDigest: context.manifest.runtime.runtimeImageDigest,
    rubricSha256: context.rubricSha256,
    requirementRunnerBundleSha256: bundles.requirement_runner,
    boundaryRunnerBundleSha256: bundles.boundary_runner,
    requirementEvaluatorBundleSha256: bundles.requirement_evaluator,
    boundaryEvaluatorBundleSha256: bundles.boundary_evaluator,
    referencePolicyBundleSha256: bundles.reference_policy,
    requirementResultSha256: canonicalSha({ aggregate: requirementAggregate() }),
    boundaryResultSha256: canonicalSha({ aggregate: boundaryAggregate() }),
    requirementRunnerMountSetSha256: mountSetSha256("requirement_runner", context),
    boundaryRunnerMountSetSha256: mountSetSha256("boundary_runner", context),
    requirementEvaluatorMountSetSha256: mountSetSha256("requirement_evaluator", context),
    boundaryEvaluatorMountSetSha256: mountSetSha256("boundary_evaluator", context),
    reviewerIdentity: "independent-reviewer",
    reviewState: "approved"
  };
  return exact[name] ?? hex(hashNibble(name));
}

function mountSetSha256(role, context) {
  const surface = role.startsWith("requirement") ? "requirement" : "boundary";
  const runner = role.endsWith("runner");
  const bundles = Object.fromEntries(context.manifest.bundles.map((bundle) => [bundle.id, bundle.sha256]));
  const inputSha256 = surface === "requirement" ? context.seal.evidenceCorpusSha256 : context.seal.boundaryCorpusSha256;
  const resultSha256 = canonicalSha({ aggregate: surface === "requirement" ? requirementAggregate() : boundaryAggregate() });
  const bundleSha256 = bundles[`${surface}_${runner ? "runner" : "evaluator"}`];
  const profileSha256 = runner ? context.manifest.runnerSandboxProfile.sha256 : context.manifest.evaluatorSandboxProfile.sha256;
  const readOnlyMounts = runner ? [
    { kind: "candidate_sut", binding: context.candidateSha }, { kind: "protected_input", binding: inputSha256 },
    { kind: "runner_bundle", binding: bundleSha256 }, { kind: "runtime_profile", binding: profileSha256 }
  ] : [
    { kind: "protected_input", binding: inputSha256 }, { kind: "policy_seal", binding: canonicalSha(context.seal) },
    { kind: "candidate_result", binding: resultSha256 }, { kind: "reference_policy", binding: context.manifest.referencePolicy.sha256 },
    { kind: "evaluator_bundle", binding: bundleSha256 }, { kind: "runtime_profile", binding: profileSha256 }
  ];
  return canonicalSha({ role, readOnlyMounts, writableMounts: [{ kind: runner ? "result" : "aggregate_result" }] });
}

function evidenceResult(definition, context) {
  if (definition.id === "freeze_manifest") return {
    manifestSha256: context.toolchainManifestSha256,
    seal: context.seal
  };
  if (definition.id === "protected_aggregate") return { aggregate: requirementAggregate() };
  if (definition.id === "protected_boundary_aggregate") return { aggregate: boundaryAggregate() };
  if (definition.id === "runner_isolation_attestation") return {
    attestations: [
      sandboxAttestation("requirement_runner", context, definition),
      sandboxAttestation("boundary_runner", context, definition),
      sandboxAttestation("requirement_evaluator", context, definition),
      sandboxAttestation("boundary_evaluator", context, definition)
    ]
  };
  if (definition.id === "independent_review") return {
    reviewerIdentity: "independent-reviewer",
    reviewState: "approved",
    reviewedDiffSha256: bindingValue("reviewedDiffSha256", context),
    independent: true
  };
  const commands = (definition.commands ?? []).map((command) => ({ command, exitCode: 0, outputSha256: canonicalSha(command) }));
  return definition.id === "production_smoke" ? { commands, readinessOk: true } : { commands };
}

function sandboxAttestation(role, context, definition) {
  const bindings = Object.fromEntries((definition.requiredBindings ?? []).map((name) => [name, bindingValue(name, context)]));
  const surface = role.startsWith("requirement") ? "requirement" : "boundary";
  const runner = role.endsWith("runner");
  const bundleSha256 = bindings[`${surface}${runner ? "Runner" : "Evaluator"}BundleSha256`];
  const inputSha256 = bindings[surface === "requirement" ? "evidenceCorpusSha256" : "boundaryCorpusSha256"];
  const resultSha256 = bindings[surface === "requirement" ? "requirementResultSha256" : "boundaryResultSha256"];
  const sandboxProfileSha256 = bindings[runner ? "runnerSandboxProfileSha256" : "evaluatorSandboxProfileSha256"];
  return {
    version: 1,
    role,
    candidateSha: context.candidateSha,
    bundleSha256,
    sandboxProfileSha256,
    runtimeImageDigest: context.manifest.runtime.runtimeImageDigest,
    inputSha256,
    resultSha256,
    referencePolicySha256: bindings.referencePolicySha256,
    referencePolicySealSha256: bindings.referencePolicySealSha256,
    mountedReadOnlyFileSetSha256: bindings[`${surface}${runner ? "Runner" : "Evaluator"}MountSetSha256`],
    networkMode: "disabled",
    readOnlyMounts: runner ? [
      { kind: "candidate_sut", binding: context.candidateSha },
      { kind: "protected_input", binding: inputSha256 },
      { kind: "runner_bundle", binding: bundleSha256 },
      { kind: "runtime_profile", binding: sandboxProfileSha256 }
    ] : [
      { kind: "protected_input", binding: inputSha256 },
      { kind: "policy_seal", binding: bindings.referencePolicySealSha256 },
      { kind: "candidate_result", binding: resultSha256 },
      { kind: "reference_policy", binding: bindings.referencePolicySha256 },
      { kind: "evaluator_bundle", binding: bundleSha256 },
      { kind: "runtime_profile", binding: sandboxProfileSha256 }
    ],
    writableMounts: [{ kind: runner ? "result" : "aggregate_result" }]
  };
}

function requirementAggregate() {
  return {
    totalCases: 12,
    structuralMismatchCount: 0,
    falseSupportedCount: 0,
    falseRequirementLocalCiAssociationCount: 0,
    crossRequirementReceiptReuseCount: 0,
    privacyLeakCount: 0,
    unexpectedFailure: { count: 0, rate: 0 },
    durationMs: { p50: 10, p95: 20 },
    githubRequestCount: { p50: 1, p95: 2 },
    githubPageCount: { p50: 1, p95: 1 },
    githubRetryCount: { p50: 0, p95: 0 },
    providerCallCount: 0
  };
}

function boundaryAggregate() {
  return {
    untrustedActiveV2AcceptanceCount: 0,
    pastedEvidenceGithubAuthorityCount: 0,
    falseBoundaryLocalPositiveCount: 0,
    boundaryPrivacyLeakCount: 0,
    boundaryStructuralMismatchCount: 0
  };
}

function frozenManifest(rubricSha256, candidateSha) {
  const sourceFiles = [{ path: "scripts/runner.mjs", sha256: hex("1") }];
  const toolingEntries = ["scripts/runner.mjs"];
  const moduleEdges = [];
  const nodeBuiltins = [];
  const bundles = [
    { id: "authority_cli_bootstrap", path: "scripts/evaluate-production-authority-release-cli.mjs", sha256: hex("2") },
    { id: "boundary_evaluator", path: "dist/boundary-evaluator.mjs", sha256: hex("3") },
    { id: "boundary_runner", path: "dist/boundary.mjs", sha256: hex("4") },
    { id: "reference_policy", path: "dist/reference-policy.mjs", sha256: hex("5") },
    { id: "requirement_evaluator", path: "dist/requirement-evaluator.mjs", sha256: hex("6") },
    { id: "requirement_runner", path: "dist/requirement.mjs", sha256: hex("7") }
  ];
  const sutExternalImports = ["src/lib/verifier.ts"];
  const packageEntries = [{ name: "eval:production-authority:release", command: "node scripts/evaluate-production-authority-release.mjs" }];
  const parserArtifacts = runtimeParserArtifacts();
  const toolingBuiltinImports = [];
  const resolutionPolicy = {
    version: 1,
    module: "ESNext",
    moduleResolution: "Bundler",
    target: "ES2024",
    resolveJsonModule: true,
    allowJs: false,
    noLib: true,
    types: [],
    baseUrl: null,
    paths: null,
    rootDirs: null,
    typeRoots: null,
    customConditions: []
  };
  return {
    version: 2,
    policyId: "restricted_static_toolchain.v1",
    candidateSha,
    toolingEntries,
    toolingEntrySetSha256: canonicalSha(toolingEntries),
    sourceFiles,
    evaluationToolchainSourceClosureSha256: canonicalSha({ sourceFiles, parserArtifacts }),
    moduleEdges,
    moduleEdgeSetSha256: canonicalSha(moduleEdges),
    nodeBuiltins,
    nodeBuiltinAllowlistSha256: canonicalSha(nodeBuiltins),
    approvedNodeBuiltinUniverseSha256: canonicalSha([
      "node:crypto", "node:fs", "node:path", "node:perf_hooks", "node:url", "node:util"
    ]),
    toolingBuiltinImports,
    evaluationToolchainBuiltinAllowlistSha256: canonicalSha(toolingBuiltinImports),
    bundles,
    evaluationToolchainBundleSetSha256: canonicalSha(bundles),
    sutExternalImports,
    sutExternalImportAllowlistSha256: canonicalSha(sutExternalImports),
    parserArtifacts,
    resolutionPolicy,
    resolutionPolicySha256: canonicalSha(resolutionPolicy),
    runnerSandboxProfile: { path: "runner-sandbox-profile.json", sha256: hex("8") },
    evaluatorSandboxProfile: { path: "evaluator-sandbox-profile.json", sha256: hex("9") },
    referencePolicy: { path: "scripts/evidence-release-reference-policy-v2.mjs", sha256: hex("c") },
    authorityRubric: { path: "docs/superpowers/specs/2026-08-22-production-authority-blind-evaluation-rubric.v2.json", sha256: rubricSha256 },
    packageScripts: { entries: packageEntries, sha256: canonicalSha(packageEntries) },
    lockfile: { path: "pnpm-lock.yaml", sha256: hex("d") },
    runtime: {
      path: "runtime.json",
      sha256: hex("e"),
      nodeVersion: "v22.19.0",
      pnpmVersion: "10.32.1",
      runtimeImageDigest: `sha256:${hex("f")}`
    }
  };
}

function canonicalSha(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function runtimeParserArtifacts() {
  return [
    { id: "acorn", version: acorn.version, entrySha256: parserEntrySha256("acorn") },
    { id: "typescript", version: ts.version, entrySha256: parserEntrySha256("typescript") }
  ];
}

function parserEntrySha256(id) {
  return createHash("sha256").update(readFileSync(fileURLToPath(import.meta.resolve(id)))).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hex(character, length = 64) {
  return character.repeat(length);
}

function hashNibble(value) {
  return createHash("sha256").update(value).digest("hex")[0];
}
