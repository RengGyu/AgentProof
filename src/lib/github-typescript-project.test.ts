import { afterEach, expect, it, vi } from "vitest";
import * as github from "./github";
import { createHash } from "node:crypto";
const head = "a".repeat(40), tree = "b".repeat(40);
const blobSha = (content: string) => createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest("hex");
afterEach(() => vi.unstubAllGlobals());
it("collects complete commit-bound inventory and exact regular-file contents", async () => {
  const files = { "tsconfig.json": "{}", "src/mode.ts": "export type Mode = string;" };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith(`/git/commits/${head}`)) return Response.json({ sha: head, tree: { sha: tree } });
    if (url.endsWith(`/git/trees/${tree}?recursive=1`)) return Response.json({ sha: tree, truncated: false, tree: Object.entries(files).map(([path, content]) => ({ path, type: "blob", mode: "100644", sha: blobSha(content), size: Buffer.byteLength(content) })) });
    const file = Object.entries(files).find(([path]) => url.endsWith(`/contents/${path}?ref=${head}`));
    if (file) return Response.json({ type: "file", sha: blobSha(file[1]), encoding: "base64", content: Buffer.from(file[1]).toString("base64") });
    throw new Error("Unexpected request");
  }));
  expect(github).toHaveProperty("collectOrdinaryTypeScriptProject");
  const project = await github.collectOrdinaryTypeScriptProject("https://github.com/owned/types/pull/12", undefined, head);
  expect(project?.inventory).toEqual({ paths: ["src/mode.ts", "tsconfig.json"], complete: true });
  expect(project?.blobs.map(blob => blob.content).sort()).toEqual(Object.values(files).sort());
});
it("does not read unrelated JSON data or lockfiles, but follows relative config inheritance", async () => {
  const files = { "tsconfig.json": '{"extends":"./config/base"}', "config/base.json": '{"compilerOptions":{"strict":true}}', "src/mode.ts": "type Mode = string;" };
  const reads: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith(`/git/commits/${head}`)) return Response.json({ sha: head, tree: { sha: tree } });
    if (url.endsWith(`/git/trees/${tree}?recursive=1`)) return Response.json({ sha: tree, truncated: false, tree: [...Object.entries(files).map(([path, content]) => ({ path, type: "blob", mode: "100644", sha: blobSha(content), size: Buffer.byteLength(content) })), { path: "package-lock.json", type: "blob", mode: "100644", sha: "e".repeat(40), size: 1000000 }, { path: "data.json", type: "blob", mode: "100644", sha: "f".repeat(40), size: 1000000 }] });
    const file = Object.entries(files).find(([path]) => url.endsWith(`/contents/${path}?ref=${head}`));
    if (file) { reads.push(file[0]); return Response.json({ type: "file", sha: blobSha(file[1]), encoding: "base64", content: Buffer.from(file[1]).toString("base64") }); }
    throw new Error("Unexpected request");
  }));
  const project = await github.collectOrdinaryTypeScriptProject("https://github.com/owned/types/pull/12", undefined, head);
  expect(project?.blobs.map(blob => blob.path).sort()).toEqual(Object.keys(files).sort());
  expect(reads.sort()).toEqual(Object.keys(files).sort());
});
it.each(["wrong commit", "wrong tree", "truncated", "inventory budget", "file budget", "unsafe path", "symlink", "oversized", "lossy UTF-8", "wrong content hash", "missing content"])("fails closed for %s", async mode => {
  const content = "{}";
  const entry = { path: "tsconfig.json", type: "blob", mode: "100644", sha: blobSha(content), size: Buffer.byteLength(content) };
  let entries = [entry];
  if (mode === "inventory budget") entries = Array.from({ length: 20001 }, (_, i) => ({ ...entry, path: `file${i}.txt` }));
  if (mode === "file budget") entries = Array.from({ length: 65 }, (_, i) => ({ ...entry, path: `file${i}.ts` }));
  if (mode === "unsafe path") entries = [{ ...entry, path: "../tsconfig.json" }];
  if (mode === "symlink") entries = [{ ...entry, mode: "120000" }];
  if (mode === "oversized") entries = [{ ...entry, size: 65537 }];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith(`/git/commits/${head}`)) return Response.json({ sha: mode === "wrong commit" ? tree : head, tree: { sha: tree } });
    if (url.endsWith(`/git/trees/${tree}?recursive=1`)) return Response.json({ sha: mode === "wrong tree" ? head : tree, truncated: mode === "truncated", tree: entries });
    if (mode === "missing content") return Response.json({}, { status: 404 });
    return Response.json({ type: "file", sha: entry.sha, encoding: "base64", content: (mode === "lossy UTF-8" ? Buffer.from([0xff]) : Buffer.from(mode === "wrong content hash" ? "[]" : content)).toString("base64") });
  }));
  expect(await github.collectOrdinaryTypeScriptProject("https://github.com/owned/types/pull/12", undefined, head)).toBeNull();
});
