import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanToolingSource } from "./tooling-source-scan.mjs";

function expectCode(action, code) {
  assert.throws(action, (error) => error?.code === code);
}

describe("tooling-source-scan AST contract", () => {
  it("extracts static dependencies without treating regexes or raw template text as executable code", () => {
    expectCode(() => scanToolingSource({
      path: "tools/runner.mjs",
      source: "export const load = () => `${/}/.test(\"}\") && import(\"../src/sut.mjs\")}`;\n",
      sourceMode: "module"
    }), "UNSUPPORTED_MODULE_FORM");
    expectCode(() => scanToolingSource({ path: "tools/runner.mjs", source: "const = ;\n", sourceMode: "module" }), "TOOLING_SOURCE_INVALID");
    assert.doesNotThrow(() => scanToolingSource({ path: "tools/runner.mjs", source: "export const p = /createRequire/;\n", sourceMode: "module" }));
    assert.doesNotThrow(() => scanToolingSource({ path: "tools/runner.mjs", source: "export const s = `raw import(\"x\")`;\n", sourceMode: "module" }));
    assert.deepEqual(scanToolingSource({
      path: "tools/runner.mjs",
      source: 'import helper from "./helper.mjs"; export { helper };\n',
      sourceMode: "module"
    }), { version: 1, sourceKind: "esm", staticSpecifiers: ["./helper.mjs"] });
  });

  it("dispatches the closed extension set with explicit source modes", () => {
    const controls = [
      ["tools/runner.mjs", "export const value = 1;\n", "module"],
      ["tools/runner.cjs", "const helper = require(\"./helper.cjs\"); void helper;\n", "script"],
      ["tools/runner.ts", "export const value = 1;\n", "typescript"],
      ["tools/runner.tsx", "export const view = <div />;\n", "tsx"],
      ["tools/tooling.json", '{"version":1}\n', "json"],
      ["tools/runner.js", "const helper = require(\"./helper.cjs\"); void helper;\n", "script"],
      ["tools/runner.js", "export const value = 1;\n", "module"]
    ];
    for (const [path, source, sourceMode] of controls) {
      assert.doesNotThrow(() => scanToolingSource({ path, source, sourceMode }), path);
    }
    expectCode(() => scanToolingSource({ path: "tools/runner.coffee", source: "value = 1\n", sourceMode: "script" }), "UNSUPPORTED_TOOLING_SOURCE");
  });

  it("collects TypeScript import-equals dependencies and fails closed on unresolved forms", () => {
    assert.deepEqual(scanToolingSource({
      path: "tools/runner.ts",
      source: 'import helper = require("./helper.cjs"); export { helper };\n',
      sourceMode: "typescript"
    }), { version: 1, sourceKind: "typescript", staticSpecifiers: ["./helper.cjs"] });
    expectCode(() => scanToolingSource({
      path: "tools/runner.ts",
      source: "import helper = require(name); export { helper };\n",
      sourceMode: "typescript"
    }), "UNSUPPORTED_MODULE_FORM");
  });

  it("rejects every forbidden loader and code-construction capability", () => {
    const forbidden = {
      "worker threads": 'import "node:worker_threads";\n',
      "child process": 'import "node:child_process";\n',
      vm: 'import "node:vm";\n',
      "worker eval": "new Worker(\"worker.js\", { eval: true });\n",
      "function constructor property": "(() => {}).constructor(\"return 1\");\n",
      "computed constructor": "({})[\"constructor\"](\"return 1\");\n",
      Reflect: "Reflect.get({}, \"constructor\");\n",
      Proxy: "new Proxy({}, {});\n",
      "prototype reflection": "Object.getPrototypeOf({});\n",
      "Function alias": "const F = Function; F(\"return 1\");\n",
      "Function destructuring": "const { Function: F } = globalThis; F(\"return 1\");\n",
      "global Function": "global.Function(\"return 1\");\n",
      "optional Function": "Function?.(\"return 1\");\n",
      "Function argument": "consume(Function);\n",
      "Function return": "function make() { return Function; }\n"
    };
    for (const [label, source] of Object.entries(forbidden)) {
      expectCode(() => scanToolingSource({ path: "tools/runner.mjs", source, sourceMode: "module" }), "UNSUPPORTED_MODULE_FORM", label);
    }
  });

  it("treats export names as keys but exported forbidden bindings as runtime values", () => {
    for (const [path, sourceMode] of [["tools/runner.mjs", "module"], ["tools/runner.ts", "typescript"]]) {
      assert.doesNotThrow(() => scanToolingSource({
        path,
        source: "const value = 1; export { value as Function };\n",
        sourceMode
      }));
      expectCode(() => scanToolingSource({
        path,
        source: "const Function = 1; export { Function };\n",
        sourceMode
      }), "UNSUPPORTED_MODULE_FORM");
    }
  });

  it("accepts TypeScript type member keys while rejecting the same runtime values", () => {
    for (const source of ["interface I { eval: string }", "interface I { Function(): void }"]) {
      assert.doesNotThrow(() => scanToolingSource({
        path: "tools/runner.ts",
        source,
        sourceMode: "typescript"
      }));
    }
    for (const source of ["const x = eval;", "eval();", "new Function();"]) {
      expectCode(() => scanToolingSource({
        path: "tools/runner.ts",
        source,
        sourceMode: "typescript"
      }), "UNSUPPORTED_MODULE_FORM");
    }
  });

  it("accepts every approved built-in and rejects every sampled unapproved built-in", () => {
    for (const specifier of ["node:crypto", "node:fs", "node:path", "node:perf_hooks", "node:url", "node:util"]) {
      assert.doesNotThrow(() => scanToolingSource({ path: "tools/runner.mjs", source: `import ${JSON.stringify(specifier)};\n`, sourceMode: "module" }));
    }
    for (const specifier of ["node:assert", "node:os"]) {
      expectCode(() => scanToolingSource({ path: "tools/runner.mjs", source: `import ${JSON.stringify(specifier)};\n`, sourceMode: "module" }), "BUILTIN_NOT_ALLOWED", specifier);
    }
  });
});
