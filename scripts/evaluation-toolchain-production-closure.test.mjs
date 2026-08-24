import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  buildEvaluationToolchainManifestV2,
  canonicalSha256,
  validateEvaluationToolchainManifestV2,
  verifyEvaluationToolchainManifestV2
} from "./build-evaluation-toolchain-manifest.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const toolingEntries = [
  "scripts/build-evaluation-toolchain-manifest.mjs",
  "scripts/evaluate-production-authority-release.mjs",
  "src/lib/production-boundary-evaluation-runner.ts",
  "src/lib/release-evaluation-runner.ts"
];
const toolingFiles = [
  "scripts/build-evaluation-toolchain-manifest.mjs",
  "scripts/evaluate-evidence-release-gate.mjs",
  "scripts/evaluate-production-authority-release.mjs",
  "scripts/evaluate-production-boundary-release-gate.mjs",
  "scripts/toolchain-closure-policy.mjs",
  "scripts/tooling-module-resolution.mjs",
  "scripts/tooling-source-scan.mjs",
  "src/lib/production-boundary-evaluation-runner.ts",
  "src/lib/release-evaluation-runner.ts"
];
const sutExternalImports = [
  "src/lib/analyze-request.ts",
  "src/lib/github.ts",
  "src/lib/redact.ts",
  "src/lib/report-runtime-validation.ts",
  "src/lib/report-share.ts",
  "src/lib/report-validation.ts",
  "src/lib/server-report-store.ts",
  "src/lib/tenant-report-validation.ts",
  "src/lib/types.ts",
  "src/lib/verification-contract-v2.ts",
  "src/lib/verifier.ts"
];

describe("evaluation-toolchain-production-closure", () => {
  it("rebuilds the exact non-protected static closure deterministically", () => {
    const root = mkdtempSync(join("/private/tmp", "agentproof-production-closure-"));
    try {
      for (const path of [
        ...toolingFiles,
        ...sutExternalImports,
        "scripts/evaluate-production-authority-release-cli.mjs",
        "package.json",
        "pnpm-lock.yaml"
      ]) copyIntoFixture(root, path);
      mkdirSync(join(root, "dist"), { recursive: true });
      writeFileSync(join(root, "dist", "requirement.bundle.mjs"), "export {};\n");
      writeFileSync(join(root, "dist", "boundary.bundle.mjs"), "export {};\n");
      writeFileSync(join(root, "sandbox-profile.json"), JSON.stringify({
        version: 1,
        networkMode: "disabled",
        readOnlyMountKinds: ["candidate_sut", "protected_input", "runner_bundle", "runtime_profile"],
        writableMountKinds: ["result"]
      }));
      writeFileSync(join(root, "runtime.json"), JSON.stringify({
        version: 1,
        nodeVersion: "v22.19.0",
        pnpmVersion: "10.32.1",
        runtimeImageDigest: `sha256:${"a".repeat(64)}`
      }));
      const config = {
        version: 2,
        candidateSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim(),
        nodeBuiltins: ["node:crypto", "node:fs", "node:path", "node:perf_hooks", "node:url"],
        toolingEntries,
        toolingFiles,
        sutExternalImports,
        bundleFiles: [
          { id: "requirement_runner", path: "dist/requirement.bundle.mjs" },
          { id: "boundary_runner", path: "dist/boundary.bundle.mjs" },
          { id: "authority_cli_bootstrap", path: "scripts/evaluate-production-authority-release-cli.mjs" }
        ],
        sandboxProfilePath: "sandbox-profile.json",
        packageJsonPath: "package.json",
        packageScriptNames: [
          "eval:evidence:candidates",
          "eval:evidence:release",
          "eval:production-authority:release",
          "eval:production-boundary:candidates",
          "eval:production-boundary:release",
          "eval:toolchain:manifest"
        ],
        lockfilePath: "pnpm-lock.yaml",
        runtimePath: "runtime.json"
      };
      const first = buildEvaluationToolchainManifestV2({ rootDir: root, config });
      const second = buildEvaluationToolchainManifestV2({ rootDir: root, config });

      assert.deepEqual(first, second);
      assert.equal(canonicalSha256(first), canonicalSha256(second));
      assert.equal(validateEvaluationToolchainManifestV2(first), true);
      assert.deepEqual(verifyEvaluationToolchainManifestV2({ rootDir: root, config, manifest: first }), first);
      assert.equal(first.moduleEdges.some((edge) => edge.targetKind === "sut_external" && !sutExternalImports.includes(edge.targetRef)), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function copyIntoFixture(root, path) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(join(repositoryRoot, path), target, { dereference: true });
}
