import { vi } from "vitest";
// Downstream unit fixtures isolate budget; paid-budget*.test.ts checks the real boundary.
vi.mock('@/lib/paid-budget', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/paid-budget')>(),
  ...(await import('@/lib/test-support/unmetered-budget')).unmeteredBudgetFixture
}));
import { createHash } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import * as intent from './review-intent';
import { generateVerificationReportV2FromInput } from './verifier';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PrEvidenceReview } from '../components/PrEvidenceReview';
import { reportToMarkdown } from './markdown';
import { validateRuntimeReportBoundary } from './report-runtime-validation';
import { prepareTenantDetailReportForStorage } from './server-report-store';
import { projectTenantPersistedReport, decodeTenantPersistedReport } from './tenant-report-validation';
import { sanitizeReportForShare } from './report-share';
import { buildDashboardPrEvidenceReview, buildPrEvidenceReview } from './pr-evidence-review';
import { GitHubFetchError } from './github';
import type { PullRequestInput } from './types';
const head='a'.repeat(40),base='b'.repeat(40);
const input=():PullRequestInput=>({title:'Retry queue',url:'https://github.com/acme/queue/pull/1',repositoryPrivate:false,taskSource:'issue',taskText:'Retain queued work when reconnecting.\n\nOptionally retire the switch.',description:'Restores pending work.',changedFiles:[{path:'src/queue.ts',status:'modified',patch:'@@ -1,2 +1,2 @@\n function reconnect(queue) {\n- return [];\n+ return queue.pending;'}],checks:[],logs:[],sourceProvenance:{version:1,origin:'github_snapshot',headSha:head,baseSha:base,evidenceCapturedAt:'2026-09-16T00:00:00Z',inputFingerprint:{version:1,algorithm:'sha256',value:'c'.repeat(64),coverage:'github_metadata'}}});
const refinementRead={readArtifacts:async()=>[{path:'src/neighbor.ts',headSha:head,content:'extra neighbor context'}]};
const run=(i:PullRequestInput,provider:any,extra:any={})=>(intent as any).enrichReviewNavigation(i,generateVerificationReportV2FromInput(i),{model:'gpt-5.6-luna',provider,...extra});
const goals=(request:any)=>({goals:[{summary:'Preserve pending work during reconnect',emphasis:'primary',sourceRefs:[request.sources[0].spans[0].id],facets:[{kind:'condition',summary:'During reconnection',sourceRefs:[request.sources[0].spans[0].id]}],openQuestions:[]},{summary:'Consider retiring the switch',emphasis:'optional',sourceRefs:[request.sources[0].spans[1].id],facets:[],openQuestions:['Is retirement in scope?']}],unprocessed:[]});
const ranks=(request:any)=>({rankings:request.goals.map((g:any)=>{const a=request.artifacts.find((a:any)=>!a.goalIds||a.goalIds.includes(g.id));return {goalId:g.id,firstInspection:a?.id??null,candidates:a?[{artifactId:a.id,relevance:'relevant',whyInspect:'Inspect the pending-work return path',reviewQuestion:'Does reconnect retain pending entries?',uncertainty:'Runtime behavior was not exercised'}]:[],uncertainty:[]};}),readPaths:[]});
describe('Luna review navigation',()=>{
 it.each(['src/app/reports/[id]/page.tsx','src/app/(auth)/login/page.tsx','src/app/[...slug]/page.tsx','src/app/[[...slug]]/page.tsx','src/app/@modal/(.)photo/page.tsx'])('retains legitimate framework route %s',async path=>{
  const i=input();i.changedFiles[0].path=path;
  const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):ranks(q));
  expect(r.reviewCandidates.navigation.artifacts.some((a:any)=>a.path===path)).toBe(true);
  expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:r}).valid).toBe(true);
 });
 it('interprets goals independently of strict extraction and ranks real code without promoting status',async()=>{
  const i=input(), strict=generateVerificationReportV2FromInput(i);let seen='';
  const r=await run(i,async(q:any)=>{if(q.stage==='intent'){expect(q.sources.map((s:any)=>s.authority)).toEqual(['issue_source','pr_author_claim','pr_author_claim']);return goals(q);}seen=JSON.stringify(q);return ranks(q);});
  expect(r.requirements).toEqual(strict.requirements);expect(r.summary).toEqual(strict.summary);
  const view=buildPrEvidenceReview(r);expect(view.objectives[0].text).toBe('Preserve pending work during reconnect');
  expect(view.objectives[0].firstInspection).toMatchObject({label:'src/queue.ts',relation:'candidate',line:1});
  expect(view.objectives[0].firstInspection!.url).toContain(`/blob/${head}/`);
  expect(seen).toContain('return queue.pending');
  expect(r.reviewCandidates.navigation.goals.map((g:any)=>g.emphasis)).toEqual(['primary','optional']);
  expect(JSON.stringify(r.reviewCandidates.navigation)).not.toContain('return queue.pending');
 });
 it('labels PR-only intent as author claims and retains change access on semantic failure',async()=>{
  const i=input();i.taskText='';i.description='Retain queued work.';
  const r=await run(i,async(q:any)=>q.stage==='intent'?{goals:[{summary:'Keep queued work',emphasis:'primary',sourceRefs:[q.sources[0].spans[0].id],facets:[],openQuestions:[]}],unprocessed:[]}:ranks(q));
  expect(r.reviewCandidates.navigation.goals[0].authority).toBe('pr_author_claim');
  const failed=await run(i,async()=>{throw Error('private raw provider message');});
  const v=buildPrEvidenceReview(failed);expect(v.mode).toBe('change_summary');expect(v.changes.some(x=>x.label==='src/queue.ts')).toBe(true);expect(v.nextInspection).not.toContain('Inspect src/');expect(JSON.stringify(failed)).not.toContain('private raw provider message');
 });
 it('removes invented ranking references and accepts a supplied unchanged exact-head helper',async()=>{
  const i=input();i.verificationCriterionEvidenceV2={artifactBlobs:[{path:'src/helper.ts',headSha:head,content:'export function retain(queue) { return queue.pending; }'}]};
  const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):{...ranks(q),rankings:q.goals.map((g:any)=>({goalId:g.id,firstInspection:'invented',candidates:[{artifactId:'invented',relevance:'relevant',whyInspect:'Check invented code',reviewQuestion:'Is it linked?',uncertainty:''}],uncertainty:[]}))});
  expect(buildPrEvidenceReview(r).objectives[0].firstInspection).toBeUndefined();expect(r.reviewCandidates.navigation.limitations).toContain('invalid_reference');
  const valid=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);const a=q.artifacts.find((a:any)=>a.path==='src/helper.ts');return {...ranks({...q,artifacts:[a]})};});
  expect(buildPrEvidenceReview(valid).objectives[0].firstInspection!.label).toBe('src/helper.ts');
 });
});

describe('navigation boundaries and surfaces',()=>{
 it('rejects forged source/revision/path/range/rank mutations at the full boundary',async()=>{
  const i=input(),r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):ranks(q));
  expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:r}).valid).toBe(true);
  for(const mutate of [(n:any)=>n.repository='other/repo',(n:any)=>n.headSha='d'.repeat(40),(n:any)=>n.artifacts[0].path='src/fake.ts',(n:any)=>n.artifacts[0].startLine=999,(n:any)=>n.goals[0].sourceRefs[0].start=99,(n:any)=>n.goals[0].firstInspection='invented']){
   const clone=structuredClone(r);mutate(clone.reviewCandidates.navigation);expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:clone}).valid).toBe(false);
  }
 });
 it('round-trips semantic reasons and explicit first location through signed storage, Markdown and UI',async()=>{
  const i=input(),r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):ranks(q));
  const prepared=prepareTenantDetailReportForStorage(r,'verified_agentproof','test-key');
  const saved=projectTenantPersistedReport(prepared,'test-key');const decoded=decodeTenantPersistedReport(saved,{signingSecret:'test-key',createdAt:r.createdAt});
  expect(decoded.status).toBe('valid');if(decoded.status!=='valid')throw Error('decode failed');
  const view=buildDashboardPrEvidenceReview({report:decoded.report,repositoryFullName:'acme/queue',headSha:head})!;
  expect(view.objectives[0].firstInspection?.whyInspect).toBe('Inspect the pending-work return path');
  const html=renderToStaticMarkup(createElement(PrEvidenceReview,{review:view}));
  for(const surface of [html,reportToMarkdown(r)]){expect(surface).toContain('Does reconnect retain pending entries?');expect(surface).toContain('Runtime behavior was not exercised');expect(surface).toContain('Inspect first');}
  expect(JSON.stringify(sanitizeReportForShare(r))).not.toContain('Inspect the pending-work return path');
 });
 it('does not read privately or retain injected code/provider error text',async()=>{
  const i=input();i.repositoryPrivate=true;let calls=0;
  const r=await run(i,async()=>{calls++;throw Error('raw secret');});expect(calls).toBe(0);expect(r.reviewCandidates.navigation.state).toBe('fallback');
  i.repositoryPrivate=false;
  const bad=await run(i,async(q:any)=>q.stage==='intent'?goals(q):{...ranks(q),rankings:[{...ranks(q).rankings[0],candidates:[{...ranks(q).rankings[0].candidates[0],whyInspect:'```return queue.pending```'}]}]});
  expect(JSON.stringify(bad.reviewCandidates.navigation)).not.toContain('```');
 });
 it('rechecks freshness and removes stale ranked locations',async()=>{
  const i=input();let reads=0;const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):ranks(q),{readCurrentInput:async()=>++reads===1?i:({...i,sourceProvenance:{...i.sourceProvenance,headSha:'d'.repeat(40)}})});
  expect(r.reviewCandidates.navigation.limitations).toContain('stale_snapshot');expect(buildPrEvidenceReview(r).objectives[0].firstInspection).toBeUndefined();
 });
 it('keeps exact-commit review navigation when only public GitHub recheck is rate limited',async()=>{
  const i=input();let calls=0;
  const r=await run(i,async(q:any)=>{calls++;return q.stage==='intent'?goals(q):ranks(q);},{
   readCurrentInput:async()=>{throw new GitHubFetchError(403,'github_rate_limited','API limit reached',false);}
  });
  const view=buildPrEvidenceReview(r);
  expect(calls).toBeGreaterThan(0);
  expect(view.objectives[0].firstInspection?.url).toContain(`/blob/${head}/`);
  expect(view.retrievalNote).toContain('not reconfirmed');
  expect(r.reviewCandidates.navigation.limitations).toContain('freshness_unavailable');
  expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:r}).valid).toBe(true);
 });
});

