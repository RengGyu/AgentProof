import { createHash } from "node:crypto";
import { buildGeneralPrChangeObservationV2, type GeneralPrChangeFactV2 } from "./general-pr-change-observation";
import {
  buildGeneralPrObservationSeedV2,
  canonicalizeGeneralPrObservationCollectionsV1,
  validateGeneralPrObservationSeedV2,
  type GeneralPrEvidenceAtomV2,
  type GeneralPrObservationSeedV2
} from "./general-pr-observation-source";
import {
  buildGeneralPrRedactedSourceViewsV1,
  GENERAL_PR_SEMANTIC_SELECTION_POLICY_VERSION,
  type GeneralPrSemanticClaimSelectionV1,
  type GeneralPrSemanticSelectionCoverageV1
} from "./general-pr-semantic-selection";
import { redactSecrets } from "./redact";
import type { ChangedFile, PullRequestInput } from "./types";

const DEFAULT_MAX_PER_OBJECTIVE = 12;
const DEFAULT_MAX_TOTAL = 64;
const DEFAULT_MAX_INPUT_BYTES = 12_000;
const RRF_K = 60;
const EVIDENCE_KINDS: GeneralPrSemanticEvidenceKindV1[] = ["change", "test_artifact", "check", "execution"];
const UNSAFE_URL_LIKE_PATTERN = /(?:\b[a-z][a-z0-9+.-]*:[^\s]*|\bwww\.[^\s]+)/iu;

export type GeneralPrSemanticEvidenceKindV1 = GeneralPrEvidenceAtomV2["kind"];

export interface GeneralPrSemanticEvidenceDescriptorV1 {
  evidenceId: string;
  kind: GeneralPrSemanticEvidenceKindV1;
  roleCandidates: string[];
  language: string | null;
  changeStatus: string | null;
  tokenSketch: string[];
  completeness: "complete" | "incomplete" | "unknown";
  subjectBinding: "exact_head" | "incomplete" | "unknown";
  relationBasis:
    | "released_static_relation"
    | "released_build_relation"
    | "changed_artifact"
    | "exact_subject"
    | "observation_only"
    | "unresolved";
}

export interface GeneralPrSemanticChangeClusterDescriptorV1 {
  changeClusterId: string;
  roleCandidates: string[];
  languages: string[];
  tokenSketch: string[];
  completeness: "complete" | "incomplete" | "unknown";
  relationBasis: "released_static_relation" | "released_build_relation" | "rename" | "singleton";
}

export interface GeneralPrSemanticEvidenceSelectionOmittedReasonCountsV1 {
  evidenceBudget: number;
  inputByteBudget: number;
  unsafeDescriptor: number;
  noDeterministicSignal: number;
}

export interface GeneralPrSemanticEvidenceSelectionV1 {
  version: 1;
  policyVersion: typeof GENERAL_PR_SEMANTIC_SELECTION_POLICY_VERSION;
  limits: {
    maxPerObjective: number;
    maxTotal: number;
    maxInputBytes: number;
  };
  parentSeedHash: string;
  claimSelectionHash: string;
  evidenceSelectionHash: string;
  objectiveGroups: Array<{
    objectiveSpanIds: string[];
    changeClusterIds: string[];
    evidenceIds: string[];
  }>;
  changeClusterDescriptors: GeneralPrSemanticChangeClusterDescriptorV1[];
  evidenceDescriptors: GeneralPrSemanticEvidenceDescriptorV1[];
  coverage: GeneralPrSemanticSelectionCoverageV1;
  omittedReasonCounts: GeneralPrSemanticEvidenceSelectionOmittedReasonCountsV1;
}

export type GeneralPrSemanticEvidenceSelectionResultV1 =
  | { status: "selected"; selection: GeneralPrSemanticEvidenceSelectionV1 }
  | { status: "empty"; coverage: GeneralPrSemanticSelectionCoverageV1; omittedReasonCounts: GeneralPrSemanticEvidenceSelectionOmittedReasonCountsV1 }
  | { status: "invalid"; reason: "seed_invalid" | "claim_binding_invalid" | "descriptor_invalid" };

