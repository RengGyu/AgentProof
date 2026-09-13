import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import { compileOrdinaryDocumentationPlans, evaluateOrdinaryDocumentationPlan, type OrdinaryDocumentationBlob } from "./general-pr-documentation";
import { compileExplicitOrdinaryUnionPlans } from "./general-pr-static-types";
import { compileOrdinaryAssignabilityPlans, evaluateOrdinaryAssignabilityPlans, type TypeScriptProjectCollector } from "./typescript-assignability-verification";
import { compileOrdinaryScalarPlans, evaluateOrdinaryScalarPlan, readOrdinaryScalarRuntime } from "./general-pr-scalar";
import type { GeneralPrObservationBundleV2 } from "./general-pr-observation-service";
import { readEnabledVerificationCapabilitiesV2 } from "./verification-capability-policy-v2";
import { registerOrdinaryOutcomeValidationContext } from "./report-runtime-validation";
import { ordinaryRequirementStatus, type OrdinaryRequirementOutcomes } from "./ordinary-requirement-outcome-contract";
import type { EvidenceItem, PullRequestInput, VerificationReportV2 } from "./types";

type Collector = (paths: string[], headSha: string) => Promise<OrdinaryDocumentationBlob[]>;

/** Closed source meaning owns the result; semantic observation admission owns no authority here. */
export async function attachOrdinaryRequirementOutcomes(input: PullRequestInput, report: VerificationReportV2, collectors: { collectDocumentationArtifacts?: Collector; collectStaticArtifacts?: Collector; collectScalarArtifacts?: Collector; collectTypeScriptProject?: TypeScriptProjectCollector }): Promise<VerificationReportV2> {
  if (report.verificationContract?.state !== "absent" || !report.requirements.length || !Array.isArray(report.evidenceIndex)) return report;
  const seed = buildGeneralPrObservationSeedV2(input);
  const originalSource = JSON.stringify(report.source);
  // The existing whole-clause compiler resolves exact canonical source aliases.
  const sourceBundle = { seedHash: seed.seedHash, objectives: seed.spans.map(span => ({ sourceSpanIds: [span.id] })) } as GeneralPrObservationBundleV2;
  const docs = /^[a-f0-9]{40}$/i.test(seed.headSha ?? "") ? compileOrdinaryDocumentationPlans(input, seed, sourceBundle).filter(plan => plan.legacyRequirementId !== null) : [];
  const unions = compileExplicitOrdinaryUnionPlans(input, seed);
  const assignability = compileOrdinaryAssignabilityPlans(input, seed);
  let typeProject = null;
  if (assignability.length && seed.headSha && collectors.collectTypeScriptProject && process.env.AGENTPROOF_ORDINARY_TYPESCRIPT_ASSIGNABILITY === "enabled") {
    try { typeProject = structuredClone(await collectors.collectTypeScriptProject(seed.headSha)); } catch { /* Unavailable project is not a type violation. */ }
  }
  const assignabilityResults = new Map((await evaluateOrdinaryAssignabilityPlans(assignability, typeProject)).map((result, index) => [assignability[index].requirementId, result]));
  typeProject = null;
  const scalars = compileOrdinaryScalarPlans(input, seed);
  const scalarRuntime = scalars.length ? readOrdinaryScalarRuntime() : undefined;
  const capabilities = readEnabledVerificationCapabilitiesV2();
  async function collect(paths: string[], capability: "documentation_literal" | "typescript_union_member", collector?: Collector) {
    if (!paths.length || !capabilities.has(capability) || !collector || !seed.headSha) return [];
    try { return structuredClone(await collector([...new Set(paths)], seed.headSha)); } catch { return []; }
  }
  const [docBlobs, unionBlobs] = await Promise.all([collect(docs.map(plan => plan.path), "documentation_literal", collectors.collectDocumentationArtifacts), collect(unions.map(plan => plan.path), "typescript_union_member", collectors.collectStaticArtifacts)]);
  let scalarBlobs: OrdinaryDocumentationBlob[] = [];
  if (scalarRuntime && collectors.collectScalarArtifacts && seed.headSha) {
    try { scalarBlobs = structuredClone(await collectors.collectScalarArtifacts([...new Set(scalars.map(plan => plan.path))], seed.headSha)); } catch { /* Missing collection cannot prove a violation. */ }
  }
  const scalarResults = new Map<string, Awaited<ReturnType<typeof evaluateOrdinaryScalarPlan>>>();
  for (const plan of scalars) scalarResults.set(plan.requirementId, await evaluateOrdinaryScalarPlan(plan, scalarBlobs, scalarRuntime));
  // Execution is finished. Retain only private bound observations, not raw code.
  scalarBlobs.length = 0;
  const evaluateUnion = unions.length ? (await import("./typescript-union-verification")).evaluateTypeScriptUnionMember : null;
  const originalRequirements = report.requirements.map(row => ({ requirementId: row.requirementId, requirementText: row.requirementText }));
  const authority = input.taskText.trim() ? "authoritative" as const : "author_claim" as const;
  const artifactEvidence: EvidenceItem[] = [];
  function project(): OrdinaryRequirementOutcomes {
    artifactEvidence.length = 0;
    return { version: 1, scope: "selected_source_requirements", requirements: originalRequirements.map(row => {
      const doc = docs.find(plan => plan.legacyRequirementId === row.requirementId);
      const union = unions.find(plan => plan.requirementId === row.requirementId);
      const scalar = scalars.find(plan => plan.requirementId === row.requirementId);
      const scalarResult = scalarResults.get(row.requirementId);
      const typeResult = assignabilityResults.get(row.requirementId);
      const result = doc ? evaluateOrdinaryDocumentationPlan(doc, docBlobs) : union && evaluateUnion ? evaluateUnion(union, unionBlobs) : null;
      if (!result && !scalarResult && !typeResult) return { requirementId: row.requirementId, authority, interpretation: "unavailable", criterion: null, reason: "source_interpretation_unavailable" };
      const state = typeResult?.state ?? scalarResult?.state ?? (result!.state === "supported" ? "satisfied" : result!.state === "contradicted" ? "violated" : "unavailable");
      const evidenceRefs: string[] = [];
      if (state !== "unavailable") {
        const id = `ev_ordinary_${row.requirementId}_c1`;
        // Do not overwrite an existing evidence owner.
        if (report.evidenceIndex.some(item => item.id === id)) throw new Error("Ordinary artifact evidence ID collision.");
        evidenceRefs.push(id);
        artifactEvidence.push({ id, kind: "artifact", label: typeResult ? "TypeScript assignability" : scalar ? "Standalone scalar observation" : "Exact-head source criterion", locator: typeResult?.path ?? (doc ?? union ?? scalar)!.path, confidence: 0.95, summary: typeResult ? `TypeScript ${typeResult.compilerVersion} primitive-to-target assignability ${state === "satisfied" ? "accepted" : "rejected"} under ${typeResult.configPath}; exact-head project sha256:${typeResult.projectDigest}.` : scalar ? `Synchronous standalone ECMAScript scalar observation ${state === "satisfied" ? "matched" : "differed from"} the explicit source criterion; not Node or asynchronous completion evidence; sha256:${scalarResult!.artifactDigest}.` : `${doc ? "Documentation literal" : "Direct union member"} ${state === "satisfied" ? "present" : "absent"} in complete exact-head artifact; sha256:${result!.artifactDigest}.` });
      }
      return { requirementId: row.requirementId, authority, interpretation: "source_explicit", criterion: { criterionId: `${row.requirementId}_c1`, kind: typeResult ? "typescript_assignability" : doc ? "documentation_literal" : union ? "typescript_union_member" : "standalone_scalar", state, evidenceRefs }, reason: state === "satisfied" ? "criterion_satisfied" : state === "violated" ? "criterion_violated" : "evidence_unavailable" };
    }) };
  }
  const ordinaryRequirementOutcomes = project();
  const generatedEvidence = structuredClone(artifactEvidence);
  const expectedEvidence = generatedEvidence.map(item => ({ id: item.id, serialized: JSON.stringify(item) }));
  registerOrdinaryOutcomeValidationContext(ordinaryRequirementOutcomes, (currentInput, currentReport) => {
    if (JSON.stringify(currentReport.source) !== originalSource) return false;
    if (![...scalarResults.values()].every(result => result.validate(currentInput))) return false;
    if (![...assignabilityResults.values()].every(result => result.validate(currentInput))) return false;
    if (currentInput.repositoryPrivate !== input.repositoryPrivate || currentInput.sourceProvenance?.origin !== input.sourceProvenance?.origin || buildGeneralPrObservationSeedV2(currentInput).seedHash !== seed.seedHash || JSON.stringify(originalRequirements) !== JSON.stringify(currentReport.requirements.map(row => ({ requirementId: row.requirementId, requirementText: row.requirementText })))) return false;
    return JSON.stringify(ordinaryRequirementOutcomes) === JSON.stringify(project()) && expectedEvidence.every(item => JSON.stringify(currentReport.evidenceIndex.find(candidate => candidate.id === item.id)) === item.serialized);
  });
  return { ...report, ordinaryRequirementOutcomes, evidenceIndex: [...report.evidenceIndex, ...generatedEvidence], requirements: report.requirements.map((row, index) => ({ ...row, status: ordinaryRequirementStatus(ordinaryRequirementOutcomes.requirements[index]), evidenceRefs: [...new Set([...row.evidenceRefs, ...(ordinaryRequirementOutcomes.requirements[index].criterion?.evidenceRefs ?? [])])] })) };
}
