import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "./route";
import * as github from "@/lib/github";
import { demoScenarios } from "@/lib/sample-data";
import { clearTenantAuthSessionsForTests, createTenantAuthSessionForMember, saveGitHubUserCredentials } from "@/lib/tenant-auth";

beforeEach(() => {
  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "AGENTPROOF_CONTROL_PLANE_SUPABASE_URL", "AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY", "AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_URL", "AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "OPENAI_API_KEY", "OPENAI_MODEL", "AI_GATEWAY_API_KEY"]) vi.stubEnv(key, "");
  vi.stubEnv("AGENTPROOF_GENERAL_PR_OBSERVATION_MODE", "disabled");
  vi.stubEnv("AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
  vi.stubEnv("AGENTPROOF_PUBLIC_AUTH_SECRET", "server-encryption-secret-at-least-thirty-two-characters");
  vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([{ tenantId: "gh_123", name: "Test", status: "active", plan: "beta", members: [{ memberId: "github:123", role: "owner", status: "active" }] }]));
  vi.spyOn(github, "buildPullRequestInput").mockResolvedValue(demoScenarios.clean);
});
afterEach(() => { clearTenantAuthSessionsForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("analyzes another account's public PR with the session credential after the temporary OAuth cookie has expired", async () => {
  const signedInAt = Date.now() - 16 * 60_000;
  const session = await createTenantAuthSessionForMember({ tenantId: "gh_123", memberId: "github:123" }, process.env, signedInAt);
  await saveGitHubUserCredentials({ sessionCookie: session.sessionCookie, githubUserId: "123", accessToken: "ghu-persistent-test-secret", accessExpiresAt: Date.now() + 8 * 60 * 60_000, refreshToken: "ghr-persistent-test-secret", refreshExpiresAt: Date.now() + 180 * 24 * 60 * 60_000 }, process.env, signedInAt);
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "https://api.github.com/users/other") return Response.json({ id: 456, login: "other", type: "User" });
    if (url === "https://api.github.com/repos/other/repo") return Response.json({ private: false, permissions: { admin: false } });
    throw new Error(`Unexpected request ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const response = await POST(new Request("http://localhost/api/analyze", { method: "POST", headers: { origin: "http://localhost", cookie: session.sessionCookie }, body: JSON.stringify({ prUrl: "https://github.com/other/repo/pull/7", githubToken: "caller-token-ignored" }) }));
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(github.buildPullRequestInput).toHaveBeenCalledWith(expect.objectContaining({ githubToken: "ghu-persistent-test-secret" }), expect.anything());
  expect(fetchMock.mock.calls.every(([, init]) => (init?.headers as Record<string, string>)?.Authorization === "Bearer ghu-persistent-test-secret")).toBe(true);
  expect(JSON.stringify(body)).not.toContain("ghu-persistent-test-secret");
  expect(JSON.stringify(body)).not.toContain("caller-token-ignored");
});
