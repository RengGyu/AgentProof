import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, posix, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as acorn from "acorn";
import ts from "typescript";
import {
  APPROVED_NODE_BUILTINS_V1,
  FROZEN_TOOLING_RESOLUTION_POLICY_V1,
  TOOLCHAIN_POLICY_ID,
  normalizeNodeBuiltinSpecifier,
  ToolchainClosureError,
  toolchainFailure
} from "./toolchain-closure-policy.mjs";
import { resolveToolingModuleEdges } from "./tooling-module-resolution.mjs";
import { resolveToolingSourceDescriptor, scanToolingSource } from "./tooling-source-scan.mjs";

const CONFIG_KEYS = [
  "version", "candidateSha", "nodeBuiltins", "toolingEntries", "toolingFiles", "sutExternalImports", "bundleFiles",
  "runnerSandboxProfilePath", "evaluatorSandboxProfilePath", "referencePolicyPath",
  "authorityRubricPath", "packageJsonPath", "packageScriptNames", "lockfilePath", "runtimePath"
];
const MANIFEST_KEYS = [
  "version", "policyId", "candidateSha", "toolingEntries", "toolingEntrySetSha256",
  "sourceFiles", "evaluationToolchainSourceClosureSha256", "moduleEdges", "moduleEdgeSetSha256",
  "nodeBuiltins", "nodeBuiltinAllowlistSha256", "approvedNodeBuiltinUniverseSha256",
  "toolingBuiltinImports", "evaluationToolchainBuiltinAllowlistSha256",
  "sutExternalImports", "sutExternalImportAllowlistSha256", "parserArtifacts", "resolutionPolicy",
  "resolutionPolicySha256", "bundles", "evaluationToolchainBundleSetSha256", "runnerSandboxProfile",
  "evaluatorSandboxProfile", "referencePolicy", "authorityRubric",
  "packageScripts", "lockfile", "runtime"
];
const PROFILE_KEYS = ["version", "networkMode", "readOnlyMountKinds", "writableMountKinds"];
const RUNTIME_KEYS = ["version", "nodeVersion", "pnpmVersion", "runtimeImageDigest"];
const PARSER_ARTIFACT_KEYS = ["id", "version", "entrySha256"];
const SHA256 = /^[a-f0-9]{64}$/;
const CANDIDATE_SHA = /^[a-f0-9]{40}$/;
const READ_ONLY_MOUNT_KINDS = ["candidate_sut", "protected_input", "runner_bundle", "runtime_profile"];
const WRITABLE_MOUNT_KINDS = ["result"];
const EVALUATOR_READ_ONLY_MOUNT_KINDS = ["protected_input", "policy_seal", "candidate_result", "reference_policy", "evaluator_bundle", "runtime_profile"];
const EVALUATOR_WRITABLE_MOUNT_KINDS = ["aggregate_result"];
const REQUIRED_BUNDLE_IDS = ["authority_cli_bootstrap", "boundary_evaluator", "boundary_runner", "reference_policy", "requirement_evaluator", "requirement_runner"];
const AUTHORITY_CLI_BOOTSTRAP_V1 = Object.freeze({
  id: "authority_cli_bootstrap",
  path: "scripts/evaluate-production-authority-release-cli.mjs"
});
const BUILDER_REPOSITORY_ROOT = realpathSync(resolve(dirname(realpathSync(fileURLToPath(import.meta.url))), ".."));

