import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./PublicGitHubEntry.tsx", import.meta.url), "utf8");

describe("PublicGitHubEntry", () => {
  it("makes GitHub sign-in the primary action and keeps public analysis secondary", () => {
    expect(source).toContain("Continue with GitHub");
    expect(source).toContain('"/api/auth/github/start"');
    expect(source).toContain('href="/analyze"');
    expect(source).toContain("Analyze a public PR");
  });

  it("does not ask users to supply a GitHub token on the entry screen", () => {
    expect(source).not.toContain("githubToken");
  });
});