export function reciprocalRankFusionScoreV1(ranks: readonly (number | null)[]): number {
  return ranks.reduce<number>((total, rank) => total + (rank === null ? 0 : 1 / (RRF_K + rank)), 0);
}

export function generalPrSemanticRelationPriorityV1(
  basis: GeneralPrSemanticEvidenceDescriptorV1["relationBasis"] | GeneralPrSemanticChangeClusterDescriptorV1["relationBasis"]
): number | null {
  if (basis === "released_static_relation") return 4;
  if (basis === "released_build_relation") return 3;
  if (basis === "changed_artifact") return 2;
  if (basis === "rename") return 1;
  return null;
}

export function computeGeneralPrSemanticEvidenceSelectionHashV1(
  selection: Omit<GeneralPrSemanticEvidenceSelectionV1, "evidenceSelectionHash">
): string {
  return digest({ domain: "agentproof.general-pr.evidence-selection.v1", selection });
}

export function selectGeneralPrSemanticEvidenceV1(input: {
  pullRequest: PullRequestInput;
  seed: GeneralPrObservationSeedV2;
  claimSelection: GeneralPrSemanticClaimSelectionV1;
  objectiveGroups: Array<{ spanIds: string[]; disposition: "candidate" }>;
  maxPerObjective?: number;
  maxTotal?: number;
  maxInputBytes?: number;
}): GeneralPrSemanticEvidenceSelectionResultV1 {
  if (!validateGeneralPrObservationSeedV2(input.seed).valid) return { status: "invalid", reason: "seed_invalid" };
  const rebuilt = buildGeneralPrObservationSeedV2(input.pullRequest);
  if (rebuilt.seedHash !== input.seed.seedHash) return { status: "invalid", reason: "seed_invalid" };
  const objectiveTexts = validateClaimBinding(input.pullRequest, input.seed, input.claimSelection, input.objectiveGroups);
  if (!objectiveTexts) return { status: "invalid", reason: "claim_binding_invalid" };
  const catalogs = buildDescriptorCatalogs({
    ...input.pullRequest,
    ...canonicalizeGeneralPrObservationCollectionsV1(input.pullRequest)
  }, input.seed);
  if (!catalogs) return { status: "invalid", reason: "descriptor_invalid" };

  const maxPerObjective = boundedBudget(input.maxPerObjective, DEFAULT_MAX_PER_OBJECTIVE, DEFAULT_MAX_PER_OBJECTIVE);
  const maxTotal = boundedBudget(input.maxTotal, DEFAULT_MAX_TOTAL, DEFAULT_MAX_TOTAL);
  const maxInputBytes = boundedBudget(input.maxInputBytes, DEFAULT_MAX_INPUT_BYTES, DEFAULT_MAX_INPUT_BYTES);
  const omittedReasonCounts = { ...emptyOmissionCounts(), unsafeDescriptor: catalogs.unsafeDescriptorCount };
  const candidates = relationCandidates(catalogs);
  const selectedGroups: SelectedObjectiveGroup[] = [];
  const globalIds = new Set<string>();

  for (let groupIndex = 0; groupIndex < input.objectiveGroups.length; groupIndex += 1) {
    const group = input.objectiveGroups[groupIndex]!;
    const objectiveTokens = tokenSketch(objectiveTexts[groupIndex] ?? "");
    const ranked = rankCandidates(candidates, objectiveTokens);
    const reservedIds = new Set<string>();
    for (const kind of EVIDENCE_KINDS) {
      const reserved = ranked.find((candidate) => candidate.evidenceKind === kind);
      if (reserved) reservedIds.add(reserved.id);
    }
    const chosen: SelectedRelation[] = [];
    const consider = (candidate: RankedCandidate, reserved: boolean) => {
      if (chosen.length >= maxPerObjective) {
        omittedReasonCounts.evidenceBudget += 1;
        return;
      }
      if (!globalIds.has(candidate.id) && globalIds.size >= maxTotal) {
        omittedReasonCounts.evidenceBudget += 1;
        return;
      }
      chosen.push({ candidate, reserved, groupIndex });
      globalIds.add(candidate.id);
    };
    for (const candidate of ranked) if (reservedIds.has(candidate.id)) consider(candidate, true);
    for (const candidate of ranked) {
      if (reservedIds.has(candidate.id)) continue;
      if (!candidate.hasSignal) {
        omittedReasonCounts.noDeterministicSignal += 1;
        continue;
      }
      consider(candidate, false);
    }
    chosen.sort(compareSelectedBySeed);
    selectedGroups.push({ objectiveSpanIds: [...group.spanIds], chosen });
  }

  let selection = materializeSelection(input.seed, input.claimSelection, selectedGroups, catalogs, omittedReasonCounts, maxPerObjective, maxTotal, maxInputBytes);
  while (selection && Buffer.byteLength(JSON.stringify(selection), "utf8") > maxInputBytes) {
    const removable = selectedGroups
      .flatMap((group) => group.chosen)
      .sort(compareRemoval)
      .find((entry) => !entry.reserved)
      ?? selectedGroups.flatMap((group) => group.chosen).sort(compareRemoval)[0];
    if (!removable) break;
    const group = selectedGroups[removable.groupIndex];
    if (!group) break;
    group.chosen.splice(group.chosen.indexOf(removable), 1);
    omittedReasonCounts.inputByteBudget += 1;
    selection = materializeSelection(input.seed, input.claimSelection, selectedGroups, catalogs, omittedReasonCounts, maxPerObjective, maxTotal, maxInputBytes);
  }

  if (!selection || selectedGroups.every((group) => group.chosen.length === 0)) {
    return {
      status: "empty",
      coverage: coverageFor(input.seed, omittedReasonCounts),
      omittedReasonCounts
    };
  }
  return { status: "selected", selection };
}

