import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveToolingModuleEdges } from "./tooling-module-resolution.mjs";

function withTree(run) {
  const root = mkdtempSync(join(tmpdir(), "agentproof-toolchain-resolution-"));
  try {
    mkdirSync(join(root, "tools", "dir"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "tools", "runner.ts"), "export {};\n");
    writeFileSync(join(root, "tools", "helper.ts"), "export {};\n");
    writeFileSync(join(root, "tools", "hidden.ts"), "export {};\n");
    writeFileSync(join(root, "tools", "dir", "index.ts"), "export {};\n");
    writeFileSync(join(root, "tools", "runner.mjs"), "export {};\n");
    writeFileSync(join(root, "tools", "helper.mjs"), "export {};\n");
    writeFileSync(join(root, "src", "verifier.ts"), "export {};\n");
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function baseInput(root, moduleEdges) {
  return {
    rootDir: root,
    moduleEdges,
    toolingFiles: ["tools/helper.ts", "tools/runner.ts"],
    sutExternalImports: ["src/verifier.ts"]
  };
}

describe("tooling-module-resolution", () => {
  it("binds declared TypeScript, SUT, built-in, and parser targets", () => withTree((root) => {
    assert.deepEqual(resolveToolingModuleEdges(baseInput(root, [
      { importerPath: "tools/runner.ts", kind: "runtime_import", specifier: "./helper" },
      { importerPath: "tools/runner.ts", kind: "runtime_import", specifier: "crypto" },
      { importerPath: "tools/runner.ts", kind: "type_import", specifier: "../src/verifier" },
      { importerPath: "tools/runner.ts", kind: "type_import", specifier: "typescript" }
    ])), [
      { importerPath: "tools/runner.ts", kind: "runtime_import", specifier: "./helper", targetKind: "tooling", targetRef: "tools/helper.ts" },
      { importerPath: "tools/runner.ts", kind: "runtime_import", specifier: "crypto", targetKind: "node_builtin", targetRef: "node:crypto" },
      { importerPath: "tools/runner.ts", kind: "type_import", specifier: "../src/verifier", targetKind: "sut_external", targetRef: "src/verifier.ts" },
      { importerPath: "tools/runner.ts", kind: "type_import", specifier: "typescript", targetKind: "parser_artifact", targetRef: "typescript" }
    ]);
  }));

  it("permits explicit .mjs targets only", () => withTree((root) => {
    assert.deepEqual(resolveToolingModuleEdges({
      rootDir: root,
      moduleEdges: [{ importerPath: "tools/runner.mjs", kind: "runtime_import", specifier: "./helper.mjs" }],
      toolingFiles: ["tools/helper.mjs", "tools/runner.mjs"],
      sutExternalImports: []
    }), [{
      importerPath: "tools/runner.mjs",
      kind: "runtime_import",
      specifier: "./helper.mjs",
      targetKind: "tooling",
      targetRef: "tools/helper.mjs"
    }]);
  }));

  it("fails closed for unbound or non-static targets", () => withTree((root) => {
    const cases = [
      [baseInput(root, [{ importerPath: "tools/runner.ts", kind: "runtime_import", specifier: "./missing" }]), "MODULE_RESOLUTION_FAILED"],
      [baseInput(root, [{ importerPath: "tools/runner.ts", kind: "runtime_import", specifier: "../../outside" }]), "MODULE_OUTSIDE_CLOSURE"],
      [baseInput(root, [{ importerPath: "tools/runner.ts", kind: "runtime_import", specifier: "unapproved-package" }]), "MODULE_RESOLUTION_FAILED"],
      [baseInput(root, [{ importerPath: "tools/runner.ts", kind: "runtime_import", specifier: "node:os" }]), "BUILTIN_NOT_ALLOWED"],
      [baseInput(root, [{ importerPath: "tools/runner.ts", kind: "runtime_import", specifier: "https://example.test/tool" }]), "MODULE_RESOLUTION_FAILED"],
      [{
        rootDir: root,
        moduleEdges: [{ importerPath: "tools/runner.mjs", kind: "runtime_import", specifier: "./helper" }],
        toolingFiles: ["tools/helper.mjs", "tools/runner.mjs"],
        sutExternalImports: []
      }, "MODULE_RESOLUTION_FAILED"],
      [baseInput(root, [{ importerPath: "tools/runner.ts", kind: "runtime_import", specifier: "./dir" }]), "MODULE_RESOLUTION_FAILED"],
      [baseInput(root, [{ importerPath: "tools/runner.ts", kind: "runtime_import", specifier: "./hidden" }]), "MODULE_RESOLUTION_FAILED"]
    ];
    for (const [input, code] of cases) {
      assert.throws(() => resolveToolingModuleEdges(input), (error) => error?.code === code);
    }
  }));

  it("returns each edge once for a resolved cycle", () => withTree((root) => {
    writeFileSync(join(root, "tools", "a.ts"), "export {};\n");
    writeFileSync(join(root, "tools", "b.ts"), "export {};\n");
    assert.deepEqual(resolveToolingModuleEdges({
      rootDir: root,
      moduleEdges: [
        { importerPath: "tools/a.ts", kind: "runtime_import", specifier: "./b" },
        { importerPath: "tools/b.ts", kind: "runtime_import", specifier: "./a" },
        { importerPath: "tools/a.ts", kind: "runtime_import", specifier: "./b" }
      ],
      toolingFiles: ["tools/a.ts", "tools/b.ts"],
      sutExternalImports: []
    }), [
      { importerPath: "tools/a.ts", kind: "runtime_import", specifier: "./b", targetKind: "tooling", targetRef: "tools/b.ts" },
      { importerPath: "tools/b.ts", kind: "runtime_import", specifier: "./a", targetKind: "tooling", targetRef: "tools/a.ts" }
    ]);
  }));
});
