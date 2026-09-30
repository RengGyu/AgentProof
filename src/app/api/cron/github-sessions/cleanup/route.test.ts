import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupExpiredGitHubSessionCredentials, TenantAuthStoreError } from "@/lib/tenant-auth";
import { continuePersonalAccountDeletions } from "@/lib/personal-deletion-store";
import { GET } from "./route";

vi.mock("@/lib/tenant-auth", () => ({
  cleanupExpiredGitHubSessionCredentials: vi.fn(),
  TenantAuthStoreError: class TenantAuthStoreError extends Error {}
}));

vi.mock("@/lib/personal-deletion-store", () => ({ continuePersonalAccountDeletions: vi.fn() }));
const continuation = vi.mocked(continuePersonalAccountDeletions);
const cleanup = vi.mocked(cleanupExpiredGitHubSessionCredentials);

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("GET /api/cron/github-sessions/cleanup", () => {
  it("does not run without a configured cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("AGENTPROOF_CRON_TOKEN", "");
    const response = await GET(new Request("http://localhost/api/cron/github-sessions/cleanup"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "disabled" });
    expect(cleanup).not.toHaveBeenCalled();
    expect(continuation).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated calls and query-string credentials", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    const response = await GET(new Request("http://localhost/api/cron/github-sessions/cleanup?token=cron-secret-value"));
    expect(response.status).toBe(401);
    expect(JSON.stringify(await response.json())).not.toContain("cron-secret-value");
    expect(cleanup).not.toHaveBeenCalled();
    expect(continuation).not.toHaveBeenCalled();
  });

  it("clears expired credentials and returns metadata only", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    cleanup.mockResolvedValue(2);
    const response = await GET(new Request("http://localhost/api/cron/github-sessions/cleanup", { headers: { authorization: "Bearer cron-secret-value" } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ ok: true, status: "ran", processedCount: 2 });
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("continues accepted deletions only under cron authentication and exposes aggregate counts", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    continuation.mockResolvedValue({completed:2,pending:1});
    cleanup.mockResolvedValue(0);
    const response = await GET(new Request("http://localhost/api/cron/github-sessions/cleanup", {headers:{authorization:"Bearer cron-secret-value"}}));
    expect(await response.json()).toMatchObject({deletion:{completed:2,pending:1}});
    expect(continuation).toHaveBeenCalledOnce();
    continuation.mockRejectedValue(new Error("private-store-error"));
    const failed = await GET(new Request("http://localhost/api/cron/github-sessions/cleanup", {headers:{authorization:"Bearer cron-secret-value"}}));
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain("private-store-error");
  });

  it("reports store failure without exposing storage details", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    cleanup.mockRejectedValue(new TenantAuthStoreError("service-role-secret"));
    const response = await GET(new Request("http://localhost/api/cron/github-sessions/cleanup", { headers: { authorization: "Bearer cron-secret-value" } }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("service-role-secret");
  });
});

it("keeps credential expiry cleanup running but reports 503 when deletion continuation fails", async () => {
  vi.stubEnv("CRON_SECRET","cron-secret-value");
  vi.stubEnv("AGENTPROOF_SELF_SERVICE_DELETION_ENABLED","false");
  continuation.mockRejectedValue(new Error("private-store-error"));
  cleanup.mockResolvedValue(3);
  const response=await GET(new Request("http://localhost/api/cron/github-sessions/cleanup",{headers:{authorization:"Bearer cron-secret-value"}}));
  expect(response.status).toBe(503);
  expect(continuation).toHaveBeenCalledOnce();
  expect(cleanup).toHaveBeenCalledOnce();
  expect(await response.text()).not.toContain("private-store-error");
});