function validateClaimBinding(
  pullRequest: PullRequestInput,
  seed: GeneralPrObservationSeedV2,
  selection: GeneralPrSemanticClaimSelectionV1,
  objectiveGroups: Array<{ spanIds: string[]; disposition: "candidate" }>
): string[] | null {
  if (!Array.isArray(objectiveGroups) || objectiveGroups.length === 0) return null;
  if (selection.version !== 1 || selection.parentSeedHash !== seed.seedHash || !isHash(selection.claimSelectionHash)) return null;
  const { claimSelectionHash, ...unsigned } = selection;
  if (digest({ domain: "agentproof.general-pr.claim-selection.v1", policyVersion: GENERAL_PR_SEMANTIC_SELECTION_POLICY_VERSION, selection: unsigned }) !== claimSelectionHash) return null;
  if (!isCoverage(selection.coverage) || !validCount(selection.omittedReasonCounts?.spanBudget) || !validCount(selection.omittedReasonCounts?.inputByteBudget)) return null;
  if (!Array.isArray(selection.selectedSpanIds) || !Array.isArray(selection.selectedSpans) || selection.selectedSpanIds.length !== selection.selectedSpans.length) return null;
  const views = buildGeneralPrRedactedSourceViewsV1(pullRequest, seed);
  if (!views) return null;
  const spansById = new Map(seed.spans.map((span, index) => [span.id, { span, index }]));
  const selectedById = new Map<string, GeneralPrSemanticClaimSelectionV1["selectedSpans"][number]>();
  let priorIndex = -1;
  for (let index = 0; index < selection.selectedSpans.length; index += 1) {
    const selected = selection.selectedSpans[index];
    if (!selected || selected.spanId !== selection.selectedSpanIds[index] || selectedById.has(selected.spanId)) return null;
    const canonical = spansById.get(selected.spanId);
    const source = seed.sources.find((candidate) => candidate.id === canonical?.span.sourceUnitId);
    const text = canonical && views.get(canonical.span.sourceUnitId)?.slice(canonical.span.start, canonical.span.end);
    if (!canonical || !source || canonical.index <= priorIndex || typeof text !== "string") return null;
    if (selected.sourceUnitId !== canonical.span.sourceUnitId || selected.authority !== source.authority || selected.sourceRole !== (source.roleCeiling === "context" ? "context" : "objective") || selected.structuralKind !== canonical.span.structuralKind || selected.deterministicRole !== canonical.span.deterministicRole || selected.text !== text) return null;
    priorIndex = canonical.index;
    selectedById.set(selected.spanId, selected);
  }
  const usedSpanIds = new Set<string>();
  const objectiveTexts: string[] = [];
  for (const group of objectiveGroups) {
    if (!group || group.disposition !== "candidate" || !Array.isArray(group.spanIds) || group.spanIds.length === 0 || new Set(group.spanIds).size !== group.spanIds.length) return null;
    const spans = group.spanIds.map((id) => selectedById.get(id));
    if (spans.some((span) => !span) || spans.some((span) => span!.sourceUnitId !== spans[0]!.sourceUnitId)) return null;
    if (group.spanIds.some((id) => usedSpanIds.has(id))) return null;
    group.spanIds.forEach((id) => usedSpanIds.add(id));
    objectiveTexts.push(spans.map((span) => span!.text).join("\n"));
  }
  return objectiveTexts;
}

