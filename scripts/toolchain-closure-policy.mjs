export const TOOLCHAIN_POLICY_ID = "restricted_static_toolchain.v1";

export const APPROVED_NODE_BUILTINS_V1 = Object.freeze([
  "node:crypto",
  "node:fs",
  "node:path",
  "node:perf_hooks",
  "node:url",
  "node:util"
]);

export const LEGACY_NODE_BUILTIN_ALIASES_V1 = Object.freeze(Object.assign(Object.create(null), {
  crypto: "node:crypto",
  fs: "node:fs",
  path: "node:path",
  perf_hooks: "node:perf_hooks",
  url: "node:url",
  util: "node:util"
}));

export const FROZEN_TOOLING_RESOLUTION_POLICY_V1 = Object.freeze({
  version: 1,
  module: "ESNext",
  moduleResolution: "Bundler",
  target: "ES2024",
  resolveJsonModule: true,
  allowJs: false,
  noLib: true,
  types: Object.freeze([]),
  baseUrl: null,
  paths: null,
  rootDirs: null,
  typeRoots: null,
  customConditions: Object.freeze([])
});

export const TOOLCHAIN_CLOSURE_ERROR_CODES = Object.freeze([
  "TOOLCHAIN_INVENTORY_INCOMPLETE",
  "UNSUPPORTED_TOOLING_SOURCE",
  "TOOLING_SOURCE_INVALID",
  "UNSUPPORTED_MODULE_FORM",
  "MODULE_RESOLUTION_FAILED",
  "MODULE_OUTSIDE_CLOSURE",
  "BUILTIN_NOT_ALLOWED",
  "PARSER_BINDING_INVALID",
  "MANIFEST_BINDING_INVALID",
  "SANDBOX_EVIDENCE_INCOMPLETE"
]);

const ERROR_CODES = new Set(TOOLCHAIN_CLOSURE_ERROR_CODES);

export class ToolchainClosureError extends Error {
  constructor(code) {
    if (!ERROR_CODES.has(code)) throw new TypeError("toolchain closure error code is invalid");
    super();
    this.name = "ToolchainClosureError";
    this.code = code;
  }
}

export function normalizeNodeBuiltinSpecifier(specifier) {
  if (APPROVED_NODE_BUILTINS_V1.includes(specifier)) return specifier;
  return typeof specifier === "string" && Object.hasOwn(LEGACY_NODE_BUILTIN_ALIASES_V1, specifier)
    ? LEGACY_NODE_BUILTIN_ALIASES_V1[specifier]
    : null;
}

export function toolchainFailure(error) {
  return {
    version: 1,
    ok: false,
    errorCode: error instanceof ToolchainClosureError
      ? error.code
      : "MANIFEST_BINDING_INVALID"
  };
}