it('runs the ordinary runtime with the navigation provider and preserves strict generation',async()=>{
 const {runGeneralPrObservationNowV2}=await import('./general-pr-observation-service');
 const {resolveGeneralPrAssessmentRuntimePolicyV1}=await import('./general-pr-runtime-policy');
 const i=input();const result=await runGeneralPrObservationNowV2({input:i,policy:resolveGeneralPrAssessmentRuntimePolicyV1('advisory'),generateReport:generateVerificationReportV2FromInput,validateDeterministicReport:()=>true,navigation:{model:'gpt-5.6-luna',provider:async(q:any)=>q.stage==='intent'?goals(q):ranks(q)}} as any);
 expect(buildPrEvidenceReview(result.report).objectives[0].text).toBe('Preserve pending work during reconnect');
});
it('uses strict schemas for both bounded navigation stages without provider storage',async()=>{
 const adapter=await import('./openai-semantic');
 for(const [stage,output,name] of [['intent','{"goals":[],"unprocessed":[]}','agentproof_review_navigation_intent_v1'],['ranking','{"rankings":[],"readPaths":[]}','agentproof_review_navigation_ranking_v1']] as const){
  let sent:any;const result=await (adapter as any).submitReviewNavigationWithOpenAI({stage,model:'gpt-5.6-luna',goals:[],sources:[],artifacts:[],inventory:[],capabilities:{readPaths:false,searchScope:'supplied_artifacts',wholeRepository:false}},{apiKey:'test-key',fetchFn:async(_url:any,init:any)=>{sent=JSON.parse(init.body);return Response.json({model:'gpt-5.6-luna',output:[{type:'message',content:[{type:'output_text',text:output}]}]});}});
  expect(result).toEqual(JSON.parse(output));expect(sent.model).toBe('gpt-5.6-luna');expect(sent.store).toBe(false);
  expect(sent.text.format).toMatchObject({type:'json_schema',name,strict:true,schema:{type:'object',additionalProperties:false}});
  const objects=(value:any):any[]=>value&&typeof value==='object'?[value,...Object.values(value).flatMap(objects)]:[];
  expect(objects(sent.text.format.schema).filter(value=>value.type==='object').every(value=>value.additionalProperties===false&&Array.isArray(value.required))).toBe(true);
  if(stage==='intent'){
   const goal=sent.text.format.schema.properties.goals.items;
   expect(goal.required).toEqual(['summary','emphasis','sourceRefs','facets','openQuestions']);
   expect(goal.properties.facets.items.required).toEqual(['kind','summary','sourceRefs']);
  }else{
   const ranking=sent.text.format.schema.properties.rankings.items;
   expect(ranking.required).toEqual(['goalId','firstInspection','candidates','uncertainty']);
   expect(ranking.properties.firstInspection.type).toEqual(['string','null']);
   expect(ranking.properties.candidates.items.required).toEqual(['artifactId','relevance','whyInspect','reviewQuestion','uncertainty']);
  }
 }
});
it('exposes the exact provider output only through an explicit navigation callback',async()=>{
 const adapter=await import('./openai-semantic');
 const raw='{\n  "goals": [],\n  "unprocessed": []\n}';let captured='';
 await (adapter as any).submitReviewNavigationWithOpenAI({stage:'intent',model:'gpt-5.6-luna',goals:[],sources:[],artifacts:[],inventory:[],capabilities:{readPaths:false,searchScope:'supplied_artifacts',wholeRepository:false}},{apiKey:'test-key',onRawOutput:(text:string)=>{captured=text;},fetchFn:async()=>Response.json({model:'gpt-5.6-luna',output:[{type:'message',content:[{type:'output_text',text:raw}]}]})});
 expect(captured).toBe(raw);
});
it('reads an unchanged requested neighbor only at the bound head and rejects unreturned artifacts',async()=>{
 let rounds=0;const i=input();
 const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);rounds++;if(rounds===1)return {rankings:[],readPaths:['src/helper.py']};return ranks({...q,artifacts:q.artifacts.filter((a:any)=>a.path==='src/helper.py')});},{readArtifacts:async(paths:string[],sha:string)=>{expect(paths).toEqual(['src/helper.py']);expect(sha).toBe(head);return [{path:'src/helper.py',headSha:head,content:'def retain(queue):\n    return queue.pending'}];}});
 expect(buildPrEvidenceReview(r).objectives[0].firstInspection?.label).toBe('src/helper.py');
});
it('limits actual ranking context and never accepts artifacts that were not returned to the model',async()=>{
 const i=input();i.verificationCriterionEvidenceV2={artifactBlobs:Array.from({length:40},(_,n)=>({path:`src/file${n}.ts`,headSha:head,content:('long_source_line_'+n+'x'.repeat(90)+'\n').repeat(80)}))};
 let bytes=0;const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);bytes=Buffer.byteLength(JSON.stringify(q));return ranks(q);});
 expect(bytes).toBeLessThan(100000);expect(r.reviewCandidates.navigation.limitations).toContain('retrieval_file_budget_exceeded');
});
it('ignores query-only requests and retains the first ranking',async()=>{
 const i=input();let rounds=0;
 const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);rounds++;if(rounds===1)return {...ranks(q),searchQueries:['queue.pending']};return ranks(q);});
 expect(rounds).toBe(1);expect(buildPrEvidenceReview(r).objectives[0].firstInspection?.label).toBe('src/queue.ts');
});
it('keeps navigation available for real linked-issue source bindings without altering typed contracts',async()=>{
 const i=input();i.verificationContractSourceV2={kind:'linked_issue',title:'Queue work',body:i.taskText};i.verificationContractBindingV2={sourceKind:'linked_issue',sourceIdentity:'github:issue:acme/queue#2',sourceContent:i.taskText,headSha:head,baseSha:base};
 const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):ranks(q));expect(buildPrEvidenceReview(r).objectives[0].text).toBe('Preserve pending work during reconnect');
});
it('keeps exact-source authority when only capture time changes and shows distinct source links',async()=>{
 const i=input();i.verificationContractBindingV2={sourceKind:'linked_issue',sourceIdentity:'github:issue:acme/queue#2',sourceContent:i.taskText,headSha:head,baseSha:base};
 const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):ranks(q),{readCurrentInput:async()=>({...i,sourceProvenance:{...i.sourceProvenance,evidenceCapturedAt:'2026-09-16T00:01:00Z'}})});
 expect(buildPrEvidenceReview(r).objectives[0].firstInspection).toBeDefined();
 const html=renderToStaticMarkup(createElement(PrEvidenceReview,{review:buildPrEvidenceReview(r)}));expect(html).toContain('https://github.com/acme/queue/issues/2');expect(html).toContain('https://github.com/acme/queue/pull/1');
});
it('does not disclose source when the current snapshot cannot be reauthorized',async()=>{
 const i=input();let calls=0;const r=await run(i,async(q:any)=>{calls++;return q.stage==='intent'?goals(q):ranks(q);},{readCurrentInput:async()=>{throw Error('private repository denied');}});
 expect(calls).toBe(0);expect(buildPrEvidenceReview(r).mode).toBe('change_summary');expect(JSON.stringify(r)).not.toContain('private repository denied');
});
it('suppresses code navigation when UI repository/head context does not match the analyzed snapshot',async()=>{
 const i=input(),r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):ranks(q));
 for(const context of [{repositoryFullName:'wrong/repo'},{headSha:'d'.repeat(40)}]){
  for(const v of [buildPrEvidenceReview(r,context),buildDashboardPrEvidenceReview({report:r,...context})!]){
   expect(v.objectives[0].firstInspection).toBeUndefined();expect(v.changes.some(c=>c.url)).toBe(false);
  }
 }
});
it('retains ordinary source wording while removing copied code from explanations',async()=>{
 const i=input();
 for(const text of ['return queue.pending;','Retain queued work when reconnecting.']){
  const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):{...ranks(q),rankings:[{...ranks(q).rankings[0],candidates:[{...ranks(q).rankings[0].candidates[0],whyInspect:text}]}]});
  if(text.startsWith('return '))expect(JSON.stringify(r.reviewCandidates.navigation)).not.toContain(text);else expect(r.reviewCandidates.navigation.goals[0].candidates[0].whyInspect).toBe(text);
  expect(r.reviewCandidates.navigation.limitations).toContain('unsafe_summary_omitted');
 }
});
it('reports rejected stale snapshots and conflicting same-path content instead of using either',async()=>{
 const i=input();i.verificationCriterionEvidenceV2={artifactBlobs:[{path:'src/stale.ts',headSha:'d'.repeat(40),content:'stale body'},{path:'src/conflict.ts',headSha:head,content:'first version'},{path:'src/conflict.ts',headSha:head,content:'other version'}]};
 const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):ranks(q));
 expect(r.reviewCandidates.navigation.limitations).toContain('invalid_reference');expect(r.reviewCandidates.navigation.artifacts.some((a:any)=>/stale|conflict/.test(a.path))).toBe(false);
});
it('bounds fragmented source input and retains explicitly unprocessed source even if referenced',async()=>{
 const i=input();i.taskText='paragraph\n\n'.repeat(400);let sourceBytes=0;let spanCount=0;
 const r=await run(i,async(q:any)=>{if(q.stage==='intent'){sourceBytes=Buffer.byteLength(JSON.stringify(q));spanCount=q.sources[0].spans.length;return {goals:[{summary:'Inspect repeated source intent',emphasis:'uncertain',sourceRefs:[q.sources[0].spans[0].id],facets:[],openQuestions:[]}],unprocessed:[q.sources[0].spans[0].id]};}return ranks(q);});
 expect(sourceBytes).toBeLessThan(100000);expect(spanCount).toBeLessThanOrEqual(256);expect(r.reviewCandidates.navigation.unprocessed).toContain('task:0');expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:r}).valid).toBe(true);
});
it('displays the source identity alongside offsets in mixed-source goals',async()=>{
 const i=input();const r=await run(i,async(q:any)=>q.stage==='intent'?{goals:[{...goals(q).goals[0],sourceRefs:[q.sources[0].spans[0].id,q.sources[1].spans[0].id]}],unprocessed:[]}:ranks(q));
 const html=renderToStaticMarkup(createElement(PrEvidenceReview,{review:buildPrEvidenceReview(r)}));expect(html).toContain('task 0');expect(html).toContain('description 0');
});
it('preserves the PR title as a distinct author-claim source when the body is empty',async()=>{
 const i=input();i.taskText='';i.description='';i.title='Retain pending work after reconnect';
 const r=await run(i,async(q:any)=>{if(q.stage==='intent'){const title=q.sources.find((s:any)=>s.id==='title');return {goals:title?[{summary:'Preserve pending queue entries',emphasis:'primary',sourceRefs:[title.spans[0].id],facets:[],openQuestions:[]}]:[],unprocessed:[]};}return ranks(q);});
 expect(r.reviewCandidates.navigation.goals[0]?.authority).toBe('pr_author_claim');
});

