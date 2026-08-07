import { describe, expect, it, vi } from "vitest";
import { isGitHubRepositoryPublic } from "./github-repository-visibility";

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