export function buildEvaluationToolchainManifestV2({ rootDir, config }) {
  const root = absoluteRoot(rootDir);
  const normalized = normalizedConfig(config);
  const packageJson = parseJson(readBounded(root, normalized.packageJsonPath));
  requirePinnedParser(packageJson);
  const parserArtifacts = derivedParserArtifacts();
  const visited = new Set();
  const edges = new Map();

  for (const entry of normalized.toolingEntries) walkToolingClosure(root, normalized, entry, visited, edges);
  if (normalized.toolingFiles.some((path) => !visited.has(path))) fail("MANIFEST_BINDING_INVALID");

  const moduleEdges = normalizedEdges([...edges.values()]);
  const usedNodeBuiltins = [...new Set(moduleEdges
    .filter((edge) => edge.targetKind === "node_builtin")
    .map((edge) => edge.targetRef))].sort();
  if (!sameArray(normalized.nodeBuiltins, usedNodeBuiltins)) fail("MANIFEST_BINDING_INVALID");
  if (candidateRunnerReachesReferencePolicy(moduleEdges, normalized.referencePolicyPath)) {
    fail("MANIFEST_BINDING_INVALID");
  }

  const referencePolicyRaw = readBounded(root, normalized.referencePolicyPath);
  const referencePolicyDescriptor = resolveToolingSourceDescriptor({ rootDir: root, path: normalized.referencePolicyPath });
  const referencePolicyEdges = scanToolingSource({
    path: normalized.referencePolicyPath,
    source: referencePolicyRaw.toString("utf8"),
    sourceMode: referencePolicyDescriptor.sourceMode
  }, { includeModuleEdges: true }).moduleEdges;
  if (referencePolicyEdges.some((edge) => !normalizeNodeBuiltinSpecifier(edge.specifier))) fail("MANIFEST_BINDING_INVALID");

  const sourceFiles = normalized.toolingFiles.map((path) => fileRecord(root, path));
  const bundles = normalized.bundleFiles.map(({ id, path }) => ({ id, ...fileRecord(root, path) }));
  const runnerProfileRaw = readBounded(root, normalized.runnerSandboxProfilePath);
  validateSandboxProfile(parseJson(runnerProfileRaw), "runner");
  const evaluatorProfileRaw = readBounded(root, normalized.evaluatorSandboxProfilePath);
  validateSandboxProfile(parseJson(evaluatorProfileRaw), "evaluator");
  const scripts = normalized.packageScriptNames.map((name) => {
    const command = packageJson?.scripts?.[name];
    if (typeof command !== "string" || command.length === 0 || command.length > 1024 || /[\r\n\0]/.test(command)) {
      fail("MANIFEST_BINDING_INVALID");
    }
    return { name, command };
  });
  const runtimeRaw = readBounded(root, normalized.runtimePath);
  const runtime = parseJson(runtimeRaw);
  validateRuntime(runtime);

  return {
    version: 2,
    policyId: TOOLCHAIN_POLICY_ID,
    candidateSha: normalized.candidateSha,
    toolingEntries: normalized.toolingEntries,
    toolingEntrySetSha256: canonicalSha256(normalized.toolingEntries),
    sourceFiles,
    evaluationToolchainSourceClosureSha256: canonicalSha256({ sourceFiles, parserArtifacts }),
    moduleEdges,
    moduleEdgeSetSha256: canonicalSha256(moduleEdges),
    nodeBuiltins: normalized.nodeBuiltins,
    nodeBuiltinAllowlistSha256: canonicalSha256(normalized.nodeBuiltins),
    approvedNodeBuiltinUniverseSha256: canonicalSha256(APPROVED_NODE_BUILTINS_V1),
    toolingBuiltinImports: normalized.nodeBuiltins,
    evaluationToolchainBuiltinAllowlistSha256: canonicalSha256(normalized.nodeBuiltins),
    sutExternalImports: normalized.sutExternalImports,
    sutExternalImportAllowlistSha256: canonicalSha256(normalized.sutExternalImports),
    parserArtifacts,
    resolutionPolicy: FROZEN_TOOLING_RESOLUTION_POLICY_V1,
    resolutionPolicySha256: canonicalSha256(FROZEN_TOOLING_RESOLUTION_POLICY_V1),
    bundles,
    evaluationToolchainBundleSetSha256: canonicalSha256(bundles),
    runnerSandboxProfile: { path: normalized.runnerSandboxProfilePath, sha256: sha256(runnerProfileRaw) },
    evaluatorSandboxProfile: { path: normalized.evaluatorSandboxProfilePath, sha256: sha256(evaluatorProfileRaw) },
    referencePolicy: fileRecord(root, normalized.referencePolicyPath),
    authorityRubric: fileRecord(root, normalized.authorityRubricPath),
    packageScripts: { entries: scripts, sha256: canonicalSha256(scripts) },
    lockfile: fileRecord(root, normalized.lockfilePath),
    runtime: {
      path: normalized.runtimePath,
      sha256: sha256(runtimeRaw),
      nodeVersion: runtime.nodeVersion,
      pnpmVersion: runtime.pnpmVersion,
      runtimeImageDigest: runtime.runtimeImageDigest
    }
  };
}

export function verifyEvaluationToolchainManifestV2({ rootDir, config, manifest }) {
  validateEvaluationToolchainManifestV2(manifest);
  const observed = buildEvaluationToolchainManifestV2({ rootDir, config });
  if (stableJson(observed) !== stableJson(manifest)) fail("MANIFEST_BINDING_INVALID");
  return observed;
}

