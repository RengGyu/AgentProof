import { createHash } from "node:crypto";
import ts from "typescript";

export type TypeScriptUnionPrimitive = "string" | "number" | "boolean" | "bigint" | "symbol" | "undefined" | "null";
export interface TypeScriptUnionMemberTarget {
  path: string;
  aliasName: string;
  member: TypeScriptUnionPrimitive;
  headSha: string;
}
export interface TypeScriptUnionArtifactBlob { path: string; headSha: string; content: string }
export interface TypeScriptUnionMemberResult {
  path: string | null;
  headSha: string | null;
  artifactDigest: string | null;
  state: "supported" | "contradicted" | "unavailable";
  reason: "invalid_target" | "artifact_unavailable" | "syntax_invalid" | "parser_unavailable" | "alias_missing" | "alias_ambiguous" | "unsupported_alias" | "member_present" | "member_absent";
}

const PRIMITIVES = new Map<ts.SyntaxKind, TypeScriptUnionPrimitive>([
  [ts.SyntaxKind.StringKeyword, "string"], [ts.SyntaxKind.NumberKeyword, "number"],
  [ts.SyntaxKind.BooleanKeyword, "boolean"], [ts.SyntaxKind.BigIntKeyword, "bigint"],
  [ts.SyntaxKind.SymbolKeyword, "symbol"], [ts.SyntaxKind.UndefinedKeyword, "undefined"],
  [ts.SyntaxKind.NullKeyword, "null"]
]);

/** Private syntactic evidence only. Source authority and source/operand binding belong to the caller. */
export function evaluateTypeScriptUnionMember(target: TypeScriptUnionMemberTarget, blobs: readonly TypeScriptUnionArtifactBlob[]): TypeScriptUnionMemberResult {
  const path = typeof target?.path === "string" && target.path.length <= 200 && /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:ts|tsx|mts|cts)$/.test(target.path) ? target.path : null;
  const headSha = typeof target?.headSha === "string" && /^[a-f0-9]{40}$/i.test(target.headSha) ? target.headSha : null;
  let artifactDigest: string | null = null;
  const result = (state: TypeScriptUnionMemberResult["state"], reason: TypeScriptUnionMemberResult["reason"]): TypeScriptUnionMemberResult => ({ path, headSha, artifactDigest, state, reason });
  if (!path || !headSha || typeof target.aliasName !== "string" || target.aliasName.length > 200 || !/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(target.aliasName) || ![...PRIMITIVES.values()].includes(target.member)) return result("unavailable", "invalid_target");
  if (!Array.isArray(blobs) || blobs.length > 8) return result("unavailable", "artifact_unavailable");
  const matching = blobs.filter(blob => blob?.path === path);
  const artifact = matching.length === 1 ? matching[0] : undefined;
  if (!artifact || artifact.headSha !== headSha || typeof artifact.content !== "string" || Buffer.byteLength(artifact.content, "utf8") > 64 * 1024) return result("unavailable", "artifact_unavailable");
  artifactDigest = createHash("sha256").update(artifact.content, "utf8").digest("hex");
  try {
    const source = ts.createSourceFile(path, artifact.content, ts.ScriptTarget.Latest, false, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    // createSourceFile exposes parser diagnostics at runtime; fail closed if that API changes.
    const diagnostics = (source as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
    if (!Array.isArray(diagnostics)) return result("unavailable", "parser_unavailable");
    if (diagnostics.length) return result("unavailable", "syntax_invalid");
    const aliases = matchingAliases(source, target.aliasName);
    if (aliases.length !== 1) return result("unavailable", aliases.length ? "alias_ambiguous" : "alias_missing");
    const alias = aliases[0];
    const union = unparenthesized(alias.type);
    if (alias.typeParameters?.length || !ts.isUnionTypeNode(union)) return result("unavailable", "unsupported_alias");
    const pending = [...union.types];
    let found = false;
    while (pending.length) {
      const node = unparenthesized(pending.pop()!);
      if (ts.isUnionTypeNode(node)) { pending.push(...node.types); continue; }
      const kind = ts.isLiteralTypeNode(node) && node.literal.kind === ts.SyntaxKind.NullKeyword ? ts.SyntaxKind.NullKeyword : node.kind;
      const primitive = PRIMITIVES.get(kind);
      if (!primitive) return result("unavailable", "unsupported_alias");
      if (primitive === target.member) found = true;
    }
    return result(found ? "supported" : "contradicted", found ? "member_present" : "member_absent");
  } catch {
    return result("unavailable", "parser_unavailable");
  }
}

function matchingAliases(source: ts.SourceFile, name: string): ts.TypeAliasDeclaration[] {
  const matches: ts.TypeAliasDeclaration[] = [];
  const pending: Array<{ node: ts.Node; namespace: string[] }> = [{ node: source, namespace: [] }];
  while (pending.length) {
    const { node, namespace } = pending.pop()!;
    if (ts.isTypeAliasDeclaration(node)) {
      if ((name.includes(".") ? [...namespace, node.name.text].join(".") : node.name.text) === name) matches.push(node);
    } else if (ts.isSourceFile(node) || ts.isModuleBlock(node)) {
      for (const statement of node.statements) pending.push({ node: statement, namespace });
    } else if (ts.isModuleDeclaration(node) && ts.isIdentifier(node.name) && !(node.flags & ts.NodeFlags.GlobalAugmentation) && node.body) {
      pending.push({ node: node.body, namespace: [...namespace, node.name.text] });
    }
  }
  return matches;
}

function unparenthesized(node: ts.TypeNode): ts.TypeNode {
  while (ts.isParenthesizedTypeNode(node)) node = node.type;
  return node;
}
