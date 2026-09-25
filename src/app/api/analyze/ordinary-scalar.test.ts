// Downstream unit fixtures isolate budget; paid-budget*.test.ts checks the real boundary.
vi.mock('@/lib/paid-budget', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/paid-budget')>(),
  ...(await import('@/lib/test-support/unmetered-budget')).unmeteredBudgetFixture
}));
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as routePOST } from "./route";
// These downstream evidence/provider fixtures represent an authenticated caller.
// auth.test.ts exercises the real durable session and CSRF boundary separately.
vi.mock("@/lib/tenant-auth", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/tenant-auth")>(),
  resolveTenantAuthAccess: vi.fn(async () => ({ authorized: true, tenantId: "gh_123", memberId: "github:123", method: "durable-session", sessionState: "active" }))
}));
vi.mock("@/lib/github-analysis-access", () => ({ resolveGitHubAnalysisCredential: vi.fn(async () => ({ ok: true, token: "server-selected-test-token", kind: "installation" })) }));
function POST(request: Request) {
  const headers = new Headers(request.headers);
  headers.set("origin", new URL(request.url).origin);
  return routePOST(new Request(request, { headers }));
}
import { deriveRequirementPresentationV2 } from "@/lib/requirement-presentation-v2";
import { validateRuntimeReportBoundary } from "@/lib/report-runtime-validation";
import { encodeReportForShare, decodeSharedReport } from "@/lib/report-share";
import { projectTenantPersistedReport, decodeTenantPersistedReport, validateTenantPersistedReport } from "@/lib/tenant-report-validation";
import { prepareTenantDetailReportForStorage } from "@/lib/server-report-store";
import type { VerificationReportV2 } from "@/lib/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportView } from "@/components/ReportView";
import { DetailedEvidence } from "@/components/PublicGitHubDashboard";
import { reportToMarkdown, reportToGitHubComment } from "@/lib/markdown";
import { dashboardReportToMarkdown } from "@/lib/dashboard-report-export";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe.skipIf(process.env.AGENTPROOF_SCALAR_OWNED_FIXTURE_TESTS !== "1")("ordinary scalar owned API flow", () => {
  it.each(["fulfilled", "violated", "missing", "off", "module_named", "module_default"])("observes an owned exact-head scalar through POST: %s", async mode => {
    vi.stubEnv("AGENTPROOF_GENERAL_PR_OBSERVATION_MODE", "advisory");
    vi.stubEnv("AGENTPROOF_ORDINARY_SCALAR_EXECUTION", mode === "off" ? "" : "enabled");
    vi.stubEnv("AGENTPROOF_VERIFICATION_CAPABILITIES_V2", "documentation_literal,typescript_union_member");
    vi.stubEnv("OPENAI_API_KEY", "");
    const headSha = "a".repeat(40);
    const reads: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/pulls/12")) return Response.json({ title: "Scalar change", body: "Implementation update", base: { ref: "main", sha: "b".repeat(40), repo: { private: false } }, head: { ref: "scalar", sha: headSha } });
      if (url.includes("/files?")) return Response.json([{ filename: "src/answer.js", status: "modified", patch: "+ misleading patch" }]);
      if (url.includes("/check-runs")) return Response.json({}, { status: 503 });
      if (url.endsWith("/status")) return Response.json({ statuses: [] });
      if (url.includes("/contents/src/answer.js?ref=")) {
        reads.push(url);
        const exportPrefix = mode === "module_named" ? "export " : mode === "module_default" ? "export default " : "";
        return mode === "missing" ? Response.json({}, { status: 404 }) : Response.json({ type: "file", encoding: "base64", content: Buffer.from(`${exportPrefix}function answer() { return ${mode === "violated" ? 41 : 42}; } // PRIVATE_SOURCE_MARKER`).toString("base64") });
      }
      throw new Error("Unexpected fixture transport request");
    }));
    const response = await POST(new Request("http://localhost/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prUrl: "https://github.com/acme/repo/pull/12", taskText: '## Requirements\n- Function `answer` in `src/answer.js` must return `42` when called with no arguments.',
      AGENTPROOF_ORDINARY_SCALAR_EXECUTION: "enabled", imageDigest: "sha256:" + "f".repeat(64), ordinaryRequirementOutcomes: { state: "satisfied" } }) }));
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    const report = body.report;
    const state = ["fulfilled", "module_named", "module_default"].includes(mode) ? "satisfied" : mode === "violated" ? "violated" : "unavailable";
    expect(report.ordinaryRequirementOutcomes.requirements[0]).toMatchObject({ requirementId: "req_1", criterion: { criterionId: "req_1_c1", kind: "standalone_scalar", state } });
    expect(reads).toEqual(mode === "off" ? [] : [`https://api.github.com/repos/acme/repo/contents/src/answer.js?ref=${headSha}`]);
    expect(JSON.stringify(report)).not.toMatch(/PRIVATE_SOURCE_MARKER|signingPrivateKey|publicKeyPem|bindingDigest|attestedResult|"actual"/);
    expect(validateRuntimeReportBoundary({ boundary: "inbound_untrusted_full", report }).valid).toBe(false);
    const label = deriveRequirementPresentationV2(report, "req_1").outcomeLabel;
    const stored = projectTenantPersistedReport(prepareTenantDetailReportForStorage(report, "verified_agentproof", "owned-test-secret"), "owned-test-secret");
    expect(validateTenantPersistedReport(stored, "owned-test-secret").valid).toBe(true);
    const decoded = decodeTenantPersistedReport(stored, { signingSecret: "owned-test-secret", createdAt: report.createdAt });
    expect(decoded.status).toBe("valid");
    if (decoded.status === "valid") expect(deriveRequirementPresentationV2(decoded.report as typeof report, "req_1").outcomeLabel).toBe(label);
    const shared = decodeSharedReport(encodeReportForShare(report)) as VerificationReportV2 | null;
    expect(shared?.ordinaryRequirementOutcomes?.requirements[0]).toMatchObject({ requirementId: "req_1", criterion: { criterionId: "req_1_c1", kind: "standalone_scalar", state, evidenceRefs: [] } });
    expect(deriveRequirementPresentationV2(shared as typeof report, "req_1").outcomeLabel).toBe(label);
    if (mode === "fulfilled") {
      const detail = { report, freshness: "current" as const, copyEligible: true };
      for (const output of [renderToStaticMarkup(createElement(ReportView, { report })), renderToStaticMarkup(createElement(DetailedEvidence, { detail, demoMode: true })), reportToMarkdown(report), reportToGitHubComment(report), dashboardReportToMarkdown(detail)]) {
        expect(output).toContain("Fulfilled");
        expect(output).not.toContain("PRIVATE_SOURCE_MARKER");
        expect(output).not.toContain("attestedResult");
      }
    }
  }, 20_000);
});
