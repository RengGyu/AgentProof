import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import {
  buildEvaluationToolchainManifestV2,
  canonicalSha256,
  validateEvaluationToolchainManifestV2,
  verifyEvaluationToolchainManifestV2
} from "./build-evaluation-toolchain-manifest.mjs";

const manifestKeys = [
  "version", "policyId", "candidateSha", "toolingEntries", "toolingEntrySetSha256",
  "sourceFiles", "evaluationToolchainSourceClosureSha256", "moduleEdges", "moduleEdgeSetSha256",
  "nodeBuiltins", "nodeBuiltinAllowlistSha256", "approvedNodeBuiltinUniverseSha256",
  "sutExternalImports", "sutExternalImportAllowlistSha256", "parserArtifact", "resolutionPolicy",
  "resolutionPolicySha256", "bundles", "evaluationToolchainBundleSetSha256", "runnerSandboxProfile",
  "packageScripts", "lockfile", "runtime"
];

function expectCode(action, code) {
  assert.throws(action, (error) => error?.code === code);
}

describe("build-evaluation-toolchain-manifest", () => {
  it("builds the exact deterministic V2 manifest and canonicalizes bare built-ins", () => withToolTree(({ root, config }) => {
    const first = buildEvaluationToolchainManifestV2({ rootDir: root, config });
    const second = buildEvaluationToolchainManifestV2({ rootDir: root, config });

    assert.deepEqual(first, second);
    assert.deepEqual(Object.keys(first), manifestKeys);
    assert.deepEqual(first.toolingEntries, ["tools/runner.mjs"]);
    assert.deepEqual(first.sourceFiles.map((file) => file.path), ["tools/helper.mjs", "tools/runner.mjs"]);
    assert.deepEqual(first.moduleEdges, [
      { importerPath: "tools/runner.mjs", kind: "runtime_import", specifier: "./helper.mjs", targetKind: "tooling", targetRef: "tools/helper.mjs" },
      { importerPath: "tools/runner.mjs", kind: "runtime_import", specifier: "crypto", targetKind: "node_builtin", targetRef: "node:crypto" },
      { importerPath: "tools/runner.mjs", kind: "runtime_import", specifier: "typescript", targetKind: "parser_artifact", targetRef: "typescript" }
    ]);
    assert.deepEqual(first.nodeBuiltins, ["node:crypto"]);
    assert.equal(first.toolingEntrySetSha256, canonicalSha256(first.toolingEntries));
    assert.equal(first.moduleEdgeSetSha256, canonicalSha256(first.moduleEdges));
    assert.equal(first.nodeBuiltinAllowlistSha256, canonicalSha256(first.nodeBuiltins));
    assert.equal(first.approvedNodeBuiltinUniverseSha256, canonicalSha256([
      "node:crypto", "node:fs", "node:path", "node:perf_hooks", "node:url", "node:util"
    ]));
    assert.equal(first.parserArtifact.id, "typescript");
    assert.equal(first.parserArtifact.version, "5.9.3");
    assert.ok(!JSON.stringify(first.parserArtifact).includes(root));
    assert.equal(validateEvaluationToolchainManifestV2(first), true);
    assert.deepEqual(verifyEvaluationToolchainManifestV2({ rootDir: root, config, manifest: first }), first);
  }));

  it("rejects every changed V2 binding when it is independently rebuilt", () => withToolTree(({ root, config }) => {
    const frozen = buildEvaluationToolchainManifestV2({ rootDir: root, config });
    for (const mutate of [
      (manifest) => { manifest.candidateSha = "b".repeat(40); },
      (manifest) => { manifest.toolingEntries[0] = "tools/helper.mjs"; },
      (manifest) => { manifest.sourceFiles[0].sha256 = "f".repeat(64); },
      (manifest) => { manifest.moduleEdges[0].kind = "type_import"; },
      (manifest) => { manifest.moduleEdges[0].specifier = "./other.mjs"; },
      (manifest) => { manifest.moduleEdges[0].targetRef = "tools/runner.mjs"; },
      (manifest) => { manifest.nodeBuiltins = []; },
      (manifest) => { manifest.parserArtifact.entrySha256 = "f".repeat(64); },
      (manifest) => { manifest.resolutionPolicy.target = "ES2023"; },
      (manifest) => { manifest.bundles[0].sha256 = "f".repeat(64); },
      (manifest) => { manifest.runnerSandboxProfile.sha256 = "f".repeat(64); },
      (manifest) => { manifest.packageScripts.entries[0].command = "node changed.mjs"; },
      (manifest) => { manifest.lockfile.sha256 = "f".repeat(64); },
      (manifest) => { manifest.runtime.runtimeImageDigest = `sha256:${"f".repeat(64)}`; }
    ]) {
      const changed = structuredClone(frozen);
      mutate(changed);
      expectCode(
        () => verifyEvaluationToolchainManifestV2({ rootDir: root, config, manifest: changed }),
        "MANIFEST_BINDING_INVALID"
      );
    }
  }));

  it("rejects malformed schema, rollups, unbound targets, and V1 manifests", () => withToolTree(({ root, config }) => {
    const frozen = buildEvaluationToolchainManifestV2({ rootDir: root, config });
    for (const mutate of [
      (manifest) => { manifest.extra = true; },
      (manifest) => { delete manifest.candidateSha; },
      (manifest) => { manifest.moduleEdges.push(structuredClone(manifest.moduleEdges[0])); },
      (manifest) => { manifest.moduleEdges.reverse(); },
      (manifest) => { manifest.moduleEdges[0].targetRef = "src/unbound.ts"; },
      (manifest) => { manifest.nodeBuiltins = ["node:os"]; },
      (manifest) => { manifest.bundles = manifest.bundles.filter((bundle) => bundle.id !== "authority_cli_bootstrap"); },
      (manifest) => { manifest.bundles.find((bundle) => bundle.id === "authority_cli_bootstrap").path = "tools/helper.mjs"; },
      (manifest) => { manifest.parserArtifact.loadedBindingSha256 = "f".repeat(64); },
      (manifest) => { manifest.resolutionPolicySha256 = "f".repeat(64); }
    ]) {
      const changed = structuredClone(frozen);
      mutate(changed);
      expectCode(() => validateEvaluationToolchainManifestV2(changed), "MANIFEST_BINDING_INVALID");
    }
    expectCode(() => validateEvaluationToolchainManifestV2({ version: 1 }), "MANIFEST_BINDING_INVALID");
  }));

  it("requires the exact bound authority CLI bootstrap in every closure", () => withToolTree(({ root, config }) => {
    expectCode(
      () => buildEvaluationToolchainManifestV2({
        rootDir: root,
        config: { ...config, bundleFiles: config.bundleFiles.filter((bundle) => bundle.id !== "authority_cli_bootstrap") }
      }),
      "MANIFEST_BINDING_INVALID"
    );
    expectCode(
      () => buildEvaluationToolchainManifestV2({
        rootDir: root,
        config: {
          ...config,
          bundleFiles: config.bundleFiles.map((bundle) => bundle.id === "authority_cli_bootstrap"
            ? { ...bundle, path: "tools/helper.mjs" }
            : bundle)
        }
      }),
      "MANIFEST_BINDING_INVALID"
    );
  }));

  it("rejects self-consistent edge and parser mutations that do not match their real binding", () => withToolTree(({ root, config }) => {
    const frozen = buildEvaluationToolchainManifestV2({ rootDir: root, config });
    const changedEdge = structuredClone(frozen);
    changedEdge.moduleEdges[0].specifier = "./different.mjs";
    changedEdge.moduleEdgeSetSha256 = canonicalSha256(changedEdge.moduleEdges);
    expectCode(() => validateEvaluationToolchainManifestV2(changedEdge), "MANIFEST_BINDING_INVALID");

    const changedParser = structuredClone(frozen);
    changedParser.parserArtifact.entryPath = "lib/other.js";
    changedParser.parserArtifact.entrySha256 = "f".repeat(64);
    changedParser.parserArtifact.loadedBindingSha256 = canonicalSha256({
      id: changedParser.parserArtifact.id,
      version: changedParser.parserArtifact.version,
      entryPath: changedParser.parserArtifact.entryPath,
      entrySha256: changedParser.parserArtifact.entrySha256,
      packageJsonPath: changedParser.parserArtifact.packageJsonPath,
      packageJsonSha256: changedParser.parserArtifact.packageJsonSha256
    });
    expectCode(() => validateEvaluationToolchainManifestV2(changedParser), "MANIFEST_BINDING_INVALID");
  }));

  it("requires the exact used Node-builtin allowlist", () => withToolTree(({ root, config }) => {
    expectCode(
      () => buildEvaluationToolchainManifestV2({ rootDir: root, config: { ...config, nodeBuiltins: [] } }),
      "MANIFEST_BINDING_INVALID"
    );
    writeFileSync(join(root, "tools", "runner.mjs"), 'import ts from "typescript"; export { ts };\n');
    expectCode(
      () => buildEvaluationToolchainManifestV2({ rootDir: root, config }),
      "MANIFEST_BINDING_INVALID"
    );
  }));

  it("rejects a direct Acorn dependency in every root dependency section", () => withToolTree(({ root, config }) => {
    for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      const packageJson = {
        devDependencies: { typescript: "5.9.3" },
        [section]: {
          ...(section === "devDependencies" ? { typescript: "5.9.3" } : {}),
          acorn: "8.17.0"
        }
      };
      writeFileSync(join(root, "package.json"), JSON.stringify(packageJson));
      expectCode(
        () => buildEvaluationToolchainManifestV2({ rootDir: root, config }),
        "PARSER_BINDING_INVALID"
      );
    }
  }));

  it("binds type-only SUT leaves without scanning them and terminates a tooling cycle", () => withToolTree(({ root, config }) => {
    writeFileSync(join(root, "tools", "runner.ts"), [
      'import type { Verifier } from "../src/verifier";',
      'import ts from "typescript";',
      'import { helper } from "./helper";',
      'void ts; void helper;',
      'export type { Verifier };'
    ].join("\n"));
    writeFileSync(join(root, "tools", "helper.ts"), 'import { marker } from "./runner"; export const helper = marker;\n');
    writeFileSync(join(root, "src", "verifier.ts"), "export type Verifier = never;\n");
    const typedConfig = {
      ...config,
      toolingEntries: ["tools/runner.ts"],
      toolingFiles: ["tools/helper.ts", "tools/runner.ts"],
      sutExternalImports: ["src/verifier.ts"],
      nodeBuiltins: []
    };
    const manifest = buildEvaluationToolchainManifestV2({ rootDir: root, config: typedConfig });
    assert.ok(manifest.moduleEdges.some((edge) => edge.targetKind === "sut_external" && edge.kind === "type_import"));
    assert.equal(manifest.sourceFiles.some((file) => file.path === "src/verifier.ts"), false);
    assert.equal(manifest.moduleEdges.filter((edge) => edge.targetKind === "tooling").length, 2);
  }));

  it("emits only bounded JSON when the CLI cannot build a manifest", () => withToolTree(({ root, config }) => {
    const configPath = join(root, "config.json");
    const outputPath = join(root, "manifest.json");
    writeFileSync(configPath, JSON.stringify({ ...config, version: 1 }));
    const result = spawnSync(process.execPath, [
      new URL("./build-evaluation-toolchain-manifest.mjs", import.meta.url).pathname,
      "--root", root,
      "--config", configPath,
      "--output", outputPath
    ], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.deepEqual(JSON.parse(result.stderr), {
      version: 1,
      ok: false,
      errorCode: "MANIFEST_BINDING_INVALID"
    });
    assert.equal(result.stderr.includes(root), false);
    assert.equal(readFileSync(configPath, "utf8").includes(root), false);
  }));
});

