import { createHash } from "crypto";
import type {
  CanonicalRequirementSetV1,
  DeterministicRequirementRelation,
  ExactHeadTargetReceipt,
  RequirementSourceBinding,
  ResolvedHeadModulePayload,
  TestRelationReceiptV2
} from "./types";

const GENERIC_RELATION_TOKENS = new Set([
  "check",
  "checks",
  "ci",
  "e2e",
  "integration",
  "js",
  "jsx",
  "passed",
  "py",
  "regression",
  "spec",
  "specs",
  "src",
  "status",
  "test",
  "tests",
  "ts",
  "tsx",
  "unit",
  "workflow",
  "회귀",
  "시험",
  "테스트"
]);

const GENERIC_CODE_SUBJECT_IDENTIFIERS = new Set([
  ...GENERIC_RELATION_TOKENS,
  "data",
  "file",
  "files",
  "input",
  "inputs",
  "item",
  "items",
  "log",
  "logs",
  "name",
  "output",
  "outputs",
  "result",
  "results",
  "value",
  "values"
]);

const MAX_FLAT_OBJECT_LITERAL_FIELDS = 8;
const SCALAR_LITERAL_PATTERN = /^(?:true|false|null|undefined|-?(?:\d+(?:\.\d+)?|\.\d+)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`$]*`)$/u;

interface PatchFile {
  path: string;
  patch?: string;
}

interface DirectTestBinding {
  importSpecifier: string;
  targetPath: string;
  exportedName: string;
  localName: string;
  importKind: "named" | "default" | "commonjs";
  distinctLiteralCaseCount: number;
}

export interface DirectTestTargetCandidate {
  testPath: string;
  importSpecifier: string;
  targetPath: string;
}

export interface ExactHeadTargetResolution {
  testPath: string;
  targetPath: string;
  bindingExportedName: string;
  bindingLocalName: string;
  distinctLiteralCaseCount: number;
  receipt: ExactHeadTargetReceipt;
}

export type TestRelationSubjectSource = TestRelationReceiptV2["subjectSource"];

type StableRequirementBinding = Pick<
  RequirementSourceBinding,
  "id" | "requirementId" | "seedId" | "groupId" | "source" | "ordinal"
>;

/** Derives the current requirement's stable private identity from Task 3's canonical bundle. */
export function canonicalCurrentRequirementBinding(
  canonical: CanonicalRequirementSetV1,
  requirementId: string
): StableRequirementBinding | null {
  const unit = canonical.requirements.find((candidate) => candidate.reportRequirementId === requirementId);
  if (!unit) return null;
  return {
    id: `rsb_${unit.stableBindingKey}`,
    requirementId: unit.reportRequirementId,
    seedId: canonical.sourceContentHash,
    groupId: unit.groupId as RequirementSourceBinding["groupId"],
    source: unit.source,
    ordinal: unit.ordinal
  };
}

/**
 * Transient parser output. Its target paths are used only to match collected
 * evidence; a receipt receives the digests and references below, never these
 * raw locations or the caller-provided subject identifier.
 */
export interface BoundedTestRelationCandidate {
  target: DirectTestTargetCandidate;
  subjectSource: TestRelationSubjectSource;
  subjectDigest: string;
  importBindingDigest: string;
  directAssertionCount: number;
}

/**
 * Produces one receipt-ready parser candidate only when a closed Task 3
 * relation establishes the owner and a single exact static binding is called
 * directly inside a live assertion. It consumes source bindings and never
 * recreates them from source prose.
 */
export function boundedTestRelationCandidate(input: {
  testFile: PatchFile;
  subject: string;
  requirementId: string;
  currentRequirementText: string;
  /** Canonical Task 3 requirement text keyed by its report requirement ID. */
  requirementTexts: ReadonlyMap<string, string>;
  /** Canonical selected-source binding for the current requirement, when relation bindings are absent. */
  currentSourceBinding?: StableRequirementBinding;
  targetMode: TestRelationReceiptV2["targetMode"];
  relation?: DeterministicRequirementRelation;
  sourceBindings: readonly RequirementSourceBinding[];
}): BoundedTestRelationCandidate | null {
  const context = closedTestRelationSubjectContext(input);
  if (!context) return null;

  const bindings = directAssertedTestBindings(input.testFile, input.subject);
  if (bindings.length !== 1) return null;
  const binding = bindings[0]!;
  const target = {
    testPath: normalizeRepositoryPath(input.testFile.path),
    importSpecifier: binding.importSpecifier,
    targetPath: binding.targetPath
  };
  return {
    target,
    subjectSource: context.subjectSource,
    subjectDigest: sha256(["v2", input.requirementId, input.subject, ...context.stableBindingIdentity].join("\0")),
    importBindingDigest: sha256([
      "v2",
      input.requirementId,
      ...context.stableBindingIdentity,
      binding.targetPath,
      binding.importSpecifier,
      binding.importKind,
      binding.exportedName,
      binding.localName
    ].join("\0")),
    directAssertionCount: Math.min(binding.distinctLiteralCaseCount, 8)
  };
}

