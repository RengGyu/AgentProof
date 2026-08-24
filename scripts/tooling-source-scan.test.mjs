import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanToolingSource } from "./tooling-source-scan.mjs";

function expectCode(input, code) {
  assert.throws(() => scanToolingSource(input), (error) => error?.code === code);
}

describe("tooling-source-scan", () => {
  it("emits sorted normalized runtime and type edges", () => {
    assert.deepEqual(scanToolingSource({
      path: "tools/runner.ts",
      source: [
        'import { run as execute } from "./run";',
        'import type { A, B } from "./types";',
        'export type { C, D as E } from "./proof-contract";'
      ].join("\n")
    }), {
      version: 2,
      sourceKind: "typescript",
      moduleEdges: [
        { importerPath: "tools/runner.ts", kind: "runtime_import", specifier: "./run" },
        { importerPath: "tools/runner.ts", kind: "type_import", specifier: "./proof-contract" },
        { importerPath: "tools/runner.ts", kind: "type_import", specifier: "./types" }
      ]
    });
  });

  it("uses stable code-unit ordering for normalized edge fields", () => {
    assert.deepEqual(scanToolingSource({
      path: "tools/runner.ts",
      source: 'import "./ä"; import "./z";'
    }).moduleEdges.map((edge) => edge.specifier), ["./z", "./ä"]);
  });

  it("keeps normal runtime language features outside the static-edge policy", () => {
    assert.deepEqual(scanToolingSource({
      path: "tools/runner.ts",
      source: [
        'import { createHash } from "crypto";',
        'const enabled = process.env.CI;',
        'const host = globalThis;',
        'const proxy = new Proxy({}, {});',
        'const reflection = Reflect.get({}, "value");',
        'void createHash; void enabled; void host; void proxy; void reflection;'
      ].join("\n")
    }).moduleEdges, [
      { importerPath: "tools/runner.ts", kind: "runtime_import", specifier: "crypto" }
    ]);
  });

  it("does not mistake ordinary object property names for CommonJS globals", () => {
    assert.deepEqual(scanToolingSource({
      path: "tools/runner.ts",
      source: 'const policy = { module: "ESNext", exports: false }; void policy;'
    }).moduleEdges, []);
  });

  it("accepts .mjs and JSON leaves only", () => {
    assert.deepEqual(scanToolingSource({
      path: "tools/runner.mjs",
      source: 'import "./helper.mjs";'
    }), {
      version: 2,
      sourceKind: "esm",
      moduleEdges: [{ importerPath: "tools/runner.mjs", kind: "runtime_import", specifier: "./helper.mjs" }]
    });
    assert.deepEqual(scanToolingSource({ path: "tools/profile.json", source: '{"version":1}' }), {
      version: 2,
      sourceKind: "json",
      moduleEdges: []
    });
  });

  it("rejects every unsupported production module form", () => {
    const cases = [
      [{ path: "tools/runner.ts", source: 'export { value } from "./dep";' }, "UNSUPPORTED_MODULE_FORM"],
      [{ path: "tools/runner.ts", source: 'export { "value" as value } from "./dep";' }, "UNSUPPORTED_MODULE_FORM"],
      [{ path: "tools/runner.ts", source: 'export * from "./dep";' }, "UNSUPPORTED_MODULE_FORM"],
      [{ path: "tools/runner.ts", source: 'import("./dep");' }, "UNSUPPORTED_MODULE_FORM"],
      [{ path: "tools/runner.ts", source: 'require("./dep");' }, "UNSUPPORTED_MODULE_FORM"],
      [{ path: "tools/runner.ts", source: 'import dep = require("./dep");' }, "UNSUPPORTED_MODULE_FORM"],
      [{ path: "tools/runner.ts", source: "export = value;" }, "UNSUPPORTED_MODULE_FORM"],
      [{ path: "tools/runner.ts", source: 'import value from "./dep" with { type: "json" };' }, "UNSUPPORTED_MODULE_FORM"],
      [{ path: "tools/runner.ts", source: 'eval("1");' }, "UNSUPPORTED_MODULE_FORM"],
      [{ path: "tools/runner.ts", source: 'new Function("return 1");' }, "UNSUPPORTED_MODULE_FORM"],
      [{ path: "tools/runner.ts", source: 'module.exports = {};' }, "UNSUPPORTED_MODULE_FORM"],
      [{ path: "tools/runner.ts", source: 'exports.value = 1;' }, "UNSUPPORTED_MODULE_FORM"],
      [{ path: "tools/runner.ts", source: 'createRequire("./dep");' }, "UNSUPPORTED_MODULE_FORM"],
      [{ path: "tools/runner.ts", source: 'import "node:vm";' }, "BUILTIN_NOT_ALLOWED"],
      [{ path: "tools/runner.js", source: 'export {};' }, "UNSUPPORTED_TOOLING_SOURCE"],
      [{ path: "tools/runner.cjs", source: 'module.exports = {};' }, "UNSUPPORTED_TOOLING_SOURCE"],
      [{ path: "tools/runner.tsx", source: 'export {};' }, "UNSUPPORTED_TOOLING_SOURCE"],
      [{ path: "tools/runner.ts", source: 'const = ;' }, "TOOLING_SOURCE_INVALID"]
    ];
    for (const [input, code] of cases) expectCode(input, code);
  });
});
