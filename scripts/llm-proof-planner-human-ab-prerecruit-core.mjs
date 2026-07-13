import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
  HUMAN_AB_V2_HOLDOUT_RECEIPT_VERSION,
  HUMAN_AB_V2_PREFLIGHT_VERSION,
  HUMAN_AB_V2_PROTOCOL_VERSION,
  buildAssignmentPreflightV2,
  buildFreezeManifestV2,
  sha256,
  stableJson,
  validateAssignmentPlanV2,
  validateHoldoutReceiptV2
} from "./llm-proof-planner-human-ab-v2-core.mjs";

export const HOLDOUT_POLICY_VERSION = "agentproof-sealed-holdout-selection-policy.v1";
export const HOLDOUT_PRIVATE_MANIFEST_VERSION = "agentproof-sealed-holdout-private-manifest.v1";
export const HOLDOUT_EXCLUSION_REGISTRY_VERSION = "agentproof-sealed-holdout-exclusion-registry.v1";
export const HOLDOUT_SEAL_RECEIPT_VERSION = HUMAN_AB_V2_HOLDOUT_RECEIPT_VERSION;
export const ASSIGNMENT_RANDOMIZATION_RECEIPT_VERSION = "agentproof-human-ab-assignment-randomization.v1";
export const HUMAN_AB_V2_LABEL_HEADERS = Object.freeze([
  "protocolVersion", "experimentId", "sealedHoldoutReceiptSha256", "assignmentPlanSha256", "assignmentPreflightSha256", "raterPacketSha256", "raterWorkbookSha256", "assignmentId", "raterPseudonym", "opaqueCaseId", "blindedArmId", "assignmentIndex", "reviewDecision", "requirementAccuracy", "requirementEvidenceNote", "proofPlanUsefulness", "proofPlanEvidenceNote", "warningAccuracy", "warningEvidenceNote", "reviewDecisionTimeSeconds", "notScorableReason", "startedAt", "submittedAt", "timingIntegrity", "rowSha256"
]);

const SHA = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const ID = /^[a-z0-9][a-z0-9._:-]{0,119}$/;

export function validateHoldoutSelectionPolicy(policy) {
  const errors = [];
  exactKeys(policy, ["policyVersion", "policyId", "experimentId", "sourceCommit", "discoveryCutoff", "samplingUnit", "strata", "requiredExclusionSets", "replacementRule"] , errors, "policy");
  if (policy?.policyVersion !== HOLDOUT_POLICY_VERSION) errors.push("policyVersion is invalid.");
  for (const key of ["policyId", "experimentId"]) if (!validId(policy?.[key])) errors.push(`policy.${key} is invalid.`);
  if (!COMMIT.test(policy?.sourceCommit ?? "")) errors.push("policy.sourceCommit is invalid.");
  if (!validIso(policy?.discoveryCutoff)) errors.push("policy.discoveryCutoff is invalid.");
  if (policy?.samplingUnit !== "pull_request_head") errors.push("policy.samplingUnit must be pull_request_head.");
  if (policy?.replacementRule !== "pre_output_unavailable_only") errors.push("policy.replacementRule is invalid.");
  if (!Array.isArray(policy?.requiredExclusionSets) || policy.requiredExclusionSets.length < 3 || new Set(policy.requiredExclusionSets).size !== policy.requiredExclusionSets.length || policy.requiredExclusionSets.some((value) => !validId(value))) errors.push("policy.requiredExclusionSets is invalid.");
  if (!Array.isArray(policy?.strata) || policy.strata.length === 0 || policy.strata.length > 20) errors.push("policy.strata is invalid.");
  const strata = new Set();
  for (const [index, stratum] of (policy?.strata ?? []).entries()) {
    exactKeys(stratum, ["stratumId", "quota"], errors, `policy.strata[${index}]`);
    if (!validId(stratum?.stratumId) || strata.has(stratum.stratumId)) errors.push(`policy.strata[${index}].stratumId is invalid or duplicated.`);
    strata.add(stratum?.stratumId);
    if (!Number.isInteger(stratum?.quota) || stratum.quota < 1 || stratum.quota > 100) errors.push(`policy.strata[${index}].quota is invalid.`);
  }
  return { valid: errors.length === 0, errors };
}

