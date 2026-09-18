import { describe, expect, it } from "vitest";
import { generateVerificationReportV2FromInput } from "./verifier";
import { buildPrEvidenceReview, buildDashboardPrEvidenceReview } from "./pr-evidence-review";
import { prepareTenantDetailReportForStorage } from "./server-report-store";
import { projectTenantPersistedReport, decodeTenantPersistedReport } from "./tenant-report-validation";
import { validateRuntimeReportBoundary } from "./report-runtime-validation";
import { validateVerificationReport } from "./report-validation";
import { buildReviewIntentGraph } from "./review-intent";
import { reportToMarkdown } from "./markdown";
import { dashboardReportToMarkdown } from "./dashboard-report-export";
import type { PullRequestInput } from "./types";
const HEAD = "a".repeat(40);
const input = (): PullRequestInput => ({ title:"Queue routing", description:"", taskSource:"issue", taskText:"## Queue routing\n\nThe dispatchQueue must preserve dispatchWindow.\n\n### Conditions\n- When retrying a job, retain its queue.\n- Except cancelled jobs.\n\n### Acceptance\n- Verify dispatchQueue retains dispatchWindow.\n\n### Reproduction\n1. Submit the same job twice.", changedFiles:[{path:"src/queue.ts",status:"modified",patch:"+ function dispatchQueue(dispatchWindow) { return dispatchWindow; }"}],checks:[],logs:[],sourceProvenance:{version:1,origin:"github_snapshot",headSha:HEAD,baseSha:"b".repeat(40),evidenceCapturedAt:"2026-09-16T00:00:00Z",inputFingerprint:{version:1,algorithm:"sha256",value:"c".repeat(64),coverage:"github_metadata"}} });

