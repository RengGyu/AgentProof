import * as acorn from "acorn";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import ts from "typescript";
import {
  normalizeNodeBuiltinSpecifier,
  ToolchainClosureError
} from "./toolchain-closure-policy.mjs";

const SAFE_NODE_BUILTINS = new Set([
  "node:crypto", "node:fs", "node:path", "node:perf_hooks", "node:url", "node:util"
]);
const FORBIDDEN_MODULES = new Set([
  "child_process", "module", "vm", "wasi", "worker_threads",
  "node:child_process", "node:module", "node:vm", "node:wasi", "node:worker_threads",
  "bindings", "ffi-napi", "node-gyp-build"
]);
const FORBIDDEN_VALUE_NAMES = new Set([
  "eval", "Function", "AsyncFunction", "GeneratorFunction", "AsyncGeneratorFunction",
  "module", "globalThis", "global", "Reflect", "Proxy", "Worker", "SharedWorker"
]);
const FORBIDDEN_LOADER_NAMES = new Set(["createRequire", "getBuiltinModule", "_load", "require"]);
const FORBIDDEN_MEMBER_NAMES = new Set(["constructor", "prototype", "__proto__"]);
const FORBIDDEN_OBJECT_METHODS = new Set(["getPrototypeOf", "getOwnPropertyDescriptor"]);
const ALLOWED_PROCESS_MEMBERS = new Set(["argv", "stdout", "stderr", "exitCode"]);

export function resolveToolingSourceDescriptor({ rootDir, path }) {
  const root = requiredRoot(rootDir);
  const normalizedPath = safeRelativePath(path);
  const extension = extname(normalizedPath);
  if (extension === ".mjs") return descriptor(normalizedPath, "module");
  if (extension === ".cjs") return descriptor(normalizedPath, "script");
  if (extension === ".ts") return descriptor(normalizedPath, "typescript");
  if (extension === ".tsx") return descriptor(normalizedPath, "tsx");
  if (extension === ".json") return descriptor(normalizedPath, "json");
  if (extension !== ".js") fail("UNSUPPORTED_TOOLING_SOURCE");

  for (let directory = dirname(resolve(root, normalizedPath)); inside(root, directory); directory = dirname(directory)) {
    const packagePath = resolve(directory, "package.json");
    if (existsSync(packagePath)) {
      const target = requiredInside(root, packagePath);
      const packageRelativePath = relative(root, target).split(sep).join("/");
      let packageJson;
      try { packageJson = JSON.parse(readFileSync(target, "utf8")); } catch { fail("TOOLING_SOURCE_INVALID"); }
      if (packageJson?.type !== undefined && packageJson.type !== "module" && packageJson.type !== "commonjs") {
        fail("TOOLING_SOURCE_INVALID");
      }
      return {
        ...descriptor(normalizedPath, packageJson?.type === "module" ? "module" : "script"),
        controllingPackagePath: packageRelativePath
      };
    }
    if (directory === root) break;
  }
  return descriptor(normalizedPath, "script");
}

export function scanToolingSource(input, options = undefined) {
  const details = scanDetails(input);
  const result = {
    version: 1,
    sourceKind: details.sourceKind,
    staticSpecifiers: normalizedSpecifiers(details.edges)
  };
  return options?.includeModuleEdges === true
    ? { ...result, moduleEdges: normalizedModuleEdges(input.path, details.edges) }
    : result;
}

function scanDetails({ path, source, sourceMode } = {}) {
  if (typeof path !== "string" || typeof source !== "string") fail("TOOLING_SOURCE_INVALID");
  const sourceKind = sourceKindFor(path, sourceMode);
  if (sourceKind === "json") {
    try { JSON.parse(source); } catch { fail("TOOLING_SOURCE_INVALID"); }
    return { sourceKind, edges: [] };
  }
  return sourceMode === "module" || sourceMode === "script"
    ? scanJavaScript(source, sourceMode, sourceKind)
    : scanTypeScript(path, source, sourceMode, sourceKind);
}

function scanJavaScript(source, sourceMode, sourceKind) {
  let file;
  try {
    file = acorn.parse(source, {
      ecmaVersion: 2024,
      allowHashBang: true,
      sourceType: sourceMode
    });
  } catch {
    fail("TOOLING_SOURCE_INVALID");
  }
  const edges = [];
  visitAcorn(file, null, null, [], sourceMode, edges);
  return { sourceKind, edges };
}