export function validateHoldoutExclusionRegistry(registry, policy) {
  const errors = [];
  exactKeys(registry, ["registryVersion", "policyId", "sets"], errors, "exclusionRegistry");
  if (registry?.registryVersion !== HOLDOUT_EXCLUSION_REGISTRY_VERSION) errors.push("exclusionRegistry.registryVersion is invalid.");
  if (registry?.policyId !== policy?.policyId) errors.push("exclusionRegistry.policyId does not match policy.");
  if (!Array.isArray(registry?.sets)) errors.push("exclusionRegistry.sets is invalid.");
  const setIds = new Set();
  for (const [index, set] of (registry?.sets ?? []).entries()) {
    exactKeys(set, ["setId", "entries"], errors, `exclusionRegistry.sets[${index}]`);
    if (!validId(set?.setId) || setIds.has(set.setId)) errors.push(`exclusionRegistry.sets[${index}].setId is invalid or duplicated.`);
    setIds.add(set?.setId);
    if (!Array.isArray(set?.entries)) errors.push(`exclusionRegistry.sets[${index}].entries is invalid.`);
    for (const [entryIndex, entry] of (set?.entries ?? []).entries()) {
      exactKeys(entry, ["sourceIdentitySha256", "taskInputFingerprint", "normalizedCaseSha256"], errors, `exclusionRegistry.sets[${index}].entries[${entryIndex}]`);
      for (const key of ["sourceIdentitySha256", "taskInputFingerprint", "normalizedCaseSha256"]) if (!SHA.test(entry?.[key] ?? "")) errors.push(`exclusionRegistry entry ${key} is invalid.`);
    }
  }
  for (const required of policy?.requiredExclusionSets ?? []) if (!setIds.has(required)) errors.push(`exclusionRegistry is missing required set ${required}.`);
  return { valid: errors.length === 0, errors };
}

export function validateHoldoutPrivateManifest(manifest, policy, registry) {
  const errors = [];
  exactKeys(manifest, ["manifestVersion", "status", "policySha256", "experimentId", "sourceCommit", "sealedAt", "exclusionRegistrySha256", "outputsObserved", "replacements", "cases"], errors, "privateManifest");
  if (manifest?.manifestVersion !== HOLDOUT_PRIVATE_MANIFEST_VERSION || manifest?.status !== "ready_to_seal") errors.push("privateManifest version/status is invalid.");
  if (manifest?.policySha256 !== sha256(stableJson(policy))) errors.push("privateManifest.policySha256 does not bind the policy.");
  if (manifest?.experimentId !== policy?.experimentId || manifest?.sourceCommit !== policy?.sourceCommit || !validIso(manifest?.sealedAt)) errors.push("privateManifest experiment/source/time binding is invalid.");
  if (manifest?.exclusionRegistrySha256 !== sha256(stableJson(registry))) errors.push("privateManifest.exclusionRegistrySha256 does not bind the registry.");
  if (manifest?.outputsObserved !== false) errors.push("privateManifest must be sealed before any model or reviewer output is observed.");
  if (!Array.isArray(manifest?.replacements) || manifest.replacements.some((value) => value !== "pre_output_unavailable_only")) errors.push("privateManifest replacements are invalid.");
  if (!Array.isArray(manifest?.cases) || manifest.cases.length === 0 || manifest.cases.length > 500) errors.push("privateManifest.cases is invalid.");
  const policyStrata = new Map((policy?.strata ?? []).map((item) => [item.stratumId, item.quota]));
  const strataCounts = new Map();
  const seen = new Set();
  const excluded = new Set((registry?.sets ?? []).flatMap((set) => (set.entries ?? []).flatMap((entry) => [entry.sourceIdentitySha256, entry.taskInputFingerprint, entry.normalizedCaseSha256])));
  for (const [index, item] of (manifest?.cases ?? []).entries()) {
    exactKeys(item, ["opaqueCaseId", "stratumId", "sourceIdentitySha256", "taskInputFingerprint", "normalizedCaseSha256"], errors, `privateManifest.cases[${index}]`);
    if (!validId(item?.opaqueCaseId) || seen.has(item.opaqueCaseId)) errors.push(`privateManifest.cases[${index}].opaqueCaseId is invalid or duplicated.`);
    seen.add(item?.opaqueCaseId);
    if (!policyStrata.has(item?.stratumId)) errors.push(`privateManifest.cases[${index}].stratumId is not in policy.`);
    strataCounts.set(item?.stratumId, (strataCounts.get(item?.stratumId) ?? 0) + 1);
    for (const key of ["sourceIdentitySha256", "taskInputFingerprint", "normalizedCaseSha256"]) {
      const value = item?.[key];
      if (!SHA.test(value ?? "")) errors.push(`privateManifest.cases[${index}].${key} is invalid.`);
      if (seen.has(`${key}:${value}`)) errors.push(`privateManifest.cases contains a duplicate ${key}.`);
      seen.add(`${key}:${value}`);
      if (excluded.has(value)) errors.push(`privateManifest.cases[${index}] overlaps the exclusion registry.`);
    }
  }
  for (const [stratumId, quota] of policyStrata) if (strataCounts.get(stratumId) !== quota) errors.push(`privateManifest quota for ${stratumId} does not equal policy.`);
  return { valid: errors.length === 0, errors };
}

