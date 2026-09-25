import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("client token lifecycle privacy", () => {
  it("does not collect a client-supplied analysis token", () => {
    const source = readFileSync(join(root, "src/components/AnalyzeWorkspace.tsx"), "utf8");
    expect(source).not.toContain('id="githubToken"');
    expect(source).not.toContain('githubToken:');
  });

  it("clears the one-time PR comment token in the comment finally path", () => {
    const source = readFileSync(join(root, "src/components/ReportView.tsx"), "utf8");
    const postGitHubComment = functionSource(source, "async function postGitHubComment");

    expect(postGitHubComment).toMatch(/finally\s*{[\s\S]*setCommentToken\(""\)[\s\S]*setPostingComment\(false\)/);
  });
});

function functionSource(source: string, marker: string): string {
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);

  const nextFunction = source.indexOf("\n  return (", start);
  expect(nextFunction).toBeGreaterThan(start);

  return source.slice(start, nextFunction);
}