function buildDescriptorCatalogs(pullRequest: PullRequestInput, seed: GeneralPrObservationSeedV2): DescriptorCatalogs | null {
  const atomsByKind = new Map(EVIDENCE_KINDS.map((kind) => [kind, seed.evidenceAtoms.filter((atom) => atom.kind === kind)]));
  const changeAtoms = atomsByKind.get("change")!;
  const testAtoms = atomsByKind.get("test_artifact")!;
  const checkAtoms = atomsByKind.get("check")!;
  const executionAtoms = atomsByKind.get("execution")!;
  if (changeAtoms.length !== seed.changeFacts.length || testAtoms.length !== seed.testArtifacts.length || checkAtoms.length !== pullRequest.checks.length || executionAtoms.length !== seed.executions.length || seed.executions.length !== pullRequest.checks.length) return null;
  if (seed.changeFacts.length !== pullRequest.changedFiles.length) return null;
  const uniqueAtomIds = new Set(seed.evidenceAtoms.map((atom) => atom.id));
  const uniqueClusterIds = new Set(seed.changeClusters.map((cluster) => cluster.id));
  if (uniqueAtomIds.size !== seed.evidenceAtoms.length || uniqueClusterIds.size !== seed.changeClusters.length) return null;
  const expectedSubjectDigest = digest({
    domain: "agentproof.general-pr.subject.v2",
    repositoryIdentityHash: seed.repositoryIdentityHash,
    baseSha: seed.baseSha,
    headSha: seed.headSha,
    testedSubject: seed.testedSubject
  });
  if (seed.evidenceAtoms.some((atom) => atom.subjectDigest !== expectedSubjectDigest) || seed.testArtifacts.some((artifact) => artifact.subjectDigest !== expectedSubjectDigest)) return null;
  const inventoryCompleteness = seed.completeness === "unavailable" ? "unknown" : seed.completeness;
  const rebuiltFacts = buildGeneralPrChangeObservationV2(pullRequest.changedFiles, { inventoryCompleteness }).facts;
  if (stableJson(rebuiltFacts) !== stableJson(seed.changeFacts)) return null;
  const factByRef = new Map(seed.changeFacts.map((fact, index) => [fact.fileRef, { fact, index }]));
  if (factByRef.size !== seed.changeFacts.length) return null;
  const artifactByEvidenceRef = new Map(seed.testArtifacts.map((artifact) => [artifact.evidenceRef, artifact]));
  if (artifactByEvidenceRef.size !== seed.testArtifacts.length || seed.testArtifacts.some((artifact) => !factByRef.get(artifact.evidenceRef)?.fact.roleCandidates.includes("test"))) return null;
  const clusteredRefs = new Set<string>();
  for (const cluster of seed.changeClusters) {
    if (cluster.fileRefs.length === 0 || new Set(cluster.fileRefs).size !== cluster.fileRefs.length || cluster.fileRefs.some((ref) => !factByRef.has(ref) || clusteredRefs.has(ref))) return null;
    cluster.fileRefs.forEach((ref) => clusteredRefs.add(ref));
  }
  if (clusteredRefs.size !== seed.changeFacts.length) return null;

  const exactSeedHead = Boolean(seed.headSha && seed.testedSubject.kind === "head" && seed.testedSubject.sha === seed.headSha);
  const evidenceDescriptors: GeneralPrSemanticEvidenceDescriptorV1[] = [];
  for (let index = 0; index < seed.changeFacts.length; index += 1) {
    const fact = seed.changeFacts[index]!;
    const atom = changeAtoms[index]!;
    if (!verifyChangeAtom(atom, fact, expectedSubjectDigest)) return null;
    const file = pullRequest.changedFiles[index];
    evidenceDescriptors.push(evidenceDescriptor(atom, fact, file, exactSeedHead ? "exact_head" : subjectBindingFor(seed), "observation_only"));
  }
  for (let index = 0; index < seed.testArtifacts.length; index += 1) {
    const artifact = seed.testArtifacts[index]!;
    const atom = testAtoms[index]!;
    const owner = factByRef.get(artifact.evidenceRef);
    if (!owner || !verifyTestAtom(atom, artifact, expectedSubjectDigest)) return null;
    const file = pullRequest.changedFiles[owner.index];
    evidenceDescriptors.push(evidenceDescriptor(atom, owner.fact, file, exactSeedHead ? "exact_head" : subjectBindingFor(seed), "changed_artifact"));
  }
  for (let index = 0; index < pullRequest.checks.length; index += 1) {
    const check = pullRequest.checks[index]!;
    const atom = checkAtoms[index]!;
    const execution = seed.executions[index]!;
    if (!verifyCheckAtom(atom, check, index, expectedSubjectDigest)) return null;
    const exact = exactSeedHead && execution.subjectKind === "head" && execution.subjectSha === seed.headSha && execution.headSha === seed.headSha && execution.subjectContextDigest !== null;
    evidenceDescriptors.push({
      evidenceId: atom.id,
      kind: "check",
      roleCandidates: [],
      language: null,
      changeStatus: null,
      tokenSketch: tokenSketch(check.name),
      completeness: atom.completeness,
      subjectBinding: exact ? "exact_head" : subjectBindingFor(seed),
      relationBasis: exact ? "exact_subject" : "unresolved"
    });
  }
  for (let index = 0; index < seed.executions.length; index += 1) {
    const execution = seed.executions[index]!;
    const atom = executionAtoms[index]!;
    const check = pullRequest.checks[index]!;
    if (!verifyExecutionAtom(atom, execution, index, expectedSubjectDigest)) return null;
    const exact = exactSeedHead && execution.subjectKind === "head" && execution.subjectSha === seed.headSha && execution.headSha === seed.headSha && execution.subjectContextDigest !== null;
    evidenceDescriptors.push({
      evidenceId: atom.id,
      kind: "execution",
      roleCandidates: [],
      language: null,
      changeStatus: null,
      tokenSketch: tokenSketch(check.name),
      completeness: atom.completeness,
      subjectBinding: exact ? "exact_head" : subjectBindingFor(seed),
      relationBasis: exact ? "exact_subject" : "unresolved"
    });
  }
  const changeClusterDescriptors: GeneralPrSemanticChangeClusterDescriptorV1[] = [];
  for (const cluster of seed.changeClusters) {
    const members = cluster.fileRefs.map((ref) => factByRef.get(ref)!);
    const relationBasis = cluster.formationBasis === "static_relation" ? "released_static_relation"
      : cluster.formationBasis === "build_relation" ? "released_build_relation"
      : cluster.formationBasis === "rename" ? "rename"
      : cluster.formationBasis === "singleton" ? "singleton"
      : null;
    if (!relationBasis) return null;
    changeClusterDescriptors.push({
      changeClusterId: cluster.id,
      roleCandidates: unique(members.flatMap((member) => member.fact.roleCandidates)),
      languages: unique(members.map((member) => member.fact.language).filter((language): language is string => Boolean(language))),
      tokenSketch: tokenSketch(...members.flatMap((member) => fileSketchInputs(pullRequest.changedFiles[member.index]))),
      completeness: aggregateCompleteness(members.map((member) => member.fact.completeness)),
      relationBasis
    });
  }
  return { evidenceDescriptors, changeClusterDescriptors, unsafeDescriptorCount: 0 };
}

