import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { executeIsolatedScalar, type IsolatedScalarInput, type IsolatedScalarRuntime } from "./isolated-scalar-execution";
import { validateAttestedExecutionResultV2 } from "./verification-execution-v2";

const keys = generateKeyPairSync("ed25519");
const runtime: IsolatedScalarRuntime = {
  enabled: true,
  imageDigest: process.env.AGENTPROOF_SCALAR_IMAGE ?? "sha256:" + "a".repeat(64),
  platform: "linux/arm64",
  nodeVersion: "v22.23.2",
  signingPrivateKey: keys.privateKey,
  publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString()
};
function input(source = "function target() { return 42; }", expected: string | number | boolean | null = 42): IsolatedScalarInput {
  return {
    source, artifactDigest: createHash("sha256").update(source).digest("hex"),
    headSha: "b".repeat(40), sourceBindingDigest: "c".repeat(64),
    criterion: { id: "owned_scalar", adapter: { id: "quickjs_standalone_scalar.v1", modulePath: "owned.js", functionName: "target" }, cases: [{ id: "one", expected }] }
  };
}

describe("isolated scalar preflight", () => {
  it("is disabled by default", async () => {
    expect((await executeIsolatedScalar(input())).reason).toBe("disabled");
  });
  it("rejects mismatched source bytes before invoking Docker", async () => {
    expect((await executeIsolatedScalar({ ...input(), source: "function target() { return 0; }" }, runtime)).reason).toBe("invalid_binding");
  });
  it("rejects built-in globals not declared by the supplied artifact", async () => {
    const request = input("const unrelated = 1;");
    request.criterion.adapter.functionName = "parseInt";
    expect((await executeIsolatedScalar(request, runtime)).reason).toBe("unsupported_target");
  });
  it.each([-0, Infinity, NaN, "x".repeat(201)])("rejects lossy or oversized scalar %s", async (expected) => {
    expect((await executeIsolatedScalar(input(undefined, expected), runtime)).reason).toBe("unsupported_scalar");
  });
  it.each(["function target() { return 'a\0b'; }", "function target() { return '\ud800'; }"])("rejects unsupported source encoding before execution", async (source) => {
    expect((await executeIsolatedScalar(input(source), runtime)).reason).toBe("unsupported_target");
  });
});

describe.skipIf(process.env.AGENTPROOF_SCALAR_OWNED_FIXTURE_TESTS !== "1")("owned isolated scalar fixtures", () => {
  it.each([
    ["function target() { return 42; }", 42, "satisfied"],
    ["function target() { return false; }", true, "violated"],
    ["const base = 21; function target() { return base * 2; }", 42, "satisfied"],
    ["function target() { return '{\"actual\":true}'; }", '{"actual":true}', "satisfied"],
    ["JSON.stringify = () => 'forged'; function target() { return false; }", true, "violated"],
    ["function target() { return 'a\\0b'; }", "a\0b", "satisfied"],
    ["function target() { return '\\ud800'; }", "\ud800", "satisfied"],
    ["String.prototype.charCodeAt = () => 65; function target() { return 'actual'; }", "actual", "satisfied"],
    ["function target() { return [typeof process, typeof require, typeof console, typeof fetch].join(','); }", "undefined,undefined,undefined,undefined", "satisfied"],
    ["function target() { return Function('return typeof process')(); }", "undefined", "satisfied"]
  ] as const)("observes %s", async (source, expected, state) => {
    const result = await executeIsolatedScalar(input(source, expected), runtime);
    expect(result.state, result.reason).toBe(state);
    expect(result.isolation).toMatchObject({ observerUid: 0, targetUid: 10001, targetGid: 10001, capEff: "0000000000000000", capPrm: "0000000000000000", noNewPrivs: "1", parentChannelsBlocked: true });
    expect(validateAttestedExecutionResultV2(result.attestedResult, result.request!, runtime.publicKeyPem).ok).toBe(true);
    expect(validateAttestedExecutionResultV2(result.attestedResult, { ...result.request!, bindingDigest: "d".repeat(64) }, runtime.publicKeyPem).ok).toBe(false);
  }, 20_000);
  it("passes one scalar argument", async () => {
    const request = input("function target(x) { return x + 1; }", 42);
    request.criterion.cases[0]!.input = 41;
    expect((await executeIsolatedScalar(request, runtime)).state).toBe("satisfied");
  }, 20_000);
  it.each(["a\0b", "\ud800", "한글😀"])("preserves scalar input code units %s", async (value) => {
    const request = input("function target(x) { return x; }", value);
    request.criterion.cases[0]!.input = value;
    expect((await executeIsolatedScalar(request, runtime)).state).toBe("satisfied");
  }, 20_000);
  it("rejects a mismatched signing public key before comparison", async () => {
    const wrongKey = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
    expect((await executeIsolatedScalar(input(), { ...runtime, publicKeyPem: wrongKey })).reason).toBe("attestation_rejected");
  }, 20_000);
  it("binds the invocation snapshot despite caller mutation during execution", async () => {
    const request = input();
    const pending = executeIsolatedScalar(request, runtime);
    request.criterion.cases[0]!.expected = false;
    expect((await pending).state).toBe("satisfied");
  }, 20_000);
  it.each([
    "function target() { process.stdout.write('{\"actual\":42}'); return 42; }",
    "function target() { return require('fs').readFileSync('/proc/1/fd/1'); }",
    "function target() { return Function('return process')().exit(); }",
    "async function target() { return 42; }",
    "import fs from 'fs'; function target() { return 42; }",
    "function target() { while (true) {} }",
    "function target() { return { valueOf() { return 42; }, toJSON() { return 42; } }; }",
    "function target() { return -0; }",
    "function target() { return NaN; }",
    "function target() { return Infinity; }",
    "function target() { return 'x'.repeat(201); }",
    "function target() { const a = []; while (true) a.push('x'.repeat(100000)); }"
  ])("fails closed for %s", async (source) => {
    expect((await executeIsolatedScalar(input(source), runtime)).state).toBe("unavailable");
  }, 20_000);
});
