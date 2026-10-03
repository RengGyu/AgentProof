import { describe, expect, it } from "vitest";
import { generateVerificationReportV2FromInput } from "./verifier";
import { buildPrEvidenceReview, buildDashboardPrEvidenceReview } from "./pr-evidence-review";
import { prepareTenantDetailReportForStorage } from "./server-report-store";
import { projectTenantPersistedReport, decodeTenantPersistedReport } from "./tenant-report-validation";
import { validateRuntimeReportBoundary } from "./report-runtime-validation";
import { validateVerificationReport } from "./report-validation";
import { buildReviewIntentGraph, rankReviewFiles, validReviewIntentGraph } from "./review-intent";
import { reportToMarkdown } from "./markdown";
import { dashboardReportToMarkdown } from "./dashboard-report-export";
import type { PullRequestInput } from "./types";
const HEAD = "a".repeat(40);
const input = (): PullRequestInput => ({ title:"Queue routing", description:"", taskSource:"issue", taskText:"## Queue routing\n\nThe dispatchQueue must preserve dispatchWindow.\n\n### Conditions\n- When retrying a job, retain its queue.\n- Except cancelled jobs.\n\n### Acceptance\n- Verify dispatchQueue retains dispatchWindow.\n\n### Reproduction\n1. Submit the same job twice.", changedFiles:[{path:"src/queue.ts",status:"modified",patch:"+ function dispatchQueue(dispatchWindow) { return dispatchWindow; }"}],checks:[],logs:[],sourceProvenance:{version:1,origin:"github_snapshot",headSha:HEAD,baseSha:"b".repeat(40),evidenceCapturedAt:"2026-09-16T00:00:00Z",inputFingerprint:{version:1,algorithm:"sha256",value:"c".repeat(64),coverage:"github_metadata"}} });

