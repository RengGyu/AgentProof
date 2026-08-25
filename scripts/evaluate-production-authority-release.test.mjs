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
  "../docs/superpowers/specs/2026-08-22-production-authority-blind-evaluation-rubric.v1.json",
  import.meta.url
), "utf8"));

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
      "candidateSha",
      "toolingEntrySetSha256",
      "moduleEdgeSetSha256",
      "nodeBuiltinAllowlistSha256",
      "approvedNodeBuiltinUniverseSha256",
      "parserArtifactBindingSha256",
      "resolutionPolicySha256"
    ];
    const required = RUBRIC.evidenceSources.find((source) => source.id === "freeze_manifest").requiredBindings;
    assert.deepEqual(required.slice(-7), names);

    const legacy = fixture();
    legacy.manifest.version = 1;
    assert.throws(() => assess(legacy), (error) => error?.code === "MANIFEST_BINDING_INVALID");

    for (const name of names) {
      const value = fixture();
      mutateAndResign(value, "freeze_manifest", (source) => { source.bindings[name] = hex("f", name === "candidateSha" ? 40 : 64); });
      assert.throws(() => assess(value), /stale evidence binding/);
    }
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

  it("rejects a re-signed source whose shared input, oracle, runner, evaluator, result, or corpus-summary hash diverges from the freeze", () => {
    for (const [sourceId, binding, expectedError] of [
      ["protected_aggregate", "requirementInputSha256", /inconsistent shared evidence binding/],
      ["protected_aggregate", "requirementOracleSha256", /inconsistent shared evidence binding/],
      ["runner_isolation_attestation", "requirementRunnerBundleSha256", /inconsistent shared evidence binding/],
      ["protected_aggregate", "aggregateEvaluatorSha256", /inconsistent shared evidence binding/],
      ["protected_aggregate", "requirementResultSha256", /aggregate result hash/],
      ["protected_aggregate", "requirementCorpusSummarySha256", /inconsistent shared evidence binding/]
    ]) {
      const value = fixture();
      mutateAndResign(value, sourceId, (source) => {
        source.bindings[binding] = source.bindings[binding] === hex("f") ? hex("e") : hex("f");
      });
      assert.throws(() => assess(value), expectedError);
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

  it("binds the fixed two-surface case balance to canonical content-free corpus summaries", () => {
    const passing = fixture();
    assert.equal(assess(passing).decision, "eligible_for_deployment_approval");

    for (const surface of ["requirement", "boundary"]) {
      for (const mutate of [
        (summary) => { summary.categoryCounts[2] = 3; },
        (summary) => { summary.inputSha256 = hex("e"); },
        (summary) => { summary.summarySha256 = hex("e"); }
      ]) {
        const tampered = fixture();
        mutateAndResign(tampered, "freeze_manifest", (source) => mutate(source.result.corpusSummaries[surface]));
        const result = assess(tampered);
        assert.equal(result.decision, "no_go");
        assert.equal(result.binaryGates.find((gate) => gate.id === "frozen_tooling_integrity").state, "failed");
      }
    }

    const leaking = fixture();
    mutateAndResign(leaking, "freeze_manifest", (source) => {
      source.result.corpusSummaries.requirement.path = "synthetic/case.json";
    });
    assert.throws(() => assess(leaking), /freeze manifest evidence schema/);
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
      const result = assess(value);

      assert.equal(result.decision, "no_go");
      assert.equal(result.binaryGates.find((gate) => gate.id === "runner_oracle_isolation").state, "failed");
    }

    const missingHash = fixture();
    mutateAndResign(missingHash, "runner_isolation_attestation", (source) => {
      delete source.result.attestations[0].resultSha256;
    });
    assert.throws(() => assess(missingHash), /sandbox attestation schema/);
  });

  it("does not let a 100-point score override a failed binary gate", () => {
    const rubric = structuredClone(RUBRIC);
    for (const category of rubric.scoreCategories) {
      for (const criterion of category.criteria) {
        criterion.requiredEvidenceSourceIds = criterion.requiredEvidenceSourceIds.map((id) =>
          id === "protected_aggregate" ? "generated_private_regression" : id
        );
      }
    }
    const value = fixture(rubric);
    mutateAndResign(value, "protected_aggregate", (source) => {
      source.result.aggregate.falseSupportedCount = 1;
    });
    synchronizeRequirementResultHash(value);

    const result = assess(value);
    assert.equal(result.score, 100);
    assert.equal(result.binaryGates.find((gate) => gate.id === "protected_release_gate").state, "failed");
    assert.equal(result.decision, "no_go");
  });

  it("returns eligible_for_deployment_approval at exactly 95 when every binary gate passes", () => {
    const rubric = structuredClone(RUBRIC);
    rubric.scoreCategories[0].criteria[0].points = 15;
    rubric.scoreCategories[0].criteria[1].points = 5;
    const value = fixture(rubric);
    mutateAndResign(value, "generated_private_regression", (source) => {
      source.result.commands[0].exitCode = 1;
    });

    const parserHashes = value.manifest.parserArtifacts.map((artifact) => artifact.entrySha256);
    const result = assess(value);
    assert.equal(result.score, 95);
    assert.ok(result.binaryGates.every((gate) => gate.state === "passed"));
    assert.equal(result.decision, "eligible_for_deployment_approval");
    assert.deepEqual(Object.keys(result), [
      "version", "rubricId", "candidateSha", "score", "maximumScore", "categoryScores", "binaryGates", "decision"
    ]);
    assert.ok(!JSON.stringify(result).includes("commands"));
    assert.ok(!JSON.stringify(result).includes("attestations"));
    assert.ok(!JSON.stringify(result).includes("corpusSummaries"));
    assert.ok(!JSON.stringify(result).includes("summarySha256"));
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

function fixture(rubric = structuredClone(RUBRIC)) {
  const candidateSha = hex("a", 40);
  const rubricSha256 = canonicalSha(rubric);
  const manifest = frozenManifest(rubricSha256, candidateSha);
  const toolchainManifestSha256 = canonicalSha(manifest);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const context = { candidateSha, manifest, toolchainManifestSha256, rubricSha256 };
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
      version: 1,
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

function synchronizeRequirementResultHash(value) {
  const aggregate = value.evidence.evidenceSources.find((source) => source.id === "protected_aggregate");
  const resultSha256 = canonicalSha(aggregate.result);
  for (const id of ["freeze_manifest", "protected_aggregate", "runner_isolation_attestation"]) {
    mutateAndResign(value, id, (source) => {
      source.bindings.requirementResultSha256 = resultSha256;
      if (id === "runner_isolation_attestation") {
        source.result.attestations.find((attestation) => attestation.surface === "requirement").resultSha256 = resultSha256;
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

function bindingValue(name, context) {
  const requirementInputSha256 = hex(hashNibble("requirementInputSha256"));
  const boundaryInputSha256 = hex(hashNibble("boundaryInputSha256"));
  const exact = {
    candidateSha: context.candidateSha,
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
    packageScriptsSha256: context.manifest.packageScripts.sha256,
    lockfileSha256: context.manifest.lockfile.sha256,
    nodeVersion: context.manifest.runtime.nodeVersion,
    pnpmVersion: context.manifest.runtime.pnpmVersion,
    runtimeImageDigest: context.manifest.runtime.runtimeImageDigest,
    rubricSha256: context.rubricSha256,
    requirementRunnerBundleSha256: context.manifest.bundles.find((bundle) => bundle.id === "requirement_runner").sha256,
    boundaryRunnerBundleSha256: context.manifest.bundles.find((bundle) => bundle.id === "boundary_runner").sha256,
    requirementResultSha256: canonicalSha({ aggregate: requirementAggregate() }),
    boundaryResultSha256: canonicalSha({ aggregate: boundaryAggregate() }),
    requirementInputSha256,
    boundaryInputSha256,
    requirementCorpusSummarySha256: corpusSummary(requirementInputSha256, [0, 0, 4]).summarySha256,
    boundaryCorpusSummarySha256: corpusSummary(boundaryInputSha256, [4, 4, 0]).summarySha256,
    networkMode: "disabled",
    reviewerIdentity: "independent-reviewer",
    reviewState: "approved"
  };
  return exact[name] ?? hex(hashNibble(name));
}

function evidenceResult(definition, context) {
  if (definition.id === "freeze_manifest") return {
    manifestSha256: context.toolchainManifestSha256,
    corpusSummaries: {
      requirement: corpusSummary(bindingValue("requirementInputSha256", context), [0, 0, 4]),
      boundary: corpusSummary(bindingValue("boundaryInputSha256", context), [4, 4, 0])
    }
  };
  if (definition.id === "protected_aggregate") return { aggregate: requirementAggregate() };
  if (definition.id === "protected_boundary_aggregate") return { aggregate: boundaryAggregate() };
  if (definition.id === "runner_isolation_attestation") return {
    attestations: [
      sandboxAttestation("requirement", context, definition),
      sandboxAttestation("boundary", context, definition)
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

function sandboxAttestation(surface, context, definition) {
  const bindings = Object.fromEntries((definition.requiredBindings ?? []).map((name) => [name, bindingValue(name, context)]));
  const runnerBundleSha256 = bindings[surface === "requirement" ? "requirementRunnerBundleSha256" : "boundaryRunnerBundleSha256"];
  const inputSha256 = bindings[surface === "requirement" ? "requirementInputSha256" : "boundaryInputSha256"];
  const resultSha256 = bindings[surface === "requirement" ? "requirementResultSha256" : "boundaryResultSha256"];
  return {
    version: 1,
    surface,
    candidateSha: context.candidateSha,
    runnerBundleSha256,
    runnerSandboxProfileSha256: context.manifest.runnerSandboxProfile.sha256,
    runtimeImageDigest: context.manifest.runtime.runtimeImageDigest,
    inputSha256,
    mountedReadOnlyFileSetSha256: bindings.mountedReadOnlyFileSetSha256,
    networkMode: "disabled",
    readOnlyMounts: [
      { kind: "candidate_sut", binding: context.candidateSha },
      { kind: "protected_input", binding: inputSha256 },
      { kind: "runner_bundle", binding: runnerBundleSha256 },
      { kind: "runtime_profile", binding: context.manifest.runnerSandboxProfile.sha256 }
    ],
    writableMounts: [{ kind: "result" }],
    resultSha256
  };
}

function requirementAggregate() {
  return {
    totalCases: 4,
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
    { id: "boundary_runner", path: "dist/boundary.mjs", sha256: hex("3") },
    { id: "requirement_runner", path: "dist/requirement.mjs", sha256: hex("4") },
    { id: "rubric", path: "docs/rubric.json", sha256: rubricSha256 }
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
    runnerSandboxProfile: { path: "sandbox-profile.json", sha256: hex("7") },
    packageScripts: { entries: packageEntries, sha256: canonicalSha(packageEntries) },
    lockfile: { path: "pnpm-lock.yaml", sha256: hex("9") },
    runtime: {
      path: "runtime.json",
      sha256: hex("a"),
      nodeVersion: "v22.19.0",
      pnpmVersion: "10.32.1",
      runtimeImageDigest: `sha256:${hex("b")}`
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