function closedTestRelationSubjectContext(input: {
  subject: string;
  requirementId: string;
  currentRequirementText: string;
  requirementTexts: ReadonlyMap<string, string>;
  currentSourceBinding?: StableRequirementBinding;
  targetMode: TestRelationReceiptV2["targetMode"];
  relation?: DeterministicRequirementRelation;
  sourceBindings: readonly RequirementSourceBinding[];
}): { subjectSource: TestRelationSubjectSource; stableBindingIdentity: string[] } | null {
  const allBindings = input.currentSourceBinding
    ? [...input.sourceBindings, input.currentSourceBinding]
    : [...input.sourceBindings];
  const bindingsById = new Map(allBindings.map((binding) => [binding.id, binding]));
  if (bindingsById.size !== allBindings.length) return null;
  const currentBinding = input.currentSourceBinding?.requirementId === input.requirementId
    ? input.currentSourceBinding
    : input.sourceBindings.find((binding) => binding.requirementId === input.requirementId);
  const currentText = input.requirementTexts.get(input.requirementId);
  const explicitCurrentSubject = Boolean(
    currentBinding &&
    currentText === input.currentRequirementText &&
    isExplicitCodeIdentifierReference(currentText, input.subject)
  );
  if (input.targetMode === "exact_head_target") {
    return !input.relation && explicitCurrentSubject
      ? { subjectSource: "current_requirement", stableBindingIdentity: stableBindingIdentity([currentBinding!]) }
      : null;
  }
  if (!input.relation) {
    return explicitCurrentSubject
      ? { subjectSource: "current_requirement", stableBindingIdentity: stableBindingIdentity([currentBinding!]) }
      : null;
  }

  if (input.relation.kind === "test_antecedent") {
    const current = bindingsById.get(input.relation.currentSourceBindingRef);
    const antecedent = bindingsById.get(input.relation.antecedentSourceBindingRef);
    const antecedentText = input.requirementTexts.get(input.relation.antecedentRequirementId);
    return current?.requirementId === input.requirementId &&
      antecedent?.requirementId === input.relation.antecedentRequirementId &&
      Boolean(antecedentText && isExplicitCodeIdentifierReference(antecedentText, input.subject)) &&
      adjacentSourceBindings(antecedent, current)
      ? { subjectSource: "test_antecedent", stableBindingIdentity: stableBindingIdentity([antecedent, current]) }
      : null;
  }
  if (input.relation.kind === "test_subject_chain") {
    const current = bindingsById.get(input.relation.currentSourceBindingRef);
    const subject = bindingsById.get(input.relation.subjectSourceBindingRef);
    const bridge = bindingsById.get(input.relation.bridgeSourceBindingRef);
    const subjectText = input.requirementTexts.get(input.relation.subjectRequirementId);
    return current?.requirementId === input.requirementId &&
      subject?.requirementId === input.relation.subjectRequirementId &&
      bridge?.requirementId === input.relation.bridgeRequirementId &&
      Boolean(subjectText && isExplicitCodeIdentifierReference(subjectText, input.subject)) &&
      adjacentSourceBindings(subject, bridge) && adjacentSourceBindings(bridge, current)
      ? { subjectSource: "test_subject_chain", stableBindingIdentity: stableBindingIdentity([subject, bridge, current]) }
      : null;
  }
  return null;
}

function stableBindingIdentity(bindings: readonly StableRequirementBinding[]): string[] {
  return bindings.flatMap((binding) => [binding.id, binding.seedId]);
}

function adjacentSourceBindings(
  earlier: StableRequirementBinding | undefined,
  later: StableRequirementBinding | undefined
): boolean {
  return Boolean(
    earlier && later &&
    earlier.seedId === later.seedId &&
    earlier.groupId === later.groupId &&
    earlier.source === later.source &&
    later.ordinal === earlier.ordinal + 1
  );
}

/**
 * Binds an exact imported target to one explicit code identifier in the
 * requirement subject. Raw identifiers remain transient resolver state.
 */
export function exactTestRelationSubjectSource(input: {
  currentRequirementText: string;
  target: Pick<ExactHeadTargetResolution, "bindingExportedName" | "bindingLocalName">;
}): "current_requirement" | null {
  const bindingIdentifiers = new Set([
    input.target.bindingExportedName,
    input.target.bindingLocalName
  ].filter((identifier) => /^[A-Za-z_$][\w$]*$/.test(identifier) &&
    identifier !== "default" && identifier !== "module.exports"));
  if (bindingIdentifiers.size === 0) return null;

  const currentMatches = matchingCodeIdentifiers(input.currentRequirementText, bindingIdentifiers);
  return currentMatches.length === 1 ? "current_requirement" : null;
}

/**
 * Selects one static relative target only after one imported local binding is
 * called directly inside an assertion. Returned raw names and paths are
 * transient resolver state, never report data.
 */
export function directTestTargetCandidate(testFile: PatchFile, subject?: string): DirectTestTargetCandidate | null {
  const bindings = directAssertedTestBindings(testFile, subject);
  if (bindings.length !== 1) return null;
  const binding = bindings[0];
  return {
    testPath: normalizeRepositoryPath(testFile.path),
    importSpecifier: binding.importSpecifier,
    targetPath: binding.targetPath
  };
}

/**
 * Resolves a transient exact-head module to a digest-only private receipt.
 * Every uncertain or non-direct shape fails closed.
 */
