import {it, expect, vi} from 'vitest';
import {createHash} from 'node:crypto';
import {capturePurposeDiffIndex} from './purpose-github';
import {localizePurpose, localizationRequestSchema} from './purpose-localization';
import {createPurposeRepository} from './purpose-repository';
import {buildPurposeSources, compilePurposeSpec} from './purpose-spec';
import type {PullRequestInput} from './types';
const head = 'a'.repeat(40), baseRef = 'b'.repeat(40), mergeBase = 'd'.repeat(40);
function fixture(withComparison = true) {
    const input = {title:'Keep queued work',description:'Keep queued work until completion.',taskText:'',repositoryPrivate:false,url:'https://github.com/acme/work/pull/9',changedFiles:[{path:'src/work.py',status:'modified',patch:'legacy preview'}],checks:[],logs:[],sourceProvenance:{version:1,origin:'github_snapshot',headSha:head,baseSha:baseRef,evidenceCapturedAt:'2026-10-11T00:00:00Z',inputFingerprint:{version:1,algorithm:'sha256',value:'c'.repeat(64),coverage:'github_metadata'}}} as PullRequestInput;
    capturePurposeDiffIndex(input, [{filename:'src/work.py',patch:'@@ -1,2 +1,2 @@\n-old_queue()\n+keep_queue()\n complete()'}], withComparison ? {baseRefSha:baseRef,diffBaseSha:mergeBase,headSha:head} : undefined);
    const spans=buildPurposeSources(input).spans;
    const spec=compilePurposeSpec(input,{goals:[{sourceRefs:[spans[0].id],clauses:[{sourceRefs:[spans[0].id],expectedObservable:'Keep queued work',conditions:[],exceptions:[],obligation:'required',evidenceNeed:'behavioral'}]}],contextRefs:spans.slice(1).map(s=>s.id),unprocessedSourceRefs:[],ambiguities:[]});
    const content=(revision:string)=>revision===head?'keep_queue()\ncomplete()':'old_queue()\ncomplete()';
    const hash=(s:string)=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0'+s).digest('hex');
    const backend={manifest:vi.fn(async(_side:any,revision:string)=>({repository:'acme/work',revision,treeSha:'c'.repeat(40),complete:true,entries:[{path:'src/work.py',mode:'100644' as const,size:Buffer.byteLength(content(revision)),blobSha:hash(content(revision))}]})),readBlob:vi.fn(async(e:any,revision:string)=>({path:e.path,revision,blobSha:e.blobSha,content:content(revision),complete:true,bytesRead:Buffer.byteLength(content(revision))}))};
    return {input,spec,backend,clauseId:spec.goals[0].clauses[0].id};
}
const selection=(clauseId:string, refs:string[])=>({actions:[],clauses:[{clauseId,evidenceRefs:refs,counterEvidenceRefs:[]}],stopReason:'unresolved'});
it('starts from original diff without downloading all hunks, binds only selected source, and preserves merge-base identity',async()=>{
    const f=fixture(), repo=await createPurposeRepository(f.input,f.backend,{signal:new AbortController().signal});
    const seen:any[]=[];
    const result=await localizePurpose(f.input,f.spec,repo,{mode:'ai',flow:'explore_final_v1',invoke:async(q:any)=>{
        seen.push(q);const l=q.localization;
        if(l.round===0){expect(f.backend.readBlob).not.toHaveBeenCalled();expect(l.diff.hunks[0].patch).toContain('keep_queue()');expect(l.diff.citable).toBe(false);
            const h=l.diff.hunks[0],target=h.targets.find((t:any)=>t.side==='head');
            return {actions:[{targetId:target.id,startLine:1,endLine:2,clauseId:f.clauseId}],clauses:[],stopReason:'continue'};}
        return selection(f.clauseId,l.selectionSources.map((e:any)=>e.id));
    }});
    expect(result.calls).toBe(2);expect(f.backend.readBlob).toHaveBeenCalledTimes(1);
    expect(f.backend.manifest.mock.calls.map(c=>c[1])).toEqual([head,mergeBase]);
    expect(result.coverage.readQuestions).toBeUndefined();
    expect(result.coverage.diffCoverage?.comparison).toEqual({baseRefSha:baseRef,diffBaseSha:mergeBase,headSha:head});
    expect(result.coverage.collection?.changedPaths.find(p=>p.side==='base')).toMatchObject({revision:mergeBase,state:'unread'});
    expect(result.evidence).toHaveLength(1);repo.dispose();
});
it.each(['forged_target','root_search','unconfirmed_base','invalid_clause','invalid_range'])('rejects %s before source access without a correction call',async(kind)=>{
    const f=fixture(kind!=='unconfirmed_base'),repo=await createPurposeRepository(f.input,f.backend,{signal:new AbortController().signal});
    const invoke=vi.fn(async(q:any)=>{
        const l=q.localization,h=l.diff.hunks[0],target=l.initial.changed.find((t:any)=>t.side===(kind==='unconfirmed_base'?'base':'head'));
        const action:any={targetId:kind==='root_search'?'ld_root':kind==='forged_target'?'lf_forged':target.id,startLine:1,endLine:kind==='invalid_range'?0:2,clauseId:kind==='invalid_clause'?'pc_forged':f.clauseId};
        return {actions:[action],clauses:[],stopReason:'continue'};
    });
    const result=await localizePurpose(f.input,f.spec,repo,{mode:'ai',flow:'explore_final_v1',invoke});
    expect(result.limitations).toContain('localization_invalid');expect(invoke).toHaveBeenCalledTimes(1);expect(f.backend.readBlob).not.toHaveBeenCalled();repo.dispose();
});
it('slim diff-first wire requires source range and clause IDs but no model read justification',async()=>{
    const Ajv=(await import('ajv')).default,f=fixture(),validate=new Ajv().compile(localizationRequestSchema(f.spec,false,true));
    const a={targetId:'lf_target',startLine:1,endLine:2,clauseId:f.clauseId};
    expect(validate({actions:[a],clauses:[],stopReason:'continue'})).toBe(true);
    expect(validate({actions:[{...a,question:'Q',knownRefs:['ph_hunk'],reportImpact:'R'}],clauses:[],stopReason:'continue'})).toBe(false);
    for(const field of ['startLine','endLine'])expect(validate({actions:[{...a,[field]:0}],clauses:[],stopReason:'continue'})).toBe(false);
    expect(validate({actions:[{...a,clauseId:'pc_forged'}],clauses:[],stopReason:'continue'})).toBe(false);
});
it('does not silently cut selected diff source at the former 80-line window',async()=>{
    const f=fixture(),content=Array.from({length:161},(_,i)=>'line_'+i).join('\n');
    const sha=createHash('sha1').update('blob '+Buffer.byteLength(content)+'\0'+content).digest('hex');
    f.backend.manifest.mockImplementation(async(_side:any,revision:string)=>({repository:'acme/work',revision,treeSha:'c'.repeat(40),complete:true,entries:[{path:'src/work.py',mode:'100644',size:Buffer.byteLength(content),blobSha:sha}]}));
    f.backend.readBlob.mockImplementation(async(e:any,revision:string)=>({path:e.path,revision,blobSha:sha,content,complete:true,bytesRead:Buffer.byteLength(content)}));
    const repo=await createPurposeRepository(f.input,f.backend,{signal:new AbortController().signal});
    const target=repo.initial().changed.find(f=>f.side==='head')!;
    const r=await repo.execute({kind:'inspect',targetId:target.id,view:'source',startLine:1,endLine:161,cursor:0,literal:'',clauseId:f.clauseId});
    expect(r.evidence[0]).toMatchObject({startLine:1,endLine:161,content});repo.dispose();
});
it('rejects comparison anchors from another snapshot before reading manifests',async()=>{
    const f=fixture();
    capturePurposeDiffIndex(f.input,[{filename:'src/work.py',patch:'@@ -1 +1 @@\n-old\n+new'}],{baseRefSha:baseRef,diffBaseSha:mergeBase,headSha:'e'.repeat(40)});
    await expect(createPurposeRepository(f.input,f.backend,{signal:new AbortController().signal})).rejects.toThrow('localization_diff_snapshot_invalid');
    expect(f.backend.manifest).not.toHaveBeenCalled();
});