export function validateEvaluationToolchainManifestV2(manifest) {
  if (!hasExactKeys(manifest, MANIFEST_KEYS) || manifest.version !== 2 || manifest.policyId !== TOOLCHAIN_POLICY_ID ||
    !CANDIDATE_SHA.test(manifest.candidateSha) || manifest.toolingEntries.length === 0 || !isSortedUniquePaths(manifest.toolingEntries) ||
    !SHA256.test(manifest.toolingEntrySetSha256) || !isSortedFileRecords(manifest.sourceFiles) ||
    !SHA256.test(manifest.evaluationToolchainSourceClosureSha256) || !isResolvedEdges(manifest.moduleEdges, manifest.sourceFiles, manifest.sutExternalImports) ||
    !SHA256.test(manifest.moduleEdgeSetSha256) || !isApprovedBuiltins(manifest.nodeBuiltins) ||
    !SHA256.test(manifest.nodeBuiltinAllowlistSha256) || !SHA256.test(manifest.approvedNodeBuiltinUniverseSha256) ||
    !isApprovedBuiltins(manifest.toolingBuiltinImports) || !SHA256.test(manifest.evaluationToolchainBuiltinAllowlistSha256) ||
    !isSortedUniquePaths(manifest.sutExternalImports) || !SHA256.test(manifest.sutExternalImportAllowlistSha256) ||
    !isParserArtifacts(manifest.parserArtifacts) || stableJson(manifest.resolutionPolicy) !== stableJson(FROZEN_TOOLING_RESOLUTION_POLICY_V1) ||
    !SHA256.test(manifest.resolutionPolicySha256) || !isBundles(manifest.bundles) ||
    !SHA256.test(manifest.evaluationToolchainBundleSetSha256) || !isFileHashObject(manifest.runnerSandboxProfile) ||
    !isFileHashObject(manifest.evaluatorSandboxProfile) || !isFileHashObject(manifest.referencePolicy) || !isFileHashObject(manifest.authorityRubric) ||
    !isPackageScripts(manifest.packageScripts) || !isFileHashObject(manifest.lockfile) || !isRuntimeRecord(manifest.runtime)) {
    fail("MANIFEST_BINDING_INVALID");
  }

  const sourcePaths = new Set(manifest.sourceFiles.map((file) => file.path));
  if (!manifest.toolingEntries.every((path) => sourcePaths.has(path)) ||
    !sameArray(manifest.nodeBuiltins, usedNodeBuiltins(manifest.moduleEdges)) ||
    manifest.toolingEntrySetSha256 !== canonicalSha256(manifest.toolingEntries) ||
    manifest.evaluationToolchainSourceClosureSha256 !== canonicalSha256({
      sourceFiles: manifest.sourceFiles,
      parserArtifacts: manifest.parserArtifacts
    }) ||
    manifest.moduleEdgeSetSha256 !== canonicalSha256(manifest.moduleEdges) ||
    manifest.nodeBuiltinAllowlistSha256 !== canonicalSha256(manifest.nodeBuiltins) ||
    manifest.approvedNodeBuiltinUniverseSha256 !== canonicalSha256(APPROVED_NODE_BUILTINS_V1) ||
    !sameArray(manifest.toolingBuiltinImports, usedNodeBuiltins(manifest.moduleEdges)) ||
    manifest.evaluationToolchainBuiltinAllowlistSha256 !== canonicalSha256(manifest.toolingBuiltinImports) ||
    manifest.sutExternalImportAllowlistSha256 !== canonicalSha256(manifest.sutExternalImports) ||
    stableJson(manifest.parserArtifacts) !== stableJson(derivedParserArtifacts()) ||
    manifest.resolutionPolicySha256 !== canonicalSha256(FROZEN_TOOLING_RESOLUTION_POLICY_V1) ||
    manifest.evaluationToolchainBundleSetSha256 !== canonicalSha256(manifest.bundles) ||
    manifest.packageScripts.sha256 !== canonicalSha256(manifest.packageScripts.entries)) {
    fail("MANIFEST_BINDING_INVALID");
  }
  return true;
}

