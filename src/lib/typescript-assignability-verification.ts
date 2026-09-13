import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { buildGeneralPrObservationSeedV2, type GeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import { selectCanonicalSelectedSourceBundle } from "./extractors";
import { buildGeneralPrRedactedSourceViewsV1 } from "./general-pr-semantic-selection";
import type { PullRequestInput } from "./types";
import type { TypeScriptUnionPrimitive } from "./typescript-union-verification";
import type { OrdinaryDocumentationBlob } from "./general-pr-documentation";

export interface TypeScriptProjectSnapshot {
  headSha: string;
  treeSha: string;
  inventory: { paths: string[]; complete: boolean };
  blobs: OrdinaryDocumentationBlob[];
}
export interface OrdinaryAssignabilityPlan {
  requirementId: string;
  seedHash: string;
  headSha: string;
  path: string | null;
  typeName: string;
  primitive: TypeScriptUnionPrimitive;
}
export type TypeScriptProjectCollector = (headSha: string) => Promise<TypeScriptProjectSnapshot | null>;
interface Observation {
  state: "satisfied" | "violated" | "unavailable";
  path: string | null;
  configPath: string | null;
  compilerVersion: string;
  compilerDigest: string | null;
}
export interface OrdinaryAssignabilityResult extends Observation {
  projectDigest: string | null;
  validate(input: PullRequestInput): boolean;
}
const plans = new WeakSet<object>();
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export const safeTypeScriptProjectPath = (path: string) => typeof path === "string" && path.length <= 200 && /^(?:[A-Za-z0-9_@.-]+\/)*[A-Za-z0-9_@.-]+$/.test(path) && path.split("/").every(part => part !== "." && part !== "..");
export const isTypeScriptProjectFile = (path: string) => /\.(?:[cm]?[jt]s|[jt]sx)$/.test(path) || /(?:^|\/)(?:tsconfig|package)\.json$/.test(path);

export function compileOrdinaryAssignabilityPlans(input: PullRequestInput, seed: GeneralPrObservationSeedV2): OrdinaryAssignabilityPlan[] {
  if (input.repositoryPrivate !== false || input.sourceProvenance?.origin !== "github_snapshot" || seed.parseState !== "complete" || !/^[a-f0-9]{40}$/i.test(seed.headSha ?? "") || buildGeneralPrObservationSeedV2(input).seedHash !== seed.seedHash) return [];
  const canonical = selectCanonicalSelectedSourceBundle(input);
  const views = buildGeneralPrRedactedSourceViewsV1(input, seed);
  const kind = input.taskText.trim() ? (input.taskSource === "issue" ? "linked_issue" : "provided_requirement") : "pr_body";
  return seed.spans.flatMap(span => {
    const source = seed.sources.find(item => item.id === span.sourceUnitId);
    if (!views || !source || source.kind !== kind || source.roleCeiling !== "objective" || source.admissionTier === "context") return [];
    const ids = [...canonical.structureByRequirementId].filter(([, item]) => item.start === span.start && item.end === span.end).map(([id]) => id);
    if (ids.length !== 1) return [];
    const match = /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?)?(?:[Tt]he )?[Tt]ype `([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)`(?: in `((?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:ts|tsx|mts|cts))`)? must support `(string|number|boolean|bigint|symbol|undefined|null)`\.?$/.exec(views.get(source.id)!.slice(span.start, span.end).trim());
    if (!match || match[1].length > 200 || (match[2] && !safeTypeScriptProjectPath(match[2]))) return [];
    const plan = Object.freeze({ requirementId: ids[0], seedHash: seed.seedHash, headSha: seed.headSha!, path: match[2] ?? null, typeName: match[1], primitive: match[3] as TypeScriptUnionPrimitive });
    plans.add(plan);
    return [plan];
  }).slice(0, 8);
}

