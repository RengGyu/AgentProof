import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearMobileCodesForTests, createMobileHandoff, exchangeMobileHandoff, hashMobileVerifier, mobileCookieFromRequest } from "@/lib/mobile-auth";
import { clearTenantAuthSessionsForTests, createTenantAuthSessionForMember } from "@/lib/tenant-auth";
import { clearSavedReportsForTests, createVerifiedSavedReport } from "@/lib/server-report-store";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport } from "@/lib/verifier";
import { GET as reports } from "./reports/route";
import { DELETE as logout, GET as session } from "./session/route";

const verifier = "v".repeat(64);
const env = () => {
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
    { tenantId: "tenant_a", name: "A", status: "active", plan: "beta", members: [{ memberId: "github:1", role: "owner", status: "active" }] },
    { tenantId: "tenant_b", name: "B", status: "active", plan: "beta", members: [{ memberId: "github:2", role: "owner", status: "active" }] }
  ]));
  vi.stubEnv("AGENTPROOF_REPORT_SIGNING_SECRET", "test-report-signing-secret-that-is-long-enough");
};
const req = (path: string, token: string, extra?: Record<string, string>) => new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}`, ...extra } });

describe("mobile session boundary", () => {
  beforeEach(env);
  afterEach(() => { clearMobileCodesForTests(); clearTenantAuthSessionsForTests(); clearSavedReportsForTests(); vi.unstubAllEnvs(); });

  it("exchanges one bound handoff once and revokes the session on logout", async () => {
    const code = await createMobileHandoff({ verifierChallenge: hashMobileVerifier(verifier), tenantId: "tenant_a", memberId: "github:1" });
    expect(await exchangeMobileHandoff({ code, verifier: "x".repeat(64) })).toBeNull();
    const token = await exchangeMobileHandoff({ code, verifier });
    expect(token).toMatch(/^apm_/);
    expect(await exchangeMobileHandoff({ code, verifier })).toBeNull();
    expect((await session(req("/api/mobile/session", token!))).status).toBe(200);
    const webCookie = `agentproof_tenant_auth_session=${token!.slice(4)}`;
    const webAccess = await import("@/lib/tenant-auth").then(x => x.resolveTenantAuthAccess({ cookieHeader: webCookie }));
    expect(webAccess.authorized).toBe(false);
    expect((await logout(new Request("http://localhost/api/mobile/session", { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }))).status).toBe(200);
    expect((await session(req("/api/mobile/session", token!))).status).toBe(401);
  });

  it("rejects browser-origin bearer and tenant-crossing report detail", async () => {
    const code = await createMobileHandoff({ verifierChallenge: hashMobileVerifier(verifier), tenantId: "tenant_a", memberId: "github:1" });
    const token = await exchangeMobileHandoff({ code, verifier });
    const otherReport = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_b", installationId: 2, repositoryId: 20, pullRequestNumber: 1, headSha: "b".repeat(40)
    });
    expect(mobileCookieFromRequest(req("/api/mobile/session", token!, { Origin: "https://evil.example" }))).toBeNull();
    expect((await reports(req("/api/mobile/reports", token!, { Origin: "https://evil.example" }))).status).toBe(401);
    expect((await reports(req(`/api/mobile/reports?id=${otherReport.id}`, token!))).status).toBe(404);
  });
  it("rejects expired handoffs and allows only one simultaneous exchange", async () => {
    const now = Date.now();
    const expired = await createMobileHandoff({ verifierChallenge: hashMobileVerifier(verifier), tenantId: "tenant_a", memberId: "github:1" }, process.env, now - 121_000);
    expect(await exchangeMobileHandoff({ code: expired, verifier }, process.env, now)).toBeNull();
    const code = await createMobileHandoff({ verifierChallenge: hashMobileVerifier(verifier), tenantId: "tenant_a", memberId: "github:1" });
    const results = await Promise.all([exchangeMobileHandoff({ code, verifier }), exchangeMobileHandoff({ code, verifier })]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

});
