import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { evaluatePrEvidenceReviewCorpus, scoreFirstInspection, firstDisplayedInspectionPath, type PrEvidenceReviewEvaluationFixture } from "../../scripts/pr-evidence-review-evaluation";
import { generateVerificationReportV2FromInput, generateVerificationReportV2 } from "./verifier";
import { buildDashboardPrEvidenceReview, buildPrEvidenceReview } from "./pr-evidence-review";
import { prepareTenantDetailReportForStorage } from "./server-report-store";
import { decodeTenantPersistedReport, projectTenantPersistedReport } from "./tenant-report-validation";
import type { PullRequestInput, VerificationReportV2 } from "./types";

const ROOT = resolve(import.meta.dirname, "../..");
const SECRET = "offline-candidate-evaluation-signing-key-32";

describe("review candidate offline evaluation", () => {
  it("compares frozen cases, strict outputs, round trips and independent positive/negative perturbations", async () => {
    const network = vi.fn(() => { throw Error("external calls forbidden"); }); vi.stubGlobal("fetch", network);
    const fixtures = readFileSync(resolve(ROOT,"eval/fixtures/swebench-verified.diverse.jsonl"),"utf8").trim().split("\n").map(line=>JSON.parse(line) as PrEvidenceReviewEvaluationFixture);
    const previous = JSON.parse(readFileSync(resolve(ROOT,"docs/verification/2026-09-15-pr-evidence-review/evaluation-linked-first-inspection.json"),"utf8"));
    const references = JSON.parse(readFileSync(resolve(ROOT,"eval/fixtures/pr-evidence-review.references.json"),"utf8")).references;
    const fixtureHashes = Object.fromEntries([
      ["diverseSha256", "swebench-verified.diverse.jsonl"],
      ["syntheticSha256", "pr-evidence-review.synthetic.jsonl"],
      ["referenceSha256", "pr-evidence-review.references.json"],
    ].map(([key, file]) => [key, createHash("sha256").update(readFileSync(resolve(ROOT, "eval/fixtures", file!))).digest("hex")]));
    expect(fixtureHashes).toEqual(previous.fixtureHashes);
    const strictChecks = [], storage = [];
    for (const f of fixtures) {
      const current = generateVerificationReportV2FromInput(f.input);
      const baseline = generateVerificationReportV2({ input: f.input, contractSource: { kind: "provided_requirement", contract: undefined }, binding: { sourceKind: "provided_requirement", sourceIdentity: "absent", sourceContent: "", headSha: f.input.sourceProvenance?.headSha ?? "", baseSha: f.input.sourceProvenance?.baseSha ?? "" } });
      const { analysisId: _a, createdAt: _b, reviewCandidates, ...strictCurrent } = current;
      const { analysisId: _c, createdAt: _d, ...strictBaseline } = baseline;
      expect(strictCurrent).toEqual(strictBaseline); strictChecks.push({ id:f.id, unchanged:true });
      const persisted = projectTenantPersistedReport(prepareTenantDetailReportForStorage(current,"verified_agentproof",SECRET),SECRET);
      const decoded = decodeTenantPersistedReport(persisted,{ signingSecret:SECRET, createdAt:current.createdAt });
      expect(decoded.status).toBe("valid"); if (decoded.status!=="valid") throw Error("invalid roundtrip");
      expect((decoded.report as VerificationReportV2).reviewCandidates).toEqual(reviewCandidates);
      const local = buildPrEvidenceReview(current).objectives.map(o=>({id:o.id, items:[...o.code,...o.tests].map(i=>[i.evidenceId,i.relation,i.candidateBasis])}));
      const saved = buildDashboardPrEvidenceReview({report:decoded.report})!.objectives.map(o=>({id:o.id, items:[...o.code,...o.tests].map(i=>[i.evidenceId,i.relation,i.candidateBasis])}));
      expect(saved).toEqual(local); storage.push({id:f.id, preserved:true, bytes:Buffer.byteLength(JSON.stringify(persisted)), companionBytes:Buffer.byteLength(JSON.stringify(reviewCandidates))});
    }
    const makeInput = (text:string, patch:string):PullRequestInput => ({title:"Offline fixture",taskText:`Requirements:\n- ${text}`,taskSource:"issue",description:"",changedFiles:[{path:"src/dispatcher.ts",status:"modified",patch},{path:"src/other.ts",status:"modified",patch:"+ function unrelatedUtility() { return 1; }"}],checks:[],logs:[]});
    const synthetic = [
      {id:"identifier",input:makeInput("dispatchQueue must retain dispatchWindow.","+ dispatchQueue(dispatchWindow);"),expected:["src/dispatcher.ts"]},
      {id:"late-identifier",input:makeInput("The service must retain current compatibility across all normal request processing and existing callers while dispatchQueue retains dispatchWindow.","+ dispatchQueue(dispatchWindow);"),expected:["src/dispatcher.ts"]},
      {id:"middle-feature",input:makeInput("dispatchQueue must retain dispatchWindow.","// padding\n".repeat(60)+"+ dispatchQueue(dispatchWindow);\n"+"// padding\n".repeat(60)),expected:["src/dispatcher.ts"]},
      {id:"common-negative",input:makeInput("The service must handle a request and return a result.","+ function handle(request) { return result; }"),expected:[]},
      {id:"unrelated-negative",input:makeInput("quartzLedger must retain quartzWindow.","+ dispatchQueue(dispatchWindow);"),expected:[]},
      {id:"path-negative",input:makeInput("src/auth/handler.ts must handle a request.","+ function handler(request) { return result; }"),expected:[]},
    ];
    const syntheticResults=[];
    for (const f of synthetic) {
      const start=performance.now(), report=generateVerificationReportV2FromInput(f.input), view=buildPrEvidenceReview(report);
      // The retrieval layer abstains independently of preserved deterministic observations.
      const graph=report.reviewCandidates!.intentGraph!;
      const paths=[...new Set(graph.edges.map(edge=>graph.chunks.find(chunk=>chunk.id===edge.chunkId)!.path))]; expect(paths).toEqual(f.expected);
      const reversed=structuredClone(f.input); reversed.changedFiles.reverse();
      const reverseView=buildPrEvidenceReview(generateVerificationReportV2FromInput(reversed));
      expect(reverseView.objectives.map(o=>o.code.map(i=>i.label))).toEqual(view.objectives.map(o=>o.code.map(i=>i.label)));
      const baseline=generateVerificationReportV2({input:f.input,contractSource:{kind:"provided_requirement",contract:undefined},binding:{sourceKind:"provided_requirement",sourceIdentity:"absent",sourceContent:"",headSha:"",baseSha:""}});
      const previousPaths=[...new Set(buildPrEvidenceReview(baseline).objectives.flatMap(o=>o.code.map(i=>i.label)))];
      syntheticResults.push({id:f.id,expectedPaths:f.expected,previousPaths,paths,firstPath:firstDisplayedInspectionPath(view,f.input.changedFiles.map(f=>f.path)),falseLinks:paths.filter(p=>!f.expected.includes(p)).length,abstained:paths.length===0,orderInvariant:true,elapsedMs:performance.now()-start});
    }
    const current = await evaluatePrEvidenceReviewCorpus(fixtures,{warmupRuns:1,measuredRuns:3});
    expect(current.cases.every(c=>c.status==="complete")).toBe(true);
    const firstInspection=scoreFirstInspection(references,current.cases.map(c=>({id:c.id,rankedPaths:c.status==="complete"&&c.firstInspectionPath?[c.firstInspectionPath]:[]})));
    expect(network).not.toHaveBeenCalled();
    const artifact={version:1,generatedAt:new Date().toISOString(),baselinePath:"evaluation-linked-first-inspection.json",fixtureHashes,baseline:previous.profiles.asIs.evaluation,baselineFirstInspection:previous.scoring.firstInspection.asIs,current,firstInspection,strictChecks,storage,synthetic:syntheticResults,externalCalls:network.mock.calls.length,semanticAccuracy:"UNKNOWN",humanAccuracy:"UNKNOWN",frozenFalseLinkRate:"UNKNOWN",limits:{sourceChars:64000,paragraphChars:4000,patchCharsPerFile:16000,wordFeatures:256,sourceIdentifiers:64,candidatesPerObjective:8},boundary:"Frozen 10 is diagnostic, not holdout; synthetic expectations authored independently of these PR references."};
    const output=process.env.AGENTPROOF_REVIEW_CANDIDATES_EVAL_OUTPUT;
    if(output)writeFileSync(resolve(ROOT,output),JSON.stringify(artifact,null,2)+"\n",{flag:"wx"});
    vi.unstubAllGlobals();
  },30000);
});