describe("review intent retrieval Phase A", () => {
  it("groups source facets under one goal without changing strict requirements", () => {
    const report=generateVerificationReportV2FromInput(input());
    const graph=(report.reviewCandidates as any)?.intentGraph;
    expect(graph).toBeDefined();
    expect(graph.goals).toHaveLength(1);
    expect(graph.goals[0].facets.map((f:any)=>f.kind)).toEqual(expect.arrayContaining(["condition","exception","acceptance","reproduction"]));
    expect(graph.goals[0].sourceRefs[0]).toMatchObject({start:18});
    expect(buildPrEvidenceReview(report).objectives).toHaveLength(1);
    expect(graph.capabilities.wholeRepository).toBe("unavailable");
  });
  it("does not erase or downgrade observed code when candidates abstain", () => {
    const report=generateVerificationReportV2FromInput(input());
    const evidence=report.evidenceIndex.find(e=>e.locator==="src/queue.ts")!;
    report.requirements[0]!.proofAxes=[{axisId:"axis",role:"criterion",subject:"implementation",polarity:"positive",state:"satisfied",evidenceRefs:[evidence.id],collectionBasis:"changed_implementation"} as any];
    report.reviewCandidates!.requirements.forEach(r=>r.candidates=[]);
    const view=buildPrEvidenceReview(report);
    expect(view.objectives.flatMap(o=>o.code)).toContainEqual(expect.objectContaining({evidenceId:evidence.id,relation:"observed"}));
  });
  it("keeps supporting prose with its goal instead of creating a goal for every paragraph", () => {
    const i=input();i.taskText="dispatchQueue must preserve dispatchWindow.\n\nThe worker currently retries jobs during reconnects.\n\nWhen reconnecting, reuse the queued job.";
    const graph=generateVerificationReportV2FromInput(i).reviewCandidates!.intentGraph!;
    expect(graph.goals).toHaveLength(1);
    expect(graph.goals[0]!.sourceRefs).toHaveLength(2);
  });
  it("keeps inline conditions and exceptions as facets of a single goal", () => {
    const i=input();i.taskText="dispatchQueue must preserve dispatchWindow when retrying, except cancelled jobs.";
    const graph=generateVerificationReportV2FromInput(i).reviewCandidates!.intentGraph!;
    expect(graph.goals).toHaveLength(1);
    expect(graph.goals[0]!.facets.map(f=>f.kind)).toEqual(expect.arrayContaining(["condition","exception"]));
  });
  it("rejects stale, invented and symbol-bearing retrieval references at the runtime boundary", () => {
    const i=input(), report=generateVerificationReportV2FromInput(i);
    expect(validateRuntimeReportBoundary({boundary:"generated_private_full",input:i,report}).valid).toBe(true);
    for(const mutate of [
      (g:any)=>{g.chunks[0].path="src/invented.ts";},
      (g:any)=>{g.chunks[0].revision="d".repeat(40);},
      (g:any)=>{g.chunks[0].symbol="inventedSymbol";},
      (g:any)=>{g.goals[0].sourceRefs[0].hash="d".repeat(64);},
      (g:any)=>{g.edges[0].relation="verified";},
    ]) {
      const bad=structuredClone(report);mutate(bad.reviewCandidates!.intentGraph!);
      expect(validateRuntimeReportBoundary({boundary:"generated_private_full",input:i,report:bad}).valid).toBe(false);
    }
    const malformed=structuredClone(report);(malformed.reviewCandidates!.intentGraph!.chunks as any[])[0]=null;
    expect(()=>validateVerificationReport(malformed,{mode:"v2_full"})).not.toThrow();
    expect(validateVerificationReport(malformed,{mode:"v2_full"}).valid).toBe(false);
  });
  it("keeps many-to-many edges and ranking stable under input order", () => {
    const i=input();i.taskText="dispatchQueue must preserve dispatchWindow.\n\ndispatchQueue must also expose dispatchWindow for inspection.";
    i.changedFiles.push({path:"src/other.ts",patch:"+ dispatchQueue(dispatchWindow)"});
    const r=generateVerificationReportV2FromInput(i), first=r.reviewCandidates!.intentGraph!;
    expect(first.goals).toHaveLength(2);
    expect(first.edges.some(e=>first.edges.some(other=>other.chunkId===e.chunkId&&other.goalId!==e.goalId))).toBe(true);
    const reversed={...i,changedFiles:[...i.changedFiles].reverse()};
    const second=buildReviewIntentGraph(reversed,r.requirements,r.evidenceIndex);
    expect(second).toEqual(first);
    expect(new Set(first.edges.map(e=>`${e.goalId}:${e.chunkId}`)).size).toBe(first.edges.length);
  });
  it("does not make links to a different repository than the analyzed source", () => {
    const i=input();i.url="https://github.com/acme/widget/pull/12";
    const r=generateVerificationReportV2FromInput(i);
    for(const review of [buildPrEvidenceReview(r,{repositoryFullName:"other/repo"}),buildDashboardPrEvidenceReview({report:r,repositoryFullName:"other/repo"})!]) {
      expect([...review.objectives.flatMap(o=>[...o.code,...o.tests]),...review.changes].some(item=>item.url)).toBe(false);
    }
  });
  it("keeps snapshot line windows anchored to original lines after multiline secret redaction", () => {
    const i=input();
    const body=["-----BEGIN PRIVATE KEY-----",...Array(20).fill("redacted-private-material"),"-----END PRIVATE KEY-----",...Array(65).fill("// padding"),"dispatchQueue(dispatchWindow);"].join("\n");
    i.verificationCriterionEvidenceV2={artifactBlobs:[{path:"src/worker.ts",headSha:HEAD,content:body}]};
    const graph=generateVerificationReportV2FromInput(i).reviewCandidates!.intentGraph!;
    const matched=graph.edges.map(e=>graph.chunks.find(c=>c.id===e.chunkId)!).filter(c=>c.path==="src/worker.ts");
    expect(matched.map(c=>c.startLine)).toEqual([81]);
    expect(JSON.stringify(graph)).not.toContain("redacted-private-material");
  });
  it("reports feature truncation instead of implying a complete search", () => {
    const i=input();i.taskText="dispatchQueue must preserve dispatchWindow. " + Array.from({length:300},(_,n)=>`vocabulary${n}`).join(" ");
    expect(generateVerificationReportV2FromInput(i).reviewCandidates!.intentGraph!.capabilities.truncated).toBe(true);
  });
  it("retrieves supplied exact-head repository artifacts without persisting source", () => {
    const i=input(); i.verificationCriterionEvidenceV2={artifactBlobs:[{path:"src/worker.ts",headSha:HEAD,content:"export function dispatchQueue(dispatchWindow) { return dispatchWindow; } // PRIVATE_RAW"},{path:"src/stale.ts",headSha:"d".repeat(40),content:"dispatchQueue dispatchWindow"},{path:"src/ghp_abcdefghijklmnopqrstuvwxyz.ts",headSha:HEAD,content:"dispatchQueue dispatchWindow"}]};
    const report=generateVerificationReportV2FromInput(i);
    const graph=(report.reviewCandidates as any)?.intentGraph;
    expect(graph?.chunks.some((c:any)=>c.path==="src/worker.ts")).toBe(true);
    expect(graph.chunks.some((c:any)=>c.path==="src/stale.ts")).toBe(false);
    expect(JSON.stringify(report.reviewCandidates)).not.toContain("PRIVATE_RAW");
    expect(JSON.stringify(report.reviewCandidates)).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz");
    const saved=projectTenantPersistedReport(prepareTenantDetailReportForStorage(report,"verified_agentproof","test-secret"),"test-secret");
    const decoded=decodeTenantPersistedReport(saved,{signingSecret:"test-secret",createdAt:report.createdAt});
    expect(decoded.status).toBe("valid");
    if(decoded.status!=="valid")throw Error("invalid");
    expect(buildDashboardPrEvidenceReview({report:decoded.report})?.objectives).toEqual(buildPrEvidenceReview(report).objectives);
    for(const markdown of [reportToMarkdown(report),dashboardReportToMarkdown({report:decoded.report,copyEligible:true,freshness:"current"})]) {
      expect(markdown).toContain("Inspect first");expect(markdown).toContain("More context");expect(markdown).toContain("Source offsets");expect(markdown).toContain("symbol resolution unavailable");
    }
  });
});
