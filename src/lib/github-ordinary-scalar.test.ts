import { afterEach, expect, it, vi } from "vitest";
import { collectOrdinaryScalarArtifacts } from "./github";

afterEach(() => vi.unstubAllGlobals());
it("reads only explicit bounded JavaScript paths at the supplied exact head", async () => {
  const head = "a".repeat(40);
  const fetch = vi.fn(async (_url: string) => Response.json({ type: "file", encoding: "base64", content: Buffer.from("function owned() { return 42; }").toString("base64") }));
  vi.stubGlobal("fetch", fetch);
  expect(await collectOrdinaryScalarArtifacts("https://github.com/owned/scalar/pull/12", undefined, ["src/owned.js", "src/owned.js"], head)).toEqual([{ path: "src/owned.js", headSha: head, content: "function owned() { return 42; }" }]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toBe(`https://api.github.com/repos/owned/scalar/contents/src/owned.js?ref=${head}`);
  expect(await collectOrdinaryScalarArtifacts("https://github.com/owned/scalar/pull/12", undefined, Array.from({ length: 9 }, (_, i) => `src/a${i}.js`), head)).toEqual([]);
  expect(await collectOrdinaryScalarArtifacts("https://github.com/owned/scalar/pull/12", undefined, ["../escape.js"], head)).toEqual([]);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it.each([Buffer.from([0xff]), Buffer.alloc(64 * 1024 + 1, 65)])("rejects lossy UTF-8 or oversized source bytes", async bytes => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ type: "file", encoding: "base64", content: bytes.toString("base64") })));
  expect(await collectOrdinaryScalarArtifacts("https://github.com/owned/scalar/pull/12", undefined, ["src/owned.js"], "a".repeat(40))).toEqual([]);
});
