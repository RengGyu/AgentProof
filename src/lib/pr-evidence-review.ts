import type { ReviewIntentGraphV1, ReviewSourceRefV1 } from "./review-intent";
import type { EvidenceItem, RequirementFinding, VerificationReport, VerificationReportV2 } from "./types";
import type { DashboardReportDetail } from "./github-dashboard-view-model";

export type PrEvidenceRelation = "verified" | "observed" | "candidate" | "collected";

export interface PrEvidenceReviewItem {
  evidenceId: string;
  kind: "code" | "test" | "execution";
  label: string;
  relation: PrEvidenceRelation;
  url?: string;
  line?: number;
  executionMeaning?: string;
  candidateBasis?: string;
  whyInspect?: string;
  reviewQuestion?: string;
  uncertainty?: string;
}

export interface PrEvidenceReviewObjective {
  id: string;
  text: string;
  firstInspection?: PrEvidenceReviewItem;
  goalContext?: string[];
  code: PrEvidenceReviewItem[];
  tests: PrEvidenceReviewItem[];
  execution: PrEvidenceReviewItem[];
  nextInspection: string;
  moreContext?: PrEvidenceReviewItem[];
  sourceRefs?: Array<ReviewSourceRefV1 & {sourceId?:string}>;
  facets?: Array<{ kind: string; sourceRef: ReviewSourceRefV1 }>;
}

export interface PrEvidenceReview {
  mode: "objectives" | "change_summary";
  source: null | {
    kind: "linked_issue" | "pr_author_claim" | "mixed" | "provided_requirement";
    label: string;
    authority: "issue_source" | "author_claim" | "mixed_sources" | "provided_source";
  };
  objectives: PrEvidenceReviewObjective[];
  changes: PrEvidenceReviewItem[];
  nextInspection: string;
  retrievalNote?: string;
  sourceLinks?: Array<{label:string;url:string}>;
}

interface PrEvidenceReviewContext {
  repositoryFullName?: string;
  headSha?: string;
  baseSha?: string;
}