export function sealHoldout({ policy, registry, privateManifest, holdoutId, normalizerVersion }) {
  const policyValidation = validateHoldoutSelectionPolicy(policy);
  const registryValidation = validateHoldoutExclusionRegistry(registry, policy);
  const manifestValidation = validateHoldoutPrivateManifest(privateManifest, policy, registry);
  const errors = [...policyValidation.errors, ...registryValidation.errors, ...manifestValidation.errors];
  if (!validId(holdoutId) || !validId(normalizerVersion)) errors.push("holdoutId or normalizerVersion is invalid.");
  if (errors.length) throw new Error(`Holdout seal refused: ${[...new Set(errors)].join(" ")}`);
  const sealedCaseSet = privateManifest.cases.map((item) => ({
    opaqueCaseId: item.opaqueCaseId,
    stratumId: item.stratumId,
    sourceIdentitySha256: item.sourceIdentitySha256,
    taskInputFingerprint: item.taskInputFingerprint,
    normalizedCaseSha256: item.normalizedCaseSha256
  })).sort((left, right) => left.opaqueCaseId.localeCompare(right.opaqueCaseId));
  const receipt = {
    receiptVersion: HOLDOUT_SEAL_RECEIPT_VERSION,
    status: "sealed",
    holdoutId,
    experimentId: policy.experimentId,
    policyVersion: policy.policyId,
    caseCount: sealedCaseSet.length,
    sealedAt: privateManifest.sealedAt,
    privateManifestSha256: sha256(stableJson(privateManifest)),
    sealedCaseSetSha256: sha256(stableJson(sealedCaseSet)),
    normalizerVersion,
    sourceCommit: policy.sourceCommit
  };
  const receiptValidation = validateHoldoutReceiptV2(receipt);
  if (!receiptValidation.valid) throw new Error(`Holdout receipt failed validation: ${receiptValidation.errors.join(" ")}`);
  return { receipt, receiptText: stableJson(receipt), sealedCaseSetText: stableJson(sealedCaseSet) };
}

export function buildSeededAssignmentPlan({ holdoutReceipt, opaqueCaseIds, raterPseudonyms, seed, minReviewersPerCaseArm = 2 }) {
  const receiptValidation = validateHoldoutReceiptV2(holdoutReceipt);
  if (!receiptValidation.valid) throw new Error(`Assignment generation requires a sealed holdout receipt: ${receiptValidation.errors.join(" ")}`);
  const cases = canonicalIds(opaqueCaseIds);
  const roster = canonicalIds(raterPseudonyms);
  if (!cases || cases.length !== holdoutReceipt.caseCount || cases.length % 2 !== 0 || !roster || roster.length < minReviewersPerCaseArm * 2 || !Number.isInteger(minReviewersPerCaseArm) || minReviewersPerCaseArm < 2) throw new Error("Assignment generation inputs are invalid, must contain an even case count, or cannot avoid same-case A/B exposure.");
  if (typeof seed !== "string" || seed.length < 16) throw new Error("Assignment randomization seed must be a private non-empty value of at least 16 characters.");
  const selected = new Map(roster.map((rater) => [rater, []]));
  for (const [caseIndex, caseId] of cases.entries()) {
    // Pairing adjacent canonical cases and swapping arms in the second member
    // preserves every rater's arm balance without exposing either condition.
    const shuffled = deterministicShuffle(roster, `${seed}\u0000pair\u0000${Math.floor(caseIndex / 2)}`);
    const first = shuffled.slice(0, minReviewersPerCaseArm);
    const second = shuffled.slice(minReviewersPerCaseArm, minReviewersPerCaseArm * 2);
    const armA = caseIndex % 2 === 0 ? first : second;
    const armB = caseIndex % 2 === 0 ? second : first;
    for (const rater of armA) selected.get(rater).push({ opaqueCaseId: caseId, blindedArmId: "A" });
    for (const rater of armB) selected.get(rater).push({ opaqueCaseId: caseId, blindedArmId: "B" });
  }
  const assignments = [];
  for (const rater of roster) {
    const ordered = deterministicShuffle(selected.get(rater), `${seed}\u0000presentation\u0000${rater}`);
    ordered.forEach((item, index) => assignments.push({
      assignmentId: `assign-${rater}-${index + 1}`,
      raterPseudonym: rater,
      opaqueCaseId: item.opaqueCaseId,
      blindedArmId: item.blindedArmId,
      assignmentIndex: index + 1
    }));
  }
  const plan = {
    protocolVersion: HUMAN_AB_V2_PROTOCOL_VERSION,
    preflightVersion: HUMAN_AB_V2_PREFLIGHT_VERSION,
    experimentId: holdoutReceipt.experimentId,
    sealedHoldoutReceiptSha256: sha256(stableJson(holdoutReceipt)),
    sealedCaseSetSha256: holdoutReceipt.sealedCaseSetSha256,
    reviewerRosterSha256: sha256(stableJson(roster)),
    minReviewersPerCaseArm,
    assignments
  };
  const validation = validateAssignmentPlanV2(plan);
  if (!validation.valid) throw new Error(`Generated assignment plan failed preflight: ${validation.errors.join(" ")}`);
  const preflight = buildAssignmentPreflightV2(plan);
  return {
    plan,
    preflight,
    randomizationReceipt: {
      receiptVersion: ASSIGNMENT_RANDOMIZATION_RECEIPT_VERSION,
      protocolVersion: HUMAN_AB_V2_PROTOCOL_VERSION,
      experimentId: plan.experimentId,
      sealedHoldoutReceiptSha256: plan.sealedHoldoutReceiptSha256,
      sealedCaseSetSha256: plan.sealedCaseSetSha256,
      reviewerRosterSha256: plan.reviewerRosterSha256,
      seedCommitmentSha256: sha256(seed),
      assignmentPlanSha256: sha256(stableJson(plan)),
      assignmentPreflightSha256: sha256(stableJson(preflight)),
      armMappingStored: false
    }
  };
}

