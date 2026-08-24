import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FROZEN_TOOLING_RESOLUTION_POLICY_V1,
  ToolchainClosureError,
  normalizeNodeBuiltinSpecifier,
  toolchainFailure
} from "./toolchain-closure-policy.mjs";

describe("toolchain-closure-policy", () => {
  it("normalizes only the approved Node built-in spellings", () => {
    assert.equal(normalizeNodeBuiltinSpecifier("crypto"), "node:crypto");
    assert.equal(normalizeNodeBuiltinSpecifier("node:crypto"), "node:crypto");
    assert.equal(normalizeNodeBuiltinSpecifier("node:os"), null);
    assert.equal(normalizeNodeBuiltinSpecifier("typescript"), null);
    assert.equal(normalizeNodeBuiltinSpecifier("constructor"), null);
    assert.equal(normalizeNodeBuiltinSpecifier("toString"), null);
    assert.equal(normalizeNodeBuiltinSpecifier("__proto__"), null);
  });

  it("returns a bounded failure envelope without the thrown message", () => {
    const typedError = new ToolchainClosureError(
      "UNSUPPORTED_MODULE_FORM",
      "runtime export details must stay private"
    );
    const failure = toolchainFailure(typedError);

    assert.deepEqual(failure, {
      version: 1,
      ok: false,
      errorCode: "UNSUPPORTED_MODULE_FORM"
    });
    assert.equal(JSON.stringify(failure).includes("runtime export details"), false);
    assert.equal(typedError.message, "");
    assert.equal(typedError.stack?.includes("runtime export details"), false);
  });

  it("keeps resolution independent from repository tsconfig", () => {
    assert.deepEqual(FROZEN_TOOLING_RESOLUTION_POLICY_V1, {
      version: 1,
      module: "ESNext",
      moduleResolution: "Bundler",
      target: "ES2024",
      resolveJsonModule: true,
      allowJs: false,
      noLib: true,
      types: [],
      baseUrl: null,
      paths: null,
      rootDirs: null,
      typeRoots: null,
      customConditions: []
    });
  });
});
