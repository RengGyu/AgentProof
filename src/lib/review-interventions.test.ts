import { expect, it, vi } from 'vitest';
import { extractReviewSnippets } from './review-snippets';
import { enrichReviewNavigation, type ReviewNavigationRequest } from './review-intent';
import { generateVerificationReportV2FromInput } from './verifier';
import { reviewNavigationSystemInstruction } from './openai-semantic';
import type { PullRequestInput } from './types';
const head='a'.repeat(40),base='b'.repeat(40);
const input=(patch=''):PullRequestInput=>({title:'Bounded navigation',url:'https://github.com/example/repo/pull/1',repositoryPrivate:false,taskSource:'task',taskText:'Inspect main condition and exception.',description:'',changedFiles:[{path:'src/work.ts',status:'modified',patch}],checks:[],logs:[],sourceProvenance:{version:1,origin:'github_snapshot',headSha:head,baseSha:base,evidenceCapturedAt:'2026-10-04T00:00:00Z',inputFingerprint:{version:1,algorithm:'sha256',value:'c'.repeat(64),coverage:'github_metadata'}}});
const intent=(q:ReviewNavigationRequest)=>({goals:[{summary:'Inspect main condition',emphasis:'primary',sourceRefs:[q.sources[0].spans[0].id],facets:[],openQuestions:[]}],unprocessed:[]});
const rank=(q:ReviewNavigationRequest,question='Inspect main condition')=>({rankings:q.goals.map(g=>({goalId:g.id,firstInspection:q.artifacts[0]?.id??null,candidates:q.artifacts[0]?[{artifactId:q.artifacts[0].id,relevance:'possible',whyInspect:'Inspect supplied logic',reviewQuestion:question,uncertainty:'Not executed'}]:[],uncertainty:[]})),readPaths:[]});
it('ignores retired hunk hints instead of adding coordinate-only source to the packet',async()=>{
 const i=input('@@ -1,1 +1,1 @@\n+// summary\n...[truncated for privacy and token control]');
 Object.defineProperty(i.changedFiles[0],'patchCoordinates',{value:{version:1,truncated:false,hunks:[{headStart:201,headLines:3,complete:true}]}});
 const content=[...Array(200).fill('// padding'),'function opaque() {',' return opaqueValue;','}'].join('\n');let packet:ReviewNavigationRequest|undefined;
 await enrichReviewNavigation(i,generateVerificationReportV2FromInput(i),{model:'fixture',provider:async q=>{if(q.stage==='intent')return intent(q);packet=q;return rank(q);},readArtifacts:async paths=>paths.map(path=>({path,headSha:head,content}))});
 expect(packet).toBeDefined();expect(packet!.artifacts.some(a=>a.content.includes('opaqueValue'))).toBe(false);
});
it('does not rerank a previously read path using model-generated refinement terms',async()=>{
 const i=input(),content=['function main() {',' return mainValue;','}',...Array(117).fill('// padding'),'function isolate() {',' return quarantineToken;','}'].join('\n');
 let reads=0;const packets:ReviewNavigationRequest[]=[];
 await enrichReviewNavigation(i,generateVerificationReportV2FromInput(i),{model:'fixture',readArtifacts:async paths=>{reads++;return paths.map(path=>({path,headSha:head,content}));},provider:async q=>{if(q.stage==='intent')return intent(q);packets.push(q);return {...rank(q,'Does quarantineToken isolate work?'),readPaths:['src/work.ts']};}});
 expect(reads).toBe(1);expect(packets).toHaveLength(1);expect(packets[0].artifacts.some(a=>a.content.includes('quarantineToken'))).toBe(false);
});
it('uses existing goal reservations without an extra facet-priority policy',async()=>{
 const content=[...Array.from({length:20},(_,n)=>`function repeated${n}() {\n const pendingReconnectRetain = mainValue;\n${Array(72).fill(' const padding = 0;').join('\n')}\n return mainValue;\n}\n`),'function exception() {',' return deniedValue;','}'].join('\n');
 const goal={id:'goal_1',terms:['main','pending','reconnect','retain','denied'],anchors:[]};
 const files=[{path:'src/work.ts',headSha:head,content}];
 const normal=await extractReviewSnippets(files,[goal]);const withRetiredField=await extractReviewSnippets(files,[{...goal,conditions:[{id:'main',terms:['main','pending','reconnect','retain']},{id:'exception',terms:['denied']}]} as typeof goal]);
 expect(withRetiredField).toEqual(normal);
});
it('keeps bounded parser/fallback selection without injecting branch-prefix candidates',async()=>{
 const content=['function work() {',' if (guardFlag) {',...Array(19).fill('  const unused = 0;'),'  return criticalValue;',...Array(100).fill('  const unused = 0;'),' }','}'].join('\n');
 const r=await extractReviewSnippets([{path:'src/work.ts',headSha:head,content}],[{id:'goal_1',terms:['critical'],anchors:[]}]);
 expect(r.snippets.some(s=>s.content.includes('return criticalValue'))).toBe(true);
 expect(r.snippets.some(s=>s.content.includes('if (guardFlag)')&&s.content.includes('return criticalValue'))).toBe(false);
 expect(r.snippets.every(s=>s.endLine-s.startLine<80&&Buffer.byteLength(s.content)<=8000)).toBe(true);
 expect(r.limitations).not.toContain('retrieval_branch_prefix');
});
it('keeps the original navigation instructions and their source/schema/privacy boundaries',()=>{
 for(const stage of ['intent','ranking'] as const){const prompt=reviewNavigationSystemInstruction(stage);expect(prompt).not.toContain('1–2 sentences');expect(prompt).toContain('untrusted');expect(prompt).toContain('600');expect(prompt).toContain('JSON');}
 expect(reviewNavigationSystemInstruction('intent')).toContain('sourceRefs');expect(reviewNavigationSystemInstruction('intent')).toContain('implementation_claim');expect(reviewNavigationSystemInstruction('ranking')).toContain('unsearched');expect(reviewNavigationSystemInstruction('ranking')).toContain('uncertainty');
});
it('rechecks authorization and never accepts a rejected revision',async()=>{
 for(const wrongRevision of [false,true]){
  const i=input();i.repositoryPrivate=true;let allowed=true,reads=0,calls=0;
  const r=await enrichReviewNavigation(i,generateVerificationReportV2FromInput(i),{model:'fixture',authorizePrivate:async()=>allowed,readArtifacts:async paths=>{reads++;return paths.map(path=>({path,headSha:wrongRevision?base:head,content:'function main() { return mainValue; }'}));},provider:async q=>{if(q.stage==='intent')return intent(q);calls++;allowed=false;return {...rank(q,'Does quarantineToken isolate work?'),readPaths:['src/work.ts']};}});
  expect(reads).toBe(1);expect(calls).toBe(1);expect(r.reviewCandidates?.navigation?.goals[0].firstInspection).toBeNull();
  expect(r.reviewCandidates?.navigation?.limitations).toContain('freshness_access_changed');
 }
});