describe('navigation refinement resilience',()=>{
 it.each(['output_limit','timeout','provider_unavailable'])('retains validated provisional ranking after %s refinement failure',async(category)=>{
  const {OpenAISemanticError}=await import('./openai-semantic');let rounds=0;
  const r=await run(input(),async(q:any)=>{if(q.stage==='intent')return goals(q);if(++rounds===1)return {...ranks(q),readPaths:['src/neighbor.ts']};throw new OpenAISemanticError(category==='timeout'?'openai_timeout':category==='output_limit'?'openai_output_invalid':'openai_provider_unavailable',false,'DO NOT STORE PROVIDER BODY',undefined,undefined,category==='output_limit'?'max_output_tokens':undefined);},refinementRead);
  const n=r.reviewCandidates.navigation;
  expect(buildPrEvidenceReview(r).objectives[0].firstInspection).toMatchObject({label:'src/queue.ts',line:1,relation:'candidate'});
  expect(n.failures).toEqual(expect.arrayContaining([expect.objectContaining({stage:'refinement',category})]));expect(n.state).toBe('partial');expect(n.rankingStatus).toBe('ready');expect(n.coverageStatus).toBe('partial');
  expect(JSON.stringify(n)).not.toContain('DO NOT STORE');
  for(const surface of [reportToMarkdown(r),renderToStaticMarkup(createElement(PrEvidenceReview,{review:buildPrEvidenceReview(r)}))])expect(surface).not.toContain('Refinement failed');
 });
 it('does not retain invalid provisional references when refinement fails',async()=>{
  let rounds=0;const r=await run(input(),async(q:any)=>{if(q.stage==='intent')return goals(q);if(++rounds===1)return {...ranks({...q,artifacts:[{id:'invented'}]}),readPaths:['src/neighbor.ts']};throw Error('raw provider detail');},refinementRead);
  expect(r.reviewCandidates.navigation.goals[0].firstInspection).toBeNull();expect(r.reviewCandidates.navigation.goals[0].candidates).toEqual([]);
  expect(r.reviewCandidates.navigation.failures).toEqual(expect.arrayContaining([expect.objectContaining({stage:'refinement',category:'unknown'})]));expect(r.reviewCandidates.navigation.rankingStatus).toBe('unavailable');
 });
 it('does not invent a ranking when retrieval-only first round is followed by failure',async()=>{
  let rounds=0;const r=await run(input(),async(q:any)=>q.stage==='intent'?goals(q):++rounds===1?{rankings:[],readPaths:['src/neighbor.ts']}:Promise.reject(Error('private detail')),refinementRead);
  expect(buildPrEvidenceReview(r).objectives[0].firstInspection).toBeUndefined();expect(r.reviewCandidates.navigation.failures).toEqual(expect.arrayContaining([expect.objectContaining({stage:'refinement',category:'unknown'})]));
 });
 it('retains provisional ranking on read failure and still rejects stale authorization',async()=>{
  let rounds=0;const provider=async(q:any)=>q.stage==='intent'?goals(q):({...ranks(q),readPaths:++rounds===1?['src/neighbor.ts']:[]});
  const r=await run(input(),provider,{readArtifacts:async()=>{throw Error('private read body');}});
  expect(r.reviewCandidates.navigation.goals[0].firstInspection).not.toBeNull();expect(r.reviewCandidates.navigation.failures).toContainEqual({stage:'read',category:'read_unavailable',reason:'read_unavailable'});
  let reads=0;rounds=0;const i=input();const stale=await run(i,provider,{readArtifacts:async()=>{throw Error();},readCurrentInput:async()=>++reads===1?i:null});
  expect(stale.reviewCandidates.navigation.goals[0].firstInspection).toBeNull();
 });
 it('retains independent same-file locations on both revisions and the selected first artifact line',async()=>{
  const i=input();i.changedFiles[0].patch+='\n@@ -40 +40 @@\n-old\n+second_location();';
  const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);const first=q.artifacts.find((a:any)=>a.side==='head'&&a.startLine===40);return {...ranks(q),rankings:q.goals.map((g:any)=>({goalId:g.id,firstInspection:first.id,candidates:q.artifacts.map((a:any)=>({...ranks(q).rankings[0].candidates[0],artifactId:a.id})),uncertainty:[]}))};});
  const n=r.reviewCandidates.navigation;expect(n.goals[0].candidates).toHaveLength(4);expect(intent.validReviewNavigation(n)).toBe(true);
  expect(n.goals[0].candidates.map((c:any)=>{const a=n.artifacts.find((a:any)=>a.id===c.artifactId);return [a.side,a.revision,a.startLine];})).toEqual(expect.arrayContaining([['head',head,1],['base',base,1],['head',head,40],['base',base,40]]));
  const view=buildPrEvidenceReview(r);const locations=[view.objectives[0].firstInspection!,...view.objectives[0].code];expect(locations).toHaveLength(4);expect(new Set(locations.map(item=>item.evidenceId)).size).toBe(4);
  expect(locations.map(item=>{const artifact=n.artifacts.find((artifact:any)=>artifact.id===item.evidenceId)!;return [artifact.side,artifact.revision,artifact.startLine];})).toEqual(expect.arrayContaining([['head',head,1],['base',base,1],['head',head,40],['base',base,40]]));
  expect(view.objectives[0].firstInspection).toMatchObject({label:'src/queue.ts',line:40,url:`https://github.com/acme/queue/blob/${head}/src/queue.ts#L40`});
 });
 it('separates primary ranking readiness from partial source coverage across signed surfaces',async()=>{
  const i=input();const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):({...ranks(q),rankings:ranks(q).rankings.slice(0,1)}));
  const n=r.reviewCandidates.navigation;expect(n.rankingStatus).toBe('ready');expect(n.coverageStatus).toBe('partial');expect(n.state).toBe('partial');
  expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:r}).valid).toBe(true);
  const saved=projectTenantPersistedReport(prepareTenantDetailReportForStorage(r,'verified_agentproof','test-key'),'test-key');const decoded=decodeTenantPersistedReport(saved,{signingSecret:'test-key',createdAt:r.createdAt});
  expect(decoded.status).toBe('valid');if(decoded.status!=='valid')throw Error('decode failed');
  expect((decoded.report as any).reviewCandidates.navigation).toMatchObject({rankingStatus:'ready',coverageStatus:'partial'});
  for(const surface of [reportToMarkdown(r),renderToStaticMarkup(createElement(PrEvidenceReview,{review:buildDashboardPrEvidenceReview({report:decoded.report,repositoryFullName:'acme/queue',headSha:head})!}))]){expect(surface).not.toContain('Ranking: ready');expect(surface).not.toContain('Coverage: partial');expect(surface).toContain('whole repository not searched');}
  expect(JSON.stringify(sanitizeReportForShare(r))).not.toContain('rankingStatus');
  const forged=structuredClone(n);forged.rankingStatus='unavailable';expect(intent.validReviewNavigation(forged)).toBe(false);
  const legacy=structuredClone(n);delete legacy.rankingStatus;delete legacy.coverageStatus;delete legacy.failures;expect(intent.validReviewNavigation(legacy)).toBe(true);
 });
 it('retains rationale and implementation/test claims as source-linked context, not strict results',async()=>{
  const i=input();i.taskText='';i.description='Keep the catalog selection stable.\n\nReaders lose their selection after reconnect.\n\nThe author says selection storage and a regression check were added.';
  const strict=generateVerificationReportV2FromInput(i);
  const r=await run(i,async(q:any)=>q.stage==='intent'?{goals:[{summary:'Maintain the active catalog selection',emphasis:'primary',sourceRefs:[q.sources[0].spans[0].id],facets:[{kind:'motivation',summary:'Reconnection disrupts reader continuity',sourceRefs:[q.sources[0].spans[1].id]},{kind:'implementation_claim',summary:'The author reports persistent selection storage',sourceRefs:[q.sources[0].spans[2].id]},{kind:'test_claim',summary:'The author reports adding a regression check',sourceRefs:[q.sources[0].spans[2].id]}],openQuestions:[]}],unprocessed:[]}:ranks(q));
  expect(r.reviewCandidates.navigation.goals[0]?.facets.map((f:any)=>f.kind)).toEqual(['motivation','implementation_claim','test_claim']);expect(r.requirements).toEqual(strict.requirements);expect(r.summary).toEqual(strict.summary);
  expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:r}).valid).toBe(true);
  for(const surface of [reportToMarkdown(r),renderToStaticMarkup(createElement(PrEvidenceReview,{review:buildPrEvidenceReview(r)}))]){expect(surface).toContain('Author-stated motivation');expect(surface).toContain('unverified');expect(surface).toContain('description 36');}
  const n=structuredClone(r.reviewCandidates.navigation);n.goals[0].facets[0].sourceRefs=[];expect(intent.validReviewNavigation(n)).toBe(false);
 });
 it('uses deterministic incomplete-response evidence for the output-limit category',async()=>{
  const {submitReviewNavigationWithOpenAI}=await import('./openai-semantic');let rounds=0;
  const r=await run(input(),async(q:any)=>{if(q.stage==='intent')return goals(q);if(++rounds===1)return {...ranks(q),readPaths:['src/neighbor.ts']};return submitReviewNavigationWithOpenAI(q,{apiKey:'test-key',fetchFn:async()=>Response.json({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},usage:{output_tokens:6000},output:[]})});},refinementRead);
  expect(r.reviewCandidates.navigation.failures).toEqual(expect.arrayContaining([expect.objectContaining({stage:'refinement',category:'output_limit'})]));expect(buildPrEvidenceReview(r).objectives[0].firstInspection).toBeDefined();
 });
});

