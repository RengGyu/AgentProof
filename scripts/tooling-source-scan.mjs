import ts from "typescript";
import {
  normalizeNodeBuiltinSpecifier,
  ToolchainClosureError
} from "./toolchain-closure-policy.mjs";

const FORBIDDEN_LOADER_NAMES = new Set(["createRequire", "getBuiltinModule", "_load"]);

export function scanToolingSource({ path, source }) {
  if (typeof path !== "string" || typeof source !== "string") fail("TOOLING_SOURCE_INVALID");
  const sourceDescriptor = sourceDescriptorFor(path);
  if (!sourceDescriptor) fail("UNSUPPORTED_TOOLING_SOURCE");
  if (sourceDescriptor.sourceKind === "json") {
    try { JSON.parse(source); } catch { fail("TOOLING_SOURCE_INVALID"); }
    return { version: 2, sourceKind: "json", moduleEdges: [] };
  }

  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ES2024, true, sourceDescriptor.scriptKind);
  if (file.parseDiagnostics.length > 0) fail("TOOLING_SOURCE_INVALID");
  const edges = [];
  visit(file, path, edges);
  return {
    version: 2,
    sourceKind: sourceDescriptor.sourceKind,
    moduleEdges: normalizedEdges(edges)
  };
}

function sourceDescriptorFor(path) {
  if (path.endsWith(".mjs")) return { sourceKind: "esm", scriptKind: ts.ScriptKind.JS };
  if (path.endsWith(".ts")) return { sourceKind: "typescript", scriptKind: ts.ScriptKind.TS };
  if (path.endsWith(".json")) return { sourceKind: "json" };
  return null;
}

function visit(node, importerPath, edges) {
  if (ts.isImportDeclaration(node)) {
    if (node.attributes || node.assertClause) fail("UNSUPPORTED_MODULE_FORM");
    addEdge(edges, importerPath, importKind(node), moduleSpecifier(node));
  } else if (ts.isExportDeclaration(node)) {
    checkExportDeclaration(node, importerPath, edges);
  } else if (ts.isExportAssignment(node)) {
    fail("UNSUPPORTED_MODULE_FORM");
  } else if (ts.isImportEqualsDeclaration(node)) {
    fail("UNSUPPORTED_MODULE_FORM");
  } else if (ts.isCallExpression(node)) {
    checkCallExpression(node);
  } else if (ts.isNewExpression(node)) {
    if (isIdentifierNamed(node.expression, "Function")) fail("UNSUPPORTED_MODULE_FORM");
  } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    checkCommonJsMember(node);
  } else if (ts.isIdentifier(node) && isCommonJsValueReference(node)) {
    fail("UNSUPPORTED_MODULE_FORM");
  }
  ts.forEachChild(node, (child) => visit(child, importerPath, edges));
}

function importKind(node) {
  const importClause = node.importClause;
  if (!importClause || importClause.isTypeOnly) return importClause?.isTypeOnly ? "type_import" : "runtime_import";
  const namedBindings = importClause.namedBindings;
  if (namedBindings && ts.isNamedImports(namedBindings) && namedBindings.elements.length > 0 &&
    namedBindings.elements.every((item) => item.isTypeOnly)) {
    return "type_import";
  }
  return "runtime_import";
}

function checkExportDeclaration(node, importerPath, edges) {
  if (!node.moduleSpecifier) return;
  if (node.attributes || node.assertClause || !node.isTypeOnly || !node.exportClause || !ts.isNamedExports(node.exportClause) ||
    !node.exportClause.elements.every(isIdentifierOnlyExport)) {
    fail("UNSUPPORTED_MODULE_FORM");
  }
  addEdge(edges, importerPath, "type_import", moduleSpecifier(node));
}

function isIdentifierOnlyExport(item) {
  return ts.isIdentifier(item.name) && (!item.propertyName || ts.isIdentifier(item.propertyName));
}

function moduleSpecifier(node) {
  if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier)) fail("UNSUPPORTED_MODULE_FORM");
  const specifier = node.moduleSpecifier.text;
  if (specifier.startsWith("node:") && !normalizeNodeBuiltinSpecifier(specifier)) fail("BUILTIN_NOT_ALLOWED");
  return specifier;
}

function addEdge(edges, importerPath, kind, specifier) {
  edges.push({ importerPath, kind, specifier });
}

function checkCallExpression(node) {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    isIdentifierNamed(node.expression, "eval") ||
    isIdentifierNamed(node.expression, "Function") ||
    isIdentifierNamed(node.expression, "require") ||
    isDirectLoaderCall(node.expression)) {
    fail("UNSUPPORTED_MODULE_FORM");
  }
}

function isDirectLoaderCall(expression) {
  if (ts.isIdentifier(expression)) return FORBIDDEN_LOADER_NAMES.has(expression.text);
  if (ts.isPropertyAccessExpression(expression)) return FORBIDDEN_LOADER_NAMES.has(expression.name.text);
  return ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression) &&
    FORBIDDEN_LOADER_NAMES.has(expression.argumentExpression.text);
}

function checkCommonJsMember(node) {
  const object = node.expression;
  if (isIdentifierNamed(object, "exports") ||
    (isIdentifierNamed(object, "module") && memberName(node) === "exports")) {
    fail("UNSUPPORTED_MODULE_FORM");
  }
}

function isCommonJsValueReference(node) {
  if (node.text !== "module" && node.text !== "exports") return false;
  const parent = node.parent;
  if (!parent || isTypePosition(node)) return false;
  if ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) && parent.name === node) return false;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) ||
    ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent)) && parent.name === node) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  return true;
}

function isTypePosition(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isTypeNode(current) || ts.isTypeParameterDeclaration(current)) return true;
    if (ts.isSourceFile(current) || ts.isBlock(current)) return false;
  }
  return false;
}

function memberName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return ts.isStringLiteral(node.argumentExpression) ? node.argumentExpression.text : null;
}

function isIdentifierNamed(node, name) {
  return ts.isIdentifier(node) && node.text === name;
}

function normalizedEdges(edges) {
  const unique = new Map();
  for (const edge of edges) unique.set(`${edge.importerPath}\u0000${edge.kind}\u0000${edge.specifier}`, edge);
  return [...unique.values()].sort((left, right) => compareText(left.importerPath, right.importerPath) ||
    compareText(left.kind, right.kind) || compareText(left.specifier, right.specifier));
}

function compareText(left, right) {
  return left === right ? 0 : left < right ? -1 : 1;
}

function fail(code) {
  throw new ToolchainClosureError(code);
}
