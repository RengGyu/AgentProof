import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/analyze/route";
// @ts-expect-error Standalone dependency-free Node evaluator has no declaration file.
import { evaluateRequirementGoalsV2 } from "./requirement-goal-evaluation-v2.mjs";

type Truth = "satisfied" | "violated" | "unavailable";
const families = [
  { kind: "documentation", criterionKind: "documentation_literal", path: "README.md", requirement: "`README.md` must contain `ready now`", positive: "ready now\n", negative: "not ready\n" },
  { kind: "scalar", criterionKind: "standalone_scalar", path: "src/ready.js", requirement: "Function `ready` in `src/ready.js` must return `true` when called with no arguments", positive: "function ready() { return true; }", negative: "function ready() { return false; }" },
  { kind: "type", criterionKind: "typescript_assignability", path: "src/mode.ts", requirement: "The type `Mode` in `src/mode.ts` must support `undefined`", positive: "type Optional<T> = T | undefined; export type Mode = Optional<string>;", negative: "type RequiredValue<T> = Exclude<T, undefined>; export type Mode = RequiredValue<string | undefined>;" }
] as const;
const config = '{"compilerOptions":{"strict":true,"target":"ES2022","types":[],"noEmit":true,"skipLibCheck":true},"files":["src/mode.ts"]}';
const objectSha = (kind: string, bytes: string | Buffer) => createHash("sha1").update(`${kind} ${Buffer.byteLength(bytes)}\0`).update(bytes).digest("hex");

function snapshot(files: Record<string, string>) {
  const blobs = Object.freeze(Object.entries(files).map(([path, content]) => Object.freeze({ path, type: "blob", mode: "100644", sha: objectSha("blob", content), size: Buffer.byteLength(content) })));
  function tree(prefix: string): string {
    const names = [...new Set(blobs.filter(blob => blob.path.startsWith(prefix)).map(blob => blob.path.slice(prefix.length).split("/")[0]))].sort();
    return objectSha("tree", Buffer.concat(names.map(name => {
      const blob = blobs.find(item => item.path === prefix + name);
      return Buffer.concat([Buffer.from(`${blob ? "100644" : "40000"} ${name}\0`), Buffer.from(blob?.sha ?? tree(`${prefix}${name}/`), "hex")]);
    })));
  }
  const treeSha = tree("");
  const commit = `tree ${treeSha}\nauthor Owned Audit <audit@example.invalid> 0 +0000\ncommitter Owned Audit <audit@example.invalid> 0 +0000\n\nFrozen v2 fixture\n`;
  const entries = Object.freeze([...blobs, Object.freeze({ path: "src", type: "tree", mode: "040000", sha: tree("src/") })]);
  return Object.freeze({ headSha: objectSha("commit", commit), baseSha: objectSha("commit", commit.replace("Frozen v2", "Base v2")), treeSha, blobs, entries, commit });
}

// Independent native compiler oracle: actual fixture tsconfig, synthetic assignment,
// and native diagnostics. No product checker, selector, or AST union shortcut.
function typeOracle(content: string) {
  const root = "/owned-v2-oracle";
  const path = `${root}/src/mode.ts`;
  const parsed = ts.parseJsonConfigFileContent(JSON.parse(config), { ...ts.sys, readDirectory: () => [path] }, root);
  if (parsed.errors.length) throw new Error("Invalid owned oracle tsconfig");
  const host = ts.createCompilerHost(parsed.options);
  const original = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language, onError, fresh) => name === path ? ts.createSourceFile(name, `${content}\nconst __audit: Mode = undefined;`, language, true) : original(name, language, onError, fresh);
  const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([path], parsed.options, host));
  if (diagnostics.some(item => item.code !== 2322)) throw new Error(`Unexpected oracle diagnostics: ${diagnostics.map(item => item.code)}`);
  return Object.freeze({ artifactTruth: diagnostics.length ? "violated" : "satisfied", method: "native_typescript_assignment_diagnostics", compilerVersion: ts.version, diagnosticCodes: diagnostics.map(item => item.code), config });
}