export function validateSandboxProfile(profile, kind = "runner") {
  const expectedReadOnly = kind === "evaluator" ? EVALUATOR_READ_ONLY_MOUNT_KINDS : READ_ONLY_MOUNT_KINDS;
  const expectedWritable = kind === "evaluator" ? EVALUATOR_WRITABLE_MOUNT_KINDS : WRITABLE_MOUNT_KINDS;
  if (!hasExactKeys(profile, PROFILE_KEYS) || profile.version !== 1 || profile.networkMode !== "disabled" ||
    !sameArray(profile.readOnlyMountKinds, expectedReadOnly) || !sameArray(profile.writableMountKinds, expectedWritable)) {
    fail("SANDBOX_EVIDENCE_INCOMPLETE");
  }
  return true;
}

export function canonicalSha256(value) {
  return sha256(Buffer.from(stableJson(value)));
}

function walkToolingClosure(root, config, path, visited, edges) {
  if (visited.has(path)) return;
  visited.add(path);
  const source = readBounded(root, path).toString("utf8");
  const sourceDescriptor = resolveToolingSourceDescriptor({ rootDir: root, path });
  if (sourceDescriptor.controllingPackagePath) {
    if (!config.toolingFiles.includes(sourceDescriptor.controllingPackagePath)) fail("MANIFEST_BINDING_INVALID");
    walkToolingClosure(root, config, sourceDescriptor.controllingPackagePath, visited, edges);
  }
  const scanned = scanToolingSource({
    path,
    source,
    sourceMode: sourceDescriptor.sourceMode
  }, { includeModuleEdges: true });
  const parserEdges = scanned.moduleEdges
    .filter((edge) => isParserSpecifier(edge.specifier))
    .map((edge) => ({ ...edge, targetKind: "parser_artifact", targetRef: edge.specifier }));
  const resolved = [...resolveToolingModuleEdges({
    rootDir: root,
    moduleEdges: scanned.moduleEdges.filter((edge) => !isParserSpecifier(edge.specifier)),
    toolingFiles: config.toolingFiles,
    sutExternalImports: config.sutExternalImports
  }), ...parserEdges];
  for (const edge of resolved) {
    edges.set(edgeKey(edge), edge);
    if (edge.targetKind === "tooling") walkToolingClosure(root, config, edge.targetRef, visited, edges);
  }
}

function normalizedConfig(config) {
  if (!hasExactKeys(config, CONFIG_KEYS) || config.version !== 2 || !CANDIDATE_SHA.test(config.candidateSha) ||
    !Array.isArray(config.nodeBuiltins) || !Array.isArray(config.toolingEntries) || config.toolingEntries.length === 0 ||
    !Array.isArray(config.toolingFiles) || config.toolingFiles.length === 0 || !Array.isArray(config.sutExternalImports) ||
    !Array.isArray(config.bundleFiles) || config.bundleFiles.length === 0 || !Array.isArray(config.packageScriptNames) ||
    config.packageScriptNames.length === 0) fail("MANIFEST_BINDING_INVALID");
  const toolingEntries = normalizedUniquePaths(config.toolingEntries);
  const toolingFiles = normalizedUniquePaths(config.toolingFiles);
  const sutExternalImports = normalizedUniquePaths(config.sutExternalImports);
  const referencePolicyPath = normalizedPath(config.referencePolicyPath);
  if (!toolingEntries.every((entry) => toolingFiles.includes(entry)) ||
    sutExternalImports.some((path) => toolingFiles.includes(path))) {
    fail("MANIFEST_BINDING_INVALID");
  }
  const nodeBuiltins = normalizedNodeBuiltins(config.nodeBuiltins);
  return {
    candidateSha: config.candidateSha,
    nodeBuiltins,
    toolingEntries,
    toolingFiles,
    sutExternalImports,
    bundleFiles: normalizedBundles(config.bundleFiles),
    runnerSandboxProfilePath: normalizedPath(config.runnerSandboxProfilePath),
    evaluatorSandboxProfilePath: normalizedPath(config.evaluatorSandboxProfilePath),
    referencePolicyPath,
    authorityRubricPath: normalizedPath(config.authorityRubricPath),
    packageJsonPath: normalizedPath(config.packageJsonPath),
    packageScriptNames: normalizedLabels(config.packageScriptNames),
    lockfilePath: normalizedPath(config.lockfilePath),
    runtimePath: normalizedPath(config.runtimePath)
  };
}