function visitAcorn(node, parent, key, ancestors, sourceMode, edges) {
  if (!node || typeof node.type !== "string") return;
  if (node.type === "ImportDeclaration") addSpecifier(edges, literalText(node.source), "runtime_import");
  if ((node.type === "ExportNamedDeclaration" || node.type === "ExportAllDeclaration") && node.source) {
    addSpecifier(edges, literalText(node.source), "runtime_import");
  }
  if (node.type === "ImportExpression") fail("UNSUPPORTED_MODULE_FORM");
  if (node.type === "CallExpression") checkAcornCall(node, sourceMode, edges);
  if (node.type === "MemberExpression") checkAcornMember(node);
  if (node.type === "Property" && parent?.type === "ObjectPattern") checkAcornPatternProperty(node);
  if (node.type === "Identifier") checkAcornIdentifier(node, parent, key, ancestors, sourceMode);

  const nextAncestors = [...ancestors, node];
  for (const [childKey, value] of Object.entries(node)) {
    if (childKey === "start" || childKey === "end" || childKey === "loc" || childKey === "range") continue;
    if (Array.isArray(value)) {
      for (const child of value) visitAcorn(child, node, childKey, nextAncestors, sourceMode, edges);
    } else if (value && typeof value === "object" && typeof value.type === "string") {
      visitAcorn(value, node, childKey, nextAncestors, sourceMode, edges);
    }
  }
}

function checkAcornCall(node, sourceMode, edges) {
  if (node.callee?.type !== "Identifier" || node.callee.name !== "require") return;
  if (sourceMode !== "script" || node.optional === true || node.arguments.length !== 1 ||
    node.arguments[0]?.type !== "Literal" || typeof node.arguments[0].value !== "string") {
    fail("UNSUPPORTED_MODULE_FORM");
  }
  addSpecifier(edges, node.arguments[0].value, "runtime_import");
}

function checkAcornMember(node) {
  const name = acornMemberName(node);
  if (name && (FORBIDDEN_MEMBER_NAMES.has(name) || FORBIDDEN_LOADER_NAMES.has(name))) {
    fail("UNSUPPORTED_MODULE_FORM");
  }
  if (node.object?.type === "Identifier" && node.object.name === "Object" && FORBIDDEN_OBJECT_METHODS.has(name)) {
    fail("UNSUPPORTED_MODULE_FORM");
  }
  if (node.object?.type === "Identifier" && node.object.name === "process" &&
    (node.computed || !ALLOWED_PROCESS_MEMBERS.has(name))) {
    fail("UNSUPPORTED_MODULE_FORM");
  }
}

function checkAcornPatternProperty(node) {
  const name = node.computed ? literalTextOrNull(node.key) : identifierOrLiteralName(node.key);
  if (name && (FORBIDDEN_VALUE_NAMES.has(name) || FORBIDDEN_MEMBER_NAMES.has(name) ||
    FORBIDDEN_LOADER_NAMES.has(name) || FORBIDDEN_OBJECT_METHODS.has(name))) {
    fail("UNSUPPORTED_MODULE_FORM");
  }
}

function checkAcornIdentifier(node, parent, key, ancestors, sourceMode) {
  const name = node.name;
  if (name === "process") {
    if (!(parent?.type === "MemberExpression" && parent.object === node && !parent.computed &&
      ALLOWED_PROCESS_MEMBERS.has(identifierOrLiteralName(parent.property)))) {
      fail("UNSUPPORTED_MODULE_FORM");
    }
    return;
  }
  if (name === "require") {
    if (!(sourceMode === "script" && parent?.type === "CallExpression" && parent.callee === node &&
      parent.optional !== true && parent.arguments.length === 1 && typeof parent.arguments[0]?.value === "string")) {
      fail("UNSUPPORTED_MODULE_FORM");
    }
    return;
  }
  if ((FORBIDDEN_VALUE_NAMES.has(name) || FORBIDDEN_LOADER_NAMES.has(name)) &&
    !isNonValueAcornIdentifier(node, parent, key, ancestors)) {
    fail("UNSUPPORTED_MODULE_FORM");
  }
}

