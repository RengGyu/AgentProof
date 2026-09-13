import type { PullRequestInput } from "./types";
import { createHash, generateKeyPairSync } from "node:crypto";
import { parseExpressionAt } from "acorn";
import { buildGeneralPrObservationSeedV2, type GeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import { selectCanonicalSelectedSourceBundle } from "./extractors";
import { buildGeneralPrRedactedSourceViewsV1 } from "./general-pr-semantic-selection";
import { executeIsolatedScalar, type IsolatedScalarRuntime } from "./isolated-scalar-execution";
import { evaluateReturnValueCriterionV2, validateAttestedExecutionResultV2, type StandaloneScalarCriterion } from "./verification-execution-v2";
import type { OrdinaryDocumentationBlob } from "./general-pr-documentation";

interface OrdinaryScalarPlan {
  requirementId: string;
  path: string;
  headSha: string;
  seedHash: string;
  sourceBindingDigest: string;
  criterion: StandaloneScalarCriterion;
}
interface OrdinaryScalarResult {
  state: "satisfied" | "violated" | "unavailable";
  artifactDigest: string | null;
  validate: (input: PullRequestInput) => boolean;
}
const registered = new WeakSet<object>();
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

/** Whole explicit source only; semantic token proposals are not authority. */
export function compileOrdinaryScalarPlans(input: PullRequestInput, seed: GeneralPrObservationSeedV2): OrdinaryScalarPlan[] {
  if (input.repositoryPrivate !== false || input.sourceProvenance?.origin !== "github_snapshot" || seed.parseState !== "complete" ||
    !/^[a-f0-9]{40}$/i.test(seed.headSha ?? "") || buildGeneralPrObservationSeedV2(input).seedHash !== seed.seedHash) return [];
  const canonical = selectCanonicalSelectedSourceBundle(input);
  const views = buildGeneralPrRedactedSourceViewsV1(input, seed);
  const selectedKind = input.taskText.trim() ? (input.taskSource === "issue" ? "linked_issue" : "provided_requirement") : "pr_body";
  return seed.spans.flatMap(span => {
    const source = seed.sources.find(source => source.id === span.sourceUnitId);
    if (!views || !source || source.kind !== selectedKind || source.roleCeiling !== "objective" || source.admissionTier === "context") return [];
    const ids = [...canonical.structureByRequirementId].filter(([, structure]) => structure.start === span.start && structure.end === span.end).map(([id]) => id);
    if (ids.length !== 1) return [];
    const text = views.get(source.id)!.slice(span.start, span.end).trim();
    const match = /^(?:[-*+]\s+(?:\[[ xX]\]\s+)?)?(?:[Tt]he )?[Ff]unction `([A-Za-z_$][A-Za-z0-9_$]*)` in `((?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:js|mjs|cjs))` must return `([^`\r\n]+)` when called(?: with no arguments| without arguments| with `([^`\r\n]+)`)?\.?$/.exec(text);
    if (!match || match[2].length > 200 || match[2].split("/").some(part => part === "." || part === "..") || /\[REDACTED/i.test(text)) return [];
    const expected = parseScalar(match[3]);
    const argument = match[4] === undefined ? undefined : parseScalar(match[4]);
    if (!expected || (match[4] !== undefined && !argument)) return [];
    const criterion: StandaloneScalarCriterion = { id: `${ids[0]}_c1`, adapter: { id: "quickjs_standalone_scalar.v1", modulePath: match[2], functionName: match[1] }, cases: [{ id: "one", expected: expected.value, ...(argument ? { input: argument.value } : {}) }] };
    Object.freeze(criterion.adapter); Object.freeze(criterion.cases[0]); Object.freeze(criterion.cases); Object.freeze(criterion);
    const plan = Object.freeze({ requirementId: ids[0], path: match[2], headSha: seed.headSha!, seedHash: seed.seedHash,
      sourceBindingDigest: hash(JSON.stringify({ seedHash: seed.seedHash, sourceDigest: source.rawSourceDigest, spanId: span.id, requirementId: ids[0], criterion })), criterion });
    registered.add(plan);
    return [plan];
  }).slice(0, 8);
}

function parseScalar(text: string): { value: string | number | boolean | null } | undefined {
  try {
    const node = parseExpressionAt(text, 0, { ecmaVersion: "latest" });
    if (node.start !== 0 || node.end !== text.length) return undefined;
    const value = node.type === "Literal" ? node.value : node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "Literal" && typeof node.argument.value === "number" ? -node.argument.value : undefined;
    return value === null || typeof value === "boolean" || (typeof value === "string" && value.length <= 200) ||
      (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) ? { value } : undefined;
  } catch { return undefined; }
}

/** Server-only exact opt-in. Signing keys are ephemeral and never serialized. */
export function readOrdinaryScalarRuntime(): IsolatedScalarRuntime | undefined {
  if (process.env.AGENTPROOF_ORDINARY_SCALAR_EXECUTION !== "enabled" || !/^sha256:[a-f0-9]{64}$/.test(process.env.AGENTPROOF_SCALAR_IMAGE ?? "")) return undefined;
  const keys = generateKeyPairSync("ed25519");
  return { enabled: true, imageDigest: process.env.AGENTPROOF_SCALAR_IMAGE!, platform: "linux/arm64", nodeVersion: "v22.23.2", signingPrivateKey: keys.privateKey,
    publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }).toString() };
}

/** Capture validated observations once; validation never reruns repository code. */
export async function evaluateOrdinaryScalarPlan(plan: OrdinaryScalarPlan, blobs: readonly OrdinaryDocumentationBlob[], runtime?: IsolatedScalarRuntime): Promise<OrdinaryScalarResult> {
  const validSource = (input: PullRequestInput) => registered.has(plan) && input.repositoryPrivate === false && input.sourceProvenance?.origin === "github_snapshot" &&
    input.sourceProvenance.headSha === plan.headSha && buildGeneralPrObservationSeedV2(input).seedHash === plan.seedHash;
  const unavailable = (): OrdinaryScalarResult => Object.freeze({ state: "unavailable", artifactDigest: null, validate: validSource });
  if (!runtime || !registered.has(plan)) return unavailable();
  const matching = blobs.filter(blob => blob.path === plan.path);
  if (matching.length !== 1 || matching[0].headSha !== plan.headSha || typeof matching[0].content !== "string" || Buffer.byteLength(matching[0].content) > 64 * 1024) return unavailable();
  const artifactDigest = hash(matching[0].content);
  const observed = await executeIsolatedScalar({ source: matching[0].content, artifactDigest, headSha: plan.headSha, sourceBindingDigest: plan.sourceBindingDigest, criterion: plan.criterion }, runtime);
  if (!observed.request || !observed.attestedResult) return unavailable();
  const request = structuredClone(observed.request);
  const attested = structuredClone(observed.attestedResult);
  const publicKeyPem = runtime.publicKeyPem;
  const validated = validateAttestedExecutionResultV2(attested, request, publicKeyPem);
  if (!validated.ok) return unavailable();
  const state = evaluateReturnValueCriterionV2(plan.criterion, validated.result).state;
  // These closed-over packets never enter the report and are not exposed to callers.
  return Object.freeze({ state, artifactDigest, validate: (input: PullRequestInput) => validSource(input) &&
    validateAttestedExecutionResultV2(attested, request, publicKeyPem).ok && evaluateReturnValueCriterionV2(plan.criterion, attested).state === state });
}