export function resolveExactHeadTarget(input: {
  testPath: string;
  testPatch: string;
  importSpecifier: string;
  headSha: string;
  target: ResolvedHeadModulePayload;
  subject?: string;
}): ExactHeadTargetResolution | null {
  if (!/^[a-f0-9]{40,64}$/i.test(input.headSha)) return null;
  if (
    input.target.version !== 1 ||
    input.target.kind !== "resolved_head_module" ||
    input.target.headSha !== input.headSha ||
    !/^[a-f0-9]{40,64}$/i.test(input.target.blobSha) ||
    Buffer.byteLength(input.target.source, "utf8") > 64 * 1024
  ) return null;
  const blobAlgorithm = input.target.blobSha.length === 40 ? "sha1" : "sha256";
  const expectedBlobSha = createHash(blobAlgorithm)
    .update(`blob ${Buffer.byteLength(input.target.source, "utf8")}\0`)
    .update(input.target.source)
    .digest("hex");
  if (expectedBlobSha !== input.target.blobSha.toLowerCase()) return null;

  const testFile = { path: input.testPath, patch: input.testPatch };
  const bindings = directAssertedTestBindings(testFile, input.subject)
    .filter((binding) => binding.importSpecifier === input.importSpecifier);
  if (bindings.length !== 1) return null;
  const binding = bindings[0];
  const targetPath = normalizeRepositoryPath(input.target.path);
  if (!targetPath || targetPath.startsWith("../") || binding.targetPath !== targetPath) return null;

  const source = input.target.source.replace(/\r\n?/g, "\n");
  const exportKind = directExportKind(source, binding);
  if (!exportKind) return null;

  const canonicalBindingDigest = sha256([
    "v1",
    exportKind,
    binding.importKind,
    binding.exportedName,
    binding.localName
  ].join("\0"));
  const targetPathDigest = sha256(targetPath);
  const targetBlobSha = input.target.blobSha.toLowerCase();
  const idDigest = sha256([input.headSha.toLowerCase(), targetPathDigest, targetBlobSha, canonicalBindingDigest].join("\0"));

  return {
    testPath: normalizeRepositoryPath(input.testPath),
    targetPath,
    bindingExportedName: binding.exportedName,
    bindingLocalName: binding.localName,
    distinctLiteralCaseCount: binding.distinctLiteralCaseCount,
    receipt: {
      id: `exact_head_${idDigest.slice(0, 24)}`,
      version: 1,
      kind: "exact_head_target",
      headSha: input.headSha.toLowerCase(),
      targetPathDigest,
      targetBlobSha,
      exportKind,
      canonicalBindingDigest
    }
  };
}

function matchingCodeIdentifiers(text: string, candidates: ReadonlySet<string>): string[] {
  return [...candidates].filter((candidate) => isExplicitCodeIdentifierReference(text, candidate));
}

function isExplicitCodeIdentifierReference(text: string, candidate: string): boolean {
  if (GENERIC_CODE_SUBJECT_IDENTIFIERS.has(candidate.toLowerCase())) return false;
  const identifier = escapeRegExp(candidate);
  if (new RegExp(`\`${identifier}\``).test(text)) return true;
  if (new RegExp(`(^|[^A-Za-z0-9_$])${identifier}\\s*\\(`).test(text)) return true;
  const hasCodeShape = /[_$]/.test(candidate) || /[A-Z]/.test(candidate);
  return hasCodeShape && new RegExp(`(^|[^A-Za-z0-9_$])${identifier}(?![A-Za-z0-9_$])`).test(text);
}

function directAssertedTestBindings(testFile: PatchFile, subject?: string): DirectTestBinding[] {
  const entries = livePatchEntries(testFile.patch ?? "");
  const lines = entries.map((entry) => entry.line);
  const code = lines.join("\n");
  if (
    /\bimport\s*\(/.test(code) ||
    /\b(?:vi|jest)\s*\.\s*(?:doMock|mock)\s*\(/.test(code) ||
    hasDisabledOrStaticallyUnreachableTestCode(patchCodeForDeclarationScan(testFile.patch ?? ""))
  ) return [];

  const imported: Omit<DirectTestBinding, "distinctLiteralCaseCount">[] = [];
  const relativeImportStatementCount = relativeStaticImportExpressionCount(lines);
  for (const sourceLine of lines) {
    const line = sourceLine.trim();
    const importMatch = line.match(/^import\s+(.+?)\s+from\s+["']([^"']+)["']\s*;?$/);
    if (importMatch) {
      const specifier = importMatch[2];
      const targetPath = explicitRelativeImportTarget(testFile.path, specifier);
      if (!targetPath) continue;
      const clause = importMatch[1].trim();
      const named = clause.match(/^\{([^}]+)\}$/);
      if (named) {
        for (const entry of named[1].split(",")) {
          const match = entry.trim().match(/^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
          if (!match || entry.trim().startsWith("type ")) continue;
          imported.push({
            importSpecifier: specifier,
            targetPath,
            exportedName: match[1],
            localName: match[2] ?? match[1],
            importKind: "named"
          });
        }
      } else {
        const defaultMatch = clause.match(/^([A-Za-z_$][\w$]*)$/);
        if (defaultMatch) imported.push({
          importSpecifier: specifier,
          targetPath,
          exportedName: "default",
          localName: defaultMatch[1],
          importKind: "default"
        });
      }
      continue;
    }

    const requireMatch = line.match(/^(?:const|let|var)\s+(.+?)\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)\s*;?$/);
    if (!requireMatch) continue;
    const specifier = requireMatch[2];
    const targetPath = explicitRelativeImportTarget(testFile.path, specifier);
    if (!targetPath) continue;
    const clause = requireMatch[1].trim();
    const destructured = clause.match(/^\{([^}]+)\}$/);
    if (destructured) {
      for (const entry of destructured[1].split(",")) {
        const match = entry.trim().match(/^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
        if (!match) continue;
        imported.push({
          importSpecifier: specifier,
          targetPath,
          exportedName: match[1],
          localName: match[2] ?? match[1],
          importKind: "commonjs"
        });
      }
    } else if (/^[A-Za-z_$][\w$]*$/.test(clause)) {
      imported.push({
        importSpecifier: specifier,
        targetPath,
        exportedName: "module.exports",
        localName: clause,
        importKind: "commonjs"
      });
    }
  }

  if (relativeImportStatementCount !== 1) return [];

  const uniqueImports = imported.filter((binding, index) => imported.findIndex((candidate) =>
    candidate.importSpecifier === binding.importSpecifier &&
    candidate.exportedName === binding.exportedName &&
    candidate.localName === binding.localName &&
    candidate.importKind === binding.importKind
  ) === index);
  if (subject) {
    const candidates = uniqueImports.filter((binding) => binding.exportedName === subject);
    if (candidates.length !== 1) return [];

    const signatures = countAddedDirectAssertionSignatures(entries, candidates[0]!.localName);
    return signatures.size > 0 && !hasRawCommentInBindingCall(testFile.patch ?? "", candidates[0]!.localName)
      ? [{ ...candidates[0]!, distinctLiteralCaseCount: signatures.size }]
      : [];
  }

  const asserted = uniqueImports.flatMap((binding) => {
    const signatures = countAddedDirectAssertionSignatures(entries, binding.localName);
    return signatures.size > 0 && !hasRawCommentInBindingCall(testFile.patch ?? "", binding.localName)
      ? [{ ...binding, distinctLiteralCaseCount: signatures.size }]
      : [];
  });
  return asserted.length === 1 ? asserted : [];
}

/**
 * The receipt parser intentionally fails closed for patches containing a
 * disabled test declaration or a compile-time unreachable branch. A bounded
 * diff parser cannot prove that assertions inside those constructs execute,
 * so none of the file's assertions may mint a positive receipt.
 */
function hasDisabledOrStaticallyUnreachableTestCode(code: string): boolean {
  const masked = lexicalCodeMask(code);
  const disabledDeclaration = hasDisabledTestDeclaration(masked);
  const assertionAfterUnconditionalExit = /\b(?:return(?:\s+[^;\n}]*)?|throw\s+[^;\n}]*)\s*(?:;|\n)[\s\S]*\b(?:expect|assert(?:\s*\.\s*\w+)?)\s*\(/.test(masked);
  return disabledDeclaration || assertionAfterUnconditionalExit ||
    /\b(?:if|while)\s*\(\s*(?:false|0|null|undefined)\s*\)/.test(masked) ||
    /\bfor\s*\([^;]*;\s*false\s*;[^)]*\)/.test(masked);
}