/** Complete bounded snapshot only; raw inputs live only for this invocation. */
export async function evaluateOrdinaryAssignabilityPlans(targets: readonly OrdinaryAssignabilityPlan[], snapshot: TypeScriptProjectSnapshot | null): Promise<OrdinaryAssignabilityResult[]> {
  let observations: Observation[] = targets.map(() => ({ state: "unavailable", path: null, configPath: null, compilerVersion: "5.9.3", compilerDigest: null }));
  let projectDigest: string | null = null;
  if (targets.length && targets.length <= 8 && targets.every(plan => plans.has(plan)) && validSnapshot(snapshot, targets[0].headSha) && targets.every(plan => plan.headSha === snapshot.headSha)) {
    const serialized = JSON.stringify({ snapshot, targets });
    const result = await runChecker(serialized);
    if (Array.isArray(result) && result.length === targets.length && result.every(item => item && ["satisfied", "violated", "unavailable"].includes(item.state) && item.compilerVersion === "5.9.3" && /^[a-f0-9]{64}$/.test(item.compilerDigest ?? "") && (item.path === null || safeTypeScriptProjectPath(item.path)) && (item.configPath === null || safeTypeScriptProjectPath(item.configPath)) && (item.state === "unavailable" || (item.path && item.configPath)))) {
      observations = result;
      projectDigest = hash(JSON.stringify({ request: serialized, observations }));
    }
  }
  return targets.map((plan, index) => Object.freeze({ ...observations[index], projectDigest, validate: (input: PullRequestInput) => plans.has(plan) && input.repositoryPrivate === false && input.sourceProvenance?.origin === "github_snapshot" && input.sourceProvenance.headSha === plan.headSha && buildGeneralPrObservationSeedV2(input).seedHash === plan.seedHash }));
}

function validSnapshot(value: TypeScriptProjectSnapshot | null, headSha: string): value is TypeScriptProjectSnapshot {
  if (!value || value.headSha !== headSha || !/^[a-f0-9]{40}$/i.test(value.treeSha) || value.inventory?.complete !== true || !Array.isArray(value.inventory.paths) || value.inventory.paths.length > 20000 || value.inventory.paths.some(path => !safeTypeScriptProjectPath(path)) || new Set(value.inventory.paths).size !== value.inventory.paths.length || !Array.isArray(value.blobs) || value.blobs.length > 64) return false;
  if (value.blobs.some(blob => !blob || !safeTypeScriptProjectPath(blob.path))) return false;
  const needed = value.inventory.paths.filter(isTypeScriptProjectFile);
  return needed.every(path => value.blobs.some(blob => blob.path === path)) && new Set(value.blobs.map(blob => blob.path)).size === value.blobs.length && value.blobs.every(blob => value.inventory.paths.includes(blob.path) && (isTypeScriptProjectFile(blob.path) || blob.path.endsWith(".json")) && blob.headSha === headSha && typeof blob.content === "string" && Buffer.byteLength(blob.content) <= 65536) && value.blobs.reduce((sum, blob) => sum + Buffer.byteLength(blob.content), 0) <= 4 * 1024 * 1024;
}
function runChecker(request: string): Promise<Observation[] | null> {
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["--max-old-space-size=256", join(process.cwd(), "scripts/trusted-typescript-assignability.mjs")], { env: { NODE_ENV: "production", LANG: "C", TZ: "UTC" }, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let bytes = 0;
    let done = false;
    const finish = (value: Observation[] | null) => { if (!done) { done = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => { child.kill("SIGKILL"); finish(null); }, 10000);
    child.on("error", () => finish(null));
    child.stdin.on("error", () => finish(null));
    child.stdout.on("data", chunk => { bytes += chunk.length; if (bytes > 16384) { child.kill("SIGKILL"); finish(null); } else output += chunk.toString(); });
    child.stderr.on("data", chunk => { bytes += chunk.length; if (bytes > 16384) { child.kill("SIGKILL"); finish(null); } });
    child.on("close", code => { try { finish(code === 0 ? JSON.parse(output) : null); } catch { finish(null); } });
    child.stdin.end(request);
  });
}
