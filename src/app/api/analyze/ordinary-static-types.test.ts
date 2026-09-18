import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { POST } from "./route";
import { validateRuntimeReportBoundary } from "@/lib/report-runtime-validation";
import { encodeReportForShare, decodeSharedReport } from "@/lib/report-share";
import { projectTenantPersistedReport, decodeTenantPersistedReport, validateTenantPersistedReport } from "@/lib/tenant-report-validation";
import { prepareTenantDetailReportForStorage } from "@/lib/server-report-store";
import { ReportView } from "@/components/ReportView";
import { DetailedEvidence } from "@/components/PublicGitHubDashboard";
import { reportToMarkdown, reportToGitHubComment } from "@/lib/markdown";
import { dashboardReportToMarkdown, dashboardReportToJson } from "@/lib/dashboard-report-export";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("ordinary static type real analyze flow", () => {
  it.each(["present", "absent", "unavailable", "off", "shadow", "stale"])("source-only union candidate reaches bounded evidence: %s", async mode => {
    vi.stubEnv("AGENTPROOF_GENERAL_PR_OBSERVATION_MODE", mode === "shadow" ? "shadow" : "advisory");
    vi.stubEnv("AGENTPROOF_VERIFICATION_CAPABILITIES_V2", mode === "off" ? "" : "typescript_union_member");
    vi.stubEnv("OPENAI_API_KEY", "test-key"); vi.stubEnv("OPENAI_MODEL", "gpt-test");
    const headSha = "a".repeat(40);
    const calls: string[] = [];
    let providerCalled = false;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url === "https://api.openai.com/v1/responses") {
        providerCalled = true;
        const packet = JSON.parse(JSON.parse(String(init?.body)).input[1].content[0].text);
        const span = packet.spans?.find((span: { text: string }) => span.text.includes("Result"));
        const output = packet.contractVersion === "general_pr_semantic_claim.v2" ? { spanRoles: packet.spans.map((item: { id: string }) => ({ spanId: item.id, role: item.id === span.id ? "objective_candidate" : "supporting_context" })), unionMemberCandidates: [{ spanId: span.id, aliasName: "Result", member: "undefined" }] } : { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] };
        return Response.json({ output_text: JSON.stringify(output) });
      }
      if (url.endsWith("/pulls/12")) return Response.json({ title: "The service must return Ready.", body: "The type `Result` must support `undefined`.", url: "https://api.github.com/repos/acme/repo/pulls/12", base: { ref: "main", sha: "b".repeat(40), repo: { private: false } }, head: { ref: "types", sha: mode === "stale" && providerCalled ? "c".repeat(40) : headSha } });
      if (url.includes("/files?")) return Response.json([{ filename: "src/types.ts", status: "modified", patch: "+ misleading unrelated patch" }]);
      if (url.includes("/check-runs")) return Response.json({}, { status: 503 });
      if (url.endsWith("/status")) return Response.json({ statuses: [] });
      if (url.includes("/contents/src/types.ts?ref=")) return mode === "unavailable" ? Response.json({}, { status: 404 }) : Response.json({ type: "file", encoding: "base64", content: Buffer.from(mode === "absent" ? "type Result = string | number;" : "type Result = string | undefined; // PRIVATE_CODE").toString("base64") });
      throw new Error(`Unexpected URL ${url}`);
    }));
    const response = await POST(new Request("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prUrl: "https://github.com/acme/repo/pulls/12".replace("/pulls/", "/pull/") }) }));
    const json = await response.json();
    expect(response.status, JSON.stringify(json)).toBe(200);
    if (["off", "shadow", "stale"].includes(mode)) {
      expect(json.report.ordinaryStaticSummary).toBeUndefined();
      expect(calls.filter(url => url.includes("/contents/"))).toEqual([]);
      if (mode === "off") expect(json.report.reviewCandidates.navigation.state).toBe("fallback");
      return;
    }
    const counts = { present: Number(mode === "present"), absent: Number(mode === "absent"), unavailable: Number(mode === "unavailable") };
    expect(json.report.ordinaryStaticSummary).toEqual({ version: 1, scope: "direct_union_membership_only", interpretation: "hypothesis", lookupScope: "changed_files_only", lookupIncomplete: false, predicates: [{ sourceKind: "pr_body", sourceOrdinal: 1, artifactCounts: counts }] });
    expect(calls.filter(url => url.includes("/contents/"))).toEqual([`https://api.github.com/repos/acme/repo/contents/src/types.ts?ref=${headSha}`]);
    expect(json.report.generalPrAssessmentSummary.counts.evidence_supported).toBe(0);
    expect(JSON.stringify(json.report.ordinaryStaticSummary)).not.toMatch(/Result|undefined|types\.ts|PRIVATE_CODE|headSha|digest|spanId/);
    expect(validateRuntimeReportBoundary({ boundary: "inbound_untrusted_full", report: json.report }).valid).toBe(false);
    expect(validateRuntimeReportBoundary({ boundary: "generated_private_full", input: {} as never, report: json.report }).valid).toBe(false);
    expect(decodeSharedReport(encodeReportForShare(json.report))).toHaveProperty("ordinaryStaticSummary", json.report.ordinaryStaticSummary);
    const safe = prepareTenantDetailReportForStorage(json.report, "verified_agentproof", "signing-secret");
    const stored = projectTenantPersistedReport(safe, "signing-secret");
    const decoded = decodeTenantPersistedReport(stored, { signingSecret: "signing-secret", createdAt: json.report.createdAt });
    expect(decoded.status).toBe("valid");
    if (decoded.status === "valid") expect(decoded.report).toHaveProperty("ordinaryStaticSummary", json.report.ordinaryStaticSummary);
    const tampered = structuredClone(stored);
    tampered.ordinaryStaticSummary!.predicates[0].artifactCounts = mode === "present" ? { present: 0, absent: 1, unavailable: 0 } : { present: 1, absent: 0, unavailable: 0 };
    expect(validateTenantPersistedReport(tampered, "signing-secret").valid).toBe(false);
    if (mode === "present") {
      const detail = { report: json.report, freshness: "current" as const, copyEligible: true };
      for (const output of [renderToStaticMarkup(createElement(ReportView, { report: json.report })), renderToStaticMarkup(createElement(DetailedEvidence, { detail, demoMode: true })), reportToMarkdown(json.report), reportToGitHubComment(json.report), dashboardReportToMarkdown(detail)]) {
        expect(output).toContain("direct union membership");
        expect(output).toContain("source interpretation needs reviewer confirmation");
        expect(output).toContain("not whole-goal or PR verification");
        expect(output).not.toContain("PRIVATE_CODE");
      }
      expect(JSON.parse(dashboardReportToJson(detail)).static_predicates).toEqual(json.report.ordinaryStaticSummary);
    }
  });
});