function normalizedNodeBuiltins(values) {
  if (!Array.isArray(values) || !values.every((value) => APPROVED_NODE_BUILTINS_V1.includes(value))) fail("MANIFEST_BINDING_INVALID");
  const result = [...values].sort();
  if (new Set(result).size !== result.length) fail("MANIFEST_BINDING_INVALID");
  return result;
}

function normalizedBundles(values) {
  if (!Array.isArray(values) || !values.every((value) => hasExactKeys(value, ["id", "path"]) && isLabel(value.id))) {
    fail("MANIFEST_BINDING_INVALID");
  }
  const result = values.map(({ id, path }) => ({ id, path: normalizedPath(path) })).sort((left, right) => compareText(left.id, right.id));
  if (!isStrictlySorted(result.map((item) => item.id)) || !sameArray(result.map((item) => item.id), REQUIRED_BUNDLE_IDS) ||
    result.find((bundle) => bundle.id === AUTHORITY_CLI_BOOTSTRAP_V1.id)?.path !== AUTHORITY_CLI_BOOTSTRAP_V1.path) {
    fail("MANIFEST_BINDING_INVALID");
  }
  return result;
}

function normalizedUniquePaths(values) {
  if (!Array.isArray(values)) fail("MANIFEST_BINDING_INVALID");
  const result = values.map(normalizedPath).sort();
  if (new Set(result).size !== result.length) fail("MANIFEST_BINDING_INVALID");
  return result;
}

function normalizedLabels(values) {
  if (!Array.isArray(values) || !values.every(isLabel)) fail("MANIFEST_BINDING_INVALID");
  const result = [...values].sort();
  if (new Set(result).size !== result.length) fail("MANIFEST_BINDING_INVALID");
  return result;
}

function normalizedPath(value) {
  if (!isSafePath(value)) fail("MANIFEST_BINDING_INVALID");
  return value.split("\\").join("/");
}

function requirePinnedParser(packageJson) {
  if (!packageJson || typeof packageJson !== "object" || packageJson.devDependencies?.typescript !== "5.9.3" ||
    packageJson.devDependencies?.acorn !== "8.17.0" ||
    ["dependencies", "optionalDependencies", "peerDependencies"].some((section) =>
      isRecord(packageJson[section]) && Object.hasOwn(packageJson[section], "acorn")
    )) {
    fail("PARSER_BINDING_INVALID");
  }
}

function derivedParserArtifacts() {
  try {
    if (acorn.version !== "8.17.0" || ts.version !== "5.9.3") fail("PARSER_BINDING_INVALID");
    return [
      parserArtifact("acorn", acorn.version),
      parserArtifact("typescript", ts.version)
    ];
  } catch (error) {
    if (error instanceof ToolchainClosureError) throw error;
    fail("PARSER_BINDING_INVALID");
  }
}

function parserArtifact(id, version) {
  const entry = realpathSync(fileURLToPath(import.meta.resolve(id)));
  if (!inside(BUILDER_REPOSITORY_ROOT, entry)) fail("PARSER_BINDING_INVALID");
  return { id, version, entrySha256: sha256(readFileSync(entry)) };
}

function inside(root, target) {
  return target === root || target.startsWith(`${root}${sep}`);
}

function isParserArtifacts(value) {
  return Array.isArray(value) && value.length === 2 && isStrictlySorted(value.map((artifact) => artifact?.id)) &&
    value.every((artifact) => hasExactKeys(artifact, PARSER_ARTIFACT_KEYS) &&
      (artifact.id === "acorn" || artifact.id === "typescript") && isBoundedText(artifact.version) &&
      SHA256.test(artifact.entrySha256));
}

function isResolvedEdges(value, sourceFiles, sutExternalImports) {
  if (!Array.isArray(value) || !isStrictlySortedOrEmpty(value.map(edgeKey))) return false;
  const sourcePaths = new Set(Array.isArray(sourceFiles) ? sourceFiles.map((file) => file?.path) : []);
  const sutPaths = new Set(Array.isArray(sutExternalImports) ? sutExternalImports : []);
  return value.every((edge) => hasExactKeys(edge, ["importerPath", "kind", "specifier", "targetKind", "targetRef"]) &&
    sourcePaths.has(edge.importerPath) && (edge.kind === "runtime_import" || edge.kind === "type_import") &&
    isBoundedText(edge.specifier) && validEdgeTarget(edge, sourcePaths, sutPaths));
}

