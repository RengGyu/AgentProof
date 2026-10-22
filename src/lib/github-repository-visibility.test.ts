import { describe, expect, it, vi } from "vitest";
import { readGitHubRepositoryPrivate, isGitHubRepositoryPublic } from "./github-repository-visibility";

describe("GitHub repository visibility", () => {
  it("accepts only GitHub's explicit public flag and fails closed for all other responses", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ private: false, full_name: "RengGyu/dongo" }))
      .mockResolvedValueOnce(Response.json({ private: true }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(isGitHubRepositoryPublic("RengGyu/dongo", "installation-token")).resolves.toBe(true);
    await expect(isGitHubRepositoryPublic("RengGyu/dongo", "installation-token")).resolves.toBe(false);
    await expect(isGitHubRepositoryPublic("RengGyu/dongo", "installation-token")).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledWith("https://api.github.com/repos/RengGyu/dongo", expect.objectContaining({ cache: "no-store" }));
  });
});

it('bound private visibility rejects a changed repository identity without exposing metadata',async()=>{
 const f=vi.fn().mockResolvedValueOnce(Response.json({id:9,private:true,full_name:'Owner/repo'})).mockResolvedValueOnce(Response.json({id:10,private:true,full_name:'Owner/repo'})).mockResolvedValueOnce(Response.json({id:9,private:true,full_name:'Owner/other'}));vi.stubGlobal('fetch',f);
 try{expect(await readGitHubRepositoryPrivate('Owner/repo','fixture-token',{repositoryId:9})).toBe(true);expect(await readGitHubRepositoryPrivate('Owner/repo','fixture-token',{repositoryId:9})).toBeNull();expect(await readGitHubRepositoryPrivate('Owner/repo','fixture-token',{repositoryId:9})).toBeNull();expect(f.mock.calls.every(([,i])=>i.redirect==='error')).toBe(true);}
 finally{vi.unstubAllGlobals();}
});