// Freeze every label and oracle before the first product call.
const fixtures = Object.freeze(families.flatMap(family => (["satisfied", "violated", "unavailable"] as const).map(variant => {
  const content = variant === "violated" ? family.negative : family.positive;
  const files = Object.freeze({ "tsconfig.json": config, "src/mode.ts": families[2].positive, [family.path]: content });
  const oracle = family.kind === "type" ? typeOracle(content) : Object.freeze({ artifactTruth: (family.kind === "documentation" ? content.includes("ready now") : runInNewContext(`${content}; ready()`, Object.create(null), { timeout: 100 }) === true) ? "satisfied" : "violated", method: family.kind === "documentation" ? "owned_exact_literal" : "owned_constant_function_vm" });
  return Object.freeze({ ...family, id: `${family.kind}-${variant}`, variant, expectedTruth: variant as Truth, oracle, files, snapshot: snapshot(files), unavailableControl: variant === "unavailable" ? "target_content_http_503" : null });
})));

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("audits nine immutable v2 controls through actual POST with frozen independent oracles", async () => {
  const output = process.env.REQUIREMENT_GOAL_AUDIT_V2_OUTPUT;
  if (!output) throw new Error("Caller-provided v2 output path required");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("AGENTPROOF_GENERAL_PR_OBSERVATION_MODE", "advisory");
  vi.stubEnv("AGENTPROOF_VERIFICATION_CAPABILITIES_V2", "documentation_literal");
  vi.stubEnv("AGENTPROOF_ORDINARY_SCALAR_EXECUTION", "enabled");
  vi.stubEnv("AGENTPROOF_ORDINARY_TYPESCRIPT_ASSIGNABILITY", "enabled");
  const rows: { id: string; expectedTruth: Truth; fixture: typeof fixtures[number]; httpStatus: number; evaluation: ReturnType<typeof evaluateRequirementGoalsV2>; criterionKindCorrect: boolean; report: unknown; error: unknown; transportErrors: string[]; contentReadCount: number; providerCalls: number }[] = [];
  for (const fixture of fixtures) {
    expect(fixture.oracle.artifactTruth).toBe(fixture.variant === "violated" ? "violated" : "satisfied");
    const calls: string[] = [];
    const transportErrors: string[] = [];
    const diagnostics: { requirementId: string; reason: string; source: string; evidenceText: string }[] = [];
    const root = "https://api.github.com/repos/owned/audit-v2";
    const { headSha, baseSha, treeSha, blobs } = fixture.snapshot;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input); calls.push(url);
      if (url === `${root}/pulls/12`) return Response.json({ number: 12, title: "Owned v2 audit", body: "Implementation update", url: `${root}/pulls/12`, base: { ref: "main", sha: baseSha, repo: { private: false } }, head: { ref: "audit-v2", sha: headSha } });
      if (url.startsWith(`${root}/pulls/12/files?`)) return Response.json([{ filename: fixture.path, status: "modified", sha: blobs.find(blob => blob.path === fixture.path)!.sha, additions: 1, deletions: 0, patch: "+ owned fixture update" }]);
      if (url.startsWith(`${root}/commits/${headSha}/check-runs`)) return Response.json({ total_count: 0, check_runs: [] });
      if (url === `${root}/commits/${headSha}/status`) return Response.json({ state: "pending", statuses: [] });
      if (url === `${root}/git/commits/${headSha}`) return Response.json({ sha: headSha, tree: { sha: treeSha }, parents: [] });
      if (url === `${root}/git/trees/${treeSha}?recursive=1`) return Response.json({ sha: treeSha, truncated: false, tree: fixture.snapshot.entries });
      const blob = blobs.find(item => url === `${root}/contents/${item.path}?ref=${headSha}`);
      if (blob) {
        if (fixture.variant === "unavailable" && blob.path === fixture.path) {
          diagnostics.push({ requirementId: "req_1", reason: "collection", source: "controlled_github_transport", evidenceText: `Exact-head ${blob.path} content request returned HTTP 503.` });
          return Response.json({ message: "Owned unavailable control" }, { status: 503 });
        }
        return Response.json({ type: "file", path: blob.path, sha: blob.sha, size: blob.size, encoding: "base64", content: Buffer.from(fixture.files[blob.path as keyof typeof fixture.files]).toString("base64") });
      }
      transportErrors.push(url); throw new Error(`Non-allowlisted v2 transport: ${url}`);
    }));
    const response = await POST(new Request("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prUrl: "https://github.com/owned/audit-v2/pull/12", taskText: fixture.requirement }) }));
    const json = await response.json();
    const evaluation = evaluateRequirementGoalsV2({ expectations: [{ requirementId: "req_1", requirementText: fixture.requirement, expectedTruth: fixture.expectedTruth }], report: json.report, httpStatus: response.status, diagnostics });
    const criterionKindCorrect = evaluation.rows.length === 1 && evaluation.rows[0].criterion?.kind === fixture.criterionKind;
    rows.push({ id: fixture.id, expectedTruth: fixture.expectedTruth, fixture, httpStatus: response.status, evaluation, criterionKindCorrect, report: json.report ?? null, error: json.error ?? null, transportErrors, contentReadCount: calls.filter(url => url.includes("/contents/")).length, providerCalls: calls.filter(url => !url.startsWith(root)).length });
  }
  const counts = Object.fromEntries((["satisfied", "violated", "unavailable"] as const).map(truth => [truth, { total: rows.filter(row => row.expectedTruth === truth).length, correct: rows.filter(row => row.expectedTruth === truth && row.evaluation.goalSuccess && row.criterionKindCorrect).length }]));
  const result = { schemaVersion: "requirement-goal-audit.v2", mode: "controlled_external_github_transport_real_product_no_model", oracleFrozenBeforeProduct: true, scalarImage: process.env.AGENTPROOF_SCALAR_IMAGE ?? null, caseCount: rows.length, counts, goalSuccess: rows.length === 9 && rows.every(row => row.evaluation.goalSuccess && row.criterionKindCorrect && row.transportErrors.length === 0), rows };
  writeFileSync(output, JSON.stringify(result, null, 2));
  expect(rows).toHaveLength(9);
  expect(rows.flatMap(row => row.transportErrors)).toEqual([]);
  expect(rows.every(row => row.httpStatus === 200)).toBe(true);
  // Harness completion is distinct from measured goal success; CLI owns exit 1.
}, 180_000);