it.each([false,true])('passes bounded diff/read facts through one final assessment, staged=%s, without changing author purpose or adding a checker',async(staged)=>{
 const {assessPurpose}=await import('./purpose-assessment'),{generateVerificationReportV2FromInput}=await import('./verifier');
 const f=fixture(),seen:any[]=[];
 const provider=async(q:any)=>{seen.push(structuredClone(q));if(q.stage==='locate'){
  const l=q.localization,h=l.diff.hunks[0];
  if(l.round===0)return {actions:[{targetId:h.targets.find((t:any)=>t.side==='head').id,startLine:1,endLine:1,clauseId:f.clauseId}],clauses:[],stopReason:'continue'};
  return selection(f.clauseId,l.selectionSources.map((e:any)=>e.id));
 }
 return {clauses:[{clauseId:f.clauseId,implementation:'unknown',testRelation:'unknown',evidenceRefs:q.evidence.map((e:any)=>e.id),counterEvidenceRefs:[],changeObservations:[{basis:'source_text',text:'keep_queue()',evidenceRefs:[q.evidence[0].id]}],testObservations:[],remainingQuestions:[]}]};
 };
 const r=await assessPurpose(f.input,generateVerificationReportV2FromInput(f.input),{mode:'shadow',flow:'explore_final_v1',frozenSpec:f.spec,...(staged?{stageProviders:{purpose:async()=>{throw Error('frozen_spec_must_skip_extraction');},exploration:provider,final:provider}}:{provider}),localization:{mode:'ai',backend:f.backend}});
 expect(seen.map(q=>q.stage)).toEqual(['locate','locate','assess']);
 const final=seen.at(-1);expect(final.spec).toEqual(f.spec);
 expect(Object.keys(final.coverage)).toEqual(['omittedEvidence']);
 expect(final).not.toHaveProperty('localization');expect(final).not.toHaveProperty('executionSignals');
 const facts=(r.assessment as any).facts;
 expect(facts.coverage.diffCoverage.hunks[0].evidenceRefs).toEqual([final.evidence[0].id]);
 expect(facts.coverage.collection.changedPaths.find((p:any)=>p.side==='base').state).toBe('unread');
 expect(facts.coverage.readOutcomes[0].returned).toEqual([{startLine:1,endLine:1}]);
 expect(facts.clauses[0].remainingQuestions).toEqual([]);
});
it('limits slim reads to changed-file source and rejects old tool/justification fields',async()=>{
    for(const kind of ['root_browse','outline']){
        const f=fixture(),repo=await createPurposeRepository(f.input,f.backend,{signal:new AbortController().signal});
        const invoke=vi.fn(async(q:any)=>{const l=q.localization,h=l.diff.hunks[0],target=l.initial.changed.find((t:any)=>t.side==='head');
            return {actions:[{kind:kind==='root_browse'?'browse':'inspect',targetId:kind==='root_browse'?'ld_unissued':target.id,view:kind==='root_browse'?'none':'outline',startLine:0,endLine:0,cursor:0,literal:'',clauseId:f.clauseId,question:'Q',knownRefs:[h.id],reportImpact:'R'}],clauses:[],stopReason:'continue'};});
        const result=await localizePurpose(f.input,f.spec,repo,{mode:'ai',flow:'explore_final_v1',invoke});
        expect(result.limitations).toContain('localization_invalid');expect(result.limitations.some(r=>r==='localization_schema'||r==='localization_scope_expansion')).toBe(true);expect(f.backend.readBlob).not.toHaveBeenCalled();expect(result.evidence).toHaveLength(0);repo.dispose();
    }
    const f=fixture(),repo=await createPurposeRepository(f.input,f.backend,{signal:new AbortController().signal}),span=buildPurposeSources(f.input).spans[0].id;
    const result=await localizePurpose(f.input,f.spec,repo,{mode:'ai',flow:'explore_final_v1',invoke:async(q:any)=>{const l=q.localization;
        if(l.round===0){const target=l.initial.changed.find((t:any)=>t.side==='head');return {actions:[{targetId:target.id,startLine:1,endLine:2,clauseId:f.clauseId}],clauses:[],stopReason:'continue'};}
        return selection(f.clauseId,l.selectionSources.map((e:any)=>e.id));}});
    expect(result.limitations).not.toContain('localization_invalid');expect(result.evidence).toHaveLength(1);expect(result.evidence[0].content).toContain('keep_queue()');repo.dispose();
    const Ajv=(await import('ajv')).default,validate=new Ajv().compile(localizationRequestSchema(f.spec,false,true));
    const a={targetId:'lf_target',startLine:1,endLine:2,clauseId:f.clauseId};
    expect(validate({actions:[a],clauses:[],stopReason:'continue'})).toBe(true);
    for(const bad of [{kind:'searchText',targetId:'ld_root',view:'none'},{view:'outline'},{kind:'definition',targetId:'lo_x',view:'none'}]) expect(validate({actions:[{...a,...bad}],clauses:[],stopReason:'continue'})).toBe(false);
});