function evidenceDescriptor(
  atom: GeneralPrEvidenceAtomV2,
  fact: GeneralPrChangeFactV2,
  file: ChangedFile | undefined,
  subjectBinding: GeneralPrSemanticEvidenceDescriptorV1["subjectBinding"],
  relationBasis: GeneralPrSemanticEvidenceDescriptorV1["relationBasis"]
): GeneralPrSemanticEvidenceDescriptorV1 {
  return {
    evidenceId: atom.id,
    kind: atom.kind,
    roleCandidates: [...fact.roleCandidates],
    language: fact.language,
    changeStatus: fact.status,
    tokenSketch: tokenSketch(...fileSketchInputs(file)),
    completeness: atom.completeness,
    subjectBinding,
    relationBasis
  };
}

function relationCandidates(catalogs: DescriptorCatalogs): RelationCandidate[] {
  const clusters: RelationCandidate[] = catalogs.changeClusterDescriptors.map((descriptor, seedOrder) => ({
    id: descriptor.changeClusterId,
    descriptorType: "cluster",
    evidenceKind: null,
    tokenSketch: descriptor.tokenSketch,
    relationSignal: generalPrSemanticRelationPriorityV1(descriptor.relationBasis) ?? 0,
    subjectSignal: descriptor.completeness === "complete" ? 1 : descriptor.completeness === "incomplete" ? 0.5 : 0,
    seedOrder
  }));
  const evidence: RelationCandidate[] = catalogs.evidenceDescriptors.map((descriptor, index) => ({
    id: descriptor.evidenceId,
    descriptorType: "evidence",
    evidenceKind: descriptor.kind,
    tokenSketch: descriptor.tokenSketch,
    relationSignal: generalPrSemanticRelationPriorityV1(descriptor.relationBasis) ?? 0,
    subjectSignal: (descriptor.subjectBinding === "exact_head" ? 2 : descriptor.subjectBinding === "incomplete" ? 0.5 : 0) + (descriptor.completeness === "complete" ? 1 : descriptor.completeness === "incomplete" ? 0.5 : 0),
    seedOrder: catalogs.changeClusterDescriptors.length + index
  }));
  return [...clusters, ...evidence];
}