it('classifies malformed refinement rows and preserves earlier valid candidates',async()=>{
 let round=0;const r=await run(input(),async(q:any)=>{if(q.stage==='intent')return goals(q);if(++round===1)return {...ranks(q),readPaths:['src/neighbor.ts']};return {...ranks(q),rankings:[{...ranks(q).rankings[0],firstInspection:null,candidates:[]},{...ranks(q).rankings[1],candidates:'not an array'}]};},refinementRead);
 expect(r.reviewCandidates.navigation.failures).toEqual(expect.arrayContaining([expect.objectContaining({stage:'refinement',category:'invalid_json_or_shape'})]));
 expect(r.reviewCandidates.navigation.goals.filter((g:any)=>g.emphasis==='primary').every((g:any)=>g.firstInspection)).toBe(true);
});
it('classifies invalid JSON, timeout and rate limiting using the real adapter without retaining response bodies',async()=>{
 const {submitReviewNavigationWithOpenAI}=await import('./openai-semantic');
 const scenarios:[string,()=>Promise<Response>][]=[['invalid_json_or_shape',async()=>Response.json({output:[{type:'message',content:[{type:'output_text',text:'private invalid json'}]}]})],['timeout',async()=>{throw new DOMException('private timeout body','TimeoutError');}],['rate_limited',async()=>new Response('private rate limit body',{status:429})]];
 for(const [category,fetchFn] of scenarios){const r=await run(input(),async(q:any)=>submitReviewNavigationWithOpenAI(q,{apiKey:'test-key',fetchFn}));expect(r.reviewCandidates.navigation.failures).toEqual(expect.arrayContaining([expect.objectContaining({stage:'intent',category})]));expect(r.reviewCandidates.navigation.rankingStatus).toBe('unavailable');expect(JSON.stringify(r.reviewCandidates.navigation)).not.toContain('private');}
});
it('keeps unverified intent context through signed storage and rejects missing refs or raw copying',async()=>{
 const i=input();i.description='The author reports a new durable queue and a new scenario check.';
 const provider=async(q:any)=>q.stage==='intent'?{...goals(q),goals:[{...goals(q).goals[0],facets:[{kind:'implementation_claim',summary:'Author reports durable storage',sourceRefs:[q.sources[1].spans[0].id]}]}]}:ranks(q);
 const r=await run(i,provider);const stored=projectTenantPersistedReport(prepareTenantDetailReportForStorage(r,'verified_agentproof','test-key'),'test-key');const decoded=decodeTenantPersistedReport(stored,{signingSecret:'test-key',createdAt:r.createdAt});
 expect(decoded.status).toBe('valid');if(decoded.status!=='valid')throw Error('decode failed');
 expect((decoded.report as any).reviewCandidates.navigation.goals[0].facets[0]).toMatchObject({kind:'implementation_claim',summary:'Author reports durable storage',sourceRefs:[{sourceId:'description',start:0}]});
 for(const field of [{sourceRefs:[]},{summary:i.description},{summary:'return queue.pending;'}]){
  const invalid=await run(i,async(q:any)=>{const result:any=await provider(q);if(q.stage==='intent')Object.assign(result.goals[0].facets[0],field);return result;});
  expect(invalid.reviewCandidates.navigation.goals).toHaveLength(1);if('sourceRefs' in field)expect(invalid.reviewCandidates.navigation.goals[0].facets).toEqual([]);else expect(invalid.reviewCandidates.navigation.goals[0].facets[0].summary).toBe(field.summary===i.description?i.description:'Summary omitted; inspect the referenced source.');expect(invalid.reviewCandidates.navigation.goals[0].firstInspection).not.toBeNull();
  expect(invalid.reviewCandidates.navigation.failures).toEqual(expect.arrayContaining([expect.objectContaining({stage:'intent',category:'invalid_json_or_shape'})]));
 }
 expect(JSON.stringify(sanitizeReportForShare(r))).not.toContain('Author reports durable storage');
});
it('accepts complete bounded coverage independently of optional ranking and rejects forged statuses/categories',async()=>{
 const i=input();i.title='';i.description='';
 const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):({...ranks(q),rankings:ranks(q).rankings.slice(0,1)}));
 const n=r.reviewCandidates.navigation;expect(n).toMatchObject({state:'partial',rankingStatus:'ready',coverageStatus:'complete'});
 for(const mutate of [(x:any)=>x.coverageStatus='partial',(x:any)=>x.failures=[{stage:'refinement',category:'raw provider text'}],(x:any)=>x.failures=[{stage:'refinement',category:'timeout',message:'raw text'}]]){const forged=structuredClone(n);mutate(forged);expect(intent.validReviewNavigation(forged)).toBe(false);}
});
it('reauthorizes a retained provisional location after a failed second round',async()=>{
 const i=input();let round=0,reads=0;
 const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):++round===1?{...ranks(q),readPaths:['src/neighbor.ts']}:Promise.reject(Error('unavailable')),{...refinementRead,readCurrentInput:async()=>++reads===1?i:null});
 expect(r.reviewCandidates.navigation.goals[0].firstInspection).toBeNull();expect(r.reviewCandidates.navigation.rankingStatus).toBe('unavailable');expect(r.reviewCandidates.navigation.limitations).toContain('freshness_unavailable');
});

it('leaves the deterministic report unchanged apart from its additive companion',async()=>{
 const i=input(),strict=generateVerificationReportV2FromInput(i),before=structuredClone(strict);
 const result=await intent.enrichReviewNavigation(i,strict,{model:'configured-model',provider:async(q:any)=>q.stage==='intent'?goals(q):ranks(q)});
 const {navigation:_,...reviewCandidates}=result.reviewCandidates!;
 expect({...result,reviewCandidates}).toEqual(before);expect(strict).toEqual(before);
});

describe('rerank only with new exact-head context',()=>{
 it('accepts the minimal ranking contract and ignores unsolicited query-only output',async()=>{
  for(const extra of [{},{searchQueries:['pending']}]){
   let count=0;const r=await run(input(),async(q:any)=>{if(q.stage==='intent')return goals(q);count++;return {...ranks(q),...extra};});
   expect(buildPrEvidenceReview(r).objectives[0].firstInspection).toBeDefined();expect(count).toBe(1);
  }
 });
 it.each(['empty','duplicate','stale','failed','blank','unsafe'])('preserves round one without reranking after %s reads',async(mode)=>{
  const i=input();i.verificationCriterionEvidenceV2={artifactBlobs:[{path:'src/neighbor.ts',headSha:head,content:'existing context'}]};let count=0;
  const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);count++;return {...ranks({...q,artifacts:q.artifacts.filter((a:any)=>a.path==='src/queue.ts')}),readPaths:mode==='blank'?[]:mode==='unsafe'?['../outside.ts']:['src/neighbor.ts','src/neighbor.ts']};},{readArtifacts:async()=>{if(mode==='failed')throw Error('private failure');return mode==='empty'?[]:[{path:'src/neighbor.ts',headSha:mode==='stale'?'d'.repeat(40):head,content:'existing context'}];}});
  expect(count).toBe(1);expect(buildPrEvidenceReview(r).objectives[0].firstInspection).toMatchObject({label:'src/queue.ts',line:1});
 });
 it('reranks exactly once for new content even when a path is requested twice',async()=>{
  let count=0;const r=await run(input(),async(q:any)=>{if(q.stage==='intent')return goals(q);count++;return {...ranks(q),readPaths:['src/neighbor.ts','src/neighbor.ts']};},{readArtifacts:async(paths:string[],revision:string)=>{expect(paths).toEqual(['src/neighbor.ts']);expect(revision).toBe(head);return [{path:'src/neighbor.ts',headSha:head,content:'new context'}];}});
  expect(count).toBe(2);expect(r.reviewCandidates.navigation.artifacts.some((a:any)=>a.path==='src/neighbor.ts')).toBe(true);
 });
});

describe('closed navigation and runtime diagnostic reasons',()=>{
 it.each(['unknown_source_ref','unsafe_summary','local_shape'])('identifies intent %s without recording rejected content',async(reason)=>{
  const r=await run(input(),async(q:any)=>{const v=goals(q);if(reason==='unknown_source_ref')v.goals[0].sourceRefs=['PRIVATE_UNKNOWN_REF'];if(reason==='unsafe_summary')v.goals[0].summary='```PRIVATE_SOURCE```';if(reason==='local_shape')return {goals:'PRIVATE_SHAPE'};return v;});
  expect(r.reviewCandidates.navigation.failures).toContainEqual({stage:'intent',category:'invalid_json_or_shape',reason});expect(JSON.stringify(r.reviewCandidates.navigation)).not.toContain('PRIVATE_');
 });
 it.each(['unknown_goal_ref','unknown_artifact_ref','first_not_candidate','unsafe_summary'])('identifies refinement %s while preserving validated provisional location',async(reason)=>{
  let calls=0;const r=await run(input(),async(q:any)=>{if(q.stage==='intent')return goals(q);const v=ranks({...q,artifacts:q.artifacts.filter((a:any)=>a.path==='src/queue.ts')});if(++calls===1)return {...v,readPaths:['src/neighbor.ts']};if(reason==='unknown_goal_ref')v.rankings[0].goalId='PRIVATE_GOAL';if(reason==='unknown_artifact_ref')v.rankings[0].candidates[0].artifactId='PRIVATE_ARTIFACT';if(reason==='first_not_candidate')v.rankings[0].firstInspection='PRIVATE_FIRST';if(reason==='unsafe_summary')v.rankings[0].candidates[0].whyInspect='```PRIVATE_CODE```';return v;},refinementRead);
  expect(r.reviewCandidates.navigation.failures).toContainEqual({stage:'refinement',category:'invalid_json_or_shape',reason});expect(buildPrEvidenceReview(r).objectives[0].firstInspection?.label).toBe('src/queue.ts');expect(JSON.stringify(r.reviewCandidates.navigation)).not.toContain('PRIVATE_');
  const n=structuredClone(r.reviewCandidates.navigation);expect(intent.validReviewNavigation(n)).toBe(true);for(const f of n.failures)delete f.reason;expect(intent.validReviewNavigation(n)).toBe(true);n.failures[0].reason='PRIVATE_RAW_REASON';expect(intent.validReviewNavigation(n)).toBe(false);
 });
 it.each(['provider_incomplete','provider_invalid_json','provider_output_unavailable'])('distinguishes adapter %s from local shape rejection',async(reason)=>{
  const {submitReviewNavigationWithOpenAI}=await import('./openai-semantic');
  const payload=reason==='provider_incomplete'?{status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}:reason==='provider_invalid_json'?{output:[{type:'message',content:[{type:'output_text',text:'PRIVATE_BROKEN_JSON'}]}]}:{output:[]};
  const r=await run(input(),(q:any)=>submitReviewNavigationWithOpenAI(q,{apiKey:'test-key',fetchFn:async()=>Response.json(payload)}));expect(r.reviewCandidates.navigation.failures[0].reason).toBe(reason);expect(JSON.stringify(r.reviewCandidates.navigation)).not.toContain('PRIVATE_');
 });
 it('returns safe boundary codes for context, intent, candidate and report failures with legacy errors intact',async()=>{
  const i=input();const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):ranks(q));
  expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:{...i,title:'Changed'},report:r})).toMatchObject({valid:false,reasonCodes:['navigation_context_mismatch'],errors:['Review navigation requires its bound source and exact read context.']});
  const strict=generateVerificationReportV2FromInput(i);const altered=structuredClone(strict);altered.reviewCandidates!.intentGraph!.repository='private/rejected';
  expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:altered})).toMatchObject({valid:false,reasonCodes:['intent_mismatch']});
  const badCandidates=structuredClone(strict);badCandidates.reviewCandidates!.version=99 as any;
  expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:badCandidates})).toMatchObject({valid:false,reasonCodes:['review_candidate_invalid'],errors:['Invalid review candidates.']});
  const badReport=structuredClone(strict);(badReport.summary as any).riskLevel='PRIVATE_STATUS';
  const result=validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:badReport});expect(result).toMatchObject({valid:false,reasonCodes:['report_invalid']});if(!result.valid)expect(JSON.stringify((result as any).reasonCodes)).not.toContain('PRIVATE_');
 });
});

it('round-trips safe diagnostic reasons through signed storage and omits navigation from shares',async()=>{
 let rounds=0;const i=input();const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);if(++rounds===1)return {...ranks(q),readPaths:['src/neighbor.ts']};const v=ranks(q);v.rankings[0].candidates[0].whyInspect='```PRIVATE_REJECTED_SNIPPET```';return v;},refinementRead);
 expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:r}).valid).toBe(true);
 const saved=projectTenantPersistedReport(prepareTenantDetailReportForStorage(r,'verified_agentproof','test-key'),'test-key');const decoded=decodeTenantPersistedReport(saved,{signingSecret:'test-key',createdAt:r.createdAt});
 expect(decoded.status).toBe('valid');if(decoded.status!=='valid')throw Error('decode failed');
 expect((decoded.report as any).reviewCandidates.navigation.failures).toEqual([{stage:'refinement',category:'invalid_json_or_shape',reason:'unsafe_summary'}]);
 expect(JSON.stringify(saved)).not.toContain('PRIVATE_REJECTED_SNIPPET');expect(JSON.stringify(sanitizeReportForShare(r))).not.toContain('unsafe_summary');
});

