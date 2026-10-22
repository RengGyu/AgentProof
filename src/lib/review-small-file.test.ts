import { describe, expect, it } from 'vitest';
import { enrichReviewNavigation, getReviewNavigationDiagnostics, type ReviewNavigationRequest } from './review-intent';
import { generateVerificationReportV2FromInput } from './verifier';
import { validateRuntimeReportBoundary } from './report-runtime-validation';
import { redactSecretsPreservingLines } from './redact';
import { createReviewMeasurements } from './review-navigation-diagnostics';
import type { PullRequestInput } from './types';

const head='a'.repeat(40),base='b'.repeat(40),path='tests/retry_test.go';
const content=Array.from({length:62},(_,n)=>n===9?'func retryPending(t *testing.T) {':n===13?'    queue.pending()':n===59?'    assertPending(t, queue)':n===61?'}':`// context ${n+1}`).join('\n');
function input(source=content):PullRequestInput {
 return {title:'Pending retry',taskText:'Preserve pending retry work',taskSource:'task',description:'Retry pending entries',url:'https://github.com/acme/queue/pull/1',repositoryPrivate:false,checks:[],logs:[],changedFiles:Array.from({length:16},(_,n)=>({path:`src/context${n}.ts`,status:'added',patch:`@@ -0,0 +1,1 @@\n+ const pending${n} = true;`})),sourceProvenance:{version:1,origin:'github_snapshot',headSha:head,baseSha:base,evidenceCapturedAt:'2026-10-07T00:00:00Z',inputFingerprint:{version:1,algorithm:'sha256',value:'c'.repeat(64),coverage:'github_metadata'}},verificationCriterionEvidenceV2:{artifactBlobs:[{path,headSha:head,content:source}]}};
}
async function run(i:PullRequestInput,enabled=false,refine=false,chooseId?:string,otherExperiment=false) {
 const packets:ReviewNavigationRequest[]=[];
 const trace=createReviewMeasurements();
 const report=await enrichReviewNavigation(i,generateVerificationReportV2FromInput(i),{model:'fixture',completeSmallSnapshot:enabled,measurements:{trace},selectionExperiment:otherExperiment?async()=>null:undefined,readArtifacts:async(paths,sha)=>paths.map(path=>({path,headSha:sha,content:'export const pending = true;'})),provider:async q=>{
  if(q.stage==='intent')return {goals:[{summary:'Preserve pending retry work',emphasis:'primary',sourceRefs:[q.sources[0]!.spans[0]!.id],facets:[],openQuestions:[]}],unprocessed:[]};
  packets.push(structuredClone(q));const a=q.artifacts.find(a=>a.path===path)!;
  return {rankings:[{goalId:q.goals[0]!.id,firstInspection:chooseId??a?.id??null,candidates:a?[{artifactId:chooseId??a.id,relevance:'relevant',whyInspect:'Inspect the pending behavior',reviewQuestion:'Is pending work retained?',uncertainty:'Not executed'}]:[],uncertainty:[]}],readPaths:refine&&packets.length===1?['src/neighbor.ts']:[]};
 }});
 return {packets,report,trace:trace.snapshot()};
}
function preserves(before:ReviewNavigationRequest,after:ReviewNavigationRequest) {
 for(const a of before.artifacts){const b=after.artifacts.find(b=>b.path===a.path&&b.revision===a.revision&&b.side===a.side&&b.startLine<=a.startLine&&b.endLine>=a.endLine)!;expect(b).toBeDefined();expect(b.content.split('\n').slice(a.startLine-b.startLine,a.endLine-b.startLine+1).join('\n')).toBe(a.content);expect(b.goalIds).toEqual(a.goalIds);}
}
describe('opt-in complete small snapshot',()=>{
 it('adds a registered missing interval without losing any B0 content, provenance or goal links',async()=>{
  const i=input(),b0=await run(i),next=await run(i,true),before=b0.packets[0]!,after=next.packets[0]!;
  expect(before.artifacts.find(a=>a.path===path)?.endLine).toBeLessThan(60);
  const full=after.artifacts.find(a=>a.path===path)!;expect(full).toMatchObject({startLine:1,endLine:62,content,side:'head',revision:head,origin:'snapshot'});
  preserves(before,after);expect(after.artifacts).toHaveLength(16);expect(Buffer.byteLength(JSON.stringify(after.artifacts))).toBeLessThanOrEqual(48000);
  const validation=validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:next.report});expect(validation.valid,JSON.stringify(validation)).toBe(true);
  const trace=getReviewNavigationDiagnostics(next.report.reviewCandidates!.navigation!)[1]!;expect(trace.artifacts.find(a=>a.id===full.id)?.endLine).toBe(62);expect(trace.artifactBytes).toBe(Buffer.byteLength(JSON.stringify(after.artifacts)));
  expect(JSON.stringify(next.report)).not.toContain('assertPending(t, queue)');
  const parent=before.artifacts.find(a=>a.path===path)!;expect(next.trace.evidence).toEqual(expect.arrayContaining([expect.objectContaining({stage:'artifact',artifactId:full.id,parentIds:[parent.id]})]));
 });
 it('retains the expanded validated reference while executing ordinary refinement reads',async()=>{
  const next=await run(input(),true,true);expect(next.packets).toHaveLength(2);
  const first=next.packets[0]!.artifacts.find(a=>a.path===path)!;expect(first.endLine).toBe(62);expect(next.packets[1]!.artifacts.some(a=>a.path==='src/neighbor.ts')).toBe(true);
  expect(next.report.reviewCandidates!.navigation!.goals[0]!.firstInspection).toBe(first.id);
 });
 it.each([['too many lines',content+'\n'.repeat(19)],['too many UTF8 bytes',content.replace('// context 1','// '+'界'.repeat(2700))]])('keeps B0 for %s',async(_,source)=>{
  const i=input(source),b0=await run(i),next=await run(i,true);expect(next.packets).toEqual(b0.packets);
 });
 it('does not expand inconsistent source intervals or stale supplied snapshots',async()=>{
  for(const stale of [false,true]){const i=input();i.changedFiles.unshift({path,status:'modified',patch:'@@ -10,1 +10,1 @@\n- old\n+ conflicting source'});if(stale)i.verificationCriterionEvidenceV2!.artifactBlobs![0]!.headSha=base;
   expect((await run(i,true)).packets).toEqual((await run(i)).packets);
  }
 });
 it.each([['80 lines',content+'\n'.repeat(18)],['8000 UTF8 bytes',content.replace('// context 30','// context 30'+'x'.repeat(8000-Buffer.byteLength(content)))]])('admits the exact %s boundary',async(_,source)=>{
  const next=await run(input(source),true);expect(next.packets[0]!.artifacts.find(a=>a.path===path)?.content).toBe(source);
 });
 it('leaves B0 unchanged when full source would exceed the conservative packet byte budget',async()=>{
  const source=content.replace('// context 30','// '+'x'.repeat(6000)),i=input(source);
  for(const file of i.changedFiles)file.patch=`@@ -0,0 +1,1 @@\n+ const pending = "${'x'.repeat(2500)}";`;
  const b0=await run(i),next=await run(i,true);expect(b0.packets[0]!.artifacts).toHaveLength(16);expect(next.packets).toEqual(b0.packets);
 });
 it('keeps registry and packet bounds when many snippets are available',async()=>{
  const i=input();i.verificationCriterionEvidenceV2!.artifactBlobs!.push(...Array.from({length:7},(_,n)=>({path:`src/many${n}.go`,headSha:head,content:Array.from({length:300},(_,line)=>line%12===0?'pending entry':'// context').join('\n')})));
  const b0=await run(i),next=await run(i,true);expect(next.report.reviewCandidates!.navigation!.artifacts.length).toBeLessThanOrEqual(96);preserves(b0.packets[0]!,next.packets[0]!);
 });
 it('rejects the replaced parent ID that was never sent, while retaining its hash lineage',async()=>{
  const i=input(),b0=await run(i),parent=b0.packets[0]!.artifacts.find(a=>a.path===path)!;
  const next=await run(i,true,false,parent.id);expect(next.packets[0]!.artifacts.some(a=>a.id===parent.id)).toBe(false);expect(next.report.reviewCandidates!.navigation!.goals[0]!.firstInspection).toBeNull();expect(next.report.reviewCandidates!.navigation!.failures?.some(f=>f.reason==='unknown_artifact_ref')).toBe(true);
 });
 it('does not combine supplementation with another protected selection experiment',async()=>{
  const i=input();expect((await run(i,true,false,undefined,true)).packets).toEqual((await run(i,false,false,undefined,true)).packets);
 });
 it('normalizes and masks full source without exposing raw secrets in packets or diagnostics',async()=>{
  const source=content.replace('// context 30','// authorization: bearer mockcredential123').replace(/\n/g,'\r\n');
  const next=await run(input(source),true),full=next.packets[0]!.artifacts.find(a=>a.path===path)!;
  expect(full.content).toBe(redactSecretsPreservingLines(source.replace(/\r\n/g,'\n')));expect(full.endLine).toBe(62);expect(JSON.stringify(next)).not.toContain('mockcredential123');
 });
 it('does not send any source after an access or freshness failure',async()=>{
  const i=input();for(const extra of [{readRepositoryPrivate:async()=>true},{readCurrentInput:async()=>({...i,sourceProvenance:{...i.sourceProvenance!,headSha:base}})}]){
   let calls=0;const report=await enrichReviewNavigation(i,generateVerificationReportV2FromInput(i),{model:'fixture',completeSmallSnapshot:true,provider:async()=>{calls++;return {};},...extra});expect(calls).toBe(0);expect(report.reviewCandidates!.navigation!.goals).toEqual([]);
  }
 });
});
