import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PullRequestInput } from "../src/lib/types";
import {
  evaluatePrEvidenceReviewCase,
  evaluatePrEvidenceReviewCorpus,
  firstDisplayedInspectionPath,
  inputForProfile,
  scoreDisplayedSource,
  scoreFirstInspection,
  type PrEvidenceReviewEvaluationFixture
} from "./pr-evidence-review-evaluation";

const ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_PATH = process.env.AGENTPROOF_PR_EVIDENCE_EVAL_OUTPUT;

function readJsonl<T>(path: string): T[] {
  return readFileSync(resolve(ROOT, path), "utf8").trim().split("\n").map((line) => JSON.parse(line) as T);
}

describe("PR-to-Evidence Review evaluation", () => {
  it("preserves independently specified synthetic paths, sources, links, failure evidence, storage, and privacy", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("external calls are forbidden")));
    vi.stubGlobal("fetch", fetchMock);
    const fixtures = readJsonl<PrEvidenceReviewEvaluationFixture>("eval/fixtures/pr-evidence-review.synthetic.jsonl");

    const expectationFailures: string[] = [];
    for (const fixture of fixtures) {
      const result = await evaluatePrEvidenceReviewCase({ id: fixture.id, input: fixture.input });
      expect(result.status).toBe("complete");
      if (result.status !== "complete") continue;
      if (result.mode !== fixture.expected?.mode) expectationFailures.push(`${fixture.id}:mode`);
      if (result.sourceKind !== fixture.expected?.sourceKind) expectationFailures.push(`${fixture.id}:sourceKind`);
      if (JSON.stringify(result.displayedPaths) !== JSON.stringify(fixture.expected?.displayedPaths)) expectationFailures.push(`${fixture.id}:displayedPaths`);
      if (JSON.stringify(result.projectionCodeLinks) !== JSON.stringify([...(fixture.expected?.headLinks ?? []), ...(fixture.expected?.baseLinks ?? [])])) expectationFailures.push(`${fixture.id}:projectionCodeLinks`);
      if (result.ssr.ciFailureVisible !== fixture.expected?.ciFailureVisible) expectationFailures.push(`${fixture.id}:ciFailureVisible`);
      if (result.ssr.purposeWarningVisible !== fixture.expected?.purposeWarningVisible) expectationFailures.push(`${fixture.id}:purposeWarningVisible`);
      expect(result.storageRoundTrip).toEqual({ valid: true, displayedPathsPreserved: true, codeLinksPreserved: true });
      expect(result.execution.unbackedItemCount).toBe(0);
      expect(result.execution.passingLanguageWithoutPassingEvidenceCount).toBe(0);
      expect(result.portableSummaryContainsCodeLocation).toBe(false);
      expect(result.ssr.rendered).toBe(true);
      expect(result.ssr.inputLimitationsPreserved).toBe(true);
      expect(JSON.stringify(result)).not.toContain("cache.clear");
    }

    expect(expectationFailures).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("excludes invalid measured samples instead of recording zero latency", async () => {
    const [fixture] = readJsonl<PrEvidenceReviewEvaluationFixture>("eval/fixtures/pr-evidence-review.synthetic.jsonl");
    const invalidInput = {
      ...fixture!.input,
      changedFiles: [{ path: "", status: "modified" }]
    } as unknown as PullRequestInput;
    const result = await evaluatePrEvidenceReviewCorpus([{ id: "invalid", input: invalidInput }], { warmupRuns: 0, measuredRuns: 2 });

    expect(result.cases[0]?.status).toBe("invalid");
    expect(result.performance.failedMeasuredSamples).toBe(2);
    expect(result.performance.pipelineMs).toEqual(expect.objectContaining({ count: 0, excludedCount: 2, p50: null, p95: null }));
    expect(result.performance.projectionAndSsrMs).toEqual(expect.objectContaining({ count: 0, excludedCount: 2, p50: null, p95: null }));
  });

  it("scores first inspection with missing predictions as misses and only rank one as a hit", () => {
    const references = [
      { id: "a", goal: "A", allowedPaths: ["src/a.ts"], rationale: "A path.", expectedSourceKind: "linked_issue" as const },
      { id: "b", goal: "B", allowedPaths: ["src/b.ts"], rationale: "B path.", expectedSourceKind: "linked_issue" as const },
      { id: "c", goal: "C", allowedPaths: ["src/c.ts"], rationale: "C path.", expectedSourceKind: "linked_issue" as const }
    ];
    const predictions = [
      { id: "a", rankedPaths: ["src/wrong.ts", "src/a.ts"], sourceKind: "pr_author_claim" as const },
      { id: "b", rankedPaths: [], sourceKind: null },
      { id: "c", rankedPaths: ["src/c.ts", "src/wrong.ts"], sourceKind: "linked_issue" as const }
    ];

    expect(scoreFirstInspection(references, predictions)).toEqual(expect.objectContaining({
      hitAt1: { numerator: 1, denominator: 3, rate: 1 / 3 },
      precisionWhenPresented: { numerator: 1, denominator: 2, rate: 0.5 },
      coverage: { numerator: 2, denominator: 3, rate: 2 / 3 },
      missingCount: 1
    }));
    expect(scoreDisplayedSource(references, predictions)).toEqual(expect.objectContaining({
      correctOverAll: { numerator: 1, denominator: 3, rate: 1 / 3 },
      accuracyWhenPresented: { numerator: 1, denominator: 2, rate: 0.5 },
      coverage: { numerator: 2, denominator: 3, rate: 2 / 3 },
      unpresentedCount: 1
    }));
  });

  it("rejects unknown, duplicate, and oracle-bearing scoring inputs", () => {
    const references = [{ id: "a", goal: "A", allowedPaths: ["src/a.ts"], rationale: "A path.", expectedSourceKind: "linked_issue" as const }];
    expect(() => scoreFirstInspection(references, [{ id: "unknown", rankedPaths: ["src/a.ts"], sourceKind: null }])).toThrow(/unknown/i);
    expect(() => scoreFirstInspection(references, [{ id: "a", rankedPaths: [] }, { id: "a", rankedPaths: [] }])).toThrow(/duplicate/i);
    expect(() => scoreFirstInspection([{ ...references[0]!, oracle: { hidden: true } } as unknown as typeof references[number]], [{ id: "a", rankedPaths: [] }])).toThrow(/unsupported/i);
    expect(() => scoreFirstInspection(references, [{ id: "a", rankedPaths: [], taskText: "leak" } as unknown as Parameters<typeof scoreFirstInspection>[1][number]])).toThrow(/unsupported/i);
  });

  it("scores only a first inspection path that the active review mode actually renders", () => {
    const objectiveReview = {
      mode: "objectives" as const,
      source: null,
      objectives: [{ id: "req", text: "Requirement", code: [], tests: [], execution: [], nextInspection: "Review the evidence." }],
      changes: [],
      nextInspection: "Inspect hidden.ts: hidden global recommendation."
    };
    expect(firstDisplayedInspectionPath(objectiveReview, ["hidden.ts"])).toBeNull();
    expect(firstDisplayedInspectionPath({
      ...objectiveReview,
      objectives: [{ ...objectiveReview.objectives[0]!, code: [{ evidenceId: "ev", kind: "code", label: "src/a.ts", relation: "observed" }], nextInspection: "Inspect src/a.ts before approval." }]
    }, ["src/a.ts", "hidden.ts"])).toBe("src/a.ts");
    expect(firstDisplayedInspectionPath({
      ...objectiveReview,
      mode: "change_summary",
      objectives: [],
      changes: [{ evidenceId: "ev", kind: "code", label: "hidden.ts", relation: "collected" }],
      nextInspection: "Inspect hidden.ts: visible recommendation."
    }, ["hidden.ts"])).toBe("hidden.ts");
  });

  it("keeps generation independent from oracle and expected reference fields", async () => {
    const [fixture] = readJsonl<PrEvidenceReviewEvaluationFixture>("eval/fixtures/pr-evidence-review.synthetic.jsonl");
    const firstInput = { ...fixture!, oracle: { hidden: "one" }, expected: undefined } as unknown as Pick<PrEvidenceReviewEvaluationFixture, "id" | "input">;
    const secondInput = { ...fixture!, oracle: { hidden: "two" }, expected: { unrelated: true } } as unknown as Pick<PrEvidenceReviewEvaluationFixture, "id" | "input">;
    const first = await evaluatePrEvidenceReviewCase(firstInput);
    const second = await evaluatePrEvidenceReviewCase(secondInput);
    expect(first).toEqual(second);
  });

  it("evaluates all ten unmodified diverse fixtures and labels semantics and human usability as not evaluated", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("external calls are forbidden")));
    vi.stubGlobal("fetch", fetchMock);
    const fixtures = readJsonl<PrEvidenceReviewEvaluationFixture>("eval/fixtures/swebench-verified.diverse.jsonl");
    const result = await evaluatePrEvidenceReviewCorpus(fixtures, { warmupRuns: 1, measuredRuns: 3 });

    expect(result.caseCount).toBe(10);
    expect(result.externalCallCount).toBe(0);
    expect(result.cases).toHaveLength(10);
    expect(result.cases.every((item) => item.status === "complete")).toBe(true);
    for (const item of result.cases) {
      if (item.status !== "complete") continue;
      expect(item.displayedFileCoverage.rate).toBe(1);
      expect(item.execution.unbackedItemCount).toBe(0);
      expect(item.execution.passingLanguageWithoutPassingEvidenceCount).toBe(0);
      expect(item.generatedRequirementCount).toBeGreaterThan(0);
      expect(item.observationBundleObjectiveCount).toBe(0);
      expect(item.assessmentOverallConclusion).toBe("no_assessable_claims");
      expect(item.assessmentTargetCount).toBe(0);
      expect(item.changeSummaryConditions).toEqual([]);
      expect(item.mode).toBe("objectives");
      expect(item.objectiveProjection).not.toBeNull();
      expect(item.objectiveProjection?.representedRequirementIds).toHaveLength(item.generatedRequirementCount);
      expect(item.objectiveProjection).toMatchObject({
        missingRequirementIds: [],
        unknownRequirementIds: [],
        missingObjectiveIds: [],
        unexpectedObjectiveIds: [],
        duplicateObjectiveIds: [],
        sourceReferenceMismatches: []
      });
      expect(item.sourceLimitations).toEqual(expect.arrayContaining([
        "task_source_not_recorded",
        "pull_request_url_not_available",
        "exact_head_sha_not_available",
        "exact_base_sha_not_available"
      ]));
    }
    expect(result.semanticRelevanceAccuracy).toBeNull();
    expect(result.humanTaskCompletionTime).toBeNull();
    expect(result.humanLinkArrivalSuccess).toBeNull();
    expect(result.performance.pipelineMs.count).toBe(30);
    expect(result.performance.projectionAndSsrMs.count).toBe(30);
    expect(result.performance.failedMeasuredSamples).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs the same ten cases with only the recorded issue source added as a separate profile", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("external calls are forbidden")));
    vi.stubGlobal("fetch", fetchMock);
    const fixtures = readJsonl<PrEvidenceReviewEvaluationFixture>("eval/fixtures/swebench-verified.diverse.jsonl");
    for (const fixture of fixtures) {
      const adapted = inputForProfile(fixture.input, "source_adapted");
      const { taskSource: _adaptedSource, ...adaptedRest } = adapted;
      const { taskSource: _originalSource, ...originalRest } = fixture.input;
      expect(adapted.taskSource).toBe("issue");
      expect(adaptedRest).toEqual(originalRest);
    }

    const result = await evaluatePrEvidenceReviewCorpus(fixtures, { profile: "source_adapted", warmupRuns: 1, measuredRuns: 3 });
    expect(result.profile).toBe("source_adapted");
    expect(result.caseCount).toBe(10);
    expect(result.externalCallCount).toBe(0);
    for (const item of result.cases) {
      if (item.status !== "complete") continue;
      expect(item.advisorySourceState).toBe("linked_issue");
      expect(item.generatedRequirementCount).toBeGreaterThan(0);
      expect(item.observationBundleObjectiveCount).toBe(0);
      expect(item.assessmentOverallConclusion).toBe("no_assessable_claims");
      expect(item.assessmentTargetCount).toBe(0);
      expect(item.changeSummaryConditions).toEqual([]);
      expect(item.mode).toBe("objectives");
      expect(item.objectiveProjection).not.toBeNull();
      expect(item.objectiveProjection?.representedRequirementIds).toHaveLength(item.generatedRequirementCount);
      expect(item.objectiveProjection).toMatchObject({
        missingRequirementIds: [],
        unknownRequirementIds: [],
        missingObjectiveIds: [],
        unexpectedObjectiveIds: [],
        duplicateObjectiveIds: [],
        sourceReferenceMismatches: []
      });
      expect(item.sourceLimitations).not.toContain("task_source_not_recorded");
      expect(item.sourceLimitations).toEqual(expect.arrayContaining([
        "pull_request_url_not_available",
        "exact_head_sha_not_available",
        "exact_base_sha_not_available"
      ]));
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  (OUTPUT_PATH ? it : it.skip)("writes the bounded evaluation artifact when explicitly requested", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("external calls are forbidden")));
    vi.stubGlobal("fetch", fetchMock);
    const diversePath = resolve(ROOT, "eval/fixtures/swebench-verified.diverse.jsonl");
    const syntheticPath = resolve(ROOT, "eval/fixtures/pr-evidence-review.synthetic.jsonl");
    const diverseBytes = readFileSync(diversePath);
    const syntheticBytes = readFileSync(syntheticPath);
    const diverse = diverseBytes.toString("utf8").trim().split("\n").map((line) => JSON.parse(line) as PrEvidenceReviewEvaluationFixture);
    const synthetic = syntheticBytes.toString("utf8").trim().split("\n").map((line) => JSON.parse(line) as PrEvidenceReviewEvaluationFixture);
    const syntheticCases = [];
    for (const fixture of synthetic) {
      const result = await evaluatePrEvidenceReviewCase({ id: fixture.id, input: fixture.input });
      syntheticCases.push({ result, expectationFailures: compareExpected(result, fixture) });
    }
    const asIs = await evaluatePrEvidenceReviewCorpus(diverse, { profile: "as_is", warmupRuns: 1, measuredRuns: 3 });
    const sourceAdapted = await evaluatePrEvidenceReviewCorpus(diverse, { profile: "source_adapted", warmupRuns: 1, measuredRuns: 3 });
    const referencePath = resolve(ROOT, "eval/fixtures/pr-evidence-review.references.json");
    const referenceBytes = readFileSync(referencePath);
    const referenceDocument = JSON.parse(referenceBytes.toString("utf8")) as {
      expectedSourceKind: "linked_issue";
      references: Array<Omit<Parameters<typeof scoreFirstInspection>[0][number], "expectedSourceKind">>;
    };
    const references = referenceDocument.references.map((reference) => ({
      ...reference,
      expectedSourceKind: referenceDocument.expectedSourceKind
    }));
    const asIsPredictions = predictionsFromEvaluation(asIs);
    const sourceAdaptedPredictions = predictionsFromEvaluation(sourceAdapted);
    const baselinePredictions = diverse.map((fixture) => ({
      id: fixture.id,
      rankedPaths: fixture.input.changedFiles[0]?.path ? [fixture.input.changedFiles[0].path] : [],
      sourceKind: null
    }));
    const artifact = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      fixtureHashes: {
        diverseSha256: createHash("sha256").update(diverseBytes).digest("hex"),
        syntheticSha256: createHash("sha256").update(syntheticBytes).digest("hex"),
        referenceSha256: createHash("sha256").update(referenceBytes).digest("hex")
      },
      evaluationBoundary: {
        rawInputPersisted: false,
        providerOrNetworkCallsAllowed: false,
        semanticRelevanceGoldAvailable: false,
        humanUsabilityStudyRun: false,
        diverseFixtureIsHoldout: false,
        patchExcerptPolicy: "existing bounded fixture; at most 900 bytes per file and 1500 bytes per case",
        sourceAdaptation: "taskSource=issue only; as-is and source-adapted results remain separate"
      },
      synthetic: {
        runnerStatus: "passed",
        caseCount: syntheticCases.length,
        expectationCheckCount: syntheticCases.length * 6,
        productExpectationFailureCount: syntheticCases.reduce((sum, item) => sum + item.expectationFailures.length, 0),
        cases: syntheticCases
      },
      profiles: {
        asIs: { summary: summarizeProfile(asIs), evaluation: asIs },
        sourceAdapted: { summary: summarizeProfile(sourceAdapted), evaluation: sourceAdapted }
      },
      scoring: {
        referenceProvenance: "supervisor AI-reviewed provisional; not human gold or holdout",
        firstInspection: {
          baselineFirstChangedFile: scoreFirstInspection(references, baselinePredictions),
          asIs: scoreFirstInspection(references, asIsPredictions),
          sourceAdapted: scoreFirstInspection(references, sourceAdaptedPredictions)
        },
        displayedSource: {
          asIs: scoreDisplayedSource(references, asIsPredictions),
          sourceAdapted: scoreDisplayedSource(references, sourceAdaptedPredictions)
        }
      }
    };
    const serialized = `${JSON.stringify(artifact, null, 2)}\n`;

    expect(artifact.fixtureHashes.diverseSha256).toBe("452c12d0e0a0ed4566b49c62ee406bae610a54167f29a2cf2831a39de6b30bcb");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain('"taskText"');
    expect(serialized).not.toContain('"patch"');
    mkdirSync(dirname(resolve(ROOT, OUTPUT_PATH!)), { recursive: true });
    writeFileSync(resolve(ROOT, OUTPUT_PATH!), serialized, { flag: "wx" });
  });
});

