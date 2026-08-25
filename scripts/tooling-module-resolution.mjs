import { readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import {
  FROZEN_TOOLING_RESOLUTION_POLICY_V1,
  normalizeNodeBuiltinSpecifier,
  ToolchainClosureError
} from "./toolchain-closure-policy.mjs";

export function resolveToolingModuleEdges({ rootDir, moduleEdges, toolingFiles, sutExternalImports }) {
  const root = requiredRealpath(rootDir);
  const declared = declaredFiles(root, toolingFiles, sutExternalImports);
  if (!Array.isArray(moduleEdges)) fail("TOOLING_SOURCE_INVALID");
  const resolved = moduleEdges.map((edge) => resolveEdge(root, declared, edge));
  return normalizedEdges(resolved);
}

function resolveEdge(root, declared, edge) {
  if (!isEdge(edge) || !declared.tooling.has(edge.importerPath)) fail("MODULE_OUTSIDE_CLOSURE");
  const builtin = normalizeNodeBuiltinSpecifier(edge.specifier);
  if (builtin) return { ...edge, targetKind: "node_builtin", targetRef: builtin };
  if (edge.specifier.startsWith("node:")) fail("BUILTIN_NOT_ALLOWED");
  if (edge.specifier === "typescript") return { ...edge, targetKind: "parser_artifact", targetRef: "typescript" };
  if (!edge.specifier.startsWith(".")) fail("MODULE_RESOLUTION_FAILED");
  if (isAbsolute(edge.specifier) || /^[A-Za-z][A-Za-z\d+.-]*:/.test(edge.specifier)) fail("MODULE_RESOLUTION_FAILED");

  const importer = declared.absoluteByPath.get(edge.importerPath);
  if (edge.importerPath.endsWith(".mjs")) return resolveEsmRelative(root, declared, edge, importer);
  if (edge.importerPath.endsWith(".js") || edge.importerPath.endsWith(".cjs")) {
    return resolveExplicitJavaScriptRelative(root, declared, edge, importer);
  }
  if (edge.importerPath.endsWith(".ts") || edge.importerPath.endsWith(".tsx")) {
    return resolveTypeScriptRelative(root, declared, edge, importer);
  }
  fail("MODULE_RESOLUTION_FAILED");
}

function resolveEsmRelative(root, declared, edge, importer) {
  if (!edge.specifier.endsWith(".mjs")) fail("MODULE_RESOLUTION_FAILED");
  return resolveExplicitRelative(root, declared, edge, importer);
}

function resolveExplicitJavaScriptRelative(root, declared, edge, importer) {
  const expectedExtension = edge.importerPath.endsWith(".cjs") ? ".cjs" : ".js";
  if (!edge.specifier.endsWith(expectedExtension)) fail("MODULE_RESOLUTION_FAILED");
  return resolveExplicitRelative(root, declared, edge, importer);
}

function resolveExplicitRelative(root, declared, edge, importer) {
  const candidate = resolve(dirname(importer), edge.specifier);
  if (!inside(root, candidate)) fail("MODULE_OUTSIDE_CLOSURE");
  return classifiedEdge(edge, declared, requiredTarget(candidate));
}

function resolveTypeScriptRelative(root, declared, edge, importer) {
  const literalTarget = resolve(dirname(importer), edge.specifier);
  if (!inside(root, literalTarget)) fail("MODULE_OUTSIDE_CLOSURE");
  const resolution = ts.resolveModuleName(
    edge.specifier,
    importer,
    compilerOptions(),
    boundedResolutionHost(root, declared)
  ).resolvedModule;
  if (!resolution) fail("MODULE_RESOLUTION_FAILED");
  const target = requiredTarget(resolution.resolvedFileName);
  const targetRef = declared.pathByAbsolute.get(target);
  if (!targetRef || !sameTypeScriptModuleTarget(root, literalTarget, targetRef)) fail("MODULE_RESOLUTION_FAILED");
  return classifiedEdge(edge, declared, target);
}

function sameTypeScriptModuleTarget(root, literalTarget, targetRef) {
  const literalRef = relative(root, literalTarget).split(sep).join("/");
  return literalRef === targetRef || stripTypeScriptExtension(literalRef) === stripTypeScriptExtension(targetRef);
}

function stripTypeScriptExtension(path) {
  if (path.endsWith(".d.ts")) return path.slice(0, -5);
  if (path.endsWith(".tsx")) return path.slice(0, -4);
  return path.endsWith(".ts") ? path.slice(0, -3) : path;
}

function classifiedEdge(edge, declared, target) {
  const targetRef = declared.pathByAbsolute.get(target);
  if (!targetRef) fail("MODULE_RESOLUTION_FAILED");
  return {
    ...edge,
    targetKind: declared.tooling.has(targetRef) ? "tooling" : "sut_external",
    targetRef
  };
}

function declaredFiles(root, toolingFiles, sutExternalImports) {
  const tooling = normalizedPathSet(toolingFiles);
  const sutExternal = normalizedPathSet(sutExternalImports);
  for (const path of tooling) if (sutExternal.has(path)) fail("MODULE_OUTSIDE_CLOSURE");
  const absoluteByPath = new Map();
  const pathByAbsolute = new Map();
  const directories = new Set([root]);
  for (const path of [...tooling, ...sutExternal]) {
    const absolute = requiredTarget(resolve(root, path));
    if (!inside(root, absolute)) fail("MODULE_OUTSIDE_CLOSURE");
    if (pathByAbsolute.has(absolute)) fail("MODULE_OUTSIDE_CLOSURE");
    absoluteByPath.set(path, absolute);
    pathByAbsolute.set(absolute, path);
    for (let directory = dirname(absolute); inside(root, directory); directory = dirname(directory)) {
      directories.add(directory);
      if (directory === root) break;
    }
  }
  return { tooling, sutExternal, absoluteByPath, pathByAbsolute, directories };
}

function boundedResolutionHost(root, declared) {
  const known = declared.pathByAbsolute;
  const normalizeRequest = (value) => isAbsolute(value) ? resolve(value) : resolve(root, value);
  return {
    fileExists(value) { return known.has(normalizeRequest(value)); },
    readFile(value) {
      const target = normalizeRequest(value);
      return known.has(target) ? readFileSync(target, "utf8") : undefined;
    },
    directoryExists(value) { return declared.directories.has(normalizeRequest(value)); },
    getCurrentDirectory() { return root; },
    realpath(value) {
      const target = normalizeRequest(value);
      return known.has(target) ? target : undefined;
    },
    useCaseSensitiveFileNames: true
  };
}

function compilerOptions() {
  return {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ES2024,
    resolveJsonModule: FROZEN_TOOLING_RESOLUTION_POLICY_V1.resolveJsonModule,
    allowJs: FROZEN_TOOLING_RESOLUTION_POLICY_V1.allowJs,
    noLib: FROZEN_TOOLING_RESOLUTION_POLICY_V1.noLib,
    types: FROZEN_TOOLING_RESOLUTION_POLICY_V1.types
  };
}

function normalizedPathSet(paths) {
  if (!Array.isArray(paths)) fail("TOOLING_SOURCE_INVALID");
  const normalized = paths.map(normalizedPath);
  if (new Set(normalized).size !== normalized.length) fail("TOOLING_SOURCE_INVALID");
  return new Set(normalized);
}

function normalizedPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || isAbsolute(value) ||
    value.includes("\0") || value.split(/[\\/]/).some((part) => part === "" || part === "." || part === "..")) {
    fail("TOOLING_SOURCE_INVALID");
  }
  return value.split("\\").join("/");
}

function requiredRealpath(value) {
  if (typeof value !== "string" || !isAbsolute(value)) fail("TOOLING_SOURCE_INVALID");
  return requiredTarget(value);
}

function requiredTarget(value) {
  try { return realpathSync(resolve(value)); } catch { fail("MODULE_RESOLUTION_FAILED"); }
}

function inside(root, target) {
  return target === root || target.startsWith(`${root}${sep}`);
}

function isEdge(value) {
  return value && typeof value === "object" && typeof value.importerPath === "string" &&
    (value.kind === "runtime_import" || value.kind === "type_import") && typeof value.specifier === "string";
}

function normalizedEdges(edges) {
  const unique = new Map();
  for (const edge of edges) {
    unique.set([edge.importerPath, edge.kind, edge.specifier, edge.targetKind, edge.targetRef].join("\0"), edge);
  }
  return [...unique.values()].sort((left, right) => compareText([
    left.importerPath,
    left.kind,
    left.specifier,
    left.targetKind,
    left.targetRef
  ].join("\0"), [
    right.importerPath,
    right.kind,
    right.specifier,
    right.targetKind,
    right.targetRef
  ].join("\0")));
}

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function fail(code) {
  throw new ToolchainClosureError(code);
}