/**
 * Recognizes bounded test declaration member chains without depending on line
 * layout. Strings, comments, regexes, and tagged-template contents have
 * already been masked, so only executable member tokens and balanced argument
 * delimiters participate in the scan.
 */
function hasDisabledTestDeclaration(masked: string): boolean {
  const declaration = /\b(describe|it|test|xdescribe|xit|xtest)\b/g;
  for (const match of masked.matchAll(declaration)) {
    if (match[1] === "xdescribe" || match[1] === "xit" || match[1] === "xtest") return true;
    let cursor = (match.index ?? 0) + match[0].length;
    const limit = Math.min(masked.length, cursor + 16_384);
    let sawEach = false;
    let steps = 0;
    while (cursor < limit && steps < 32) {
      steps += 1;
      while (cursor < limit && /\s/.test(masked[cursor]!)) cursor += 1;
      if (masked[cursor] === ".") {
        cursor += 1;
        while (cursor < limit && /\s/.test(masked[cursor]!)) cursor += 1;
        const member = /^[A-Za-z_$][\w$]*/.exec(masked.slice(cursor, limit))?.[0];
        if (!member) break;
        cursor += member.length;
        if (member === "skip" || member === "todo" || member === "pending") return true;
        sawEach ||= member === "each";
        continue;
      }
      const opener = masked[cursor];
      if (opener === "(" || opener === "[" || opener === "{") {
        const afterGroup = afterBalancedDeclarationGroup(masked, cursor, limit);
        if (afterGroup === null) return sawEach;
        cursor = afterGroup;
        continue;
      }
      break;
    }
    // An overlong or unusually deep parameterized declaration is ambiguous to
    // this bounded parser and therefore cannot mint a positive receipt.
    if (sawEach && ((limit < masked.length && cursor >= limit) || steps >= 32)) return true;
  }
  return false;
}

function afterBalancedDeclarationGroup(source: string, start: number, limit: number): number | null {
  const expectedClosers: string[] = [];
  const closerFor: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  for (let cursor = start; cursor < limit; cursor += 1) {
    const character = source[cursor]!;
    const closer = closerFor[character];
    if (closer) {
      expectedClosers.push(closer);
      continue;
    }
    if (character !== ")" && character !== "]" && character !== "}") continue;
    if (expectedClosers.pop() !== character) return null;
    if (expectedClosers.length === 0) return cursor + 1;
  }
  return null;
}

