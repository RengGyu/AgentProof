import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";
import { resolveTenantAuthAccess } from "@/lib/tenant-auth";
import { listTenantRepositoryGrants } from "@/lib/tenant-control-plane";
import { listTenantGitHubInstallationStatuses } from "@/lib/github-installations";
import { createGitHubInstallationAccessToken } from "@/lib/github-app";
vi.mock("@/lib/tenant-auth", () => ({ resolveTenantAuthAccess: vi.fn() }));
vi.mock("@/lib/tenant-control-plane", () => ({ getTenantControlPlaneSettings: () => ({enabled:true}), listTenantRepositoryGrants: vi.fn() }));
vi.mock("@/lib/github-installations", () => ({ listTenantGitHubInstallationStatuses: vi.fn() }));
vi.mock("@/lib/github-app", () => ({ createGitHubInstallationAccessToken: vi.fn() }));
const sha = "a".repeat(40), older = "b".repeat(40);
const pr = {number:12,title:"A private change",state:"open",head:{sha}};
let fetchMock: ReturnType<typeof vi.fn>;
function request(query="repositoryId=100") { return GET(new Request(`https://app.invalid/api/dashboard/pull-requests?${query}`)); }
beforeEach(() => {
  vi.mocked(resolveTenantAuthAccess).mockResolvedValue({authorized:true,tenantId:"tenant_a"} as any);
  vi.mocked(listTenantRepositoryGrants).mockResolvedValue([{repositoryId:100,repositoryFullName:"owner/private",installationId:321,enabled:true,analysisEnabled:false}] as any);
  vi.mocked(listTenantGitHubInstallationStatuses).mockResolvedValue([{installationId:321,status:"active"}]);
  vi.mocked(createGitHubInstallationAccessToken).mockResolvedValue("installation-secret");
  fetchMock=vi.fn().mockResolvedValueOnce(Response.json({id:100,full_name:"owner/private",private:true}));
  vi.stubGlobal("fetch",fetchMock);
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
it("returns only bounded metadata after tenant, installation and live repository checks, even with analysis off", async () => {
  fetchMock.mockResolvedValueOnce(Response.json([pr]));
  const response=await request();
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(await response.json()).toMatchObject({pullRequests:[{number:12,title:pr.title,headSha:sha}],repositoryId:100});
  expect(listTenantRepositoryGrants).toHaveBeenCalledWith({tenantId:"tenant_a"});
  expect(listTenantGitHubInstallationStatuses).toHaveBeenCalledWith({tenantId:"tenant_a",installationIds:[321]});
  expect(fetchMock.mock.calls[0][0]).toBe("https://api.github.com/repositories/100");
});
it("binds the selected PR analysis URL and listed head to the live repository and PR", async () => {
  fetchMock.mockResolvedValueOnce(Response.json(pr)).mockResolvedValueOnce(Response.json([]));
  const response = await request("repositoryId=100&pullRequestNumber=12");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    repositoryId: 100,
    pullRequestNumber: 12,
    analysisPrUrl: "https://github.com/owner/private/pull/12",
    headSha: sha,
    pullRequest: { number: 12, title: pr.title, state: "open", headSha: sha },
  });
});
it("denies another tenant's repository without requesting an installation token", async () => {
  expect((await request("repositoryId=200")).status).toBe(404);
  expect(createGitHubInstallationAccessToken).not.toHaveBeenCalled();
});
it("denies unsigned requests and invalid identifiers", async () => {
  expect((await request("repositoryId=100&pullRequestNumber=-1")).status).toBe(400);
  vi.mocked(resolveTenantAuthAccess).mockResolvedValue({authorized:false} as any);
  expect((await request()).status).toBe(401);
  expect(createGitHubInstallationAccessToken).not.toHaveBeenCalled();
});
it.each(["suspended","deleted","missing"])("denies %s installation access",async status => {
  vi.mocked(listTenantGitHubInstallationStatuses).mockResolvedValue(status==="missing"?[]:[{installationId:321,status}] as any);
  expect((await request()).status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});
it.each([403,404,429,500])("handles live GitHub HTTP %s without exposing upstream data",async status => {
  fetchMock.mockReset().mockResolvedValue(Response.json({message:"private secret"},{status}));
  const response=await request();
  expect(response.status).toBe(status===403||status===404?403:503);
  expect(await response.text()).not.toContain("private secret");
});
it("rejects a mismatched repository identity",async () => {
  fetchMock.mockReset().mockResolvedValue(Response.json({id:200,full_name:"other/private"}));
  expect((await request()).status).toBe(403);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("builds exact commit URLs from verified names and full SHAs, ignoring upstream links and private author email",async () => {
  fetchMock.mockResolvedValueOnce(Response.json(pr)).mockResolvedValueOnce(Response.json([
    {sha:older,html_url:"https://evil.invalid",commit:{message:"Previous\nsecret body",author:{email:"private@example.invalid"}}}
  ],{headers:{link:'<https://api.github.com/next>; rel="next"'}}));
  const response=await request("repositoryId=100&pullRequestNumber=12");
  const body=await response.json();
  expect(body.commits).toEqual([{sha,message:"Current PR head",url:`https://github.com/owner/private/commit/${sha}`},{sha:older,message:"Previous",url:`https://github.com/owner/private/commit/${older}`}]);
  expect(body.truncated).toBe(true);
  expect(JSON.stringify(body)).not.toMatch(/evil|private@example|secret body/);
});
it("returns empty PRs and fails closed on malformed metadata",async () => {
  fetchMock.mockResolvedValueOnce(Response.json([]));
  expect(await (await request()).json()).toMatchObject({pullRequests:[]});
  fetchMock.mockResolvedValueOnce(Response.json({id:100,full_name:"owner/private"})).mockResolvedValueOnce(Response.json([{...pr,head:{sha:"short"}}]));
  expect((await request()).status).toBe(503);
});

it("denies disabled connections and network failures without returning private metadata", async () => {
  vi.mocked(listTenantRepositoryGrants).mockResolvedValueOnce([{repositoryId:100,enabled:false}] as any);
  expect((await request()).status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
  fetchMock.mockRejectedValueOnce(new Error("private network diagnostics"));
  const response = await request();
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private network diagnostics");
});