function rankCandidates(candidates: RelationCandidate[], objectiveTokens: string[]): RankedCandidate[] {
  const objective = new Set(objectiveTokens);
  const withSignals = candidates.map((candidate) => ({ ...candidate, overlap: candidate.tokenSketch.filter((token) => objective.has(token)).length }));
  const tokenRanks = ranks(withSignals.filter((candidate) => candidate.overlap > 0).sort((left, right) => right.overlap - left.overlap || compareCandidateSeed(left, right)));
  const relationRanks = ranks(withSignals.filter((candidate) => candidate.relationSignal > 0).sort((left, right) => right.relationSignal - left.relationSignal || compareCandidateSeed(left, right)));
  const subjectRanks = ranks(withSignals.filter((candidate) => candidate.subjectSignal > 0).sort((left, right) => right.subjectSignal - left.subjectSignal || compareCandidateSeed(left, right)));
  return withSignals.map((candidate) => {
    const signalRanks = [tokenRanks.get(candidate.id) ?? null, relationRanks.get(candidate.id) ?? null, subjectRanks.get(candidate.id) ?? null];
    return { ...candidate, score: reciprocalRankFusionScoreV1(signalRanks), hasSignal: signalRanks.some((rank) => rank !== null) };
  }).sort((left, right) => right.score - left.score || compareCandidateSeed(left, right));
}