describe('field-local navigation privacy filtering',()=>{
 it('retains source-linked goals and safe context when a required summary copies source text',async()=>{
  const i=input();const r=await run(i,async(q:any)=>{if(q.stage==='ranking')return ranks(q);const v=goals(q);v.goals[0].summary=i.taskText.split('\n\n')[0];return v;});
  const n=r.reviewCandidates.navigation;expect(n.goals).toHaveLength(2);expect(n.goals[0].summary).toBe(i.taskText.split('\n\n')[0]);expect(n.goals[0].facets[0].summary).toBe('During reconnection');
  expect(buildPrEvidenceReview(r).objectives[0].firstInspection?.label).toBe('src/queue.ts');expect(n.goals[0].summary).toBe(i.taskText.split('\n\n')[0]);expect(n.failures).toContainEqual({stage:'intent',category:'invalid_json_or_shape',reason:'unsafe_summary'});
  expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:r}).valid).toBe(true);
 });
 it('keeps facet metadata and drops fenced questions while preserving safe siblings',async()=>{
  const r=await run(input(),async(q:any)=>{if(q.stage==='ranking')return ranks(q);const v:any=goals(q);v.goals[0].facets.push({kind:'context',summary:'return queue.pending;',sourceRefs:v.goals[0].sourceRefs});v.goals[0].openQuestions=['Safe reviewer question?','```PRIVATE_QUESTION```'];return v;});
  const g=r.reviewCandidates.navigation.goals[0];expect(g.summary).toBe('Preserve pending work during reconnect');expect(g.facets).toHaveLength(2);expect(g.facets[1]).toMatchObject({kind:'context',summary:'Summary omitted; inspect the referenced source.',sourceRefs:g.sourceRefs});expect(g.facets[0].summary).toBe('During reconnection');expect(g.openQuestions).toEqual(['Safe reviewer question?']);expect(g.firstInspection).not.toBeNull();expect(JSON.stringify(r.reviewCandidates.navigation)).not.toContain('PRIVATE_QUESTION');
 });
 it('retains candidate links and safe explanations despite an unsafe explanation in the same ranking',async()=>{
  const r=await run(input(),async(q:any)=>{if(q.stage==='intent')return goals(q);const v=ranks(q);v.rankings[0].candidates[0].whyInspect='return queue.pending;';v.rankings[0].uncertainty=['```PRIVATE_UNCERTAINTY```','Execution is unmeasured'];return v;});
  const n=r.reviewCandidates.navigation;expect(n.goals.filter((g:any)=>g.emphasis==='primary').every((g:any)=>g.firstInspection)).toBe(true);expect(n.goals[0].candidates[0]).toMatchObject({whyInspect:'',reviewQuestion:'Does reconnect retain pending entries?',uncertainty:'Runtime behavior was not exercised'});expect(n.goals[0].uncertainty).toEqual(['Execution is unmeasured']);expect(JSON.stringify(n)).not.toContain('return queue.pending;');expect(JSON.stringify(n)).not.toContain('PRIVATE_');
 });
 it('keeps internal diagnostics in storage but omits partial status labels from reviewer surfaces',async()=>{
  const i=input(),r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):ranks(q));expect(r.reviewCandidates.navigation.state).toBe('partial');expect(r.reviewCandidates.navigation.coverageStatus).toBe('partial');
  const saved=projectTenantPersistedReport(prepareTenantDetailReportForStorage(r,'verified_agentproof','test-key'),'test-key');const decoded=decodeTenantPersistedReport(saved,{signingSecret:'test-key',createdAt:r.createdAt});expect(decoded.status).toBe('valid');if(decoded.status!=='valid')throw Error();
  expect((decoded.report as any).reviewCandidates.navigation.coverageStatus).toBe('partial');
  for(const v of [buildPrEvidenceReview(r),buildDashboardPrEvidenceReview({report:decoded.report,repositoryFullName:'acme/queue',headSha:head})!]){const html=renderToStaticMarkup(createElement(PrEvidenceReview,{review:v}));expect(html).not.toContain('partial');expect(html).not.toContain('Ranking:');expect(html).toContain('whole repository not searched');}
  expect(reportToMarkdown(r)).not.toContain('Coverage: partial');
 });
});

it('keeps filtered cards safe through signed storage without weakening reference validation',async()=>{
 const i=input(),secret='ghp_'+'a'.repeat(36);
 const r=await run(i,async(q:any)=>{if(q.stage==='intent'){const v=goals(q);v.goals[0].summary=secret;return v;}const v=ranks(q);v.rankings[0].candidates[0].reviewQuestion=secret;return v;});
 const prepared=prepareTenantDetailReportForStorage(r,'verified_agentproof','test-key');const saved=projectTenantPersistedReport(prepared,'test-key');const decoded=decodeTenantPersistedReport(saved,{signingSecret:'test-key',createdAt:r.createdAt});
 expect(decoded.status).toBe('valid');expect(JSON.stringify(saved)).not.toContain(secret);expect(JSON.stringify(sanitizeReportForShare(r))).not.toContain(secret);
 expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:r}).valid).toBe(true);
 const invalid=await run(i,async(q:any)=>{if(q.stage==='ranking')return ranks(q);const v=goals(q);v.goals[0].summary=secret;v.goals[0].sourceRefs=['invented'];return v;});expect(invalid.reviewCandidates.navigation.goals.map((g:any)=>g.id)).toEqual(['goal_2']);
});

describe('goal-directed structural retrieval',()=>{
 const body='export function retainPending(queue) {\n  const pending = queue.pending;\n  return pending;\n}';
 it('reads a complete relevant function after line 800 without sending the unrelated prefix',async()=>{
  const i=input();let observed:any[]=[];
  const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);observed=q.artifacts;const target=q.artifacts.find((a:any)=>a.path==='src/deep.ts');return target?ranks({...q,artifacts:[target]}):{...ranks(q),readPaths:['src/deep.ts']};},{readArtifacts:async()=>[{path:'src/deep.ts',headSha:head,content:'// unrelated catalog heading\n'.repeat(950)+body}]});
  const a=observed.find(a=>a.path==='src/deep.ts');expect(a).toMatchObject({startLine:951,endLine:954,content:body,revision:head});expect(JSON.stringify(observed)).not.toContain('unrelated catalog heading');expect(a.goalIds).toContain('goal_1');expect(a.hash).toBe(createHash('sha256').update(body).digest('hex'));
  expect(buildPrEvidenceReview(r).objectives[0].firstInspection).toMatchObject({label:'src/deep.ts',line:951});expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:r}).valid).toBe(true);
 });
 it.each(['rs','unknown','ts'])('searches beyond line 800 in %s fallback without claiming parsed structure',async(extension)=>{
  const i=input();let seen:any[]=[];const path=`src/deep.${extension}`;
  const content='// unrelated prefix\n'.repeat(1100)+(extension==='ts'?'function retainPending( {\n  return queue.pending;':'fn retain_pending() {\n    pending();\n}');
  const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);seen=q.artifacts;return {...ranks(q),readPaths:[path]};},{readArtifacts:async()=>[{path,headSha:head,content}]});
  const a=seen.find(a=>a.path===path);expect(a?.startLine).toBeGreaterThan(1000);expect(a?.content).toContain('pending');expect(r.reviewCandidates.navigation.limitations).toContain(extension==='ts'?'retrieval_parse_failed':'retrieval_language_unsupported');
 });
 it('deduplicates structural ranges and changed hunks while preserving both goal associations',async()=>{
  const i=input();i.changedFiles=[{path:'src/deep.ts',status:'modified',patch:'@@ -951,4 +951,4 @@\n '+body.replaceAll('\n','\n ')}];i.verificationCriterionEvidenceV2={artifactBlobs:[{path:'src/deep.ts',headSha:head,content:'\n'.repeat(950)+body},{path:'src/deep.ts',headSha:head,content:'\n'.repeat(950)+body}]};let seen:any[]=[];
  const r=await run(i,async(q:any)=>{if(q.stage==='intent'){const v=goals(q);v.goals[1].summary='Inspect pending storage';return v;}seen=q.artifacts;return ranks(q);});
  expect(seen).toHaveLength(1);expect(seen[0].goalIds).toEqual(['goal_1','goal_2']);expect(r.reviewCandidates.navigation.goals.filter((g:any)=>g.emphasis==='primary').every((g:any)=>g.firstInspection)).toBe(true);
 });
 it('bounds the shared artifact payload and keeps tests as candidate context',async()=>{
  const i=input();i.verificationCriterionEvidenceV2={artifactBlobs:Array.from({length:8},(_,n)=>({path:n%2?`tests/pending${n}.ts`:`src/pending${n}.ts`,headSha:head,content:Array.from({length:20},(_,k)=>`export function pending${n}_${k}() {\n  return '${'x'.repeat(700)}';\n}`).join('\n')}))};let seen:any[]=[];
  const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);seen=q.artifacts;return ranks(q);});
  expect(seen.some(a=>a.kind==='test')).toBe(true);expect(seen.length).toBeGreaterThan(0);expect(Buffer.byteLength(JSON.stringify(seen))).toBeLessThanOrEqual(48000);
  for(const g of r.reviewCandidates.navigation.goals){const candidates=seen.filter(a=>a.goalIds?.includes(g.id));expect(candidates.length).toBeLessThanOrEqual(16);expect(Buffer.byteLength(JSON.stringify(candidates))).toBeLessThanOrEqual(48000);}
  expect(r.reviewCandidates.navigation.limitations).toContain('retrieval_budget_exceeded');expect(JSON.stringify(seen)).not.toContain('pending0_19');
 });
 it('does not admit wrong-head structural snippets',async()=>{
  const i=input();let seen:any[]=[];const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);seen=q.artifacts;return {...ranks(q),readPaths:['src/deep.ts']};},{readArtifacts:async()=>[{path:'src/deep.ts',headSha:'d'.repeat(40),content:'\n'.repeat(900)+body}]});
  expect(seen.some(a=>a.path==='src/deep.ts')).toBe(false);expect(r.reviewCandidates.navigation.limitations).toContain('invalid_reference');expect(r.reviewCandidates.navigation.goals[0].firstInspection).not.toBeNull();
 });
});
it('coalesces overlapping fallback ranges without losing goal associations',async()=>{
 const i=input();i.verificationCriterionEvidenceV2={artifactBlobs:[{path:'src/shared.rs',headSha:head,content:'\n'.repeat(900)+'pending();\n'+'\n'.repeat(6)+'retire();\n'+ '\n'.repeat(10)}]};let seen:any[]=[];
 await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);seen=q.artifacts;return ranks(q);});
 const shared=seen.filter(a=>a.path==='src/shared.rs');expect(shared).toHaveLength(1);expect(shared[0].goalIds).toEqual(['goal_1','goal_2']);
});
it('reports bounded structural enumeration even for a dense file',async()=>{
 const {extractReviewSnippets}=await import('./review-snippets');const r=await extractReviewSnippets([{path:'src/dense.ts',headSha:head,content:'const pending = 1;\n'.repeat(1200)}],[{id:'goal_1',terms:['pending'],anchors:[]}]);
 expect(r.limitations).toContain('retrieval_scan_budget_exceeded');expect(r.snippets.length).toBeLessThanOrEqual(16);
});

