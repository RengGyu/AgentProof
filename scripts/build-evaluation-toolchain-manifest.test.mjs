import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import * as acorn from "acorn";
import ts from "typescript";
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
  "toolingBuiltinImports", "evaluationToolchainBuiltinAllowlistSha256",
  "sutExternalImports", "sutExternalImportAllowlistSha256", "parserArtifacts", "resolutionPolicy",
  "resolutionPolicySha256", "bundles", "evaluationToolchainBundleSetSha256", "runnerSandboxProfile", "evaluatorSandboxProfile", "referencePolicy", "authorityRubric",
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
    assert.deepEqual(first.toolingBuiltinImports, ["node:crypto"]);
    assert.equal(first.toolingEntrySetSha256, canonicalSha256(first.toolingEntries));
    assert.equal(first.moduleEdgeSetSha256, canonicalSha256(first.moduleEdges));
    assert.equal(first.nodeBuiltinAllowlistSha256, canonicalSha256(first.nodeBuiltins));
    assert.equal(first.evaluationToolchainBuiltinAllowlistSha256, canonicalSha256(first.toolingBuiltinImports));
    assert.equal(first.approvedNodeBuiltinUniverseSha256, canonicalSha256([
      "node:crypto", "node:fs", "node:path", "node:perf_hooks", "node:url", "node:util"
    ]));
    assert.deepEqual(first.parserArtifacts, runtimeParserArtifacts());
    assert.equal(
      first.evaluationToolchainSourceClosureSha256,
      canonicalSha256({ sourceFiles: first.sourceFiles, parserArtifacts: first.parserArtifacts })
    );
    assert.ok(!JSON.stringify(first.parserArtifacts).includes(root));
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
      (manifest) => { manifest.parserArtifacts[0].entrySha256 = "f".repeat(64); },
      (manifest) => { manifest.resolutionPolicy.target = "ES2023"; },
      (manifest) => { manifest.bundles[0].sha256 = "f".repeat(64); },
      (manifest) => { manifest.runnerSandboxProfile.sha256 = "f".repeat(64); },
      (manifest) => { manifest.evaluatorSandboxProfile.sha256 = "f".repeat(64); },
      (manifest) => { manifest.referencePolicy.sha256 = "f".repeat(64); },
      (manifest) => { manifest.authorityRubric.sha256 = "f".repeat(64); },
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
      (manifest) => { manifest.evaluationToolchainSourceClosureSha256 = canonicalSha256(manifest.sourceFiles); },
      (manifest) => { manifest.bundles = manifest.bundles.filter((bundle) => bundle.id !== "authority_cli_bootstrap"); },
      (manifest) => { manifest.bundles.find((bundle) => bundle.id === "authority_cli_bootstrap").path = "tools/helper.mjs"; },
      (manifest) => { manifest.parserArtifacts[0].version = "8.16.0"; },
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

  it("rejects any non-built-in import from the separately bound reference policy", () => withToolTree(({ root, config }) => {
    writeFileSync(join(root, "tools", "reference-policy.mjs"), 'import "./helper.mjs";\nexport const policy = 1;\n');
    expectCode(() => buildEvaluationToolchainManifestV2({ rootDir: root, config }), "MANIFEST_BINDING_INVALID");
  }));

  it("rejects self-consistent edge and parser mutations that do not match their real binding", () => withToolTree(({ root, config }) => {
    const frozen = buildEvaluationToolchainManifestV2({ rootDir: root, config });
    const changedEdge = structuredClone(frozen);
    changedEdge.moduleEdges[0].specifier = "./different.mjs";
    changedEdge.moduleEdgeSetSha256 = canonicalSha256(changedEdge.moduleEdges);
    expectCode(() => validateEvaluationToolchainManifestV2(changedEdge), "MANIFEST_BINDING_INVALID");

    const changedParser = structuredClone(frozen);
    changedParser.parserArtifacts[0].entrySha256 = "f".repeat(64);
    changedParser.evaluationToolchainSourceClosureSha256 = canonicalSha256({
      sourceFiles: changedParser.sourceFiles,
      parserArtifacts: changedParser.parserArtifacts
    });
    expectCode(() => validateEvaluationToolchainManifestV2(changedParser), "MANIFEST_BINDING_INVALID");
  }));

  it("rejects missing, duplicate, unknown, unsorted, malformed, and mismatched parser artifacts", () => withToolTree(({ root, config }) => {
    const frozen = buildEvaluationToolchainManifestV2({ rootDir: root, config });
    for (const mutate of [
      (manifest) => { delete manifest.parserArtifacts; },
      (manifest) => { manifest.parserArtifacts.push(structuredClone(manifest.parserArtifacts[0])); },
      (manifest) => { manifest.parserArtifacts[0].id = "babel"; },
      (manifest) => { manifest.parserArtifacts.reverse(); },
      (manifest) => { manifest.parserArtifacts[0].extra = true; },
      (manifest) => { manifest.parserArtifacts[0].version = "8.16.0"; },
      (manifest) => { manifest.parserArtifacts[0].entrySha256 = "f".repeat(64); }
    ]) {
      const changed = structuredClone(frozen);
      mutate(changed);
      expectCode(() => validateEvaluationToolchainManifestV2(changed), "MANIFEST_BINDING_INVALID");
    }
  }));

  it("rejects missing, duplicate, unknown, unsafe, unsorted, and stale tooling built-in allowances", () => withToolTree(({ root, config }) => {
    const frozen = buildEvaluationToolchainManifestV2({ rootDir: root, config });
    for (const mutate of [
      (manifest) => { delete manifest.toolingBuiltinImports; },
      (manifest) => { manifest.toolingBuiltinImports.push("node:crypto"); },
      (manifest) => { manifest.toolingBuiltinImports = ["node:fs", "node:crypto"]; },
      (manifest) => { manifest.toolingBuiltinImports = ["node:os"]; },
      (manifest) => { manifest.toolingBuiltinImports = ["node:child_process"]; },
      (manifest) => { manifest.evaluationToolchainBuiltinAllowlistSha256 = "f".repeat(64); }
    ]) {
      const changed = structuredClone(frozen);
      mutate(changed);
      expectCode(() => validateEvaluationToolchainManifestV2(changed), "MANIFEST_BINDING_INVALID");
    }
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

  it("binds bare Acorn and TypeScript imports only as their parser artifacts", () => withToolTree(({ root, config }) => {
    writeFileSync(join(root, "tools", "runner.mjs"), [
      'import * as acorn from "acorn";',
      'import ts from "typescript";',
      'void acorn; void ts;'
    ].join("\n"));
    const parserOnly = buildEvaluationToolchainManifestV2({
      rootDir: root,
      config: { ...config, nodeBuiltins: [], toolingFiles: ["tools/runner.mjs"] }
    });
    assert.deepEqual(parserOnly.moduleEdges, [
      { importerPath: "tools/runner.mjs", kind: "runtime_import", specifier: "acorn", targetKind: "parser_artifact", targetRef: "acorn" },
      { importerPath: "tools/runner.mjs", kind: "runtime_import", specifier: "typescript", targetKind: "parser_artifact", targetRef: "typescript" }
    ]);
  }));

  it("requires Acorn 8.17.0 as the direct development parser dependency", () => withToolTree(({ root, config }) => {
    writeFileSync(join(root, "package.json"), JSON.stringify({
      devDependencies: { acorn: "8.17.0", typescript: "5.9.3" },
      scripts: { "eval:z": "node z.mjs", "eval:a": "node a.mjs" }
    }));
    assert.doesNotThrow(() => buildEvaluationToolchainManifestV2({ rootDir: root, config }));

    for (const [label, packageJson] of [
      ["missing", { devDependencies: { typescript: "5.9.3" } }],
      ["range", { devDependencies: { acorn: "^8.17.0", typescript: "5.9.3" } }],
      ["runtime", { dependencies: { acorn: "8.17.0" }, devDependencies: { typescript: "5.9.3" } }],
      ["optional", { optionalDependencies: { acorn: "8.17.0" }, devDependencies: { typescript: "5.9.3" } }],
      ["peer", { peerDependencies: { acorn: "8.17.0" }, devDependencies: { typescript: "5.9.3" } }]
    ]) {
      writeFileSync(join(root, "package.json"), JSON.stringify({
        ...packageJson,
        scripts: { "eval:z": "node z.mjs", "eval:a": "node a.mjs" }
      }));
      expectCode(() => buildEvaluationToolchainManifestV2({ rootDir: root, config }), "PARSER_BINDING_INVALID", label);
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

  it("closes declared JavaScript, CommonJS, and TSX dependencies with package mode evidence", () => withToolTree(({ root, config }) => {
    writeFileSync(join(root, "tools", "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(root, "tools", "runner.js"), 'import "./helper.js";\n');
    writeFileSync(join(root, "tools", "helper.js"), "export {};\n");
    writeFileSync(join(root, "tools", "script.cjs"), 'require("./helper.cjs");\n');
    writeFileSync(join(root, "tools", "helper.cjs"), "void 0;\n");
    writeFileSync(join(root, "tools", "view.tsx"), 'import "./widget"; export const view = <div />;\n');
    writeFileSync(join(root, "tools", "widget.tsx"), "export {};\n");
    const expanded = {
      ...config,
      toolingEntries: ["tools/runner.js", "tools/script.cjs", "tools/view.tsx"],
      toolingFiles: [
        "tools/helper.cjs", "tools/helper.js", "tools/package.json", "tools/runner.js",
        "tools/script.cjs", "tools/view.tsx", "tools/widget.tsx"
      ],
      nodeBuiltins: []
    };

    const manifest = buildEvaluationToolchainManifestV2({ rootDir: root, config: expanded });

    assert.deepEqual(manifest.sourceFiles.map((file) => file.path), expanded.toolingFiles);
    assert.deepEqual(manifest.moduleEdges.map((edge) => [edge.importerPath, edge.targetRef]), [
      ["tools/runner.js", "tools/helper.js"],
      ["tools/script.cjs", "tools/helper.cjs"],
      ["tools/view.tsx", "tools/widget.tsx"]
    ]);
    assert.equal(validateEvaluationToolchainManifestV2(manifest), true);
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
    for (const directory of ["tools", "src", "dist", "scripts", "docs"]) mkdirSync(join(root, directory));
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
    writeFileSync(join(root, "dist", "requirement-evaluator.bundle.mjs"), "export {};\n");
    writeFileSync(join(root, "dist", "boundary-evaluator.bundle.mjs"), "export {};\n");
    writeFileSync(join(root, "dist", "reference-policy.bundle.mjs"), "export {};\n");
    writeFileSync(join(root, "tools", "reference-policy.mjs"), "export const policy = 1;\n");
    writeFileSync(join(root, "docs", "authority-rubric.v2.json"), "{\"version\":2}\n");
    writeFileSync(join(root, "runner-sandbox-profile.json"), JSON.stringify(sandboxProfile()));
    writeFileSync(join(root, "evaluator-sandbox-profile.json"), JSON.stringify(evaluatorSandboxProfile()));
    writeFileSync(join(root, "package.json"), JSON.stringify({
      devDependencies: { acorn: "8.17.0", typescript: "5.9.3" },
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
      { id: "requirement_evaluator", path: "dist/requirement-evaluator.bundle.mjs" },
      { id: "boundary_evaluator", path: "dist/boundary-evaluator.bundle.mjs" },
      { id: "reference_policy", path: "dist/reference-policy.bundle.mjs" },
      { id: "authority_cli_bootstrap", path: "scripts/evaluate-production-authority-release-cli.mjs" }
    ],
    runnerSandboxProfilePath: "runner-sandbox-profile.json",
    evaluatorSandboxProfilePath: "evaluator-sandbox-profile.json",
    referencePolicyPath: "tools/reference-policy.mjs",
    authorityRubricPath: "docs/authority-rubric.v2.json",
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

function evaluatorSandboxProfile() {
  return {
    version: 1,
    networkMode: "disabled",
    readOnlyMountKinds: ["protected_input", "policy_seal", "candidate_result", "reference_policy", "evaluator_bundle", "runtime_profile"],
    writableMountKinds: ["aggregate_result"]
  };
}

function runtimeParserArtifacts() {
  return [
    { id: "acorn", version: acorn.version, entrySha256: entrySha256("acorn") },
    { id: "typescript", version: ts.version, entrySha256: entrySha256("typescript") }
  ];
}

function entrySha256(id) {
  return createHash("sha256")
    .update(readFileSync(fileURLToPath(import.meta.resolve(id))))
    .digest("hex");
}
