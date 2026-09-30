import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";
import { ensureGitHubOwnerTenant, findGitHubOwnerTenant } from "@/lib/tenant-accounts";
import { finishGitHubOAuth } from "@/lib/public-github-auth";
import { createTenantAuthSessionForMember, saveGitHubUserCredentials } from "@/lib/tenant-auth";
vi.mock("@/lib/tenant-accounts", () => ({ findGitHubOwnerTenant:vi.fn(), ensureGitHubOwnerTenant:vi.fn(async()=>({tenantId:"gh_123",memberId:"github:123",deletionPending:true})), TenantAccountStoreError:class extends Error {} }));
vi.mock("@/lib/tenant-auth", () => ({ clearTenantAuthSessionCookie:()=>"session=deleted", createTenantAuthSessionForMember:vi.fn(async()=>({sessionCookie:"session=opaque"})), saveGitHubUserCredentials:vi.fn(), revokeTenantAuthSession:vi.fn(), TenantAuthError:class extends Error {}, TenantAuthStoreError:class extends Error {} }));
vi.mock("@/lib/public-github-auth", () => ({ getGitHubOAuthConfig:()=>({}), finishGitHubOAuth:vi.fn(async()=>({githubUserId:"123",credentials:{accessToken:"never-store-this"}})), clearGitHubOAuthStateCookie:()=>"state=deleted", clearGitHubOAuthInstallCookie:()=>"install=deleted", bindGitHubInstallationAuthorization:vi.fn(), GitHubOAuthError:class extends Error {} }));
afterEach(()=>vi.clearAllMocks());
it("resumes only deletion after verified GitHub login without saving OAuth credentials or starting installation", async()=>{
  const result=await GET(new Request("https://app.invalid/api/auth/github/callback",{headers:{accept:"text/html"}}));
  expect(result.status).toBe(200);
  expect(await result.text()).toContain('url=/account/delete');
  expect(ensureGitHubOwnerTenant).toHaveBeenCalledWith({githubUserId:"123",allowDeletionResume:true});
  expect(createTenantAuthSessionForMember).toHaveBeenCalledWith({tenantId:"gh_123",memberId:"github:123",deletionPending:true});
  expect(saveGitHubUserCredentials).not.toHaveBeenCalled();
  expect(result.headers.get("set-cookie")).toContain("install=deleted");
});

it("status login after deletion does not recreate the account or save credentials", async () => {
  vi.mocked(finishGitHubOAuth).mockResolvedValueOnce({githubUserId:"123",returnTo:"/account/delete"} as any);
  vi.mocked(findGitHubOwnerTenant).mockResolvedValueOnce(null);
  const response = await GET(new Request("https://app.invalid/api/auth/github/callback",{headers:{accept:"text/html"}}));
  expect(await response.text()).toContain("No new account was created");
  expect(response.headers.get("set-cookie")).toContain("session=deleted");
  expect(ensureGitHubOwnerTenant).not.toHaveBeenCalled();
  expect(createTenantAuthSessionForMember).not.toHaveBeenCalled();
  expect(saveGitHubUserCredentials).not.toHaveBeenCalled();
});
it("status login uses an existing pending account without provisioning", async () => {
  vi.mocked(finishGitHubOAuth).mockResolvedValueOnce({githubUserId:"123",returnTo:"/account/delete"} as any);
  vi.mocked(findGitHubOwnerTenant).mockResolvedValueOnce({tenantId:"acct_old",memberId:"github:123",deletionPending:true});
  const response=await GET(new Request("https://app.invalid/api/auth/github/callback",{headers:{accept:"text/html"}}));
  expect(await response.text()).toContain("url=/account/delete");
  expect(ensureGitHubOwnerTenant).not.toHaveBeenCalled();
  expect(createTenantAuthSessionForMember).toHaveBeenCalledWith({tenantId:"acct_old",memberId:"github:123",deletionPending:true});
  expect(saveGitHubUserCredentials).not.toHaveBeenCalled();
});