describe('stable refinement comparison',()=>{
 const edge=(id:string)=>({artifactId:id,relevance:'relevant',whyInspect:'Inspect behavior',reviewQuestion:'Is behavior consistent?',uncertainty:''});
 it('retains validated comparisons alongside new snapshots without exposing incumbency',async()=>{
  const i=input();i.changedFiles.push({path:'src/compare.ts',status:'modified',patch:'@@ -1 +1 @@\n+pending();'});let rounds=0;let firstIds:string[]=[];let second:any;
  await run(i,async(q:any)=>{if(q.stage==='intent')return {...goals(q),goals:goals(q).goals.slice(0,1)};if(++rounds===1){firstIds=q.artifacts.map((a:any)=>a.id);return {rankings:[{goalId:q.goals[0].id,firstInspection:firstIds[0],candidates:firstIds.map(edge),uncertainty:[]}],readPaths:Array.from({length:8},(_,n)=>`src/new${n}.ts`)};}second=q;return ranks(q);},{readArtifacts:async(paths:string[])=>paths.map(path=>({path,headSha:head,content:'export function pending() { return 1; }'}))});
  expect(rounds).toBe(2);expect(second.artifacts.map((a:any)=>a.id)).toEqual(expect.arrayContaining(firstIds));expect(second.artifacts.some((a:any)=>a.path.includes('/new'))).toBe(true);expect(second.goals[0].firstInspection).toBeNull();expect(second.goals[0].candidates).toEqual([]);expect(Buffer.byteLength(JSON.stringify(second.artifacts))).toBeLessThanOrEqual(12000);
 });
 it('isolates goal associations and anchors for distinct changed files',async()=>{
  const i=input();i.changedFiles=[{path:'src/pending.ts',patch:'@@ -1 +1 @@\n+pending();'},{path:'src/retire.ts',patch:'@@ -1 +1 @@\n+retire();'}];i.verificationCriterionEvidenceV2={artifactBlobs:[{path:'src/pending.ts',headSha:head,content:'function pending() { pending(); }'},{path:'src/retire.ts',headSha:head,content:'function retire() { retire(); }'}]};let packet:any;
  await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);packet=q;return {rankings:[],readPaths:[]};});
  expect(packet.artifacts.filter((a:any)=>a.path==='src/pending.ts').every((a:any)=>JSON.stringify(a.goalIds)==='["goal_1"]')).toBe(true);expect(packet.artifacts.filter((a:any)=>a.path==='src/retire.ts').every((a:any)=>JSON.stringify(a.goalIds)==='["goal_2"]')).toBe(true);
 });
 it('maps a previous ID to a merged containing snapshot and retains omitted siblings',async()=>{
  const i=input();i.changedFiles=[{path:'src/pending.ts',patch:'@@ -2 +2 @@\n+ pending();'},{path:'src/other.ts',patch:'@@ -1 +1 @@\n+pending();'}];let old='';let second:any;let round=0;
  const r=await run(i,async(q:any)=>{if(q.stage==='intent')return {...goals(q),goals:goals(q).goals.slice(0,1)};if(++round===1){old=q.artifacts.find((a:any)=>a.path==='src/pending.ts').id;return {rankings:[{goalId:'goal_1',firstInspection:old,candidates:q.artifacts.map((a:any)=>edge(a.id)),uncertainty:[]}],readPaths:['src/pending.ts']};}second=q;return {rankings:[{goalId:'goal_1',firstInspection:old,candidates:[edge(old)],uncertainty:[]}],readPaths:[]};},{readArtifacts:async()=>[{path:'src/pending.ts',headSha:head,content:'function pending() {\n pending();\n}'}]});
  const merged=second.artifacts.filter((a:any)=>a.path==='src/pending.ts');expect(merged).toHaveLength(1);expect(merged[0]).toMatchObject({startLine:1,endLine:3});const g=r.reviewCandidates.navigation.goals[0];expect(g.firstInspection).toBe(merged[0].id);expect(g.candidates).toHaveLength(2);expect(intent.validReviewNavigation(r.reviewCandidates.navigation)).toBe(true);
 });
 it('preserves safe source wording and normalizes formatting with internal diagnostics only',async()=>{
  const i=input();const r=await run(i,async(q:any)=>{if(q.stage==='intent'){const v=goals(q);v.goals[0].summary=i.taskText.split('\n\n')[0];return v;}const v=ranks(q);v.rankings[0].candidates[0].whyInspect='Inspect pending work.\nConfirm retention.';return v;});
  const n=r.reviewCandidates.navigation;expect(n.goals[0].summary).toBe(i.taskText.split('\n\n')[0]);expect(n.goals[0].candidates[0].whyInspect).toBe('Inspect pending work. Confirm retention.');expect(n.failures.some((f:any)=>f.reason==='unsafe_summary')).toBe(true);
 });
 it('masks credentials while omitting code-bearing fields and retaining safe sibling explanations',async()=>{
  const secret='ghp_'+'z'.repeat(36);const r=await run(input(),async(q:any)=>{if(q.stage==='intent')return goals(q);const v=ranks(q);v.rankings[0].candidates[0].whyInspect=`Inspect pending work. ${secret}`;v.rankings[0].candidates[0].reviewQuestion='Check return queue.pending; for retention.';return v;});const n=r.reviewCandidates.navigation;
  expect(n.goals[0].candidates[0].whyInspect).toContain('Inspect pending work.');expect(n.goals[0].candidates[0].reviewQuestion).toBe('');expect(n.goals[0].candidates[0].uncertainty).toBe('Runtime behavior was not exercised');expect(n.goals[0].firstInspection).toBe(n.goals[0].candidates[0].artifactId);expect(n.limitations).toContain('unsafe_summary_omitted');expect(JSON.stringify(n)).not.toContain(secret);expect(JSON.stringify(n)).not.toContain('return queue.pending;');
 });
 it('retains valid sibling goals and candidates when source and first IDs are invalid',async()=>{
  const r=await run(input(),async(q:any)=>{if(q.stage==='intent'){const v=goals(q);v.goals[1].sourceRefs=['invented'];return v;}const v=ranks(q);v.rankings[0].firstInspection='invented';v.rankings[0].candidates.push(edge('invented'));return v;});const n=r.reviewCandidates.navigation;
  expect(n.goals).toHaveLength(1);expect(n.goals[0].candidates).toHaveLength(1);expect(n.goals[0].firstInspection).toBeNull();expect(JSON.stringify(n)).not.toContain('invented');expect(intent.validReviewNavigation(n)).toBe(true);
 });
 it('keeps closed failure and retrieval codes off reviewer surfaces',async()=>{
  let round=0;const r=await run(input(),async(q:any)=>{if(q.stage==='intent')return goals(q);if(++round===1)return {...ranks(q),readPaths:['src/neighbor.ts']};throw Error('private');},refinementRead);const n=r.reviewCandidates.navigation;expect(n.failures).not.toEqual([]);
  for(const surface of [JSON.stringify(buildPrEvidenceReview(r)),reportToMarkdown(r)]){expect(surface).not.toContain('Refinement failed');expect(surface).not.toContain('semantic_unavailable');expect(surface).not.toContain('retrieval_');expect(surface).not.toContain('partial');}
 });
});

