import { createHash, randomUUID, type KeyObject } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { parse } from "acorn";
import {
  buildVerificationExecutionRequestV2, evaluateReturnValueCriterionV2,
  signExecutionObservationV2, validateAttestedExecutionResultV2,
  type AttestedVerificationExecutionResultV2, type StandaloneScalarCriterion, type VerificationExecutionRequestV2
} from "./verification-execution-v2";

const DOCKER = "/Applications/Docker.app/Contents/Resources/bin/docker";
const HASH = /^[a-f0-9]{64}$/;
const LIMIT = 64 * 1024;
export interface IsolatedScalarInput {
  source: string;
  artifactDigest: string;
  headSha: string;
  sourceBindingDigest: string;
  criterion: StandaloneScalarCriterion;
}
export interface IsolatedScalarRuntime {
  enabled: boolean;
  imageDigest: string;
  platform: "linux/arm64";
  nodeVersion: "v22.23.2";
  signingPrivateKey: KeyObject;
  publicKeyPem: string;
}
interface Isolation {
  observerUid: number; targetUid: number; targetGid: number;
  capEff: string; capPrm: string; noNewPrivs: string; parentChannelsBlocked: boolean;
}
interface Result {
  state: "satisfied" | "violated" | "unavailable";
  reason?: string;
  evidenceRefs: string[];
  gapKinds: string[];
  request?: VerificationExecutionRequestV2;
  attestedResult?: AttestedVerificationExecutionResultV2;
  isolation?: Isolation;
}
const unavailable = (reason: string): Result => ({ state: "unavailable", reason, evidenceRefs: [], gapKinds: ["evidence_unavailable"] });
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const scalar = (value: unknown): value is string | number | boolean | null => value === null || typeof value === "boolean" ||
  (typeof value === "string" && value.length <= 200) || (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0));

/** Standalone ECMAScript only, not Node compatibility. No product/runtime wiring. */
export async function executeIsolatedScalar(input: IsolatedScalarInput, runtime?: IsolatedScalarRuntime): Promise<Result> {
  if (!runtime?.enabled) return unavailable("disabled");
  input = structuredClone(input);
  runtime = { ...runtime };
  if (!/^sha256:[a-f0-9]{64}$/.test(runtime.imageDigest) || runtime.platform !== "linux/arm64" || runtime.nodeVersion !== "v22.23.2") return unavailable("invalid_runtime");
  if (typeof input.source !== "string" || Buffer.byteLength(input.source) > LIMIT || !HASH.test(input.sourceBindingDigest) ||
    !/^[a-f0-9]{40}$/.test(input.headSha) || !HASH.test(input.artifactDigest) || digest(input.source) !== input.artifactDigest) return unavailable("invalid_binding");
  if (input.source.includes("\0") || Buffer.from(input.source, "utf8").toString("utf8") !== input.source) return unavailable("unsupported_target");
  const { criterion } = input;
  if (criterion.adapter.id !== "quickjs_standalone_scalar.v1" || !/^[A-Za-z_$][\w$]*$/.test(criterion.adapter.functionName) ||
    !/^[\w./-]{1,240}$/.test(criterion.adapter.modulePath) || criterion.adapter.modulePath.split("/").includes("..") ||
    !/^[\w-]{1,80}$/.test(criterion.id) || criterion.cases.length !== 1 || !/^[\w-]{1,80}$/.test(criterion.cases[0]!.id)) return unavailable("unsupported_target");
  const testCase = criterion.cases[0]!;
  if (!scalar(testCase.expected) || (Object.hasOwn(testCase, "input") && !scalar(testCase.input))) return unavailable("unsupported_scalar");
  const selection = selectOwnedTarget(input.source, criterion.adapter.functionName);
  if (!selection) return unavailable("unsupported_target");
  try {
    const observer = await readFile(resolve(process.cwd(), "scripts/trusted-scalar-observer.mjs"), "utf8");
    const bindingDigest = digest(JSON.stringify({
      version: 1, sourceBindingDigest: input.sourceBindingDigest, headSha: input.headSha, artifactDigest: input.artifactDigest,
      criterion, selection, runtime: { imageDigest: runtime.imageDigest, platform: runtime.platform, nodeVersion: runtime.nodeVersion, quickjs: "0.32.0", observerDigest: digest(observer) }
    }));
    const request = buildVerificationExecutionRequestV2(bindingDigest, criterion);
    // Neither expected values nor signing material enter the container.
    const payload = JSON.stringify({ source: input.source, modulePath: criterion.adapter.modulePath, functionName: criterion.adapter.functionName, ...selection,
      hasInput: Object.hasOwn(testCase, "input"), ...(Object.hasOwn(testCase, "input") ? { input: testCase.input } : {}) });
    const packet = await observe(runtime, observer, payload);
    if (!packet || !exact(packet, ["kind", "actual", "isolation", "nodeVersion", "quickjsVersion"]) || packet.kind !== "returned" ||
      !scalar(packet.actual) || packet.nodeVersion !== runtime.nodeVersion || packet.quickjsVersion !== "0.32.0" || !validIsolation(packet.isolation)) return unavailable("observation_unavailable");
    const attestedResult = signExecutionObservationV2({ version: 1, bindingDigest, results: [{ criterionId: criterion.id, adapterId: criterion.adapter.id,
      cases: [{ id: testCase.id, outcome: { kind: "returned", actual: packet.actual } }] }] }, runtime.signingPrivateKey);
    const validated = validateAttestedExecutionResultV2(attestedResult, request, runtime.publicKeyPem);
    if (!validated.ok) return unavailable("attestation_rejected");
    return { ...evaluateReturnValueCriterionV2(criterion, validated.result), request, attestedResult: validated.result, isolation: packet.isolation };
  } catch { return unavailable("executor_unavailable"); }
}