function materializeSelection(
  seed: GeneralPrObservationSeedV2,
  claimSelection: GeneralPrSemanticClaimSelectionV1,
  groups: SelectedObjectiveGroup[],
  catalogs: DescriptorCatalogs,
  omittedReasonCounts: GeneralPrSemanticEvidenceSelectionOmittedReasonCountsV1,
  maxPerObjective: number,
  maxTotal: number,
  maxInputBytes: number
): GeneralPrSemanticEvidenceSelectionV1 | null {
  const selectedIds = new Set(groups.flatMap((group) => group.chosen.map((entry) => entry.candidate.id)));
  if (selectedIds.size === 0) return null;
  const objectiveGroups = groups.map((group) => ({
    objectiveSpanIds: [...group.objectiveSpanIds],
    changeClusterIds: group.chosen.filter((entry) => entry.candidate.descriptorType === "cluster").map((entry) => entry.candidate.id),
    evidenceIds: group.chosen.filter((entry) => entry.candidate.descriptorType === "evidence").map((entry) => entry.candidate.id)
  }));
  const changeClusterDescriptors = catalogs.changeClusterDescriptors.filter((descriptor) => selectedIds.has(descriptor.changeClusterId));
  const evidenceDescriptors = catalogs.evidenceDescriptors.filter((descriptor) => selectedIds.has(descriptor.evidenceId));
  const unsigned: Omit<GeneralPrSemanticEvidenceSelectionV1, "evidenceSelectionHash"> = {
    version: 1,
    policyVersion: GENERAL_PR_SEMANTIC_SELECTION_POLICY_VERSION,
    limits: { maxPerObjective, maxTotal, maxInputBytes },
    parentSeedHash: seed.seedHash,
    claimSelectionHash: claimSelection.claimSelectionHash,
    objectiveGroups,
    changeClusterDescriptors,
    evidenceDescriptors,
    coverage: coverageFor(seed, omittedReasonCounts),
    omittedReasonCounts: { ...omittedReasonCounts }
  };
  return { ...unsigned, evidenceSelectionHash: computeGeneralPrSemanticEvidenceSelectionHashV1(unsigned) };
}

function fileSketchInputs(file: ChangedFile | undefined): string[] {
  if (!file) return [];
  return [file.path, ...(file.previousPath ? [file.previousPath] : []), ...hunkLabels(file.patch)];
}

function hunkLabels(patch: string | undefined): string[] {
  if (!patch) return [];
  return patch.split(/\r?\n/).flatMap((line) => {
    if (!line.startsWith("@@")) return [];
    const secondMarker = line.indexOf("@@", 2);
    return secondMarker < 0 ? [] : [line.slice(secondMarker + 2).trim()];
  });
}

