import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { executeIsolatedScalar, type IsolatedScalarInput, type IsolatedScalarRuntime } from "./isolated-scalar-execution";
import { validateAttestedExecutionResultV2 } from "./verification-execution-v2";

const keys = generateKeyPairSync("ed25519");
const runtime: IsolatedScalarRuntime = { enabled: true, imageDigest: process.env.AGENTPROOF_SCALAR_IMAGE ?? "sha256:" + "a".repeat(64), platform: "linux/arm64", nodeVersion: "v22.23.2", signingPrivateKey: keys.privateKey, publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString() };
function request(source: string, expected: string | number | boolean | null = 42): IsolatedScalarInput {
  return { source, artifactDigest: createHash("sha256").update(source).digest("hex"), headSha: "a".repeat(40), sourceBindingDigest: "b".repeat(64), criterion: { id: "owned_module", adapter: { id: "quickjs_standalone_scalar.v1", modulePath: "owned.mjs", functionName: "target" }, cases: [{ id: "one", expected }] } };
}
describe.skipIf(process.env.AGENTPROOF_SCALAR_OWNED_FIXTURE_TESTS !== "1")("owned native scalar modules", () => {
  it.each([
    ["function target() { return 42; }", 42, "satisfied"],
    ["export function target() { return 42; }", 42, "satisfied"],
    ["export default function target() { return 42; }", 42, "satisfied"],
    ["export function target() { return 41; }", 42, "violated"],
    ["export default function target() { return false; }", true, "violated"],
    ["let ready = 0; ready = 21; export default function target() { return ready * 2; }", 42, "satisfied"],
    ["const moduleThis = this; export function target() { return moduleThis === undefined; }", true, "satisfied"],
    ["function target() { return 42; } export { target as answer };", 42, "satisfied"],
    ["function target() { return 42; } export default target;", 42, "satisfied"]
  ] as const)("evaluates complete source natively: %s", async (source, expected, state) => {
    const result = await executeIsolatedScalar(request(source, expected), runtime);
    expect(result.state, result.reason).toBe(state);
    expect(result.isolation).toMatchObject({ targetUid: 10001, capEff: "0000000000000000", noNewPrivs: "1", parentChannelsBlocked: true });
  }, 20_000);
  it("passes one exact scalar argument to the native module function", async () => {
    const input = request("export default function target(value) { return value; }", "한글\0\ud800");
    input.criterion.cases[0]!.input = "한글\0\ud800";
    expect((await executeIsolatedScalar(input, runtime)).state).toBe("satisfied");
  }, 20_000);
  it("does not let a replaced export binding impersonate its declared function", async () => {
    const result = await executeIsolatedScalar(request("export function target() { return true; } target = Boolean;", false), runtime);
    expect(result.state).toBe("unavailable");
  }, 20_000);
  it.each([
    "import { target } from './other.mjs'; export { target };",
    "export default Boolean;",
    "export { Boolean as target };",
    "export const target = Boolean;",
    "export default function () { return 42; }",
    "export function other() { return 42; }",
    "function target() { return 42; } export { target, target as other };",
    "await Promise.resolve(); export function target() { return 42; }",
    "export async function target() { return 42; }",
    "export function target() { return { toJSON() { return 42; } }; }",
    "export function target() { return process.stdout.write('forged'); }"
  ])("leaves unsupported or non-owned module targets unavailable: %s", async source => {
    expect((await executeIsolatedScalar(request(source), runtime)).state).toBe("unavailable");
  }, 20_000);
  it("binds source/export selection and runtime image into validation", async () => {
    const named = await executeIsolatedScalar(request("export function target() { return 42; }"), runtime);
    const defaultExport = await executeIsolatedScalar(request("export default function target() { return 42; }"), runtime);
    expect(named.state).toBe("satisfied");
    expect(defaultExport.state).toBe("satisfied");
    expect(validateAttestedExecutionResultV2(named.attestedResult, defaultExport.request!, runtime.publicKeyPem).ok).toBe(false);
    const script = request("function target() { return 42; }");
    const oldImage = await executeIsolatedScalar(script, { ...runtime, imageDigest: "sha256:a2734e435f0edd0773fca3dcbe0f5d78f5eb0ccb51e187a30fce6199708183ff" });
    const newImage = await executeIsolatedScalar(script, runtime);
    expect(oldImage.state).toBe("satisfied");
    expect(newImage.state).toBe("satisfied");
    expect(oldImage.request!.bindingDigest).not.toBe(newImage.request!.bindingDigest);
    expect(validateAttestedExecutionResultV2(oldImage.attestedResult, newImage.request!, runtime.publicKeyPem).ok).toBe(false);
  }, 30_000);
});