const SAFE_REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SAFE_PATH = /^[A-Za-z0-9_.@+:/#-]+(?:\/[A-Za-z0-9_.@+:#-]+)*$/;
const EXACT_SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export function buildExactGitHubFileUrl(input: {
  repositoryFullName: string;
  revisionSha: string;
  path: string;
  line?: number;
}): string | undefined {
  if (!safeRepository(input.repositoryFullName) || !EXACT_SHA.test(input.revisionSha) || !safePath(input.path)) return undefined;
  if (input.line !== undefined && (!Number.isSafeInteger(input.line) || input.line < 1)) return undefined;
  const encodedPath = input.path.split("/").map(encodeURIComponent).join("/");
  return `https://github.com/${input.repositoryFullName}/blob/${input.revisionSha}/${encodedPath}${input.line ? `#L${input.line}` : ""}`;
}

export function usesPrEvidenceReview(report: NonNullable<DashboardReportDetail["report"]>): boolean {
  return (report.reportSchemaVersion === "verification-report.v2" || report.generalPrAssessmentSummary?.mode === "ordinary_pr")
    && report.generalPrAssessmentSummary?.mode !== "typed_contract_companion"
    && (!report.verificationContract || report.verificationContract.state === "absent");
}

export function buildPrEvidenceReview(report: VerificationReport, context: PrEvidenceReviewContext = {}): PrEvidenceReview {
  const changeSummaryOnly = report.requirements.length === 0;
  const sourceRepository = repositoryFromPullUrl(report.source.url);
  const repositoryFullName = sourceRepository && context.repositoryFullName && sourceRepository !== context.repositoryFullName ? undefined : context.repositoryFullName ?? sourceRepository;
  const headSha = context.headSha ?? report.source.provenance?.headSha;
  const baseSha = context.baseSha ?? report.source.provenance?.baseSha;
  const evidenceById = new Map(report.evidenceIndex.map(item => [item.id, item]));

  const changes = report.evidenceIndex
    .filter(item => evidenceGroup(item) !== null)
    .map(item => reviewItem(item, "collected", repositoryFullName, headSha, baseSha));

  const navigation=(report as VerificationReportV2).reviewCandidates?.navigation;
  if(navigation)return projectNavigation(navigation,changes,context.repositoryFullName ?? repositoryFullName,headSha);

  if (changeSummaryOnly) {
    return {
      mode: "change_summary",
      source: null,
      objectives: [],
      changes,
      nextInspection: firstReviewTarget(report) ?? "Review the collected change and execution evidence.",
    };
  }

  const legacyObjectives = report.requirements.map(requirement => objectiveFor(report, requirement, evidenceById, repositoryFullName, headSha, baseSha));
  const graph = (report as VerificationReportV2).reviewCandidates?.intentGraph;
  const objectives = graph ? projectReviewIntents(graph, legacyObjectives, evidenceById, repositoryFullName, headSha, baseSha) : legacyObjectives;
  const linkedEvidenceIds = new Set(objectives.flatMap((objective) => [...objective.code, ...(objective.moreContext ?? []), ...objective.tests, ...objective.execution].map((item) => item.evidenceId)));
  return {
    mode: "objectives",
    source: sourceForDisplayedRequirements(report.requirements, report.analysisContext),
    objectives,
    ...(graph ? { retrievalNote: retrievalNote(graph) } : {}),
    changes: changes.filter((item) => !linkedEvidenceIds.has(item.evidenceId)),
    nextInspection: objectives[0]?.nextInspection ?? "Link unconfirmed; inspect collected changes separately.",
  };
}

export function buildDashboardPrEvidenceReview(detail: DashboardReportDetail & { repositoryFullName?: string }): PrEvidenceReview | undefined {
  const report = detail.report as (NonNullable<DashboardReportDetail["report"]> & { proofGraph?: VerificationReport["proofGraph"] }) | undefined;
  if (!report || !usesPrEvidenceReview(report)) return undefined;
  if (!report.reviewCandidates?.navigation && report.reviewCandidates?.intentGraph?.repository && detail.repositoryFullName && report.reviewCandidates.intentGraph.repository !== detail.repositoryFullName) detail = { ...detail, repositoryFullName: undefined };
  const evidence = (report.evidenceIndex ?? []).flatMap((item): EvidenceItem[] => item.kind ? [{
    id: item.id,
    kind: item.kind,
    label: item.locator ?? `Evidence ${item.id}`,
    summary: "Bounded evidence metadata.",
    confidence: 0,
    ...(item.locator ? { locator: item.locator } : {}),
    ...(item.codeLocation ? { codeLocation: item.codeLocation } : {}),
  }] : []);
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const changeSummaryOnly = (report.requirements?.length ?? 0) === 0;
  const changes = evidence.filter((item) => evidenceGroup(item) !== null)
    .map((item) => reviewItem(item, "collected", detail.repositoryFullName, detail.headSha, undefined));
  const nextInspection = report.reviewPriority?.[0]?.path
    ? `Inspect ${report.reviewPriority[0].path}.`
    : "Review the collected change and execution evidence.";
  if(report.reviewCandidates?.navigation)return projectNavigation(report.reviewCandidates.navigation,changes,detail.repositoryFullName,detail.headSha);
  if (changeSummaryOnly) return { mode: "change_summary", source: null, objectives: [], changes, nextInspection };

  const legacyObjectives = (report.requirements ?? []).map((requirement): PrEvidenceReviewObjective => {
    const node = report.proofGraph?.nodes.find((item) => item.requirementId === requirement.requirementId);
    const semanticRefs = report.semantic?.requirement_evidence_relations
      .filter((item) => item.requirement_id === requirement.requirementId)
      .map((item) => item.evidence_id) ?? [];
    const refs = unique([...requirement.evidenceRefs, ...(requirement.proofAxes ?? []).flatMap((axis) => axis.evidenceRefs), ...(node?.implementationEvidenceRefs ?? []), ...(node?.targetedTestEvidenceRefs ?? []), ...(node?.executionEvidenceRefs ?? []), ...semanticRefs]);
    const observed = new Set((requirement.proofAxes ?? []).filter((axis) => axis.state === "satisfied" && axis.collectionBasis).flatMap((axis) => axis.evidenceRefs));
    let items = refs.flatMap((ref) => {
      const item = evidenceById.get(ref);
      return item && evidenceGroup(item) ? [{ ...reviewItem(item, observed.has(ref) ? "observed" : "candidate", detail.repositoryFullName, detail.headSha, undefined), ...(semanticRefs.includes(ref) ? { candidateBasis: "Existing semantic relation" } : {}) }] : [];
    });
    if (report.authenticity?.trust === "verified_agentproof") {
      for (const edge of report.reviewCandidates?.retainedRelations ?? []) {
        if (edge.requirementId !== requirement.requirementId) continue;
        const item = evidenceById.get(edge.evidenceId);
        if (item && evidenceGroup(item)) items = mergeReviewItems(items, [reviewItem(item, edge.relation, detail.repositoryFullName, detail.headSha, undefined)]);
      }
    }
    const candidates = report.reviewCandidates?.requirements.find(row => row.requirementId === requirement.requirementId);
    if (candidates) items = mergeReviewItems(items.filter(item=>item.relation!=="candidate" || item.kind==="execution" || item.candidateBasis==="Existing semantic relation"), candidates.candidates.flatMap(candidate => {
      const item = evidenceById.get(candidate.evidenceId);
      return item ? [{ ...reviewItem(item, "candidate", detail.repositoryFullName, detail.headSha, undefined), candidateBasis: candidate.basis === "source_path" ? "Source path match" as const : candidate.basis === "source_identifier" ? "Source identifier match" as const : "Changed token overlap" as const }] : [];
    }));
    if (!candidates && !items.some((item) => item.kind === "code")) {
      for (const path of node?.firstFiles ?? []) {
        for (const item of evidence.filter((item) => (evidenceGroup(item) === "code" || evidenceGroup(item) === "test") && (item.codeLocation?.path ?? item.locator) === path && (!item.codeLocation || !item.locator || item.codeLocation.path === item.locator))) {
          if (!items.some((linked) => linked.evidenceId === item.id)) items.push(reviewItem(item, "candidate", detail.repositoryFullName, detail.headSha, undefined));
        }
      }
    }
    const first = items.find((item) => item.kind === "code") ?? items.find((item) => item.kind === "test") ?? items.find((item) => item.kind === "execution");
    return {
      id: requirement.requirementId,
      text: requirement.requirementText ?? `Requirement ${requirement.requirementId}`,
      code: items.filter((item) => item.kind === "code"),
      tests: items.filter((item) => item.kind === "test"),
      execution: items.filter((item) => item.kind === "execution"),
      nextInspection: first ? `Inspect ${first.label}.` : "Link unconfirmed; inspect collected changes separately.",
    };
  });
  const graph = report.reviewCandidates?.intentGraph;
  const objectives = graph ? projectReviewIntents(graph, legacyObjectives, evidenceById, detail.repositoryFullName, detail.headSha, undefined) : legacyObjectives;
  const linkedEvidenceIds = new Set(objectives.flatMap((objective) => [...objective.code, ...(objective.moreContext ?? []), ...objective.tests, ...objective.execution].map((item) => item.evidenceId)));
  const analysisContext = detail.analysisContext ?? (report as { analysisContext?: VerificationReport["analysisContext"] }).analysisContext;
  return { mode: "objectives", source: sourceForDisplayedRequirements(report.requirements ?? [], analysisContext), objectives, ...(graph ? { retrievalNote: retrievalNote(graph) } : {}), changes: changes.filter((item) => !linkedEvidenceIds.has(item.evidenceId)), nextInspection: objectives[0]?.nextInspection ?? "Link unconfirmed; inspect collected changes separately." };
}

function objectiveFor(
  report: VerificationReport,
  requirement: RequirementFinding,
  evidenceById: ReadonlyMap<string, EvidenceItem>,
  repositoryFullName: string | undefined,
  headSha: string | undefined,
  baseSha: string | undefined,
): PrEvidenceReviewObjective {
  const node = report.proofGraph.nodes.find(item => item.requirementId === requirement.requirementId);
  const semanticRefs = report.semantic?.requirement_evidence_relations
    .filter(item => item.requirement_id === requirement.requirementId)
    .map(item => item.evidence_id) ?? [];
  const refs = unique([
    ...requirement.evidenceRefs,
    ...(requirement.proofAxes ?? []).flatMap((axis) => axis.evidenceRefs),
    ...(node?.implementationEvidenceRefs ?? []),
    ...(node?.targetedTestEvidenceRefs ?? []),
    ...(node?.executionEvidenceRefs ?? []),
    ...semanticRefs,
  ]);
  const observed = new Set((requirement.proofAxes ?? [])
    .filter(axis => axis.state === "satisfied" && axis.collectionBasis)
    .flatMap(axis => axis.evidenceRefs));
  const verified = verifiedEvidenceRefs(report, requirement, node);
  let items = unique([...refs,...verified]).flatMap(ref => {
    const evidence = evidenceById.get(ref);
    const relation = verified.has(ref) ? "verified" : observed.has(ref) ? "observed" : "candidate";
    return evidence && evidenceGroup(evidence) ? [{ ...reviewItem(evidence, relation, repositoryFullName, headSha, baseSha, requirement), ...(semanticRefs.includes(ref) ? { candidateBasis: "Existing semantic relation" } : {}) }] : [];
  });

  const candidates = (report as VerificationReportV2).reviewCandidates?.requirements.find(row => row.requirementId === requirement.requirementId);
  if (candidates) items = mergeReviewItems(items.filter(item=>item.relation!=="candidate" || item.kind==="execution" || item.candidateBasis==="Existing semantic relation"), candidates.candidates.flatMap(candidate => {
    const item = evidenceById.get(candidate.evidenceId);
    return item ? [{ ...reviewItem(item, "candidate", repositoryFullName, headSha, baseSha, requirement), candidateBasis: candidate.basis === "source_path" ? "Source path match" as const : candidate.basis === "source_identifier" ? "Source identifier match" as const : "Changed token overlap" as const }] : [];
  }));
  if (!candidates && !items.some((item) => item.kind === "code")) {
    for (const path of node?.firstFiles ?? []) {
      for (const item of report.evidenceIndex.filter((item) => (evidenceGroup(item) === "code" || evidenceGroup(item) === "test") && (item.codeLocation?.path ?? item.locator) === path && (!item.codeLocation || !item.locator || item.codeLocation.path === item.locator))) {
        if (!items.some((linked) => linked.evidenceId === item.id)) items.push(reviewItem(item, "candidate", repositoryFullName, headSha, baseSha, requirement));
      }
    }
  }
  const first = items.find((item) => item.kind === "code") ?? items.find((item) => item.kind === "test") ?? items.find((item) => item.kind === "execution");
  return {
    id: requirement.requirementId,
    text: requirement.requirementText,
    code: items.filter(item => item.kind === "code"),
    tests: items.filter(item => item.kind === "test"),
    execution: items.filter(item => item.kind === "execution"),
    nextInspection: first ? `Inspect ${first.label}.` : "Link unconfirmed; inspect collected changes separately.",
  };
}

function reviewItem(
  evidence: EvidenceItem,
  relation: PrEvidenceRelation,
  repositoryFullName: string | undefined,
  headSha: string | undefined,
  baseSha: string | undefined,
  requirement?: RequirementFinding,
): PrEvidenceReviewItem {
  const kind = evidenceGroup(evidence)!;
  const location = evidence.codeLocation;
  const path = location?.path ?? evidence.locator ?? evidence.label;
  const revision = codeRevision(evidence, headSha, baseSha);
  const canonicalLocation = location && (!evidence.locator || evidence.locator === location.path);
  const url = kind !== "execution" && repositoryFullName && revision && canonicalLocation
    ? buildExactGitHubFileUrl({ repositoryFullName, revisionSha: revision, path: location.path, ...(location.line ? { line: location.line } : {}) })
    : kind === "execution" ? safeGitHubUrl(evidence.locator, repositoryFullName) : undefined;
  return {
    evidenceId: evidence.id,
    kind,
    label: path,
    relation,
    ...(url ? { url } : {}),
    ...(url && location?.line ? { line: location.line } : {}),
    ...(kind === "execution" ? { executionMeaning: executionMeaning(evidence, requirement) } : {}),
  };
}

function evidenceGroup(item: EvidenceItem): PrEvidenceReviewItem["kind"] | null {
  if (item.kind === "diff" || item.kind === "changed_file" || item.kind === "artifact") return "code";
  if (item.kind === "test") return "test";
  if (item.kind === "check" || item.kind === "log") return "execution";
  return null;
}

function codeRevision(item: EvidenceItem, headSha: string | undefined, baseSha: string | undefined): string | undefined {
  const location = item.codeLocation;
  if (!location || !safePath(location.path)) return undefined;
  const contextual = location.side === "base" ? baseSha : headSha;
  if (location.revisionSha && EXACT_SHA.test(location.revisionSha)) {
    if (contextual && EXACT_SHA.test(contextual) && contextual !== location.revisionSha) return undefined;
    return location.revisionSha;
  }
  return contextual && EXACT_SHA.test(contextual) ? contextual : undefined;
}

function executionMeaning(item: EvidenceItem, requirement: RequirementFinding | undefined): string {
  const axis = requirement?.proofAxes?.find(candidate => candidate.subject === "execution" && candidate.evidenceRefs.includes(item.id));
  if (axis?.collectionBasis === "passing_suite_execution") return "Repository suite passed; individual test execution is not established.";
  if (axis?.collectionBasis === "passing_execution") return "A requirement-linked check passed; individual test execution is not established.";
  if (axis?.collectionBasis === "failed_execution") return "A relevant check reported failure; inspect the recorded failure evidence.";
  return "Execution evidence was collected; it does not by itself establish individual test execution.";
}

function verifiedEvidenceRefs(
  report: VerificationReport,
  requirement: RequirementFinding,
  node: VerificationReport["proofGraph"]["nodes"][number] | undefined,
): Set<string> {
  const refs = new Set<string>();
  const add = (value: string | undefined) => { if (value) refs.add(value); };
  add(node?.caseCoverageReceipt?.implementationEvidenceRef);
  add(node?.caseCoverageReceipt?.testEvidenceRef);

  for (const receipt of report.proofGraph.executionBindingReceipts ?? []) {
    if (receipt.requirementId !== requirement.requirementId) continue;
    add(receipt.testEvidenceRef);
    add(receipt.executionEvidenceRef);
  }
  for (const receipt of report.proofGraph.testRelationReceipts ?? []) {
    if (receipt.subjectRequirementId !== requirement.requirementId) continue;
    add(receipt.testEvidenceRef);
    add(receipt.executionEvidenceRef);
  }
  for (const receipt of report.proofGraph.privateReceiptBundleV2?.testRelationReceipts ?? []) {
    const requirementId = receipt.version === 1 ? receipt.subjectRequirementId : receipt.requirementId;
    if (requirementId !== requirement.requirementId) continue;
    if (receipt.version === 2) add(receipt.implementationEvidenceRef);
    add(receipt.testEvidenceRef);
    if (receipt.version === 1) add(receipt.executionEvidenceRef);
  }
  for (const receipt of report.proofGraph.privateReceiptBundleV2?.executionBindingReceipts ?? []) {
    if (receipt.requirementId !== requirement.requirementId) continue;
    add(receipt.testEvidenceRef);
    add(receipt.executionEvidenceRef);
  }
  return refs;
}

function sourceForDisplayedRequirements(
  requirements: ReadonlyArray<Pick<RequirementFinding, "sourceAuthority">>,
  analysisContext: VerificationReport["analysisContext"] | undefined
): PrEvidenceReview["source"] {
  const hasPrAuthorRequirement = requirements.some((requirement) => requirement.sourceAuthority === "pr_description");
  const hasCanonicalRequirement = requirements.some((requirement) => requirement.sourceAuthority !== "pr_description");
  if (hasPrAuthorRequirement && hasCanonicalRequirement) return sourceForMixedContext(analysisContext);
  if (hasPrAuthorRequirement) return sourceForState("pr_author_claim");
  if (hasCanonicalRequirement && analysisContext === "linked_issue") return sourceForState("linked_issue");
  if (hasCanonicalRequirement && analysisContext === "provided_requirement") return sourceForState("provided_requirement");
  if (hasCanonicalRequirement && analysisContext === "unlinked_pr") return sourceForState("pr_author_claim");
  return null;
}

function sourceForMixedContext(analysisContext: VerificationReport["analysisContext"] | undefined): NonNullable<PrEvidenceReview["source"]> {
  return {
    kind: "mixed",
    label: analysisContext === "linked_issue"
      ? "Linked issue and PR author sources"
      : analysisContext === "provided_requirement"
        ? "Provided requirement and PR author sources"
        : "Mixed requirement sources",
    authority: "mixed_sources"
  };
}

function sourceForState(state: NonNullable<VerificationReportV2["generalPrAssessmentSummary"]>["sourceState"] | "provided_requirement"): PrEvidenceReview["source"] {
  if (state === "linked_issue") return { kind: "linked_issue", label: "Linked issue requirement source", authority: "issue_source" };
  if (state === "pr_author_claim") return { kind: "pr_author_claim", label: "PR author objective / claim", authority: "author_claim" };
  if (state === "mixed") return { kind: "mixed", label: "Linked issue and PR author sources", authority: "mixed_sources" };
  return { kind: "provided_requirement", label: "Provided requirement source", authority: "provided_source" };
}

function repositoryFromPullUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || parts.length !== 4 || parts[2] !== "pull" || !/^[1-9]\d*$/.test(parts[3] ?? "")) return undefined;
    const repository = `${parts[0]}/${parts[1]}`;
    return safeRepository(repository) ? repository : undefined;
  } catch {
    return undefined;
  }
}