function tokenSketch(...inputs: string[]): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const input of inputs) {
    if (UNSAFE_URL_LIKE_PATTERN.test(input)) continue;
    let safe: string;
    try {
      safe = redactSecrets(input)
        .replace(new RegExp(UNSAFE_URL_LIKE_PATTERN.source, "giu"), " ")
        .replace(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu, " ")
        .replace(/\b[a-f0-9]{40,64}\b/giu, " ")
        .normalize("NFKC")
        .replace(/([\p{Ll}\p{N}])([\p{Lu}])/gu, "$1 $2")
        .replace(/([\p{L}])([\p{N}])|([\p{N}])([\p{L}])/gu, "$1$3 $2$4")
        .toLowerCase();
    } catch {
      continue;
    }
    for (const token of safe.split(/[^\p{L}\p{N}]+/u)) {
      if (tokens.length >= 16) return tokens;
      if (token.length <= 1 || token.length > 40 || /^\d+$/u.test(token) || /^[a-f0-9]{40,64}$/u.test(token) || token === "redacted" || seen.has(token)) continue;
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}

function verifyChangeAtom(atom: GeneralPrEvidenceAtomV2, fact: GeneralPrChangeFactV2, subjectDigest: string): boolean {
  return atom.kind === "change" && atom.subjectDigest === subjectDigest
    && atom.id === `gpea_${digest({ domain: "agentproof.general-pr.change-atom.v2", fileRef: fact.fileRef, subjectDigest }).slice(0, 24)}`
    && atom.contentDigest === digest({ domain: "agentproof.general-pr.change-content.v2", fact });
}

function verifyTestAtom(atom: GeneralPrEvidenceAtomV2, artifact: GeneralPrObservationSeedV2["testArtifacts"][number], subjectDigest: string): boolean {
  return atom.kind === "test_artifact" && atom.subjectDigest === subjectDigest
    && atom.id === `gpea_${digest({ domain: "agentproof.general-pr.test-atom.v2", artifact: artifact.id }).slice(0, 24)}`
    && atom.contentDigest === digest({ domain: "agentproof.general-pr.test-content.v2", artifact });
}

function verifyCheckAtom(atom: GeneralPrEvidenceAtomV2, check: PullRequestInput["checks"][number], index: number, subjectDigest: string): boolean {
  return atom.kind === "check" && atom.subjectDigest === subjectDigest
    && atom.id === `gpea_${digest({ domain: "agentproof.general-pr.check-atom.v2", index, subjectDigest, name: check.name, status: check.status }).slice(0, 24)}`
    && atom.contentDigest === digest({ domain: "agentproof.general-pr.check-content.v2", name: check.name, status: check.status });
}

function verifyExecutionAtom(atom: GeneralPrEvidenceAtomV2, execution: GeneralPrObservationSeedV2["executions"][number], index: number, subjectDigest: string): boolean {
  return atom.kind === "execution" && atom.subjectDigest === subjectDigest
    && atom.id === `gpea_${digest({ domain: "agentproof.general-pr.execution-atom.v2", index, subjectDigest, execution }).slice(0, 24)}`
    && atom.contentDigest === digest({ domain: "agentproof.general-pr.execution-content.v2", execution });
}

function subjectBindingFor(seed: GeneralPrObservationSeedV2): GeneralPrSemanticEvidenceDescriptorV1["subjectBinding"] {
  return seed.headSha || seed.testedSubject.sha ? "incomplete" : "unknown";
}

function aggregateCompleteness(values: Array<"complete" | "incomplete" | "unknown">): "complete" | "incomplete" | "unknown" {
  if (values.every((value) => value === "complete")) return "complete";
  if (values.some((value) => value === "incomplete")) return "incomplete";
  return "unknown";
}

function coverageFor(seed: GeneralPrObservationSeedV2, omitted: GeneralPrSemanticEvidenceSelectionOmittedReasonCountsV1): GeneralPrSemanticSelectionCoverageV1 {
  if (seed.completeness !== "complete" || omitted.unsafeDescriptor > 0 || omitted.noDeterministicSignal > 0) return "incomplete";
  if (omitted.evidenceBudget > 0 || omitted.inputByteBudget > 0) return "sampled";
  return "complete";
}

function ranks(candidates: Array<{ id: string }>): Map<string, number> { return new Map(candidates.map((candidate, index) => [candidate.id, index + 1])); }
function compareCandidateSeed(left: { seedOrder: number; id: string }, right: { seedOrder: number; id: string }): number { return left.seedOrder - right.seedOrder || left.id.localeCompare(right.id); }
function compareSelectedBySeed(left: SelectedRelation, right: SelectedRelation): number { return compareCandidateSeed(left.candidate, right.candidate); }
function compareRemoval(left: SelectedRelation, right: SelectedRelation): number { return left.candidate.score - right.candidate.score || right.candidate.seedOrder - left.candidate.seedOrder || right.candidate.id.localeCompare(left.candidate.id) || right.groupIndex - left.groupIndex; }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function validCount(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function isCoverage(value: unknown): value is GeneralPrSemanticSelectionCoverageV1 { return value === "complete" || value === "sampled" || value === "incomplete"; }
function isHash(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function boundedBudget(value: number | undefined, fallback: number, cap: number): number { return Number.isSafeInteger(value) && value! >= 0 ? Math.min(value!, cap) : fallback; }
function emptyOmissionCounts(): GeneralPrSemanticEvidenceSelectionOmittedReasonCountsV1 { return { evidenceBudget: 0, inputByteBudget: 0, unsafeDescriptor: 0, noDeterministicSignal: 0 }; }
function digest(value: unknown): string { return createHash("sha256").update(stableJson(value), "utf8").digest("hex"); }
function stableJson(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") { const record = value as Record<string, unknown>; return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`; } return JSON.stringify(value); }

interface DescriptorCatalogs {
  evidenceDescriptors: GeneralPrSemanticEvidenceDescriptorV1[];
  changeClusterDescriptors: GeneralPrSemanticChangeClusterDescriptorV1[];
  unsafeDescriptorCount: number;
}

interface RelationCandidate {
  id: string;
  descriptorType: "cluster" | "evidence";
  evidenceKind: GeneralPrSemanticEvidenceKindV1 | null;
  tokenSketch: string[];
  relationSignal: number;
  subjectSignal: number;
  seedOrder: number;
}

interface RankedCandidate extends RelationCandidate {
  overlap: number;
  score: number;
  hasSignal: boolean;
}

interface SelectedRelation { candidate: RankedCandidate; reserved: boolean; groupIndex: number }
interface SelectedObjectiveGroup { objectiveSpanIds: string[]; chosen: SelectedRelation[] }