function validEdgeTarget(edge, sourcePaths, sutPaths) {
  if (edge.targetKind === "tooling") return sourcePaths.has(edge.targetRef) && isBoundRelativeTarget(edge);
  if (edge.targetKind === "sut_external") return sutPaths.has(edge.targetRef) && isBoundRelativeTarget(edge);
  if (edge.targetKind === "node_builtin") return edge.targetRef === normalizeNodeBuiltinSpecifier(edge.specifier);
  return edge.targetKind === "parser_artifact" && isParserSpecifier(edge.specifier) && edge.targetRef === edge.specifier;
}

function isParserSpecifier(value) {
  return value === "acorn" || value === "typescript";
}

function isBoundRelativeTarget(edge) {
  if (!edge.specifier.startsWith(".")) return false;
  const literalTarget = posix.normalize(posix.join(posix.dirname(edge.importerPath), edge.specifier));
  if (!isSafePath(literalTarget)) return false;
  if (edge.importerPath.endsWith(".mjs")) return edge.specifier.endsWith(".mjs") && literalTarget === edge.targetRef;
  if (edge.importerPath.endsWith(".js")) return edge.specifier.endsWith(".js") && literalTarget === edge.targetRef;
  if (edge.importerPath.endsWith(".cjs")) return edge.specifier.endsWith(".cjs") && literalTarget === edge.targetRef;
  return (edge.importerPath.endsWith(".ts") || edge.importerPath.endsWith(".tsx")) &&
    (literalTarget === edge.targetRef || stripTypeScriptExtension(literalTarget) === stripTypeScriptExtension(edge.targetRef));
}

function stripTypeScriptExtension(path) {
  if (path.endsWith(".d.ts")) return path.slice(0, -5);
  if (path.endsWith(".tsx")) return path.slice(0, -4);
  return path.endsWith(".ts") ? path.slice(0, -3) : path;
}

function usedNodeBuiltins(edges) {
  return [...new Set(edges.filter((edge) => edge.targetKind === "node_builtin").map((edge) => edge.targetRef))].sort();
}

function normalizedEdges(edges) {
  const unique = new Map();
  for (const edge of edges) unique.set(edgeKey(edge), edge);
  return [...unique.values()].sort((left, right) => compareText(edgeKey(left), edgeKey(right)));
}

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function edgeKey(edge) {
  return [edge?.importerPath, edge?.kind, edge?.specifier, edge?.targetKind, edge?.targetRef].join("\0");
}

function isCandidateRunner(path) {
  return path === "src/lib/release-evaluation-runner.ts" || path === "src/lib/production-boundary-evaluation-runner.ts";
}

function candidateRunnerReachesReferencePolicy(edges, referencePolicyPath) {
  const pending = edges.filter((edge) => isCandidateRunner(edge.importerPath)).map((edge) => edge.importerPath);
  const visited = new Set();
  while (pending.length > 0) {
    const importerPath = pending.pop();
    if (visited.has(importerPath)) continue;
    visited.add(importerPath);
    for (const edge of edges) {
      if (edge.importerPath !== importerPath) continue;
      if (edge.targetRef === referencePolicyPath) return true;
      if (edge.targetKind === "tooling") pending.push(edge.targetRef);
    }
  }
  return false;
}

function isApprovedBuiltins(value) {
  return Array.isArray(value) && value.every((item) => APPROVED_NODE_BUILTINS_V1.includes(item)) && isStrictlySortedOrEmpty(value);
}

function isBundles(value) {
  return Array.isArray(value) && value.length > 0 && isStrictlySorted(value.map((item) => item?.id)) &&
    value.every((item) => hasExactKeys(item, ["id", "path", "sha256"]) && isLabel(item.id) && isSafePath(item.path) && SHA256.test(item.sha256)) &&
    sameArray(value.map((item) => item.id), REQUIRED_BUNDLE_IDS) &&
    value.find((bundle) => bundle.id === AUTHORITY_CLI_BOOTSTRAP_V1.id)?.path === AUTHORITY_CLI_BOOTSTRAP_V1.path;
}

function isPackageScripts(value) {
  return hasExactKeys(value, ["entries", "sha256"]) && Array.isArray(value.entries) && value.entries.length > 0 &&
    isStrictlySorted(value.entries.map((item) => item?.name)) && SHA256.test(value.sha256) &&
    value.entries.every((entry) => hasExactKeys(entry, ["name", "command"]) && isLabel(entry.name) &&
      typeof entry.command === "string" && entry.command.length > 0 && entry.command.length <= 1024 && !/[\r\n\0]/.test(entry.command));
}