it('keeps a full shared incumbent budget valid when new context cannot fit',async()=>{
 const i=input();i.changedFiles=Array.from({length:16},(_,n)=>({path:`src/pending${n}.ts`,patch:`@@ -1 +1 @@\n+pending(${n});`}));let rounds=0;let original:string[]=[];
 const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);rounds++;original=q.artifacts.map((a:any)=>a.id);return {rankings:q.goals.map((g:any,n:number)=>({goalId:g.id,firstInspection:original[n*8],candidates:original.slice(n*8,n*8+8).map(id=>({artifactId:id,relevance:'relevant',whyInspect:'Inspect behavior',reviewQuestion:'Check behavior?',uncertainty:''})),uncertainty:[]})),readPaths:['src/new.ts']};},{readArtifacts:async()=>[{path:'src/new.ts',headSha:head,content:'function pending() { return 0; }'}]});
 expect(rounds).toBe(1);expect(r.reviewCandidates.navigation.goals.flatMap((g:any)=>g.candidates.map((c:any)=>c.artifactId))).toEqual(original);expect(r.reviewCandidates.navigation.limitations).toContain('retrieval_budget_exceeded');expect(intent.validReviewNavigation(r.reviewCandidates.navigation)).toBe(true);
});
it.each([true,false])('merges cross-round partial overlaps only when shared lines agree: %s',async(agree)=>{
 const i=input();i.changedFiles=[{path:'src/overlap.rs',patch:'@@ -1,4 +1,4 @@\n line_one\n line_two\n line_three\n pending();'}];let rounds=0;let packet:any;
 const r=await run(i,async(q:any)=>{if(q.stage==='intent')return {...goals(q),goals:goals(q).goals.slice(0,1)};rounds++;if(rounds===2)packet=q;return {...ranks(q),readPaths:['src/overlap.rs']};},{readArtifacts:async()=>[{path:'src/overlap.rs',headSha:head,content:`line_one\nline_two\nline_three\n${agree?'pending();':'conflict();'}\nline_five\nline_six\npending();\nline_eight\nline_nine\nline_ten\nline_eleven\nline_twelve`}]});
 expect(rounds).toBe(2);expect(packet.artifacts).toHaveLength(agree?1:2);expect(intent.validReviewNavigation(r.reviewCandidates.navigation)).toBe(true);
});
it('does not let a larger canonical range displace required comparison evidence at the byte budget',async()=>{
 const i=input();const content=(n:number)=>`pending('${'x'.repeat(6200)}${n}');`;i.changedFiles=Array.from({length:7},(_,n)=>({path:`src/pending${n}.ts`,patch:`@@ -2 +2 @@\n+${content(n)}`}));let rounds=0;let ids:string[]=[];let second:any;
 const r=await run(i,async(q:any)=>{if(q.stage==='intent')return {...goals(q),goals:goals(q).goals.slice(0,1)};if(++rounds===1){ids=q.artifacts.map((a:any)=>a.id);return {rankings:[{goalId:'goal_1',firstInspection:ids[0],candidates:ids.map(id=>({...ranks(q).rankings[0].candidates[0],artifactId:id})),uncertainty:[]}],readPaths:['src/pending0.ts']};}second=q;return {rankings:[],readPaths:[]};},{readArtifacts:async()=>[{path:'src/pending0.ts',headSha:head,content:`function pending() {\n${content(0)}\nconst extra = '${'y'.repeat(1700)}';\n}`}]});
 if(second){const represented=second.artifacts.map((a:any)=>a.path);expect(represented).toEqual(expect.arrayContaining(ids.map(id=>r.reviewCandidates.navigation.artifacts.find((a:any)=>a.id===id).path)));expect(Buffer.byteLength(JSON.stringify(second.artifacts))).toBeLessThanOrEqual(48000);}expect(r.reviewCandidates.navigation.goals[0].candidates).toHaveLength(ids.length);
});
it('normalizes bounded text and retains safe siblings beside malformed optional fields',async()=>{
 const r=await run(input(),async(q:any)=>{if(q.stage==='intent'){const v:any=goals(q);v.goals[0].openQuestions=[42,'Safe question?'];return v;}const v:any=ranks(q);v.rankings[0].uncertainty=[null,'Execution is unmeasured'];v.rankings[0].candidates[0].whyInspect='Inspect behavior. '.repeat(50);return v;});const n=r.reviewCandidates.navigation;
 expect(n.goals[0].openQuestions).toEqual(['Safe question?']);expect(n.goals[0].uncertainty).toEqual(['Execution is unmeasured']);expect(n.goals[0].candidates[0].whyInspect.length).toBeLessThanOrEqual(600);expect(n.goals[0].candidates[0].whyInspect).toContain('Inspect behavior.');expect(intent.validReviewNavigation(n)).toBe(true);
});
it('does not retain copied source code after whitespace normalization',async()=>{
 const i=input();i.changedFiles[0].patch='@@ -1 +1 @@\n+return  queue.pending;';const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);const v=ranks(q);v.rankings[0].candidates[0].whyInspect='Check return  queue.pending; for retention.';return v;});
 const g=r.reviewCandidates.navigation.goals[0];expect(g.candidates[0]).toMatchObject({whyInspect:'',reviewQuestion:'Does reconnect retain pending entries?',uncertainty:'Runtime behavior was not exercised'});expect(g.firstInspection).toBe(g.candidates[0].artifactId);expect(r.reviewCandidates.navigation.limitations).toContain('unsafe_summary_omitted');expect(JSON.stringify(r.reviewCandidates.navigation)).not.toContain('return queue.pending;');
});
it('accepts shared supplied evidence across goal hints but rejects unsupplied IDs',async()=>{
 const i=input();i.changedFiles.push({path:'src/retire.ts',patch:'@@ -1 +1 @@\n+retire();'});const events:any[]=[];
 const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);const artifact=q.artifacts.find((a:any)=>a.path==='src/queue.ts');expect(artifact.goalIds).toEqual(['goal_1']);const v=ranks(q);v.rankings[1]={...v.rankings[1],firstInspection:artifact.id,candidates:[{...v.rankings[0].candidates[0],artifactId:artifact.id},{...v.rankings[0].candidates[0],artifactId:'UNSUPPLIED_RAW_TOKEN'}]};return v;},{onDiagnostics:(event:any)=>events.push(event)});
 const n=r.reviewCandidates.navigation;expect(n.goals[1].firstInspection).toBe(n.goals[0].firstInspection);expect(n.goals[1].candidates).toHaveLength(1);
 expect(events.some(e=>e.decisions?.some((d:any)=>d.reason==='unknown_artifact_ref'))).toBe(true);expect(JSON.stringify(events)).not.toContain('UNSUPPLIED_RAW_TOKEN');expect(JSON.stringify(events)).not.toContain('return queue.pending');
 const packet=events.find(e=>e.stage==='ranking');expect(packet.artifacts[0]).toMatchObject({hash:expect.stringMatching(/^[a-f0-9]{64}$/),revision:head});expect(packet.requestHash).toMatch(/^[a-f0-9]{64}$/);expect(packet.artifactBytes).toBeGreaterThan(0);
});
it('keeps context allocation when eight source concerns are facets of one goal',async()=>{
 const files=Array.from({length:8},(_,n)=>({path:`src/concern${n}.ts`,headSha:head,content:`function concern${n}() { return concern${n}; }`}));const i=input();i.taskText=Array.from({length:8},(_,n)=>`Inspect concern${n} behavior.`).join('\n\n');i.changedFiles=[];i.verificationCriterionEvidenceV2={artifactBlobs:files};
 const packets:any[]=[];
 for(const grouped of [true,false])await run(i,async(q:any)=>{if(q.stage==='intent'){const spans=q.sources[0].spans;const units=spans.map((s:any,n:number)=>({summary:`Inspect concern${n}`,emphasis:'primary',sourceRefs:[s.id],facets:[],openQuestions:[]}));return {goals:grouped?[{...units[0],facets:units.slice(1).map((u:any)=>({kind:'condition',summary:u.summary,sourceRefs:u.sourceRefs}))}]:units,unprocessed:[]};}packets.push(q.artifacts);return {rankings:[],readPaths:[]};});
 expect(packets[0]).toHaveLength(8);expect(packets[0].map((a:any)=>a.hash)).toEqual(packets[1].map((a:any)=>a.hash));
});
it('keeps diagnostics transient, text-free, inspectable and independent of a failing sink',async()=>{
 const i=input();const packets:any[]=[];const r=await run(i,async(q:any)=>{packets.push(structuredClone(q));return q.stage==='intent'?goals(q):ranks(q);},{onDiagnostics:()=>{throw Error('sink failure');}});const n=r.reviewCandidates.navigation;
 const events=intent.getReviewNavigationDiagnostics(n);expect(events).toHaveLength(2);expect(events[1].requestHash).toBe(createHash('sha256').update(JSON.stringify(packets[1])).digest('hex'));expect(events[1].artifacts.map(a=>a.id)).toEqual(packets[1].artifacts.map((a:any)=>a.id));expect(events[1].artifactBytes).toBe(Buffer.byteLength(JSON.stringify(packets[1].artifacts)));expect(events[1].artifacts[0].hash).toBe(createHash('sha256').update(packets[1].artifacts[0].content).digest('hex'));expect(n.goals[0].firstInspection).not.toBeNull();expect(JSON.stringify(events)).not.toContain(i.taskText);expect(JSON.stringify(n)).not.toContain('requestHash');
});
it('rejects an internal alias that was never actually supplied to the model',async()=>{
 const i=input();const body='function pending() {\n pending();\n}';i.changedFiles=[{path:'src/pending.ts',patch:'@@ -2 +2 @@\n+ pending();'}];i.verificationCriterionEvidenceV2={artifactBlobs:[{path:'src/pending.ts',headSha:head,content:body}]};const hash=createHash('sha256').update(' pending();').digest('hex');const hidden='read_'+createHash('sha256').update(JSON.stringify(['src/pending.ts',head,2,2,hash])).digest('hex').slice(0,24);
 const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);expect(q.artifacts.some((a:any)=>a.id===hidden)).toBe(false);const v=ranks(q);v.rankings[0].firstInspection=hidden;v.rankings[0].candidates[0].artifactId=hidden;return v;});expect(r.reviewCandidates.navigation.goals[0].firstInspection).toBeNull();expect(r.reviewCandidates.navigation.failures.some((f:any)=>f.reason==='unknown_artifact_ref')).toBe(true);
});

describe('navigation collection and terminal diagnostics',()=>{
 it.each(['src/buffer.py','lib/delivery.py'])('automatically supplements a truncated summary before ranking: %s',async(path)=>{
  const i=input();const content=['def pending(value):',...Array.from({length:20},(_,n)=>`    item${n} = ${n}`),'    return value'].join('\n');
  i.changedFiles=[{path,status:'modified',patch:'@@ -1,22 +1,22 @@\n def pending(value):\n    cut_off\n...[truncated for privacy and token control]'}];let reads=0;let packet:any;
  const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);packet=q;return ranks(q);},{readArtifacts:async(paths:string[],sha:string)=>{reads++;expect(paths).toEqual([path]);expect(sha).toBe(head);return [{path,headSha:head,content}];}});
  expect(reads).toBe(1);expect(packet.artifacts.some((a:any)=>a.origin==='snapshot'&&a.content.includes('return value'))).toBe(true);expect(JSON.stringify(packet)).not.toContain('cut_off');
  const events:any[]=intent.getReviewNavigationDiagnostics(r.reviewCandidates.navigation);expect(events.at(-1).lifecycle).toEqual(expect.arrayContaining([expect.objectContaining({kind:'read',trigger:'automatic',outcome:'supplied'})]));
 });
 it('stops before the model when GitHub access is denied without claiming a changed snapshot',async()=>{
  const i=input();let calls=0;const emitted:any[]=[];
  const r=await run(i,async()=>{calls++;},{readCurrentInput:async()=>{throw Object.assign(Error('DO_NOT_STORE'),{code:'github_permission_denied'});},onDiagnostics:(d:any)=>emitted.push(d)});
  expect(calls).toBe(0);expect(r.reviewCandidates.navigation.limitations).toContain('freshness_access_changed');expect(r.reviewCandidates.navigation.limitations).not.toContain('stale_snapshot');expect(emitted).toHaveLength(1);
  expect(emitted[0]).toMatchObject({stage:'preflight',providerCalled:false,lifecycle:expect.arrayContaining([expect.objectContaining({kind:'freshness',phase:'initial',outcome:'access_changed',code:'github_permission_denied'})])});expect(JSON.stringify(emitted)).not.toContain('DO_NOT_STORE');
 });
 it('distinguishes a known revision change thrown by the collector',async()=>{
  const {GitHubPullRequestHeadChangedError}=await import('./github');const i=input();
  const r=await run(i,async()=>{throw Error('must not call');},{readCurrentInput:async()=>{throw new GitHubPullRequestHeadChangedError(head,'d'.repeat(40),'initial','base');}});
  expect(r.reviewCandidates.navigation.limitations).toContain('stale_snapshot');expect((intent.getReviewNavigationDiagnostics(r.reviewCandidates.navigation)[0] as any).lifecycle).toEqual(expect.arrayContaining([expect.objectContaining({kind:'freshness',outcome:'snapshot_changed'})]));
 });
 it('reports missing and invalid automatic reads and respects a shared eight-file read bound',async()=>{
  const i=input();i.changedFiles=Array.from({length:10},(_,n)=>({path:`src/unit${n}.py`,status:'modified'}));let requested:string[]=[];
  const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):{rankings:[],readPaths:['src/extra.py']},{readArtifacts:async(paths:string[])=>{requested.push(...paths);return [{path:paths[0],headSha:'d'.repeat(40),content:'private wrong revision'}];}});
  expect(requested).toHaveLength(8);expect(r.reviewCandidates.navigation.limitations).toContain('requested_path_unread');expect(JSON.stringify(r)).not.toContain('private wrong revision');expect(r.reviewCandidates.navigation.limitations).toContain('retrieval_file_budget_exceeded');
 });
});
it('preserves independent test anchors through signed storage without duplicate IDs',async()=>{
 const i=input();i.changedFiles=[{path:'tests/test_transport.py',status:'modified',patch:'@@ -4 +4 @@\n+assert pending_small()\n@@ -64 +64 @@\n+assert pending_large()'}];
 const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):{rankings:q.goals.map((g:any)=>({goalId:g.id,firstInspection:q.artifacts[1].id,candidates:[...q.artifacts,q.artifacts[1]].map((a:any)=>({artifactId:a.id,relevance:'possible',whyInspect:'Inspect the independent assertion',reviewQuestion:'Is pending work retained?',uncertainty:''})),uncertainty:[]})),readPaths:[]});
 expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:r}).valid).toBe(true);
 const saved=projectTenantPersistedReport(prepareTenantDetailReportForStorage(r,'verified_agentproof','test-key'),'test-key');const decoded=decodeTenantPersistedReport(saved,{signingSecret:'test-key',createdAt:r.createdAt});expect(decoded.status).toBe('valid');
 if(decoded.status!=='valid')throw Error('invalid storage');const view=buildPrEvidenceReview(decoded.report);const testAnchors=[view.objectives[0].firstInspection,...view.objectives[0].tests].filter((item):item is NonNullable<typeof item>=>item?.kind==='test');expect(testAnchors.map(item=>item.line)).toEqual([64,4]);expect(new Set(testAnchors.map(item=>item.evidenceId)).size).toBe(2);
});
it.each(['github_permission_denied','github_fetch_failed'])('keeps final authorization closed and diagnoses %s',async(code)=>{
 const i=input();let calls=0;const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):ranks(q),{readCurrentInput:async()=>{if(++calls===1)return i;throw Object.assign(Error('sensitive message'),{code});}});
 expect(r.reviewCandidates.navigation.goals[0].firstInspection).toBeNull();expect(r.reviewCandidates.navigation.limitations).not.toContain('stale_snapshot');
 expect((intent.getReviewNavigationDiagnostics(r.reviewCandidates.navigation).at(-1) as any).lifecycle).toEqual(expect.arrayContaining([expect.objectContaining({kind:'freshness',phase:'final',outcome:code==='github_permission_denied'?'access_changed':'collection_failed',code})]));
});
it('uses the real summary compaction marker to recover exact code without raising the summary bound',async()=>{
 const {compactText}=await import('./redact');const i=input();const content=['def pending(record):',...Array.from({length:25},(_,n)=>`    item${n} = "${'x'.repeat(45)}"`),'    return record'].join('\n');const patch='@@ -1,27 +1,27 @@\n'+content.split('\n').map(l=>' '+l).join('\n');
 i.changedFiles=[{path:'lib/archive.py',status:'modified',patch:compactText(patch,1000)}];expect(i.changedFiles[0].patch!.length).toBeLessThan(1000);let packet:any;
 const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);packet=q;return ranks(q);},{readArtifacts:async()=>[{path:'lib/archive.py',headSha:head,content}]});
 expect(packet.artifacts.some((a:any)=>a.content===content)).toBe(true);expect(r.reviewCandidates.navigation.limitations).toContain('diff_context_incomplete');
});
it('does not read deleted base files at head or private automatic context',async()=>{
 const i=input();i.changedFiles=[{path:'lib/retired.py',status:'removed'}];let calls=0;
 for(const repositoryPrivate of [false,true])await run({...i,repositoryPrivate},async(q:any)=>q.stage==='intent'?goals(q):ranks(q),{readArtifacts:async()=>{calls++;return [];}});
 expect(calls).toBe(0);
});
it('deduplicates canonical ranges after refinement while retaining the earlier first choice on failure',async()=>{
 const i=input();const content='function pending() {\n pending_small();\n pending_large();\n}';i.changedFiles=[{path:'src/delivery.ts',patch:'@@ -2 +2 @@\n+ pending_small();\n@@ -3 +3 @@\n+ pending_large();'}];let rounds=0;
 const r=await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);if(++rounds>1)throw Error('unavailable');return {rankings:q.goals.map((g:any)=>({goalId:g.id,firstInspection:q.artifacts[1].id,candidates:q.artifacts.map((a:any)=>({artifactId:a.id,relevance:'possible',whyInspect:'Inspect work',reviewQuestion:'Retained?',uncertainty:''})),uncertainty:[]})),readPaths:['src/delivery.ts']};},{readArtifacts:async()=>[{path:'src/delivery.ts',headSha:head,content}]});
 expect(r.reviewCandidates.navigation.goals[0].candidates).toHaveLength(1);expect(intent.validReviewNavigation(r.reviewCandidates.navigation)).toBe(true);expect(r.reviewCandidates.navigation.goals[0].firstInspection).not.toBeNull();
});
it('expands a clipped changed declaration even when the goal uses different vocabulary',async()=>{
 const i=input();i.changedFiles=[{path:'lib/warehouse.py',status:'modified',patch:'@@ -1,20 +1,20 @@\n def calculate(x):\n     y =\n...[truncated for privacy and token control]'}];const content=['def calculate(x):',...Array.from({length:25},(_,n)=>`    x${n} = ${n}`),'    return x'].join('\n');let supplied=false;
 await run(i,async(q:any)=>{if(q.stage==='intent')return goals(q);supplied=q.artifacts.some((a:any)=>a.content===content);return ranks(q);},{readArtifacts:async()=>[{path:'lib/warehouse.py',headSha:head,content}]});expect(supplied).toBe(true);
});
it('does not call unchanged missing revision metadata a changed snapshot',async()=>{
 const i=input();i.sourceProvenance=undefined;
 const r=await run(i,async(q:any)=>q.stage==='intent'?goals(q):ranks(q),{readCurrentInput:async()=>i});
 expect(r.reviewCandidates.navigation.limitations).toContain('exact_snapshot_unavailable');expect(r.reviewCandidates.navigation.limitations).not.toContain('stale_snapshot');
});