describe("review intent retrieval Phase A", () => {
  it("shows bound goals and their fallback conditions without inventing a goal from introductory prose", () => {
    const i=input(); i.taskText=""; i.taskSource=undefined;
    i.description="Context for maintainers reviewing this proposal.\n\n## Requirements\n- dispatchQueue must preserve dispatchWindow.\n- If no queue is supplied, use the default queue.";
    const report=generateVerificationReportV2FromInput(i);
    const view=buildPrEvidenceReview(report);
    expect(view.objectives).toHaveLength(1);
    expect(view.objectives[0]!.text).toContain("dispatchQueue must preserve dispatchWindow");
    expect(view.objectives[0]!.text).toContain("If no queue is supplied, use the default queue");
    expect(JSON.stringify(view)).not.toContain("Review goal at source offset");
    expect(reportToMarkdown(report)).toContain("If no queue is supplied, use the default queue");
    const saved=projectTenantPersistedReport(prepareTenantDetailReportForStorage(report,"verified_agentproof","test-secret"),"test-secret");
    const decoded=decodeTenantPersistedReport(saved,{signingSecret:"test-secret",createdAt:report.createdAt});
    expect(decoded.status).toBe("valid");
    if(decoded.status!=="valid")throw Error("invalid");
    expect(buildDashboardPrEvidenceReview({report:decoded.report})?.objectives.map(o=>o.text)).toEqual(view.objectives.map(o=>o.text));
    expect(validateRuntimeReportBoundary({boundary:"generated_private_full",input:i,report}).valid).toBe(true);
  });
  it("links changed code and tests after leading hunk context at the analyzed revision", () => {
    const i=input(); i.url="https://github.com/acme/widget/pull/12";
    i.changedFiles=[
      {path:"src/queue.ts",status:"modified",patch:"@@ -1,4 +1,4 @@\n // header\n \n const unrelated = 1;\n-old();\n+dispatchQueue(dispatchWindow);"},
      {path:"src/queue.test.ts",status:"modified",patch:"@@ -10,2 +10,2 @@\n // test context\n-oldTest();\n+expect(dispatchQueue(dispatchWindow)).toBe(dispatchWindow);"}
    ];
    const view=buildPrEvidenceReview(generateVerificationReportV2FromInput(i));
    expect(view.objectives[0]!.code.find(c=>c.label==="src/queue.ts")?.url).toBe(`https://github.com/acme/widget/blob/${HEAD}/src/queue.ts#L4`);
    expect(view.objectives[0]!.tests.find(c=>c.label==="src/queue.test.ts")?.url).toBe(`https://github.com/acme/widget/blob/${HEAD}/src/queue.test.ts#L11`);
  });
  it("locates candidate goal identifiers inside newly added code and tests rather than their imports", () => {
    const i=input(); i.url="https://github.com/acme/widget/pull/12";
    i.changedFiles=[
      {path:"src/queue.ts",status:"added",patch:"@@ -0,0 +1,4 @@\n+// Queue helpers\n+import { schedule } from './scheduler';\n+\n+export function dispatchQueue(dispatchWindow) { return schedule(dispatchWindow); }"},
      {path:"src/queue.test.ts",status:"added",patch:"@@ -0,0 +1,4 @@\n+import { dispatchQueue } from './queue';\n+import { expect } from 'vitest';\n+\n+expect(dispatchQueue(dispatchWindow)).toBe(dispatchWindow);"}
    ];
    const report=generateVerificationReportV2FromInput(i),view=buildPrEvidenceReview(report);
    for(const candidate of [...view.objectives[0]!.code,...view.objectives[0]!.tests]) expect(candidate.url).toMatch(/#L4$/);
    expect(view.objectives[0]!.code[0]!.relation).toBe("observed");
    expect(view.objectives[0]!.tests.length).toBeGreaterThan(0);
    const saved=projectTenantPersistedReport(prepareTenantDetailReportForStorage(report,"verified_agentproof","test-secret"),"test-secret");
    const decoded=decodeTenantPersistedReport(saved,{signingSecret:"test-secret",createdAt:report.createdAt});
    expect(decoded.status).toBe("valid");
    if(decoded.status!=="valid")throw Error("invalid");
    expect(buildDashboardPrEvidenceReview({report:decoded.report,repositoryFullName:"acme/widget",headSha:HEAD})?.objectives[0]?.code[0]?.url).toMatch(/#L4$/);
    expect(JSON.stringify(report.reviewCandidates?.intentGraph)).not.toContain("return schedule");
    const forged=structuredClone(report);
    forged.reviewCandidates!.intentGraph!.edges[0]!.line=3;
    expect(validateRuntimeReportBoundary({boundary:"generated_private_full",input:i,report:forged}).valid).toBe(false);
    expect(validateRuntimeReportBoundary({boundary:"generated_private_full",input:i,report}).valid).toBe(true);
  });
  it.each([true,false])("starts a test-focused goal at its test body (implementation goal=%s)", implementationGoal => {
    const i=input(); i.url="https://github.com/acme/widget/pull/12";
    i.taskText=(implementationGoal?"Add dispatchQueue to preserve dispatchWindow.\n\n":"")+"Add focused tests for dispatchQueue.";
    i.changedFiles=[
      {path:"src/queue.ts",status:"added",patch:"@@ -0,0 +1,3 @@\n+\n+// Queue operations\n+export function dispatchQueue(dispatchWindow) { return dispatchWindow; }"},
      {path:"test/queue.test.ts",status:"added",patch:"@@ -0,0 +1,5 @@\n+import { dispatchQueue } from '../src/queue';\n+import { expect, test } from 'vitest';\n+\n+test('retains the window', () => {\n+  expect(dispatchQueue(dispatchWindow)).toBe(dispatchWindow);"}
    ];
    const report=generateVerificationReportV2FromInput(i),view=buildPrEvidenceReview(report);
    if(implementationGoal) expect(view.objectives[0]!.code[0]!.url).toBe(`https://github.com/acme/widget/blob/${HEAD}/src/queue.ts#L3`);
    const testsGoal=view.objectives.find(o=>o.text.startsWith("Add focused tests"))!;
    expect(testsGoal.firstInspection).toMatchObject({kind:"test",url:`https://github.com/acme/widget/blob/${HEAD}/test/queue.test.ts#L5`});
    expect(testsGoal.tests.some(t=>t.evidenceId===testsGoal.firstInspection?.evidenceId)).toBe(false);
    const oldReport=structuredClone(report);
    const oldGraph=oldReport.reviewCandidates!.intentGraph!;
    oldGraph.edges.forEach(edge=>{delete edge.lineBasis;});
    expect(validReviewIntentGraph(oldGraph,new Set(oldReport.requirements.map(r=>r.requirementId)),oldReport.evidenceIndex)).toBe(true);
    expect(buildPrEvidenceReview(oldReport).objectives.find(o=>o.text.startsWith("Add focused tests"))?.firstInspection?.line).toBeUndefined();
    expect(view.changes.some(t=>t.evidenceId===testsGoal.firstInspection?.evidenceId)).toBe(false);
    const saved=projectTenantPersistedReport(prepareTenantDetailReportForStorage(report,"verified_agentproof","test-secret"),"test-secret");
    const decoded=decodeTenantPersistedReport(saved,{signingSecret:"test-secret",createdAt:report.createdAt});
    expect(decoded.status).toBe("valid");
    if(decoded.status!=="valid")throw Error("invalid");
    expect(buildDashboardPrEvidenceReview({report:decoded.report,repositoryFullName:"acme/widget",headSha:HEAD})?.objectives.find(o=>o.text.startsWith("Add focused tests"))?.firstInspection?.url).toBe(testsGoal.firstInspection?.url);
    expect(validateRuntimeReportBoundary({boundary:"generated_private_full",input:i,report}).valid).toBe(true);
  });
  it("does not present an import-only word match as a goal-specific test line", () => {
    const i=input(); i.url="https://github.com/acme/widget/pull/12";
    i.taskText="Add focused tests for accepted and rejected requests.";
    i.changedFiles=[{path:"test/transport.test.ts",status:"added",patch:"@@ -0,0 +1,4 @@\n+import { accepted, rejected } from '../transport';\n+\n+test('handles empty input', () => {\n+  expect(runTransport()).toBe(false);"}];
    const report=generateVerificationReportV2FromInput(i);
    const first=buildPrEvidenceReview(report).objectives[0]?.firstInspection;
    expect(first).toMatchObject({kind:"test",url:`https://github.com/acme/widget/blob/${HEAD}/test/transport.test.ts`});
    expect(first?.line).toBeUndefined();
    expect(first?.uncertainty).toContain("No goal-specific test body line");
    expect(reportToMarkdown(report)).toContain("No goal-specific test body line");
    const saved=projectTenantPersistedReport(prepareTenantDetailReportForStorage(report,"verified_agentproof","test-secret"),"test-secret");
    const decoded=decodeTenantPersistedReport(saved,{signingSecret:"test-secret",createdAt:report.createdAt});
    expect(decoded.status).toBe("valid");
    if(decoded.status!=="valid")throw Error("invalid");
    expect(buildDashboardPrEvidenceReview({report:decoded.report,repositoryFullName:"acme/widget",headSha:HEAD})?.objectives[0]?.firstInspection).toMatchObject({url:first!.url,uncertainty:first!.uncertainty});
    expect(JSON.stringify(report.reviewCandidates?.intentGraph)).not.toContain("runTransport");
    const forged=structuredClone(report);
    forged.reviewCandidates!.intentGraph!.edges[0]!.line=1;
    forged.reviewCandidates!.intentGraph!.edges[0]!.lineBasis="test_body_match";
    expect(validateRuntimeReportBoundary({boundary:"generated_private_full",input:i,report:forged}).valid).toBe(false);
    expect(validateRuntimeReportBoundary({boundary:"generated_private_full",input:i,report}).valid).toBe(true);
  });
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
      (g:any)=>{g.edges[0].line=99999;},
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

describe("review intent retrieval: path relevance and bounded graph order", () => {
  const base = (description: string, changedFiles: PullRequestInput["changedFiles"]): PullRequestInput => ({ ...input(), url: "https://github.com/acme/widget/pull/12", taskText: "", taskSource: undefined, description, changedFiles });
  const candidatePaths = (report: ReturnType<typeof generateVerificationReportV2FromInput>) => new Set(report.reviewCandidates!.requirements.flatMap(row => row.candidates.map(c => report.evidenceIndex.find(e => e.id === c.evidenceId)?.locator)));

  it("offers a changed implementation file whose name matches the stated behavior even when its visible patch shares few words", () => {
    const i = base("## Summary\n\n- Fix the false positive when `widget.raises` is used as a context manager in a `with` statement and extra positional arguments are passed.",
      [{ path: "crates/core/resources/mdtest/rules/legacy-form-widget-raises.md", status: "added", patch: "@@ -0,0 +1,2 @@\n+# widget.raises in a with statement\n+Extra positional arguments are allowed in context manager form." },
       { path: "crates/core/src/rules/legacy_form_widget_raises.rs", status: "modified", patch: "@@ -10,2 +10,4 @@\n     return;\n+    if let Stmt::With(items) = current() {\n+        return;\n+    }" }]);
    const report = generateVerificationReportV2FromInput(i);
    expect(report.requirements.length).toBeGreaterThan(0);
    expect(candidatePaths(report).has("crates/core/src/rules/legacy_form_widget_raises.rs")).toBe(true);
    expect(validateVerificationReport(report, { mode: "v2_full" }).valid).toBe(true);
  });

  it("keeps a relevant implementation file in the bounded graph when many unrelated files sort before it", () => {
    const unrelated = Array.from({ length: 135 }, (_, n) => ({ path: `docs/archive/note-${String(n).padStart(3, "0")}.md`, status: "modified" as const, patch: `@@ -1,1 +1,1 @@\n+Archive entry ${n}.` }));
    const i = base("## Requirements\n\n- dispatchQueue must preserve dispatchWindow when a job is retried.",
      [...unrelated, { path: "src/queue/dispatch-window.ts", status: "modified", patch: "@@ -1,1 +1,1 @@\n+export function dispatchQueue(dispatchWindow) { return dispatchWindow; }" }]);
    const report = generateVerificationReportV2FromInput(i);
    expect(report.reviewCandidates!.intentGraph!.chunks.some(c => c.path === "src/queue/dispatch-window.ts")).toBe(true);
    expect(candidatePaths(report).has("src/queue/dispatch-window.ts")).toBe(true);
    expect(validReviewIntentGraph(report.reviewCandidates!.intentGraph, new Set(report.requirements.map(r => r.requirementId)), report.evidenceIndex)).toBe(true);
  });

  it("does not let documentation that repeats the goal's words crowd changed code out of a behavior goal's bounded candidates", () => {
    const docs = Array.from({ length: 13 }, (_, n) => ({ path: `docs/plans/rollout-note-${n}.md`, status: "added" as const, patch: `@@ -0,0 +1,2 @@\n+Rollout note ${n}: the default private shadow observation pipeline has release evaluation gates.\n+Observation pipeline release evaluation stays default-off.` }));
    const unrelated = Array.from({ length: 20 }, (_, n) => ({ path: `src/feature/unrelated-${n}.ts`, status: "modified" as const, patch: `@@ -1,1 +1,1 @@\n+export const unrelatedValue${n} = ${n};` }));
    const i = base("## Summary\n\n- Add a default-off private shadow observation pipeline with release evaluation gates.",
      [...docs, ...unrelated, { path: "src/lib/observation-runner.ts", status: "added", patch: "@@ -0,0 +1,2 @@\n+export function runShadow(defaultEnabled = false, privateRepository = true) { return defaultEnabled && !privateRepository; }\n+// default private shadow runner" }]);
    const report = generateVerificationReportV2FromInput(i);
    const graph = report.reviewCandidates!.intentGraph!;
    const edgePaths = graph.edges.map(e => graph.chunks.find(c => c.id === e.chunkId)!.path);
    expect(edgePaths).toContain("src/lib/observation-runner.ts");
    expect(buildPrEvidenceReview(report).objectives[0]!.code[0]?.label).toBe("src/lib/observation-runner.ts");
  });

  it("keeps documentation first for a documentation goal", () => {
    const i = base("## Summary\n\n- Update the observation pipeline documentation guide.",
      [{ path: "docs/observation-pipeline-guide.md", status: "modified", patch: "@@ -1,1 +1,1 @@\n+Observation pipeline documentation guide." },
       { path: "src/lib/observation-pipeline.ts", status: "modified", patch: "@@ -1,1 +1,1 @@\n+// observation pipeline documentation guide" }]);
    const report = generateVerificationReportV2FromInput(i);
    const graph = report.reviewCandidates!.intentGraph!;
    expect(graph.chunks.find(c => c.id === graph.edges[0]!.chunkId)!.path).toBe("docs/observation-pipeline-guide.md");
  });

  it("orders equally relevant paths as code, tests, fixtures or generated output, then documentation", () => {
    const files = [
      { path: "docs/observation-pipeline.md", additions: 50 },
      { path: "eval/fixtures/observation-pipeline.json", additions: 900 },
      { path: "scripts/observation-pipeline.test.mjs", additions: 300 },
      { path: "src/lib/observation-pipeline.ts", additions: 120 },
      { path: "src/lib/unrelated.ts", additions: 2000 }
    ].map(f => ({ ...f, status: "modified" as const }));
    expect(rankReviewFiles(files, "Add the private observation pipeline.").map(f => f.path)).toEqual([
      "src/lib/observation-pipeline.ts", "scripts/observation-pipeline.test.mjs", "eval/fixtures/observation-pipeline.json", "docs/observation-pipeline.md", "src/lib/unrelated.ts"
    ]);
    expect(rankReviewFiles(files, "See docs/observation-pipeline.md.")[0]!.path).toBe("docs/observation-pipeline.md");
    expect(rankReviewFiles([{ path: "pnpm-lock.yaml", additions: 40 }, { path: "src/pnpm-runner.ts", additions: 4 }], "Run pnpm test.").map(f => f.path)).toEqual(["src/pnpm-runner.ts", "pnpm-lock.yaml"]);
  });

  it("spreads equally tiered relevant paths across directories so one folder cannot fill a bounded read budget", () => {
    const tools = Array.from({ length: 6 }, (_, n) => ({ path: `scripts/evaluate-observation-release-gate-${n}.mjs`, status: "modified" as const, additions: 10 }));
    const core = [{ path: "src/lib/observation-pipeline.ts", status: "modified" as const, additions: 400 }, { path: "src/lib/observation-source.ts", status: "modified" as const, additions: 300 }];
    const top = rankReviewFiles([...tools, ...core], "Add the observation pipeline and release evaluation gates.").slice(0, 4).map(f => f.path);
    expect(top).toContain("src/lib/observation-pipeline.ts");
    expect(top).toContain("src/lib/observation-source.ts");
  });
});
