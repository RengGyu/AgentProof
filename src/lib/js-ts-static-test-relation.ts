import { createHash } from "node:crypto";
import path from "node:path";
import ts from "typescript";

export interface JsTsStaticTestRelationInputV1 {
  testPath: string;
  testSource: string;
  modules: Array<{ path: string; source: string }>;
}

export interface JsTsStaticTestRelationV1 {
  state: "verified" | "unresolved";
  importRelation: { level: "verified"; basis: "typescript_ast_relation"; subjectDigest: string } | null;
  assertionRelation: { level: "verified"; basis: "typescript_ast_relation"; subjectDigest: string } | null;
}

/**
 * A closed, source-supplied TypeScript AST adapter. It never reads the file
 * system, resolves dynamic imports, executes code, or makes product claims.
 */
export function resolveJsTsStaticTestRelationV1(input: JsTsStaticTestRelationInputV1): JsTsStaticTestRelationV1 {
  if (!isValidInput(input)) return unresolved();
  const testFile = ts.createSourceFile(input.testPath, input.testSource, ts.ScriptTarget.Latest, true, scriptKind(input.testPath));
  if (hasParseErrors(testFile)) return unresolved();
  const imports = staticImportBindings(testFile);
  const assertedLocalNames = directAssertedLocalNames(testFile);
  if (assertedLocalNames.size !== 1) return unresolved();
  const localName = [...assertedLocalNames][0]!;
  const binding = imports.get(localName);
  if (!binding) return unresolved();
  const module = resolveModule(input.testPath, binding.specifier, input.modules);
  if (!module || !exportsBinding(module.source, binding.exportedName)) return unresolved();
  const subjectDigest = digest({
    domain: "agentproof.js-ts-static-test-relation.v1",
    test: sha(input.testSource),
    module: sha(module.source),
    export: binding.exportedName,
    local: binding.localName
  });
  return {
    state: "verified",
    importRelation: { level: "verified", basis: "typescript_ast_relation", subjectDigest },
    assertionRelation: { level: "verified", basis: "typescript_ast_relation", subjectDigest }
  };
}

interface StaticImportBinding {
  localName: string;
  exportedName: string;
  specifier: string;
}

function staticImportBindings(file: ts.SourceFile): Map<string, StaticImportBinding> {
  const bindings = new Map<string, StaticImportBinding>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.importClause || statement.importClause.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause.name) {
      if (bindings.has(clause.name.text)) return new Map();
      bindings.set(clause.name.text, { localName: clause.name.text, exportedName: "default", specifier });
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (element.isTypeOnly || bindings.has(element.name.text)) return new Map();
        bindings.set(element.name.text, { localName: element.name.text, exportedName: element.propertyName?.text ?? element.name.text, specifier });
      }
    }
  }
  return bindings;
}

function directAssertedLocalNames(file: ts.SourceFile): Set<string> {
  const result = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const localName = assertedTargetLocalName(node);
      if (localName) result.add(localName);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return result;
}

function assertedTargetLocalName(node: ts.CallExpression): string | null {
  if (ts.isIdentifier(node.expression) && node.expression.text === "expect" && node.arguments.length === 1 && isExpectationMatcherCall(node)) return directTargetCallName(node.arguments[0]!);
  if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "assert" && node.expression.name.text === "equal" && node.arguments.length >= 2) return directTargetCallName(node.arguments[0]!);
  return null;
}

function isExpectationMatcherCall(expectCall: ts.CallExpression): boolean {
  const parent = expectCall.parent;
  return ts.isPropertyAccessExpression(parent) && parent.expression === expectCall && ts.isCallExpression(parent.parent) && parent.parent.expression === parent;
}

function directTargetCallName(value: ts.Expression): string | null {
  if (!ts.isCallExpression(value) || !ts.isIdentifier(value.expression) || value.arguments.some((argument) => ts.isSpreadElement(argument) || !isStaticLiteral(argument))) return null;
  return value.expression.text;
}

function isStaticLiteral(value: ts.Expression): boolean {
  return ts.isStringLiteral(value) || ts.isNumericLiteral(value) || value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword || value.kind === ts.SyntaxKind.NullKeyword || ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand);
}

function resolveModule(testPath: string, specifier: string, modules: JsTsStaticTestRelationInputV1["modules"]): { path: string; source: string } | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(normalizePath(testPath)), specifier));
  const candidates = modules.filter((module) => moduleMatches(normalizePath(module.path), base));
  return candidates.length === 1 ? candidates[0]! : null;
}

function moduleMatches(modulePath: string, base: string): boolean {
  return modulePath === base || stripScriptExtension(modulePath) === stripScriptExtension(base);
}

function exportsBinding(source: string, exportedName: string): boolean {
  const file = ts.createSourceFile("module.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (hasParseErrors(file)) return false;
  return file.statements.some((statement) => {
    if (exportedName === "default") return hasDefaultExport(statement);
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isVariableStatement(statement)) && hasExportModifier(statement)) {
      if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === exportedName);
      return statement.name?.text === exportedName;
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      return statement.exportClause.elements.some((element) => (element.name.text === exportedName));
    }
    return false;
  });
}

function hasDefaultExport(statement: ts.Statement): boolean {
  return (ts.isExportAssignment(statement) && !statement.isExportEquals) || (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && Boolean(statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) && hasExportModifier(statement));
}
function hasParseErrors(file: ts.SourceFile): boolean { return ((file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length ?? 0) > 0; }
function hasExportModifier(node: ts.HasModifiers): boolean { return Boolean(node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)); }
function scriptKind(filePath: string): ts.ScriptKind { return /\.tsx$/i.test(filePath) ? ts.ScriptKind.TSX : /\.jsx$/i.test(filePath) ? ts.ScriptKind.JSX : /\.js$/i.test(filePath) ? ts.ScriptKind.JS : ts.ScriptKind.TS; }
function isValidInput(input: JsTsStaticTestRelationInputV1): boolean { return typeof input.testPath === "string" && typeof input.testSource === "string" && input.modules.length > 0 && input.modules.every((module) => typeof module.path === "string" && typeof module.source === "string") && Buffer.byteLength(input.testSource, "utf8") <= 64 * 1024 && input.modules.every((module) => Buffer.byteLength(module.source, "utf8") <= 64 * 1024); }
function normalizePath(value: string): string { return value.replace(/\\/g, "/").replace(/^\.\//, ""); }
function stripScriptExtension(value: string): string { return value.replace(/\.(?:[cm]?[jt]sx?)$/i, ""); }
function unresolved(): JsTsStaticTestRelationV1 { return { state: "unresolved", importRelation: null, assertionRelation: null }; }
function sha(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }
function digest(value: unknown): string { return sha(stableJson(value)); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`; } return JSON.stringify(value); }