function compareExpected(result: Awaited<ReturnType<typeof evaluatePrEvidenceReviewCase>>, fixture: PrEvidenceReviewEvaluationFixture): string[] {
  if (result.status !== "complete" || !fixture.expected) return ["evaluation_incomplete"];
  const failures: string[] = [];
  if (result.mode !== fixture.expected.mode) failures.push("mode");
  if (result.sourceKind !== fixture.expected.sourceKind) failures.push("sourceKind");
  if (JSON.stringify(result.displayedPaths) !== JSON.stringify(fixture.expected.displayedPaths)) failures.push("displayedPaths");
  if (JSON.stringify(result.projectionCodeLinks) !== JSON.stringify([...fixture.expected.headLinks, ...fixture.expected.baseLinks])) failures.push("projectionCodeLinks");
  if (result.ssr.ciFailureVisible !== fixture.expected.ciFailureVisible) failures.push("ciFailureVisible");
  if (result.ssr.purposeWarningVisible !== fixture.expected.purposeWarningVisible) failures.push("purposeWarningVisible");
  return failures;
}

function summarizeProfile(result: Awaited<ReturnType<typeof evaluatePrEvidenceReviewCorpus>>) {
  const complete = result.cases.filter((item) => item.status === "complete");
  return {
    caseCompletion: { numerator: complete.length, denominator: result.caseCount, rate: complete.length / result.caseCount },
    fullDisplayedFileCoverage: { numerator: complete.filter((item) => item.displayedFileCoverage.rate === 1).length, denominator: result.caseCount, rate: complete.filter((item) => item.displayedFileCoverage.rate === 1).length / result.caseCount },
    executionInvariantPass: { numerator: complete.filter((item) => item.execution.unbackedItemCount === 0 && item.execution.passingLanguageWithoutPassingEvidenceCount === 0).length, denominator: result.caseCount, rate: complete.filter((item) => item.execution.unbackedItemCount === 0 && item.execution.passingLanguageWithoutPassingEvidenceCount === 0).length / result.caseCount },
    semanticRelevanceAccuracy: null,
    humanTaskCompletionTime: null,
    humanLinkArrivalSuccess: null
  };
}