/** Ownership/loader selection only. Source bytes are never stripped or reconstructed. */
function selectOwnedTarget(source: string, target: string): { sourceType: "global" | "module"; exportName?: string } | undefined {
  try {
    let program;
    let sourceType: "global" | "module" = "global";
    try { program = parse(source, { ecmaVersion: "latest", sourceType: "script" }); }
    catch { program = parse(source, { ecmaVersion: "latest", sourceType: "module" }); sourceType = "module"; }
    if (hasModuleDependency(program)) return undefined;
    const declarations = program.body.filter(node => {
      const declaration = node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration" ? node.declaration : node;
      return declaration?.type === "FunctionDeclaration" && declaration.id?.name === target;
    });
    if (declarations.length !== 1) return undefined;
    if (sourceType === "global") return { sourceType };
    const names = program.body.flatMap(node => {
      if (node.type === "ExportDefaultDeclaration") {
        const declaration = node.declaration;
        return (declaration.type === "FunctionDeclaration" && declaration.id?.name === target) || (declaration.type === "Identifier" && declaration.name === target) ? ["default"] : [];
      }
      if (node.type !== "ExportNamedDeclaration") return [];
      if (node.declaration?.type === "FunctionDeclaration" && node.declaration.id?.name === target) return [target];
      return node.specifiers.filter(item => item.local.type === "Identifier" && item.local.name === target).map(item => item.exported.type === "Identifier" ? item.exported.name : String(item.exported.value));
    });
    return names.length === 1 && /^[A-Za-z_$][\w$]*$/.test(names[0]) ? { sourceType, exportName: names[0] } : undefined;
  } catch { return undefined; }
}

function hasModuleDependency(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  if (node.type === "ImportDeclaration" || node.type === "ImportExpression" || node.type === "ExportAllDeclaration" || (node.type === "ExportNamedDeclaration" && node.source)) return true;
  return Object.values(node).some(child => Array.isArray(child) ? child.some(hasModuleDependency) : hasModuleDependency(child));
}

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}
function validIsolation(value: unknown): value is Isolation {
  return exact(value, ["observerUid", "targetUid", "targetGid", "capEff", "capPrm", "noNewPrivs", "parentChannelsBlocked"]) &&
    value.observerUid === 0 && value.targetUid === 10001 && value.targetGid === 10001 && value.capEff === "0000000000000000" &&
    value.capPrm === "0000000000000000" && value.noNewPrivs === "1" && value.parentChannelsBlocked === true;
}
async function observe(runtime: IsolatedScalarRuntime, observer: string, payload: string): Promise<unknown> {
  const name = `agentproof-scalar-${randomUUID()}`;
  const args = ["run", "--rm", "--name", name, "--pull", "never", "--platform", runtime.platform,
    "--network", "none", "--log-driver", "none", "--read-only", "--cap-drop", "ALL", "--cap-add", "SETUID", "--cap-add", "SETGID",
    "--security-opt", "no-new-privileges:true", "--memory", "192m", "--memory-swap", "192m", "--cpus", "0.5",
    "--pids-limit", "16", "--ulimit", "nofile=64:64", "--user", "0:0", "--entrypoint", "node", "-i",
    runtime.imageDigest, "--input-type=module", "-e", observer];
  const result = await new Promise<string | undefined>((resolve) => {
    const child = spawn(DOCKER, args, { shell: false, stdio: ["pipe", "pipe", "pipe"], env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", NODE_ENV: "production" } });
    const output: Buffer[] = [];
    let bytes = 0;
    let failed = false;
    const timer = setTimeout(() => { failed = true; child.kill("SIGKILL"); }, 10_000);
    for (const stream of [child.stdout, child.stderr]) stream.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > LIMIT) { failed = true; child.kill("SIGKILL"); }
      else if (stream === child.stdout) output.push(chunk);
    });
    child.on("error", () => { failed = true; });
    child.stdin.on("error", () => { failed = true; });
    child.on("close", (code) => { clearTimeout(timer); resolve(!failed && code === 0 ? Buffer.concat(output).toString("utf8") : undefined); });
    child.stdin.end(payload);
  });
  // Exact invocation-owned name only; normal --rm exits make this a harmless no-op.
  await new Promise<void>((resolve) => {
    const cleanup = spawn(DOCKER, ["rm", "--force", name], { shell: false, stdio: "ignore", env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", NODE_ENV: "production" } });
    const timer = setTimeout(() => cleanup.kill("SIGKILL"), 3_000);
    cleanup.on("error", () => { clearTimeout(timer); resolve(); });
    cleanup.on("close", () => { clearTimeout(timer); resolve(); });
  });
  try { return result ? JSON.parse(result) : undefined; } catch { return undefined; }
}
