import { writeFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/analyze/route";

// Fixed, owned synthetic fixtures. Oracles are defined before invoking the product.
const families = [
  { kind: "documentation", path: "README.md", requirement: "`README.md` must contain `ready now`.", positive: "ready now\n", negative: "not ready\n" },
  { kind: "static_type", path: "src/types.ts", requirement: "The type `Result` must support `undefined`.", positive: "type Result = string | undefined;", negative: "type Result = string | number;" },
  { kind: "behavior", path: "src/ready.js", requirement: "The function `ready` in `src/ready.js` must return `true` when called.", positive: "function ready() { return true; }", negative: "function ready() { return false; }" }
] as const;
const variants = ["satisfied", "violated", "unavailable"] as const;
const cases = families.flatMap(family => variants.map(variant => ({ ...family, variant })));
const rows: Record<string, unknown>[] = [];
const real = process.env.REQUIREMENT_GOAL_AUDIT_MODE === "real";
const originalFetch = globalThis.fetch;

function oracle(kind: string, content: string | null): "satisfied" | "violated" | "unavailable" {
  if (content === null) return "unavailable";
  let supported: boolean;
  if (kind === "documentation") supported = content.includes("ready now");
  else if (kind === "static_type") {
    const source = ts.createSourceFile("owned.ts", content, ts.ScriptTarget.Latest, true);
    const alias = source.statements.find(ts.isTypeAliasDeclaration)!;
    supported = ts.isUnionTypeNode(alias.type) && alias.type.types.some(member => member.kind === ts.SyntaxKind.UndefinedKeyword);
  } else {
    // Never executes fetched or user code: only either fixed constant function above.
    if (!families.some(family => family.kind === "behavior" && [family.positive, family.negative].includes(content as never))) throw new Error("Unowned VM fixture");
    supported = runInNewContext(`${content}; ready()`, Object.create(null), { timeout: 100 }) === true;
  }
  return supported ? "satisfied" : "violated";
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("audits nine fixed requirement goals through actual POST /api/analyze", async () => {
  vi.stubEnv("AGENTPROOF_GENERAL_PR_OBSERVATION_MODE", "advisory");
  vi.stubEnv("AGENTPROOF_VERIFICATION_CAPABILITIES_V2", "documentation_literal,typescript_union_member");
  if (!real) { vi.stubEnv("OPENAI_API_KEY", "synthetic-audit-key"); vi.stubEnv("OPENAI_MODEL", "synthetic-audit-model"); }
  else if (!process.env.OPENAI_API_KEY) throw new Error("Real mode requires OPENAI_API_KEY");
  const headSha = "a".repeat(40);
  for (const fixture of cases.filter(item => !real || item.variant !== "unavailable")) {
    console.log(JSON.stringify({ case: `${fixture.kind}-${fixture.variant}`, progress: "started" }));
    const content = fixture.variant === "unavailable" ? null : fixture.variant === "satisfied" ? fixture.positive : fixture.negative;
    const expectedTruth = oracle(fixture.kind, content);
    expect(expectedTruth).toBe(fixture.variant);
    const calls: string[] = [];
    let providerCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (value: string | URL | Request, init?: RequestInit) => {
      const url = String(value);
      calls.push(url);
      if (url === "https://api.openai.com/v1/responses") {
        providerCalls++;
        if (real) return originalFetch(value, init);
        const packet = JSON.parse(JSON.parse(String(init?.body)).input[1].content[0].text);
        const span = packet.spans?.find((item: { text: string }) => item.text === fixture.requirement);
        const output = packet.contractVersion === "general_pr_semantic_claim.v2"
          ? { spanRoles: packet.spans.map((item: { id: string }) => ({ spanId: item.id, role: item.id === span?.id ? "objective_candidate" : "supporting_context" })), ...(fixture.kind === "static_type" && span ? { unionMemberCandidates: [{ spanId: span.id, aliasName: "Result", member: "undefined" }] } : {}) }
          : { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] };
        return Response.json({ output_text: JSON.stringify(output) });
      }
      if (new URL(url).origin !== "https://api.github.com") throw new Error("Non-allowlisted transport");
      if (url.endsWith("/pulls/12")) return Response.json({ title: "Synthetic goal audit", body: "Closes #71", url: "https://api.github.com/repos/acme/repo/pulls/12", base: { ref: "main", sha: "b".repeat(40), repo: { private: false } }, head: { ref: "audit", sha: headSha } });
      if (url.endsWith("/issues/71")) return Response.json({ title: "Acceptance criteria", body: fixture.requirement });
      if (url.includes("/files?")) return Response.json([{ filename: fixture.path, status: "modified", additions: 1, deletions: 0, ...(content === null ? {} : { patch: `@@ -0,0 +1 @@\n+${content.trimEnd()}` }) }]);
      if (url.includes("/check-runs")) return Response.json({ total_count: 0, check_runs: [] });
      if (url.endsWith("/status")) return Response.json({ state: "pending", statuses: [] });
      if (url.includes("/contents/")) {
        expect(url).toBe(`https://api.github.com/repos/acme/repo/contents/${fixture.path}?ref=${headSha}`);
        return content === null ? Response.json({}, { status: 404 }) : Response.json({ type: "file", encoding: "base64", content: Buffer.from(content).toString("base64") });
      }
      throw new Error("Unexpected synthetic GitHub endpoint");
    }));
    const response = await POST(new Request("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prUrl: "https://github.com/acme/repo/pull/12" }) }));
    const json = await response.json();
    const report = json.report;
    const requirements = (report?.requirements ?? []).map((item: { requirementText: string; status: string; evidenceStatus?: string; sourceAuthority?: string; proofAxes?: { state: string }[] }) => ({ text: item.requirementText, status: item.status, evidenceStatus: item.evidenceStatus ?? null, sourceAuthority: item.sourceAuthority ?? null, proofAxes: item.proofAxes ?? [] }));
    const summary = report?.generalPrAssessmentSummary ?? null;
    const finalRequirementPositive = requirements.some((item: { status: string }) => item.status === "met") || (summary?.counts.evidence_supported ?? 0) > 0;
    const evidenceOnlyPositive = requirements.some((item: { evidenceStatus: string }) => item.evidenceStatus === "met");
    // `missing` alone means missing proof, not an established factual violation.
    const negative = requirements.some((item: { proofAxes: { state: string; role?: string }[] }) => item.proofAxes.some(axis => axis.role === "criterion" && axis.state === "violated")) || (summary?.counts.contradicted ?? 0) > 0;
    const docState = report?.ordinaryDocumentationSummary?.predicates?.[0]?.state;
    const staticCounts = report?.ordinaryStaticSummary?.predicates?.[0]?.artifactCounts;
    const scopedState = docState ?? (staticCounts ? staticCounts.present > 0 ? "supported" : staticCounts.absent > 0 ? "contradicted" : "unavailable" : "not_evaluated");
    const expectedScopedState = expectedTruth === "satisfied" ? "supported" : expectedTruth === "violated" ? "contradicted" : "unavailable";
    const unsupportedPositiveSignal = expectedTruth !== "satisfied" && (finalRequirementPositive || evidenceOnlyPositive);
    rows.push({
      id: `${fixture.kind}-${fixture.variant}`, expectedTruth,
      syntheticFact: { requirementSource: "linked_issue", issueNumber: 71, requirementText: fixture.requirement, artifactPath: fixture.path, artifactContent: content, headSha, baseSha: "b".repeat(40) },
      oracle: fixture.kind === "behavior" ? "owned_constant_function_vm" : fixture.kind === "static_type" ? "typescript_ast_direct_primitive_union" : "exact_literal_fixture_check",
      httpStatus: response.status, scopedState,
      scopedPlanObservation: scopedState === "not_evaluated" ? "absent_from_scoped_report_fields" : "present_in_scoped_report_fields",
      scopedPredicateCorrect: fixture.kind === "behavior" ? null : scopedState === expectedScopedState,
      generalPrAssessmentSummary: summary, requirements, sourceAuthority: report?.analysisContext ?? null,
      changedFileInventory: report?.source?.provenance?.changedFileInventory ?? null,
      contentReadCount: calls.filter(url => url.includes("/contents/")).length, providerCalls,
      finalRequirementPositive, evidenceOnlyPositive, negative, unsupportedPositiveSignal,
      noUnsupportedPositiveOnKnownViolationOrUnavailable: !unsupportedPositiveSignal,
      goalSuccess: response.status === 200 && (expectedTruth === "satisfied" ? finalRequirementPositive && !negative : expectedTruth === "violated" ? negative && !finalRequirementPositive && !evidenceOnlyPositive : !finalRequirementPositive && !evidenceOnlyPositive && !negative)
    });
    console.log(JSON.stringify({ case: `${fixture.kind}-${fixture.variant}`, progress: "completed" }));
  }
  const output = process.env.REQUIREMENT_GOAL_AUDIT_OUTPUT;
  if (!output) throw new Error("Caller-provided output path required");
  writeFileSync(output, JSON.stringify({ schemaVersion: "requirement-goal-audit.v1", runtimeDate: new Date().toISOString(), model: process.env.OPENAI_MODEL ?? null, mode: real ? "real_openai_synthetic_github" : "controlled_semantic_synthetic_github", githubTransport: "fully_mocked_complete_head_bound_snapshot_no_real_github", semanticTransport: real ? "real_OpenAI_source_interpretation" : "controlled_source_roles_and_union_operands_no_verdicts", caseCount: rows.length, noUnsupportedPositiveOnKnownViolationOrUnavailable: rows.every(row => row.noUnsupportedPositiveOnKnownViolationOrUnavailable), scopedPredicateSuccess: rows.filter(row => row.scopedPredicateCorrect !== null).every(row => row.scopedPredicateCorrect), goalSuccess: rows.every(row => row.goalSuccess), rows }, null, 2));
  expect(rows).toHaveLength(real ? 6 : 9);
}, real ? 360_000 : 180_000);