function relativeStaticImportExpressionCount(lines: readonly string[]): number {
  let count = 0;
  for (const line of lines) {
    const staticImport = line.trim().match(/^import\s+(?:(?:type\s+)?[\s\S]*?\s+from\s+)?(["'])([^"']+)\1/);
    if (staticImport?.[2].startsWith("./") || staticImport?.[2].startsWith("../")) count += 1;
    for (const match of line.matchAll(/\brequire\s*\(\s*(["'])([^"']+)\1\s*\)/g)) {
      const matchIndex = match.index;
      if (
        matchIndex !== undefined &&
        isCodePosition(line, matchIndex) &&
        (match[2].startsWith("./") || match[2].startsWith("../"))
      ) count += 1;
    }
  }
  return count;
}

function explicitRelativeImportTarget(testPath: string, specifier: string): string | null {
  if (!(specifier.startsWith("./") || specifier.startsWith("../"))) return null;
  if (/[?#\0]/.test(specifier)) return null;
  const lastSegment = specifier.replace(/\\/g, "/").split("/").at(-1) ?? "";
  if (!/\.(?:[cm]?[jt]sx?)$/i.test(lastSegment)) return null;
  const target = normalizeRepositoryPath([
    ...normalizeRepositoryPath(testPath).split("/").slice(0, -1),
    ...specifier.replace(/\\/g, "/").split("/")
  ].join("/"));
  return target && !target.startsWith("../") ? target : null;
}

function directAssertionSignatures(lines: readonly string[], localName: string): Set<string> {
  const signatures = new Set<string>();
  const bindingPattern = new RegExp(`\\b${escapeRegExp(localName)}\\s*\\(([^()]*)\\)`, "g");
  for (const line of lines) {
    const ranges = assertionArgumentRanges(line);
    if (ranges.length === 0) continue;
    for (const match of line.matchAll(bindingPattern)) {
      const matchIndex = match.index;
      if (
        matchIndex === undefined ||
        !isCodePosition(line, matchIndex) ||
        !ranges.some(([start, end]) => isDirectAssertionArgumentCall(line, start, end, matchIndex, match[0]))
      ) continue;
      const signature = literalArgumentSignature(match[1].trim());
      if (signature !== null) signatures.add(signature);
    }
  }
  return signatures;
}

function isDirectAssertionArgumentCall(
  line: string,
  start: number,
  end: number,
  matchIndex: number,
  call: string
): boolean {
  const argumentsText = line.slice(start, end);
  const firstArgument = splitTopLevel(argumentsText, ",")?.[0]?.trim();
  return firstArgument === call;
}

function countAddedDirectAssertionSignatures(
  entries: readonly { line: string; added: boolean }[],
  localName: string
): Set<string> {
  return directAssertionSignatures(entries.filter((entry) => entry.added).map((entry) => entry.line), localName);
}

function directExportKind(
  source: string,
  binding: Pick<DirectTestBinding, "exportedName" | "importKind">
): "named" | "default" | "commonjs" | null {
  const code = lexicalCodeMask(source);
  if (/\bexport\s+(?:\*[^;\n]*|\{[^}]*\})\s+from\b/.test(code)) return null;
  if (/\b(?:vi|jest)\s*\.\s*(?:doMock|mock)\s*\(/.test(code)) return null;
  const importedNames = sourceImportedLocalNames(code);

  if (binding.importKind === "default") {
    if (/\bexport\s+default\s+(?:(?:async\s+)?function\b|class\b|\(|\{|\[|(?:async\s*)?[^;\n]*=>)/.test(code)) return "default";
    const identifier = code.match(/\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?/)?.[1];
    return identifier && !importedNames.has(identifier) && hasDirectLocalDeclaration(code, identifier)
      ? "default"
      : null;
  }

  if (binding.importKind === "commonjs") {
    if (binding.exportedName === "module.exports") {
      const assignment = code.match(/\bmodule\s*\.\s*exports\s*=\s*([^;\n]+)/)?.[1]?.trim();
      if (!assignment) return null;
      if (/^[A-Za-z_$][\w$]*$/.test(assignment)) {
        return !importedNames.has(assignment) && hasDirectLocalDeclaration(code, assignment) ? "commonjs" : null;
      }
      return isDirectExportInitializer(assignment) ? "commonjs" : null;
    }
    const name = escapeRegExp(binding.exportedName);
    const assignment = code.match(new RegExp(`\\b(?:exports|module\\s*\\.\\s*exports)\\s*\\.\\s*${name}\\s*=\\s*([^;\\n]+)`))?.[1]?.trim();
    if (!assignment) return null;
    if (/^[A-Za-z_$][\w$]*$/.test(assignment)) {
      return !importedNames.has(assignment) && hasDirectLocalDeclaration(code, assignment) ? "commonjs" : null;
    }
    return isDirectExportInitializer(assignment) ? "commonjs" : null;
  }

  const name = escapeRegExp(binding.exportedName);
  if (new RegExp(`\\bexport\\s+(?:(?:async\\s+)?function|class)\\s+${name}\\b`).test(code)) return "named";
  const directInitializer = code.match(new RegExp(`\\bexport\\s+(?:const|let|var)\\s+${name}\\s*=\\s*([^;\\n]+)`))?.[1]?.trim();
  if (directInitializer) {
    if (!isDirectExportInitializer(directInitializer)) return null;
    if (/^[A-Za-z_$][\w$]*$/.test(directInitializer) && importedNames.has(directInitializer)) return null;
    return "named";
  }
  for (const match of code.matchAll(/\bexport\s*\{([^}]+)\}\s*;?/g)) {
    for (const entry of match[1].split(",")) {
      const alias = entry.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (!alias || (alias[2] ?? alias[1]) !== binding.exportedName) continue;
      if (!importedNames.has(alias[1]) && hasDirectLocalDeclaration(code, alias[1])) return "named";
    }
  }
  return null;
}

function sourceImportedLocalNames(code: string): Set<string> {
  const names = new Set<string>();
  for (const match of code.matchAll(/\bimport\s+(.+?)\s+from\b/g)) {
    const clause = match[1].trim();
    const defaultName = clause.match(/^([A-Za-z_$][\w$]*)/)?.[1];
    if (defaultName) names.add(defaultName);
    const named = clause.match(/\{([^}]+)\}/)?.[1];
    if (named) {
      for (const entry of named.split(",")) {
        const binding = entry.trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (binding) names.add(binding[2] ?? binding[1]);
      }
    }
  }
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(/g)) {
    names.add(match[1]);
  }
  for (const match of code.matchAll(/\b(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(/g)) {
    for (const entry of match[1].split(",")) {
      const binding = entry.trim().match(/^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
      if (binding) names.add(binding[2] ?? binding[1]);
    }
  }
  return names;
}

function hasDirectLocalDeclaration(code: string, identifier: string): boolean {
  const name = escapeRegExp(identifier);
  if (new RegExp(`\\b(?:(?:async\\s+)?function|class)\\s+${name}\\b`).test(code)) return true;
  const initializer = code.match(new RegExp(`\\b(?:const|let|var)\\s+${name}\\s*=\\s*([^;\\n]+)`))?.[1]?.trim();
  return Boolean(initializer && isDirectExportInitializer(initializer));
}

function isDirectExportInitializer(initializer: string): boolean {
  if (/^require\s*\(/.test(initializer)) return false;
  if (/^(?:(?:async\s+)?function\b|class\b)|=>|^[{[]|^(?:true|false|null|undefined|-?\d)/.test(initializer)) return true;
  return false;
}

/** Replaces strings and comments with spaces while preserving code offsets. */
function lexicalCodeMask(source: string): string {
  let state: "code" | "single" | "double" | "template" | "regex" | "regex_class" | "line_comment" | "block_comment" = "code";
  let escaped = false;
  let result = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (state === "line_comment") {
      if (character === "\n") {
        state = "code";
        result += "\n";
      } else result += " ";
      continue;
    }
    if (state === "block_comment") {
      if (character === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else result += character === "\n" ? "\n" : " ";
      continue;
    }
    if (state !== "code") {
      result += character === "\n" ? "\n" : " ";
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (state === "regex" && character === "[") state = "regex_class";
      else if (state === "regex_class" && character === "]") state = "regex";
      else if (state === "regex" && character === "/") state = "code";
      else if (
        (state === "single" && character === "'") ||
        (state === "double" && character === '"') ||
        (state === "template" && character === "`")
      ) state = "code";
      continue;
    }
    if (character === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line_comment";
    } else if (character === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block_comment";
    } else if (character === "/" && canStartRegexLiteral(result)) {
      result += " ";
      state = "regex";
    } else if (character === "'" || character === '"' || character === "`") {
      result += " ";
      state = character === "'" ? "single" : character === '"' ? "double" : "template";
    } else result += character;
  }
  return result;
}

function canStartRegexLiteral(maskedPrefix: string): boolean {
  const prefix = maskedPrefix.trimEnd();
  if (!prefix) return true;
  const previous = prefix.at(-1) ?? "";
  if (/[([{,:;=!?&|+*%^~<>-]/.test(previous)) return true;
  return /\b(?:return|case|throw|yield|await|typeof|instanceof|in|of|delete|void|new)$/.test(prefix);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Returns true only when a static relative import/require in the changed test
 * resolves directly to the candidate implementation path. The caller remains
 * responsible for rejecting edges that match more than one changed
 * implementation file.
 */
export function testImportMatchesImplementation(
  testFile: PatchFile,
  implementationFile: PatchFile
): boolean {
  return importedModuleSpecifiers(testFile.patch ?? "").some((specifier) =>
    relativeImportCandidates(testFile.path, specifier).includes(normalizeRepositoryPath(implementationFile.path))
  );
}

export function distinctDirectAssertionCallCount(
  testFile: PatchFile,
  implementationFile: PatchFile,
  subject?: string
): number {
  const entries = livePatchEntries(testFile.patch ?? "");
  if (hasDisabledOrStaticallyUnreachableTestCode(patchCodeForDeclarationScan(testFile.patch ?? ""))) return 0;
  const bindings = importedBindingsForImplementation(testFile, implementationFile, subject);
  if (bindings.length !== 1) return 0;
  if (hasRawCommentInBindingCall(testFile.patch ?? "", bindings[0]!.localName)) return 0;
  return countAddedDirectAssertionSignatures(entries, bindings[0]!.localName).size;
}

function assertionArgumentRanges(line: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  const assertionPattern = /\b(?:expect|assert(?:\.\w+)?)\s*\(/g;

  for (const match of line.matchAll(assertionPattern)) {
    const matchIndex = match.index;
    if (matchIndex === undefined || !isCodePosition(line, matchIndex)) continue;
    const openIndex = line.indexOf("(", matchIndex);
    const closeIndex = matchingClosingParenthesis(line, openIndex);
    if (closeIndex > openIndex) {
      ranges.push([openIndex + 1, closeIndex]);
    }
  }
  return ranges;
}

function matchingClosingParenthesis(line: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let index = openIndex; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "/" && line[index + 1] === "/") return -1;
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function isCodePosition(line: string, targetIndex: number): boolean {
  return Boolean(lexicalCodeMask(line)[targetIndex]?.trim());
}

function importedModuleSpecifiers(patch: string): string[] {
  const specifiers: string[] = [];

  for (const sourceLine of livePatchLines(patch)) {
    const line = sourceLine.trim();
    if (!line) continue;

    const importMatch = line.match(/^import\s+(?:(?:type\s+)?[\s\S]*?\s+from\s+)?["']([^"']+)["']/);
    const requireMatch = line.match(/^(?:const|let|var)\s+[\s\S]*?=\s*require\s*\(\s*["']([^"']+)["']\s*\)/);
    const specifier = importMatch?.[1] ?? requireMatch?.[1];
    if (specifier?.startsWith("./") || specifier?.startsWith("../")) specifiers.push(specifier);
  }

  return specifiers;
}

function importedBindingsForImplementation(
  testFile: PatchFile,
  implementationFile: PatchFile,
  subject?: string
): DirectTestBinding[] {
  const bindings: Omit<DirectTestBinding, "distinctLiteralCaseCount">[] = [];
  const targetPath = normalizeRepositoryPath(implementationFile.path);

  for (const sourceLine of livePatchLines(testFile.patch ?? "")) {
    const line = sourceLine.trim();
    if (!line) continue;

    const specifier = importedModuleSpecifiers(line)[0];
    if (!specifier || !relativeImportCandidates(testFile.path, specifier).includes(targetPath)) continue;

    const namedImport = line.match(/^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']/);
    if (namedImport) {
      for (const entry of namedImport[1].split(",")) {
        const match = entry.trim().match(/^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        if (match && !entry.trim().startsWith("type ")) {
          bindings.push({
            importSpecifier: specifier,
            targetPath,
            exportedName: match[1],
            localName: match[2] ?? match[1],
            importKind: "named"
          });
        }
      }
      continue;
    }

    const defaultImport = line.match(/^import\s+([A-Za-z_$][\w$]*)\s*(?:,|from\s+["'])/);
    if (defaultImport) {
      bindings.push({
        importSpecifier: specifier,
        targetPath,
        exportedName: "default",
        localName: defaultImport[1],
        importKind: "default"
      });
      continue;
    }

    const destructuredRequire = line.match(/^(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(/);
    if (destructuredRequire) {
      for (const entry of destructuredRequire[1].split(",")) {
        const match = entry.trim().match(/^([A-Za-z_$][\w$]*)(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
        if (match) {
          bindings.push({
            importSpecifier: specifier,
            targetPath,
            exportedName: match[1],
            localName: match[2] ?? match[1],
            importKind: "commonjs"
          });
        }
      }
      continue;
    }

    const directRequire = line.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(/);
    if (directRequire) bindings.push({
      importSpecifier: specifier,
      targetPath,
      exportedName: "module.exports",
      localName: directRequire[1],
      importKind: "commonjs"
    });
  }

  const uniqueBindings = bindings.filter((binding, index) => bindings.findIndex((candidate) =>
    candidate.importSpecifier === binding.importSpecifier &&
    candidate.targetPath === binding.targetPath &&
    candidate.exportedName === binding.exportedName &&
    candidate.localName === binding.localName &&
    candidate.importKind === binding.importKind
  ) === index);
  const candidates = subject
    ? uniqueBindings.filter((binding) => binding.exportedName === subject)
    : uniqueBindings;
  return candidates.length === 1
    ? [{ ...candidates[0]!, distinctLiteralCaseCount: 0 }]
    : [];
}

function livePatchEntries(patch: string): Array<{ line: string; added: boolean }> {
  const entries: Array<{ line: string; added: boolean }> = [];
  const rawLines = patch.replace(/\r\n/g, "\n").split("\n");
  let hunkStateKnown = !rawLines.some((line) => line.startsWith("@@"));
  let blockComment = false;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (const rawLine of rawLines) {
    if (rawLine.startsWith("@@")) {
      const hunkHeader = rawLine.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(?:\s.*)?$/);
      hunkStateKnown = hunkHeader?.[1] === "1";
      blockComment = false;
      quote = null;
      escaped = false;
      continue;
    }
    if (!hunkStateKnown) continue;
    if (rawLine.startsWith("-")) continue;
    const added = rawLine.startsWith("+") && !rawLine.startsWith("+++");
    const line = rawLine.replace(/^\+/, "");
    let code = "";
    let suppressContinuedQuoteContent = quote !== null;

    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      const next = line[index + 1];
      if (blockComment) {
        if (character === "*" && next === "/") {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (!suppressContinuedQuoteContent) code += character;
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) {
          quote = null;
          suppressContinuedQuoteContent = false;
        }
        continue;
      }
      if (character === "/" && next === "/") break;
      if (character === "/" && next === "*") {
        blockComment = true;
        index += 1;
        continue;
      }
      code += character;
      if (character === "'" || character === '"' || character === "`") quote = character;
    }

    if (code.trim()) entries.push({ line: code, added });
  }

  return entries;
}

/** Preserves multiline delimiters for declaration-state scanning only. */
function patchCodeForDeclarationScan(patch: string): string {
  const rawLines = patch.replace(/\r\n/g, "\n").split("\n");
  let hunkStateKnown = !rawLines.some((line) => line.startsWith("@@"));
  const lines: string[] = [];
  for (const rawLine of rawLines) {
    if (rawLine.startsWith("@@")) {
      const hunkHeader = rawLine.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(?:\s.*)?$/);
      hunkStateKnown = hunkHeader?.[1] === "1";
      continue;
    }
    if (!hunkStateKnown || rawLine.startsWith("-") || rawLine.startsWith("+++")) continue;
    lines.push(rawLine.startsWith("+") || rawLine.startsWith(" ") ? rawLine.slice(1) : rawLine);
  }
  return lines.join("\n");
}

function livePatchLines(patch: string): string[] {
  return livePatchEntries(patch).map((entry) => entry.line);
}

function literalArgumentSignature(args: string): string | null {
  if (!args) return "()";
  const values = splitTopLevel(args, ",");
  if (!values || values.length === 0) return null;
  const signatures = values.map(literalValueSignature);
  return signatures.every((value): value is string => value !== null) ? signatures.join(",") : null;
}

function literalValueSignature(value: string): string | null {
  const trimmed = value.trim();
  if (SCALAR_LITERAL_PATTERN.test(trimmed)) return trimmed;
  return flatObjectLiteralSignature(trimmed);
}

function flatObjectLiteralSignature(value: string): string | null {
  if (!value.startsWith("{") || !value.endsWith("}")) return null;
  const body = value.slice(1, -1).trim();
  if (!body) return "{}";
  const fields = splitTopLevel(body, ",");
  if (!fields || fields.length === 0 || fields.length > MAX_FLAT_OBJECT_LITERAL_FIELDS) return null;

  const canonicalFields = new Map<string, string>();
  for (const field of fields) {
    const separator = topLevelSeparatorIndex(field, ":");
    if (separator <= 0 || topLevelSeparatorIndex(field.slice(separator + 1), ":") >= 0) return null;
    const key = canonicalObjectKey(field.slice(0, separator).trim());
    const fieldValue = field.slice(separator + 1).trim();
    if (!key || !SCALAR_LITERAL_PATTERN.test(fieldValue) || canonicalFields.has(key)) return null;
    canonicalFields.set(key, fieldValue);
  }
  return `{${[...canonicalFields.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([key, fieldValue]) => `${key}:${fieldValue}`).join(",")}}`;
}

function canonicalObjectKey(value: string): string | null {
  if (/^[A-Za-z_$][\w$]*$/.test(value)) return value;
  if (/^"(?:[^"\\]|\\.)*"$|^'(?:[^'\\]|\\.)*'$/u.test(value)) return value;
  return null;
}

function splitTopLevel(value: string, separator: string): string[] | null {
  const parts: string[] = [];
  let start = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    if (braces < 0 || brackets < 0 || parentheses < 0) return null;
    if (character === separator && braces === 0 && brackets === 0 && parentheses === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (quote || braces !== 0 || brackets !== 0 || parentheses !== 0) return null;
  const finalPart = value.slice(start).trim();
  return finalPart ? [...parts, finalPart] : null;
}

function topLevelSeparatorIndex(value: string, separator: string): number {
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === separator && braces === 0 && brackets === 0 && parentheses === 0) return index;
    if (character === "{") braces += 1;
    else if (character === "}") braces -= 1;
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets -= 1;
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
  }
  return -1;
}

function hasRawCommentInBindingCall(patch: string, localName: string): boolean {
  const bindingPattern = new RegExp(`\\b${escapeRegExp(localName)}\\s*\\(`);
  return patch.split(/\r?\n/).some((rawLine) => {
    if (!rawLine.startsWith("+") || rawLine.startsWith("+++")) return false;
    const line = rawLine.slice(1);
    const match = bindingPattern.exec(line);
    if (!match || match.index === undefined || !isCodePosition(line, match.index)) return false;
    const openIndex = line.indexOf("(", match.index);
    const closeIndex = matchingClosingParenthesis(line, openIndex);
    return closeIndex > openIndex && /\/\*|\/\//.test(line.slice(openIndex + 1, closeIndex));
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function relativeImportCandidates(testPath: string, specifier: string): string[] {
  const directory = normalizeRepositoryPath(testPath).split("/").slice(0, -1);
  const resolved = normalizeRepositoryPath([...directory, ...specifier.replace(/\\/g, "/").split("/")].join("/"));
  const lastSegment = resolved.split("/").at(-1) ?? "";
  if (/\.[a-z0-9]+$/i.test(lastSegment)) return [resolved];

  const extensions = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
  return [
    resolved,
    ...extensions.map((extension) => `${resolved}${extension}`),
    ...extensions.map((extension) => `${resolved}/index${extension}`)
  ];
}

function normalizeRepositoryPath(path: string): string {
  const result: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (result.length > 0 && result.at(-1) !== "..") result.pop();
      else result.push(segment);
    }
    else result.push(segment);
  }
  return result.join("/");
}

export function executionEvidenceMatchesAnyTestPath(
  testPaths: readonly string[],
  label: string,
  summary: string,
  locator = ""
): boolean {
  return evidenceMatchesAnyReference(testPaths, label, summary, locator);
}

export function artifactEvidenceMatchesAnyPath(
  paths: readonly string[],
  label: string,
  summary: string,
  locator = ""
): boolean {
  return evidenceMatchesAnyReference(paths, label, summary, locator);
}

function evidenceMatchesAnyReference(
  references: readonly string[],
  label: string,
  summary: string,
  locator: string
): boolean {
  const evidenceTokens = relationTokens(`${label} ${summary} ${locator}`);
  if (evidenceTokens.size === 0) return false;

  return references.some((reference) => {
    const pathTokens = relationTokens(reference);
    const shared = [...pathTokens].filter((token) => evidenceTokens.has(token));
    return shared.length >= 2 || shared.some((token) =>
      token.length >= 8 || (/[^\x00-\x7F]/.test(token) && [...token].length >= 2)
    );
  });
}

function relationTokens(value: string): Set<string> {
  const normalized = value
    .normalize("NFKC")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(tokens
    .flatMap((token) => [token, koreanParticleStem(token)])
    .filter((token) => token.length > 0 && !GENERIC_RELATION_TOKENS.has(token)));
}

function koreanParticleStem(token: string): string {
  if (!/^[가-힣]{2,}$/.test(token)) return token;
  return token.replace(/(?:에서|에게|한테|께서|부터|까지|보다|처럼|마다|조차|마저|으로|은|는|이|가|을|를|에|의|와|과|로|도|만)$/u, "") || token;
}