function predictionsFromEvaluation(result: Awaited<ReturnType<typeof evaluatePrEvidenceReviewCorpus>>) {
  return result.cases.map((item) => item.status === "complete"
    ? { id: item.id, rankedPaths: item.firstInspectionPath ? [item.firstInspectionPath] : [], sourceKind: item.sourceKind }
    : { id: item.id, rankedPaths: [], sourceKind: null });
}

describe('durable local navigation diagnostics',()=>{
 it('keeps each mock execution in a unique file with supplied references and provider metadata',async()=>{
  const {mkdtempSync,readdirSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const {submitReviewNavigationWithGemini}=await import('../src/lib/gemini-navigation');const root=mkdtempSync(join(tmpdir(),'navigation-files-test-'));
  const input:PullRequestInput={title:'Queue cleanup',description:'Inspect pending work.',taskText:'Inspect pending work.',taskSource:'issue',url:'https://github.com/acme/queue/pull/1',repositoryPrivate:false,changedFiles:[{path:'src/queue.ts',patch:'@@ -1 +1 @@\n+pending();',status:'modified'}],checks:[],logs:[],sourceProvenance:{version:1,origin:'github_snapshot',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),evidenceCapturedAt:'2026-09-18T00:00:00Z',inputFingerprint:{version:1,algorithm:'sha256',value:'c'.repeat(64),coverage:'github_metadata'}}};
  const navigation={model:'gemini-mock',provider:(q:any)=>submitReviewNavigationWithGemini(q,{apiKey:'DO_NOT_WRITE_KEY',generateContent:async()=>({modelVersion:'gemini-mock',usageMetadata:{promptTokenCount:10,candidatesTokenCount:5},candidates:[{finishReason:'STOP'}],text:JSON.stringify(q.stage==='intent'?{goals:[{summary:'Inspect pending behavior',emphasis:'primary',sourceRefs:[q.sources[0].spans[0].id],facets:[],openQuestions:[]}],unprocessed:[]}:{rankings:[{goalId:q.goals[0].id,firstInspection:q.artifacts[0].id,candidates:[{artifactId:q.artifacts[0].id,relevance:'relevant',whyInspect:'Inspect behavior',reviewQuestion:'Is pending work retained?',uncertainty:''},{artifactId:'DO_NOT_WRITE_INVALID_ID',relevance:'possible',whyInspect:'',reviewQuestion:'',uncertainty:''}],uncertainty:[]}],readPaths:[]})})})};
  try{
   const outputs:any[]=[];for(let n=0;n<2;n++)outputs.push(await evaluatePrEvidenceReviewCase({id:'same-case',input},'as_is',{navigation,diagnosticsDirectory:root} as any));
   expect(outputs[0].navigationDiagnosticsPath).toBeTruthy();expect(outputs[0].navigationDiagnosticsPath).not.toBe(outputs[1].navigationDiagnosticsPath);expect(readdirSync(root)).toHaveLength(2);
   for(const output of outputs){const text=readFileSync(output.navigationDiagnosticsPath,'utf8');const saved=JSON.parse(text);expect(saved.status).toBe('complete');expect(saved.events).toHaveLength(2);expect(saved.events[1].artifacts[0]).toMatchObject({path:'src/queue.ts',startLine:1,endLine:1,hash:expect.stringMatching(/^[a-f0-9]{64}$/)});expect(saved.events[1].decisions.some((d:any)=>d.reason==='accepted')).toBe(true);expect(saved.events[1].decisions.some((d:any)=>d.reason==='unknown_artifact_ref')).toBe(true);expect(saved.events[1].transport).toMatchObject({provider:'google',inputTokens:10,outputTokens:5});for(const raw of ['DO_NOT_WRITE_KEY','DO_NOT_WRITE_INVALID_ID','pending();'])expect(text).not.toContain(raw);}
   const counted=vi.fn(navigation.provider);const corpus=await evaluatePrEvidenceReviewCorpus([{id:'same-case',input}],{navigation:{...navigation,provider:counted},diagnosticsDirectory:root,warmupRuns:1,measuredRuns:1});expect(counted).toHaveBeenCalledTimes(2);expect(readFileSync(corpus.cases[0]!.navigationDiagnosticsPath!,'utf8')).toContain('agentproof.navigation-diagnostics.v1');
   const failed=await evaluatePrEvidenceReviewCase({id:'same-case',input},'as_is',{navigation:{model:'mock',provider:async()=>{throw Error('DO_NOT_WRITE_PROVIDER_ERROR');}},diagnosticsDirectory:root});const failedText=readFileSync(failed.navigationDiagnosticsPath!,'utf8');expect(JSON.parse(failedText).events[0].decisions).toEqual(expect.arrayContaining([expect.objectContaining({reason:'unknown'})]));expect(failedText).not.toContain('DO_NOT_WRITE_PROVIDER_ERROR');
   const zeroProvider=vi.fn(navigation.provider);
   const zero=await evaluatePrEvidenceReviewCase({id:'zero-calls',input},'as_is',{navigation:{...navigation,provider:zeroProvider,readCurrentInput:async()=>null},diagnosticsDirectory:root});
   expect(zeroProvider).not.toHaveBeenCalled();const zeroEvents=JSON.parse(readFileSync(zero.navigationDiagnosticsPath!,'utf8')).events;
   expect(zeroEvents).toHaveLength(1);expect(zeroEvents[0]).toMatchObject({stage:'preflight',providerCalled:false,lifecycle:expect.arrayContaining([expect.objectContaining({kind:'freshness',outcome:'collection_failed'})])});
   const privateResult:any=await evaluatePrEvidenceReviewCase({id:'private',input:{...input,repositoryPrivate:true}},'as_is',{navigation,diagnosticsDirectory:root} as any);expect(privateResult.navigationDiagnosticsPath).toBeUndefined();expect(readdirSync(root)).toHaveLength(5);
  }finally{rmSync(root,{recursive:true,force:true});}
 });
});