it('slim changed-source reads reuse one interval across two clauses and still read the next file',async()=>{
 const f=fixture();f.input.changedFiles.push({path:'src/finish.py',status:'modified',patch:'@@ -1 +1 @@\n-old\n+finish()'});
 capturePurposeDiffIndex(f.input,[{filename:'src/work.py',patch:'@@ -1,2 +1,2 @@\n-old_queue()\n+keep_queue()\n complete()'},{filename:'src/finish.py',patch:'@@ -1 +1 @@\n-old\n+finish()'}],{baseRefSha:baseRef,diffBaseSha:mergeBase,headSha:head});
 const sources=buildPurposeSources(f.input),ref=sources.spans[0].id;
 const spec=compilePurposeSpec(f.input,{goals:[{sourceRefs:[ref],clauses:['Keep work','Finish work'].map(expectedObservable=>({sourceRefs:[ref],expectedObservable,conditions:[],exceptions:[],obligation:'required',evidenceNeed:'behavioral'}))}],contextRefs:sources.spans.slice(1).map(s=>s.id),unprocessedSourceRefs:[],ambiguities:[]});const ids=spec.goals[0].clauses.map(c=>c.id);
 const contents:Record<string,string>={'src/work.py':'keep_queue()\ncomplete()','src/finish.py':'finish()'},hash=(s:string)=>createHash('sha1').update('blob '+Buffer.byteLength(s)+'\0'+s).digest('hex');
 const b={manifest:async(_side:any,revision:string)=>({repository:'acme/work',revision,treeSha:'c'.repeat(40),complete:true,entries:Object.entries(contents).map(([path,content])=>({path,mode:'100644' as const,size:Buffer.byteLength(content),blobSha:hash(content)}))}),readBlob:vi.fn(async(e:any,revision:string)=>({path:e.path,revision,blobSha:e.blobSha,content:contents[e.path],complete:true,bytesRead:Buffer.byteLength(contents[e.path])}))};
 const repo=await createPurposeRepository(f.input,b,{signal:new AbortController().signal}),seen:any[]=[];
 const result=await localizePurpose(f.input,spec,repo,{mode:'ai',flow:'explore_final_v1',invoke:async(q:any)=>{seen.push(structuredClone(q));const l=q.localization,target=l.initial.changed.find((x:any)=>x.side==='head'&&x.path==='src/work.py'),next=l.initial.changed.find((x:any)=>x.side==='head'&&x.path==='src/finish.py');
  return l.round===0?{actions:[{targetId:target.id,startLine:1,endLine:2,clauseId:ids[0]},{targetId:target.id,startLine:1,endLine:2,clauseId:ids[1]},{targetId:next.id,startLine:1,endLine:1,clauseId:ids[1]}],clauses:[],stopReason:'continue'}:{actions:[],clauses:ids.map(clauseId=>({clauseId,evidenceRefs:l.selectionSources.filter((e:any)=>e.clauseIds.includes(clauseId)).map((e:any)=>e.id),counterEvidenceRefs:[]})),stopReason:'selected'};}});
 expect(result.limitations).not.toContain('localization_invalid');expect(b.readBlob).toHaveBeenCalledTimes(2);expect(result.coverage.readOutcomes.map(x=>x.outcome)).toEqual(['available','available','available']);expect(result.coverage.readOutcomes[0].evidenceRefs).toEqual(result.coverage.readOutcomes[1].evidenceRefs);expect(result.evidence.find(e=>e.path==='src/work.py')?.clauseIds).toEqual(ids);expect(result.evidence.some(e=>e.path==='src/finish.py')).toBe(true);expect(result.coverage.readQuestions).toBeUndefined();expect(result.modelSearchClaims).toBeUndefined();expect(seen[0].localization.initial.roots).toBeUndefined();repo.dispose();
});
it('absent raw diff terminates with explicit limitation, no root search or source read',async()=>{
 const f=fixture();capturePurposeDiffIndex(f.input,[{filename:'src/work.py'}]);const repo=await createPurposeRepository(f.input,f.backend,{signal:new AbortController().signal}),invoke=vi.fn();
 const r=await localizePurpose(f.input,f.spec,repo,{mode:'ai',flow:'explore_final_v1',invoke});expect(r.evidence).toEqual([]);expect(r.limitations).toContain('patch_unavailable');expect(invoke).not.toHaveBeenCalled();expect(f.backend.readBlob).not.toHaveBeenCalled();repo.dispose();
});