function isNonValueAcornIdentifier(node, parent, key, ancestors) {
  if (!parent) return false;
  if ((parent.type === "VariableDeclarator" && key === "id") ||
    ((parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression" || parent.type === "ClassDeclaration" ||
      parent.type === "ClassExpression") && key === "id") ||
    ((parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression" || parent.type === "ArrowFunctionExpression") && key === "params") ||
    (parent.type === "CatchClause" && key === "param") || parent.type === "ImportSpecifier" ||
    parent.type === "ImportDefaultSpecifier" || parent.type === "ImportNamespaceSpecifier" ||
    (parent.type === "ExportSpecifier" && key === "exported") ||
    (parent.type === "MemberExpression" && key === "property" && !parent.computed) ||
    (parent.type === "Property" && key === "key" && !parent.computed && !parent.shorthand) ||
    ((parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") && key === "key" && !parent.computed) ||
    ((parent.type === "LabeledStatement" || parent.type === "BreakStatement" || parent.type === "ContinueStatement") && key === "label")) {
    return true;
  }
  return ancestors.some((ancestor, index) => {
    const child = index === ancestors.length - 1 ? parent : ancestors[index + 1];
    return (ancestor.type === "VariableDeclarator" && ancestor.id === child) ||
      ((ancestor.type === "FunctionDeclaration" || ancestor.type === "FunctionExpression" || ancestor.type === "ArrowFunctionExpression") &&
        ancestor.params.includes(child)) || (ancestor.type === "CatchClause" && ancestor.param === child);
  });
}

function scanTypeScript(path, source, sourceMode, sourceKind) {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.ES2024,
    true,
    sourceMode === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  if (file.parseDiagnostics.length > 0) fail("TOOLING_SOURCE_INVALID");
  const edges = [];
  visitTypeScript(file, edges);
  return { sourceKind, edges };
}

function visitTypeScript(node, edges) {
  if (ts.isImportDeclaration(node)) {
    addSpecifier(edges, tsModuleSpecifier(node.moduleSpecifier), tsImportKind(node));
  } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
    addSpecifier(edges, tsModuleSpecifier(node.moduleSpecifier), node.isTypeOnly ? "type_import" : "runtime_import");
  } else if (ts.isImportEqualsDeclaration(node)) {
    const reference = node.moduleReference;
    if (!ts.isExternalModuleReference(reference) || !reference.expression || !ts.isStringLiteral(reference.expression)) {
      fail("UNSUPPORTED_MODULE_FORM");
    }
    addSpecifier(edges, reference.expression.text, "runtime_import");
  } else if (ts.isCallExpression(node)) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword || isTsIdentifier(node.expression, "require")) {
      fail("UNSUPPORTED_MODULE_FORM");
    }
  } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    checkTsMember(node);
  } else if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
    checkTsBindingElement(node);
  } else if (ts.isIdentifier(node)) {
    checkTsIdentifier(node);
  }
  ts.forEachChild(node, (child) => visitTypeScript(child, edges));
}

function checkTsMember(node) {
  const name = tsMemberName(node);
  if (name && (FORBIDDEN_MEMBER_NAMES.has(name) || FORBIDDEN_LOADER_NAMES.has(name))) fail("UNSUPPORTED_MODULE_FORM");
  if (isTsIdentifier(node.expression, "Object") && FORBIDDEN_OBJECT_METHODS.has(name)) fail("UNSUPPORTED_MODULE_FORM");
  if (isTsIdentifier(node.expression, "process") &&
    (ts.isElementAccessExpression(node) || !ALLOWED_PROCESS_MEMBERS.has(name))) {
    fail("UNSUPPORTED_MODULE_FORM");
  }
}

function checkTsBindingElement(node) {
  const name = tsPropertyName(node.propertyName ?? node.name);
  if (name && (FORBIDDEN_VALUE_NAMES.has(name) || FORBIDDEN_MEMBER_NAMES.has(name) ||
    FORBIDDEN_LOADER_NAMES.has(name) || FORBIDDEN_OBJECT_METHODS.has(name))) {
    fail("UNSUPPORTED_MODULE_FORM");
  }
}

function checkTsIdentifier(node) {
  const name = node.text;
  if (name === "process") {
    const parent = node.parent;
    if (!(ts.isPropertyAccessExpression(parent) && parent.expression === node && ALLOWED_PROCESS_MEMBERS.has(parent.name.text))) {
      fail("UNSUPPORTED_MODULE_FORM");
    }
    return;
  }
  if (name === "require") fail("UNSUPPORTED_MODULE_FORM");
  if ((FORBIDDEN_VALUE_NAMES.has(name) || FORBIDDEN_LOADER_NAMES.has(name)) && !isNonValueTsIdentifier(node)) {
    fail("UNSUPPORTED_MODULE_FORM");
  }
}

function isNonValueTsIdentifier(node) {
  const parent = node.parent;
  if (!parent || isTsTypePosition(node)) return true;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) && parent.name === node) return true;
  if ((ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent)) && parent.name === node) return true;
  if ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) || ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent)) && parent.name === node) ||
    ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) ||
    (ts.isLabeledStatement(parent) && parent.label === node) ||
    ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node)) {
    return true;
  }
  if (ts.isExportSpecifier(parent)) {
    const declaration = parent.parent?.parent;
    return parent.isTypeOnly || (ts.isExportDeclaration(declaration) && declaration.isTypeOnly) ||
      (parent.propertyName !== undefined && parent.name === node);
  }
  return isNestedTsBinding(node);
}

function isNestedTsBinding(node) {
  let current = node;
  for (let parent = node.parent; parent; current = parent, parent = parent.parent) {
    if (ts.isBindingElement(parent) || ts.isObjectBindingPattern(parent) || ts.isArrayBindingPattern(parent)) continue;
    return ((ts.isVariableDeclaration(parent) || ts.isParameter(parent)) && parent.name === current) ||
      (ts.isCatchClause(parent) && parent.variableDeclaration?.name === current);
  }
  return false;
}