it.each(['condition','exception','motivation','implementation_claim'])('preserves source-linked %s metadata when its unsafe summary is omitted across consumers',async(kind)=>{
 const i=input();i.taskText='Retain queued work when reconnecting.\n\nOnly when capacity is available.\n\nExclude suspended deliveries.';
 let rankedFacets:any[]=[];
 const r=await run(i,async(q:any)=>{
  if(q.stage==='intent')return {goals:[{summary:'Retain eligible deliveries',emphasis:'primary',sourceRefs:[q.sources[0].spans[0].id],facets:[{kind,summary:'return queue.pending;',sourceRefs:[q.sources[0].spans[1].id]},{kind:'exception',summary:'Exclude suspended deliveries',sourceRefs:[q.sources[0].spans[2].id]}],openQuestions:['Is capacity enforced?']}],unprocessed:[]};
  rankedFacets=q.goals[0].facets;return ranks(q);
 });
 const n=r.reviewCandidates.navigation,g=n.goals[0];
 expect(g.facets).toHaveLength(2);expect(g.facets[0]).toMatchObject({kind,summary:'Summary omitted; inspect the referenced source.',sourceRefs:[{sourceId:'task',start:i.taskText.indexOf('Only when'),end:i.taskText.indexOf('\n\nExclude'),hash:createHash('sha256').update('Only when capacity is available.').digest('hex')}]});
 expect(rankedFacets).toEqual(g.facets);expect(g.facets[1].summary).toBe('Exclude suspended deliveries');expect(g.openQuestions).toEqual(['Is capacity enforced?']);expect(g.firstInspection).not.toBeNull();
 expect(n.unprocessed).not.toContain(`task:${i.taskText.indexOf('Only when')}`);expect(validateRuntimeReportBoundary({boundary:'generated_private_full',input:i,report:r}).valid).toBe(true);
 const saved=projectTenantPersistedReport(prepareTenantDetailReportForStorage(r,'verified_agentproof','test-key'),'test-key');const decoded=decodeTenantPersistedReport(saved,{signingSecret:'test-key',createdAt:r.createdAt});expect(decoded.status).toBe('valid');if(decoded.status!=='valid')throw Error('decode failed');
 expect((decoded.report as any).reviewCandidates.navigation.goals[0]).toEqual(g);
 for(const surface of [reportToMarkdown(decoded.report),renderToStaticMarkup(createElement(PrEvidenceReview,{review:buildDashboardPrEvidenceReview({report:decoded.report,repositoryFullName:'acme/queue',headSha:head})!}))]){
  expect(surface).toContain('Summary omitted; inspect the referenced source.');expect(surface).toContain(`task ${i.taskText.indexOf('Only when')}`);expect(surface).toContain('Exclude suspended deliveries');expect(surface).toContain('Is capacity enforced?');expect(surface).toContain('Does reconnect retain pending entries?');expect(surface).not.toContain('return queue.pending;');
 }
 expect(JSON.stringify(saved)).not.toContain('return queue.pending;');expect(JSON.stringify(sanitizeReportForShare(r))).not.toContain('Retain eligible deliveries');
 const malformed=structuredClone(n);malformed.goals[0].facets[0].sourceRefs=[];expect(intent.validReviewNavigation(malformed)).toBe(false);
});
it.each(['base','head'])('keeps the exact %s recommendation and safe descriptions across storage when whyInspect is omitted',async(side)=>{
 const i=input();const r=await run(i,async(q:any)=>{
  if(q.stage==='intent')return goals(q);
  const a=q.artifacts.find((x:any)=>x.side===side),v=ranks({...q,artifacts:[a]});v.rankings[0].candidates[0].whyInspect='return queue.pending;';return v;
 });
 const n=r.reviewCandidates.navigation,g=n.goals[0],a=n.artifacts.find((x:any)=>x.id===g.firstInspection);expect(a).toMatchObject({side,revision:side==='base'?base:head,startLine:1});
 expect(g.candidates[0]).toMatchObject({whyInspect:'',reviewQuestion:'Does reconnect retain pending entries?',uncertainty:'Runtime behavior was not exercised'});
 const saved=projectTenantPersistedReport(prepareTenantDetailReportForStorage(r,'verified_agentproof','test-key'),'test-key');const decoded=decodeTenantPersistedReport(saved,{signingSecret:'test-key',createdAt:r.createdAt});expect(decoded.status).toBe('valid');if(decoded.status!=='valid')throw Error('decode failed');
 const review=buildPrEvidenceReview(decoded.report),first=review.objectives[0].firstInspection!;expect(first.evidenceId).toBe(g.firstInspection);expect(first.url).toBe(`https://github.com/acme/queue/blob/${side==='base'?base:head}/src/queue.ts#L1`);
 const html=renderToStaticMarkup(createElement(PrEvidenceReview,{review:{...review,changes:[]}}));expect(html).toContain('Open referenced lines');expect(html).not.toContain('Open first changed line');
 for(const surface of [html,reportToMarkdown(decoded.report)]){expect(surface).toContain('Does reconnect retain pending entries?');expect(surface).toContain('Runtime behavior was not exercised');expect(surface).not.toContain('return queue.pending;');}
});

it('distinguishes a completed no-goal interpretation from provider failure while retaining source and exact changes',async()=>{
 const i=input();
 for(const failed of [false,true]){
  const r=await run(i,async()=>{if(failed)throw new Error('provider unavailable');return {goals:[],unprocessed:[]};});
  const view=buildPrEvidenceReview(r);
  expect(view.mode).toBe('change_summary');
  expect(view.sourceLinks?.length).toBeGreaterThan(0);
  expect(view.changes.some(item=>item.url?.includes(`/blob/${head}/`))).toBe(true);
  expect(view.nextInspection).toContain(failed?'Goal interpretation unavailable':'No review goal was identified');
 }
});

it('preserves the selected exact line link in both Markdown exports after deduplication',async()=>{
 const {reportToMarkdown}=await import('./markdown');const {dashboardReportToMarkdown}=await import('./dashboard-report-export');
 const r=await run(input(),async(q:any)=>q.stage==='intent'?goals(q):ranks(q));
 const first=buildPrEvidenceReview(r).objectives[0].firstInspection!;
 for(const markdown of [reportToMarkdown(r),dashboardReportToMarkdown({report:r,repositoryFullName:'acme/queue',headSha:head,freshness:'current',copyEligible:true})]){
  const firstSection=markdown.split('**Inspect first**')[1]!.split('Next to inspect:')[0]!;
  expect(firstSection).toContain(first.url);
  expect(firstSection).toContain(first.whyInspect);
  expect(firstSection).toContain(first.reviewQuestion);
 }
});