export function verifyRaterWorkbookOoxml({ workbookPath, verifierSourceText }) {
  const entries = Object.fromEntries(execFileSync("unzip", ["-Z1", workbookPath], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((name) => [name, execFileSync("unzip", ["-p", workbookPath, name], { encoding: "utf8" })]));
  const inspection = inspectRaterWorkbookOoxml(entries);
  return {
    workbookSha256: createHash("sha256").update(readFileSync(workbookPath)).digest("hex"),
    labelsHeaderSha256: inspection.labelsHeaderSha256,
    serializedFreezePaneVerified: inspection.serializedFreezePaneVerified,
    macrosAbsent: inspection.macrosAbsent,
    externalLinksAbsent: inspection.externalLinksAbsent,
    formulasAbsent: inspection.formulasAbsent,
    verifierSha256: sha256(verifierSourceText)
  };
}

export function inspectRaterWorkbookOoxml(entries) {
  const names = Object.keys(entries ?? {});
  const workbookXml = entries?.["xl/workbook.xml"];
  const relationshipsXml = entries?.["xl/_rels/workbook.xml.rels"];
  if (typeof workbookXml !== "string" || typeof relationshipsXml !== "string") throw new Error("Workbook OOXML is missing workbook metadata.");
  const labelsRelation = parseSheetRelation(workbookXml, "Labels");
  const labelsTarget = parseRelationshipTarget(relationshipsXml, labelsRelation);
  const labelsXml = entries?.[`xl/${labelsTarget}`];
  if (typeof labelsXml !== "string") throw new Error("Workbook OOXML is missing the Labels worksheet.");
  const headers = parseHeaderRow(labelsXml, entries?.["xl/sharedStrings.xml"] ?? "");
  if (JSON.stringify(headers) !== JSON.stringify(HUMAN_AB_V2_LABEL_HEADERS)) throw new Error("Labels worksheet header does not match the v2 label schema.");
  return {
    labelsHeaderSha256: sha256(stableJson(headers)),
    serializedFreezePaneVerified: /<pane\b(?=[^>]*\bstate="frozen")(?=[^>]*\bySplit="(?:[1-9]\d*)")[^>]*>/i.test(labelsXml),
    macrosAbsent: !names.some((name) => /(?:^|\/)vbaProject\.bin$/i.test(name)),
    externalLinksAbsent: !names.some((name) => /^xl\/externalLinks\//i.test(name)),
    formulasAbsent: !/<f(?:\s|>)/i.test(labelsXml)
  };
}

export function deriveLocalFreezeEvidence({ cwd, fileBindings }) {
  const root = realpathSync(cwd);
  const status = execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" });
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (!COMMIT.test(commit)) throw new Error("Git HEAD is not a full commit SHA.");
  const expected = ["protocolSha256", "plannerSourceSha256", "promptSha256", "plannerSchemaSha256", "evaluationHarnessSha256", "baselineSourceSha256", "automaticTimerRunnerSha256"];
  if (!fileBindings || JSON.stringify(Object.keys(fileBindings).sort()) !== JSON.stringify(expected.sort())) throw new Error("Freeze file bindings must contain the exact required digest keys.");
  const hashes = { algorithm: "sha256" };
  for (const key of expected) {
    const path = resolve(root, fileBindings[key]);
    if (!isInside(root, path)) throw new Error(`Freeze file binding escapes repository: ${key}.`);
    hashes[key] = createHash("sha256").update(readFileSync(path)).digest("hex");
  }
  const changes = status.trim() ? status.trim().split("\n") : [];
  return {
    source: { commit, workingTreeDirty: changes.length > 0, changedPathCount: changes.length, stagedPathCount: changes.filter((line) => line[0] !== " ").length, reproducibleFromCommit: changes.length === 0 },
    hashes
  };
}

export function buildFreezeManifestFromLocalEvidence({ cwd, config }) {
  const evidence = deriveLocalFreezeEvidence({ cwd, fileBindings: config?.fileBindings });
  if (config?.sourceCommit !== evidence.source.commit) throw new Error("Freeze config sourceCommit does not match local HEAD.");
  return buildFreezeManifestV2({
    generatedAt: config.generatedAt,
    source: evidence.source,
    planner: config.planner,
    workbooks: config.workbooks,
    assignment: config.assignment,
    holdout: config.holdout,
    hashes: evidence.hashes
  });
}

function exactKeys(value, allowed, errors, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push(`${label} must be an object.`); return; }
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${label} contains unexpected field: ${key}.`);
  for (const key of allowed) if (!Object.hasOwn(value, key)) errors.push(`${label} is missing field: ${key}.`);
}
function validId(value) { return typeof value === "string" && ID.test(value); }
function validIso(value) { return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value)); }
function isInside(root, child) { const result = relative(root, child); return result === "" || (!result.startsWith(`..${sep}`) && result !== ".."); }
function canonicalIds(values) {
  if (!Array.isArray(values)) return null;
  const result = values.map((value) => typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "");
  return result.some((value) => !validId(value)) || new Set(result).size !== result.length ? null : result.sort();
}
function deterministicShuffle(values, context) {
  return [...values].map((value) => ({ value, key: sha256(`${context}\u0000${typeof value === "string" ? value : stableJson(value)}`) })).sort((left, right) => left.key.localeCompare(right.key)).map((item) => item.value);
}
function parseSheetRelation(xml, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<sheet\\b(?=[^>]*\\bname="${escaped}")[^>]*\\br:id="([^"]+)"[^>]*>`, "i"));
  if (!match) throw new Error("Workbook OOXML has no Labels worksheet relation.");
  return match[1];
}
function parseRelationshipTarget(xml, id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<Relationship\\b(?=[^>]*\\bId="${escaped}")[^>]*\\bTarget="([^"]+)"[^>]*\\/?>`, "i"));
  if (!match || match[1].startsWith("/") || match[1].includes("..")) throw new Error("Workbook OOXML Labels relationship is invalid.");
  return match[1].replace(/^\.\//, "");
}
function parseHeaderRow(labelsXml, sharedStringsXml) {
  const shared = [...sharedStringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)].map((match) => xmlText(match[1]));
  const row = labelsXml.match(/<row\b[^>]*\br="1"[^>]*>([\s\S]*?)<\/row>/i)?.[1];
  if (!row) throw new Error("Labels worksheet has no first header row.");
  const values = new Map();
  for (const match of row.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
    const cell = match[1].match(/\br="([A-Z]+)1"/i)?.[1];
    if (!cell) continue;
    const sharedIndex = match[1].match(/\bt="s"/i) ? Number(match[2].match(/<v>(\d+)<\/v>/i)?.[1]) : undefined;
    values.set(cell, Number.isInteger(sharedIndex) ? shared[sharedIndex] : xmlText(match[2]));
  }
  return HUMAN_AB_V2_LABEL_HEADERS.map((_, index) => values.get(columnName(index + 1)) ?? "");
}
function columnName(index) { let value = ""; for (let current = index; current > 0; current = Math.floor((current - 1) / 26)) value = String.fromCharCode(65 + ((current - 1) % 26)) + value; return value; }
function xmlText(value) { return String(value).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
