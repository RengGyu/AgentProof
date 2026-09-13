import { createHash, generateKeyPairSync } from "node:crypto";
import { expect, it, vi } from "vitest";
import { executeIsolatedScalar } from "./isolated-scalar-execution";

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  const { PassThrough } = await import("node:stream");
  return { spawn: (_command: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    if (args[0] === "rm") queueMicrotask(() => child.emit("close", 0));
    else child.stdin.on("finish", () => {
      const bytes = Buffer.from(JSON.stringify({ kind: "returned", actual: "한글😀", nodeVersion: "v22.23.2", quickjsVersion: "0.32.0",
        isolation: { observerUid: 0, targetUid: 10001, targetGid: 10001, capEff: "0000000000000000", capPrm: "0000000000000000", noNewPrivs: "1", parentChannelsBlocked: true } }));
      // Deterministically split every UTF-8 multibyte sequence across chunks.
      for (let index = 0; index < bytes.length; index++) child.stdout.emit("data", bytes.subarray(index, index + 1));
      child.emit("close", 0);
    });
    return child;
  } };
});

it("preserves a scalar when UTF-8 output is split at every byte boundary", async () => {
  const keys = generateKeyPairSync("ed25519");
  const source = "function target() { return '한글😀'; }";
  const result = await executeIsolatedScalar({ source, artifactDigest: createHash("sha256").update(source).digest("hex"), headSha: "b".repeat(40), sourceBindingDigest: "c".repeat(64),
    criterion: { id: "unicode", adapter: { id: "quickjs_standalone_scalar.v1", modulePath: "owned.js", functionName: "target" }, cases: [{ id: "one", expected: "한글😀" }] } },
  { enabled: true, imageDigest: "sha256:" + "a".repeat(64), platform: "linux/arm64", nodeVersion: "v22.23.2", signingPrivateKey: keys.privateKey,
    publicKeyPem: keys.publicKey.export({ format: "pem", type: "spki" }).toString() });
  expect(result.state).toBe("satisfied");
});