function isTsTypePosition(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current) || ts.isTypeParameterDeclaration(current)) return true;
    if (ts.isSourceFile(current) || ts.isBlock(current)) return false;
  }
  return false;
}

function tsImportKind(node) {
  const clause = node.importClause;
  if (clause?.isTypeOnly) return "type_import";
  const bindings = clause?.namedBindings;
  return bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((item) => item.isTypeOnly)
    ? "type_import"
    : "runtime_import";
}

function addSpecifier(edges, specifier, kind) {
  validateModuleSpecifier(specifier);
  edges.push({ kind, specifier });
}

function validateModuleSpecifier(specifier) {
  if (typeof specifier !== "string" || specifier.length === 0 || specifier.length > 512 || /[\0\r\n]/.test(specifier)) {
    fail("UNSUPPORTED_MODULE_FORM");
  }
  if (FORBIDDEN_MODULES.has(specifier)) fail("UNSUPPORTED_MODULE_FORM");
  if (specifier.startsWith("node:") && !SAFE_NODE_BUILTINS.has(specifier)) fail("BUILTIN_NOT_ALLOWED");
  if (normalizeNodeBuiltinSpecifier(specifier) || specifier.startsWith(".") || specifier === "acorn" || specifier === "typescript") return;
}

function sourceKindFor(path, sourceMode) {
  const extension = extname(path);
  if (extension === ".mjs" && sourceMode === "module") return "esm";
  if (extension === ".cjs" && sourceMode === "script") return "commonjs";
  if (extension === ".js" && (sourceMode === "module" || sourceMode === "script")) {
    return sourceMode === "module" ? "esm" : "commonjs";
  }
  if (extension === ".ts" && sourceMode === "typescript") return "typescript";
  if (extension === ".tsx" && sourceMode === "tsx") return "tsx";
  if (extension === ".json" && sourceMode === "json") return "json";
  fail("UNSUPPORTED_TOOLING_SOURCE");
}

function normalizedSpecifiers(edges) {
  return [...new Set(edges.map((edge) => edge.specifier))].sort(compareText);
}

function normalizedModuleEdges(importerPath, edges) {
  const unique = new Map();
  for (const edge of edges) unique.set(`${edge.kind}\0${edge.specifier}`, { importerPath, ...edge });
  return [...unique.values()].sort((left, right) => compareText(`${left.kind}\0${left.specifier}`, `${right.kind}\0${right.specifier}`));
}

function descriptor(path, sourceMode) {
  return { version: 1, path, sourceMode };
}

function literalText(node) {
  if (node?.type !== "Literal" || typeof node.value !== "string") fail("UNSUPPORTED_MODULE_FORM");
  return node.value;
}

function literalTextOrNull(node) {
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : null;
}

function identifierOrLiteralName(node) {
  if (node?.type === "Identifier") return node.name;
  return literalTextOrNull(node);
}

function acornMemberName(node) {
  return node.computed ? literalTextOrNull(node.property) : identifierOrLiteralName(node.property);
}

function tsModuleSpecifier(node) {
  if (!ts.isStringLiteral(node)) fail("UNSUPPORTED_MODULE_FORM");
  return node.text;
}

function tsMemberName(node) {
  return ts.isPropertyAccessExpression(node) ? node.name.text : tsPropertyName(node.argumentExpression);
}

function tsPropertyName(node) {
  return node && (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) ? node.text : null;
}

function isTsIdentifier(node, name) {
  return ts.isIdentifier(node) && node.text === name;
}

function requiredRoot(rootDir) {
  if (typeof rootDir !== "string" || !isAbsolute(rootDir)) fail("TOOLING_SOURCE_INVALID");
  try { return realpathSync(resolve(rootDir)); } catch { fail("TOOLING_SOURCE_INVALID"); }
}

function requiredInside(root, path) {
  try {
    const target = realpathSync(path);
    if (!inside(root, target)) fail("MODULE_OUTSIDE_CLOSURE");
    return target;
  } catch (error) {
    if (error instanceof ToolchainClosureError) throw error;
    fail("TOOLING_SOURCE_INVALID");
  }
}

function safeRelativePath(path) {
  if (typeof path !== "string" || path.length === 0 || path.length > 512 || isAbsolute(path) || path.includes("\0") ||
    path.split(/[\\/]/).some((part) => part === "" || part === "." || part === "..")) {
    fail("TOOLING_SOURCE_INVALID");
  }
  return path.split("\\").join("/");
}

function inside(root, target) {
  return target === root || target.startsWith(`${root}${sep}`);
}

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function fail(code) {
  throw new ToolchainClosureError(code);
}