function isRuntimeRecord(value) {
  return hasExactKeys(value, ["path", "sha256", "nodeVersion", "pnpmVersion", "runtimeImageDigest"]) &&
    isSafePath(value.path) && SHA256.test(value.sha256) && isNodeVersion(value.nodeVersion) &&
    isPnpmVersion(value.pnpmVersion) && /^sha256:[a-f0-9]{64}$/.test(value.runtimeImageDigest);
}

function validateRuntime(runtime) {
  if (!hasExactKeys(runtime, RUNTIME_KEYS) || runtime.version !== 1 || !isNodeVersion(runtime.nodeVersion) ||
    !isPnpmVersion(runtime.pnpmVersion) || !/^sha256:[a-f0-9]{64}$/.test(runtime.runtimeImageDigest)) {
    fail("MANIFEST_BINDING_INVALID");
  }
}

function absoluteRoot(rootDir) {
  if (typeof rootDir !== "string" || !isAbsolute(rootDir)) fail("MANIFEST_BINDING_INVALID");
  try { return realpathSync(resolve(rootDir)); } catch { fail("MANIFEST_BINDING_INVALID"); }
}

function fileRecord(root, path) {
  return { path, sha256: sha256(readBounded(root, path)) };
}

function readBounded(root, path) {
  try {
    const target = realpathSync(resolve(root, path));
    if (target !== root && !target.startsWith(`${root}${sep}`)) fail("MODULE_OUTSIDE_CLOSURE");
    return readFileSync(target);
  } catch (error) {
    if (error instanceof ToolchainClosureError) throw error;
    fail("MANIFEST_BINDING_INVALID");
  }
}

function parseJson(raw) {
  try { return JSON.parse(raw.toString("utf8")); } catch { fail("MANIFEST_BINDING_INVALID"); }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isSafePath(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !isAbsolute(value) && !value.includes("\0") &&
    value.split(/[\\/]/).every((part) => part !== "" && part !== "." && part !== "..");
}

function isSortedUniquePaths(value) {
  return Array.isArray(value) && value.every(isSafePath) && isStrictlySortedOrEmpty(value);
}

function isSortedFileRecords(value) {
  return Array.isArray(value) && value.length > 0 && isStrictlySorted(value.map((item) => item?.path)) && value.every(isFileHashObject);
}

function isFileHashObject(value) {
  return hasExactKeys(value, ["path", "sha256"]) && isSafePath(value.path) && SHA256.test(value.sha256);
}

function isStrictlySorted(values) {
  return Array.isArray(values) && values.length > 0 && values.every((value, index) => typeof value === "string" &&
    (index === 0 || values[index - 1] < value));
}

function isStrictlySortedOrEmpty(values) {
  return Array.isArray(values) && values.every((value, index) => typeof value === "string" &&
    (index === 0 || values[index - 1] < value));
}

function isLabel(value) {
  return typeof value === "string" && /^[a-zA-Z0-9:_-]{1,128}$/.test(value);
}

function isBoundedText(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 512 && !/[\0\r\n]/.test(value);
}

function isNodeVersion(value) {
  return typeof value === "string" && /^v?\d+\.\d+\.\d+$/.test(value);
}

function isPnpmVersion(value) {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value);
}

function sameArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code) {
  throw new ToolchainClosureError(code);
}

function parseCli(argv) {
  if (argv.length !== 6 && argv.length !== 8) return null;
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!new Set(["--root", "--config", "--output", "--expected"]).has(flag) || !value || values.has(flag)) return null;
    values.set(flag, value);
  }
  if (!["--root", "--config", "--output"].every((flag) => values.has(flag))) return null;
  return Object.fromEntries([...values].map(([key, value]) => [key.slice(2), value]));
}

function runCli() {
  try {
    const paths = parseCli(process.argv.slice(2));
    if (!paths) fail("MANIFEST_BINDING_INVALID");
    const config = JSON.parse(readFileSync(paths.config, "utf8"));
    const manifest = paths.expected
      ? verifyEvaluationToolchainManifestV2({ rootDir: paths.root, config, manifest: JSON.parse(readFileSync(paths.expected, "utf8")) })
      : buildEvaluationToolchainManifestV2({ rootDir: paths.root, config });
    writeFileSync(paths.output, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify(toolchainFailure(error))}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runCli();