function safePath(value: string): boolean {
  const segments = value.split("/");
  return value.length <= 240 && SAFE_PATH.test(value) && !value.startsWith("/") && !segments.includes("..") && !segments.includes(".");
}

function safeRepository(value: string): boolean {
  return SAFE_REPOSITORY.test(value) && value.split("/").every(segment => segment !== "." && segment !== "..");
}

function safeGitHubUrl(value: string | undefined, repositoryFullName: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com" || url.username || url.password || url.port) return undefined;
    if (repositoryFullName && !url.pathname.startsWith(`/${repositoryFullName}/`)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function firstReviewTarget(report: VerificationReport): string | undefined {
  const target = report.reviewPriority.find(item => item.path !== "Requirement evidence" && item.path !== "Changed files" && item.path !== "Test/build checks");
  return target ? `Inspect ${target.path}: ${target.reason}` : undefined;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Stronger deterministic grades win; candidate fusion cannot erase their provenance. */
function mergeReviewItems(...groups: PrEvidenceReviewItem[][]): PrEvidenceReviewItem[] {
  const rank = { verified: 3, observed: 2, candidate: 1, collected: 0 };
  const items = new Map<string, PrEvidenceReviewItem>();
  for (const item of groups.flat()) {
    const old = items.get(item.evidenceId);
    if (!old || rank[item.relation] > rank[old.relation]) items.set(item.evidenceId,item);
  }
  return [...items.values()].sort((a,b)=>rank[b.relation]-rank[a.relation] || (rank[a.relation]>1 ? a.label.localeCompare(b.label) || a.evidenceId.localeCompare(b.evidenceId) : 0));
}

function projectReviewIntents(graph: ReviewIntentGraphV1, objectives: PrEvidenceReviewObjective[], evidence: ReadonlyMap<string,EvidenceItem>, repository: string|undefined, head: string|undefined, base: string|undefined): PrEvidenceReviewObjective[] {
  const assigned = new Set<string>();
  const projected = graph.goals.map(goal => {
    const legacy = goal.requirementIds.flatMap(id=>objectives.filter(o=>o.id===id));
    for(const o of legacy)assigned.add(o.id);
    const retained=legacy.flatMap(o=>[...o.code,...o.tests,...o.execution]).filter(i=>i.relation!=="candidate"||i.kind==="execution" || i.candidateBasis==="Existing semantic relation");
    const candidates=graph.edges.filter(e=>e.goalId===goal.id).flatMap(edge=>{
      const chunk=graph.chunks.find(c=>c.id===edge.chunkId);if(!chunk)return [];
      const contextual=chunk.side==="base"?base:head;
      if(contextual && chunk.revision && contextual!==chunk.revision)return [];
      if(graph.repository && repository && graph.repository!==repository)return [];
      if(chunk.evidenceId){
        const item=evidence.get(chunk.evidenceId);
        if(!item || (item.codeLocation?.path??item.locator)!==chunk.path || item.codeLocation?.revisionSha && chunk.revision && item.codeLocation.revisionSha!==chunk.revision)return [];
        return [{...reviewItem(item,"candidate",repository,head,base),candidateBasis:`Candidate: ${edge.basis.join(" + ")}`}];
      }
      const url=repository && graph.repository===repository && chunk.revision ? buildExactGitHubFileUrl({repositoryFullName:repository,revisionSha:chunk.revision,path:chunk.path,line:chunk.startLine}) : undefined;
      return [{evidenceId:chunk.id,kind:/test|spec/i.test(chunk.path)?"test" as const:"code" as const,label:chunk.path,relation:"candidate" as const,...(url?{url,line:chunk.startLine}:{}),candidateBasis:`Available snapshot: ${edge.basis.join(" + ")}`}];
    });
    const items=mergeReviewItems(retained,candidates);
    const code=items.filter(i=>i.kind==="code"), tests=items.filter(i=>i.kind==="test"), execution=items.filter(i=>i.kind==="execution" || i.candidateBasis==="Existing semantic relation");
    const first=code[0]??tests[0]??execution[0];
    return {id:goal.id,text:legacy[0]?.text??`Review goal at source offset ${goal.sourceRefs[0]!.start}`,code,tests,execution,moreContext:code.slice(1),sourceRefs:goal.sourceRefs,facets:goal.facets,nextInspection:first?`Inspect ${first.label}.`:"Link unconfirmed; not found does not mean not implemented."};
  });
  // Unmapped legacy objectives retain their evidence; a parser ceiling must not erase it.
  return [...projected,...objectives.filter(o=>!assigned.has(o.id))];
}

function retrievalNote(graph:ReviewIntentGraphV1):string {
  return `Search: changed diffs and ${graph.capabilities.snapshotChunks} supplied exact-head snapshot chunks. Whole-repository search, embeddings and symbol resolution unavailable. Existing semantic links are candidates only.${graph.capabilities.truncated?" Retrieval input or results truncated.":""}${graph.capabilities.rejectedSnapshots?` ${graph.capabilities.rejectedSnapshots} stale, unsafe or conflicting snapshots excluded.`:""}`;
}

/** Captured before receipt-stripping; used only by authenticated tenant projections. */
export function captureReviewRelations(report:VerificationReport):NonNullable<NonNullable<VerificationReportV2["reviewCandidates"]>["retainedRelations"]> {
  return report.requirements.flatMap(requirement=>{
    const verified=verifiedEvidenceRefs(report,requirement,report.proofGraph.nodes.find(n=>n.requirementId===requirement.requirementId));
    const observed=(requirement.proofAxes??[]).filter(a=>a.state==="satisfied"&&a.collectionBasis).flatMap(a=>a.evidenceRefs);
    return unique([...verified,...observed]).filter(id=>report.evidenceIndex.some(e=>e.id===id)).map(evidenceId=>({requirementId:requirement.requirementId,evidenceId,relation:verified.has(evidenceId)?"verified" as const:"observed" as const}));
  });
}

function projectNavigation(nav:import("./review-intent").ReviewNavigation,changes:PrEvidenceReviewItem[],repository:string|undefined,head:string|undefined):PrEvidenceReview {
  const bound=(!repository||repository===nav.repository)&&(!head||head===nav.headSha);
  const objectives=nav.goals.map(goal=>{
    const items=bound?goal.candidates.flatMap(edge=>{
      const a=nav.artifacts.find(a=>a.id===edge.artifactId);if(!a)return [];
      return [{evidenceId:a.id,kind:a.kind,label:a.path,relation:"candidate" as const,line:a.startLine,...(nav.repository?{url:buildExactGitHubFileUrl({repositoryFullName:nav.repository,revisionSha:a.revision,path:a.path,line:a.startLine})}:{}),whyInspect:edge.whyInspect,reviewQuestion:edge.reviewQuestion,uncertainty:edge.uncertainty}];
    }):[];
    const firstInspection=items.find(i=>i.evidenceId===goal.firstInspection);
    return {id:goal.id,text:goal.summary,sourceRefs:goal.sourceRefs,goalContext:[`${goal.emphasis} · ${goal.authority}`,...goal.facets.map(f=>`${f.kind==='motivation'?'Author-stated motivation':f.kind==='implementation_claim'?'Author implementation claim':f.kind==='test_claim'?'Author test claim':f.kind}: ${f.summary} (${['motivation','implementation_claim','test_claim'].includes(f.kind)?'unverified; ':''}${f.sourceRefs.map(r=>`${r.sourceId} ${r.start}–${r.end}`).join(', ')})`),...goal.openQuestions,...goal.uncertainty],...(firstInspection?{firstInspection}:{}),code:items.filter(i=>i.kind==="code"),tests:items.filter(i=>i.kind==="test"),execution:[],nextInspection:firstInspection?`Inspect ${firstInspection.label}. ${firstInspection.whyInspect}`:"No ranked first location; inspect collected evidence without a recommendation."};
  });
  const authorities=[...new Set(nav.sources.map(s=>s.authority))];
  const authority=authorities.length>1?'mixed_sources':authorities[0]??'provided_source';
  const kind=authority==='issue_source'?'linked_issue':authority==='pr_author_claim'?'pr_author_claim':authority==='mixed_sources'?'mixed':'provided_requirement';
  return {mode:objectives.length?'objectives':'change_summary',sourceLinks:nav.sources.filter((s,index,all)=>all.findIndex(other=>other.url===s.url)===index).flatMap(s=>s.url?[{label:s.authority.replaceAll('_',' '),url:s.url}]:[]),source:nav.sources.length?{kind,authority:authority==='pr_author_claim'?'author_claim':authority,label:authority.replaceAll('_',' ')}:null,objectives,changes:bound?changes:changes.map(({url:_,...item})=>item),nextInspection:objectives[0]?.nextInspection??'Goal interpretation unavailable; source and unranked collected changes remain available.',retrievalNote:`Bounded supplied-artifact search; whole repository not searched.`};
}
