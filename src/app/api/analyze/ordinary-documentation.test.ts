import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { validateRuntimeReportBoundary } from "@/lib/report-runtime-validation";
import { presentOrdinaryDocumentationSummary } from "@/lib/general-pr-documentation-presentation";
import { encodeReportForShare, decodeSharedReport } from "@/lib/report-share";
import { projectTenantPersistedReport, decodeTenantPersistedReport, validateTenantPersistedReport } from "@/lib/tenant-report-validation";
import { prepareTenantDetailReportForStorage, createVerifiedSavedReport } from "@/lib/server-report-store";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("ordinary documentation real analyze flow", () => {
  it.each([
    { state: "supported", mode: "advisory", capability: "documentation_literal", noPlan: false },
    { state: "contradicted", mode: "advisory", capability: "documentation_literal", noPlan: false },
    { state: "unavailable", mode: "advisory", capability: "documentation_literal", noPlan: false },
    { state: "supported", mode: "disabled", capability: "documentation_literal", noPlan: false },
    { state: "supported", mode: "shadow", capability: "documentation_literal", noPlan: false },
    { state: "supported", mode: "advisory", capability: "", noPlan: false },
    { state: "supported", mode: "advisory", capability: "documentation_literal", noPlan: true }
  ])("source-only AI → exact head: $state / $mode / capability=$capability / noPlan=$noPlan", async ({ state, mode, capability, noPlan }) => {
    vi.stubEnv("AGENTPROOF_GENERAL_PR_OBSERVATION_MODE", mode);
    vi.stubEnv("AGENTPROOF_VERIFICATION_CAPABILITIES_V2", capability);
    vi.stubEnv("OPENAI_API_KEY", "test-key"); vi.stubEnv("OPENAI_MODEL", "gpt-test");
    const headSha = "a".repeat(40);
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url === "https://api.openai.com/v1/responses") {
        const packet = JSON.parse(JSON.parse(String(init?.body)).input[1].content[0].text);
        const output = packet.contractVersion === "general_pr_semantic_claim.v2" ? { spanRoles: packet.spans.map((span: { id: string; text: string }) => ({ spanId: span.id, role: span.text.includes("must contain") ? "objective_candidate" : "supporting_context" })) } : { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] };
        return Response.json({ output_text: JSON.stringify(output) });
      }
      if (url.endsWith("/pulls/12")) return Response.json({ title: "Documentation", body: noPlan ? "If released, `README.md` must contain `ready now`." : "`README.md` must contain `ready now`.", url: "https://api.github.com/repos/acme/repo/pulls/12", base: { ref: "main", sha: "b".repeat(40), repo: { private: false } }, head: { ref: "docs", sha: headSha } });
      if (url.includes("/files?")) return Response.json([{ filename: "README.md", status: "modified", patch: "+ irrelevant diff" }]);
      if (url.includes("/check-runs")) return Response.json({}, { status: 503 });
      if (url.endsWith("/status")) return Response.json({ statuses: [] });
      if (url.includes("/contents/README.md?ref=")) return state === "unavailable" ? Response.json({}, { status: 404 }) : Response.json({ type: "file", encoding: "base64", content: Buffer.from(state === "supported" ? "ready now\nprivate document rest" : "different text").toString("base64") });
      throw new Error(`Unexpected URL ${url}`);
    }));
    const response = await POST(new Request("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prUrl: "https://github.com/acme/repo/pull/12" }) }));
    const json = await response.json();
    expect(response.status, JSON.stringify(json)).toBe(200);
    if (mode !== "advisory" || !capability || noPlan) {
      expect(json.report).not.toHaveProperty("ordinaryDocumentationSummary");
      expect(calls.filter(url => url.includes("/contents/"))).toEqual([]);
      if (noPlan) expect(json.report.generalPrAssessmentSummary.counts.evidence_partial).toBeGreaterThan(0);
      return;
    }
    expect(json.report.ordinaryDocumentationSummary?.predicates).toEqual([{ sourceKind: "pr_body", sourceOrdinal: 1, legacyRequirementId: null, state }]);
    expect(calls.filter(url => url.includes("/contents/README.md?ref="))).toEqual([`https://api.github.com/repos/acme/repo/contents/README.md?ref=${headSha}`]);
    expect(JSON.stringify(json.report.ordinaryDocumentationSummary)).not.toMatch(/ready now|README.md|private document|targetId|sourceId|artifactDigest/);
    expect(presentOrdinaryDocumentationSummary(json.report.ordinaryDocumentationSummary)[0]).toContain("not whole-goal or PR verification");
    expect(json.report.generalPrAssessmentSummary.counts.evidence_supported).toBe(0);
    expect(validateRuntimeReportBoundary({ boundary: "inbound_untrusted_full", report: json.report }).valid).toBe(false);
    expect(validateRuntimeReportBoundary({ boundary: "generated_private_full", input: {} as never, report: json.report }).valid).toBe(false);
    const shared = decodeSharedReport(encodeReportForShare(json.report));
    expect(shared).toHaveProperty("ordinaryDocumentationSummary", json.report.ordinaryDocumentationSummary);
    const safe = prepareTenantDetailReportForStorage(json.report, "verified_agentproof", "test-signing-secret");
    const stored = projectTenantPersistedReport(safe, "test-signing-secret");
    expect(stored).toHaveProperty("ordinaryDocumentationSummary", json.report.ordinaryDocumentationSummary);
    const decoded = decodeTenantPersistedReport(stored, { signingSecret: "test-signing-secret", createdAt: json.report.createdAt });
    expect(decoded.status, JSON.stringify(validateTenantPersistedReport(stored, "test-signing-secret"))).toBe("valid");
    if (decoded.status === "valid") expect(decoded.report).toHaveProperty("ordinaryDocumentationSummary", json.report.ordinaryDocumentationSummary);
    expect(JSON.stringify(stored.ordinaryDocumentationSummary)).not.toMatch(/README.md|ready now|private document|targetId|sourceId/);
    const modified = structuredClone(stored);
    modified.ordinaryDocumentationSummary!.predicates[0].state = state === "supported" ? "contradicted" : "supported";
    expect(validateTenantPersistedReport(modified, "test-signing-secret").valid).toBe(false);
    vi.stubEnv("AGENTPROOF_REPORT_SIGNING_SECRET", "test-report-signing-secret-that-is-long-enough");
    await expect(createVerifiedSavedReport(json.report)).rejects.toThrow("requires generated private validation context");
  });
});