function withToolTree(run) {
  const root = mkdtempSync(join(tmpdir(), "agentproof-toolchain-manifest-"));
  try {
    for (const directory of ["tools", "src", "dist", "scripts"]) mkdirSync(join(root, directory));
    writeFileSync(join(root, "tools", "runner.mjs"), [
      'import { helper } from "./helper.mjs";',
      'import { createHash } from "crypto";',
      'import ts from "typescript";',
      'void helper; void createHash; void ts;'
    ].join("\n"));
    writeFileSync(join(root, "tools", "helper.mjs"), "export const helper = 1;\n");
    writeFileSync(join(root, "scripts", "evaluate-production-authority-release-cli.mjs"), "export {};\n");
    writeFileSync(join(root, "src", "verifier.ts"), "export type Verifier = never;\n");
    writeFileSync(join(root, "dist", "runner.bundle.mjs"), "export {};\n");
    writeFileSync(join(root, "dist", "boundary.bundle.mjs"), "export {};\n");
    writeFileSync(join(root, "sandbox-profile.json"), JSON.stringify(sandboxProfile()));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      devDependencies: { typescript: "5.9.3" },
      scripts: { "eval:z": "node z.mjs", "eval:a": "node a.mjs" }
    }));
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    writeFileSync(join(root, "runtime.json"), JSON.stringify({
      version: 1,
      nodeVersion: "v22.19.0",
      pnpmVersion: "10.32.1",
      runtimeImageDigest: `sha256:${"a".repeat(64)}`
    }));
    return run({ root, config: manifestConfig() });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function manifestConfig() {
  return {
    version: 2,
    candidateSha: "a".repeat(40),
    nodeBuiltins: ["node:crypto"],
    toolingEntries: ["tools/runner.mjs"],
    toolingFiles: ["tools/helper.mjs", "tools/runner.mjs"],
    sutExternalImports: [],
    bundleFiles: [
      { id: "requirement_runner", path: "dist/runner.bundle.mjs" },
      { id: "boundary_runner", path: "dist/boundary.bundle.mjs" },
      { id: "authority_cli_bootstrap", path: "scripts/evaluate-production-authority-release-cli.mjs" }
    ],
    sandboxProfilePath: "sandbox-profile.json",
    packageJsonPath: "package.json",
    packageScriptNames: ["eval:z", "eval:a"],
    lockfilePath: "pnpm-lock.yaml",
    runtimePath: "runtime.json"
  };
}

function sandboxProfile() {
  return {
    version: 1,
    networkMode: "disabled",
    readOnlyMountKinds: ["candidate_sut", "protected_input", "runner_bundle", "runtime_profile"],
    writableMountKinds: ["result"]
  };
}
