import {it,expect,vi} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import * as contract from './purpose-contract';
import {compilePurposeSpec,buildPurposeSources} from './purpose-spec';
import {capturePurposeDiffIndex} from './purpose-github';
import {assessPurpose} from './purpose-assessment';
import {purposeRequestSchema,purposeProviderInput} from './purpose-provider';
import {generateVerificationReportV2FromInput} from './verifier';
import {isPurposeReview,purposeVisibleClauses} from './purpose-summary';
import {formatPurposeReview} from './shared-report-copy';
import {ReportTopSummary} from '../components/ReportTopSummary';
const head='a'.repeat(40),base='b'.repeat(40);
const input:any={title:'Retain pending work',description:'Keep work pending unless cancelled. Retain it for retries. Notes describe a standalone example.',taskText:'',url:'https://github.com/example/work/pull/9',repositoryPrivate:false,changedFiles:[{path:'queue.py',status:'modified',patch:'@@ -1 +1 @@\n-discard()\n+retain()'}],checks:[],logs:[],sourceProvenance:{version:1,origin:'github_snapshot',headSha:head,baseSha:base,evidenceCapturedAt:'2026-10-25T00:00:00Z',inputFingerprint:{version:1,algorithm:'sha256',value:'c'.repeat(64),coverage:'github_metadata'}}};
capturePurposeDiffIndex(input,input.changedFiles.map((f:any)=>({filename:f.path,patch:f.patch})),{baseRefSha:base,diffBaseSha:base,headSha:head});
const source=buildPurposeSources(input),ref=source.spans[0].id;
const spec=compilePurposeSpec(input,{goals:[{sourceRefs:[ref],clauses:['Keep pending work','Retain work for retry','Standalone background'].map((expectedObservable,i)=>({sourceRefs:[ref],expectedObservable,conditions:i===0?['unless cancelled']:i===1?['when retrying']:[],exceptions:i===1?['except expired work']:[],obligation:'required',evidenceNeed:'behavioral'}))}],contextRefs:source.spans.slice(1).map(s=>s.id),unprocessedSourceRefs:[],ambiguities:[]});
const ids=spec.goals[0].clauses.map(c=>c.id);
function wire(evidence:any[],context=true):any{const id=evidence[0]?.id;return {units:[{candidateClauseIds:context?ids.slice(0,2):[ids[0]],purpose:'Retain work until completion',implementation:'supports',evidenceRefs:id?[id]:[],counterEvidenceRefs:[],changeSummary:id?{text:'Keep unfinished work',evidenceRefs:[id]}:null,scopeNotes:[],changeObservations:id?[{basis:'model_interpretation',text:'Pending work is retained for retry.',evidenceRefs:[id]}]:[],testObservations:[]}],contextClauseIds:context?[ids[2]]:ids.slice(1)};}
function backend(){return {manifest:async(_s:any,revision:string)=>{const content=revision===head?'retain()\n# pending until complete\n':'discard()\n';return {repository:'example/work',revision,treeSha:'d'.repeat(40),complete:true,entries:[{path:'queue.py',mode:'100644' as const,size:Buffer.byteLength(content),blobSha:createHash('sha1').update('blob '+Buffer.byteLength(content)+'\0'+content).digest('hex')}]};},readBlob:async(e:any,revision:string)=>{const content=revision===head?'retain()\n# pending until complete\n':'discard()\n';return {path:e.path,revision,blobSha:e.blobSha,content,complete:true,bytesRead:Buffer.byteLength(content)};}};}
async function run(edit=(v:any)=>v,locale:'en'|'ko'='ko'){
 const seen:any[]=[];const provider=vi.fn(async(q:any)=>{seen.push(q);if(q.stage==='locate'){const l=q.localization;return l.round===0?{actions:[{targetId:l.initial.changed.find((f:any)=>f.side==='head').id,startLine:1,endLine:2,clauseId:ids[0]}],clauses:[],stopReason:'continue'}:{actions:[],clauses:ids.map(clauseId=>({clauseId,evidenceRefs:l.selectionSources.map((e:any)=>e.id),counterEvidenceRefs:[]})),stopReason:'selected'};}
  return (contract.parsePurposeUnitsWire as any)(edit(wire(q.evidence)),q.finalFormat);
 });
 const result=await assessPurpose(input,generateVerificationReportV2FromInput(input),{mode:'advisory',flow:'explore_final_v1',finalFormat:'purpose_units_v1',frozenSpec:spec,provider,reportLanguage:locale,readCurrentInput:async()=>input,localization:{mode:'ai',backend:backend()}} as any);return {...result,seen};
}
it('uses explicit units schema with bounded candidate partition rather than one row per initial clause',()=>{
 const s:any=purposeRequestSchema({stage:'assess',flow:'explore_final_v1',finalFormat:'purpose_units_v1',spec,evidence:[{id:'pe_one'}]} as any);
 expect(s.properties.units.maxItems).toBe(16);expect(s.properties).not.toHaveProperty('clauses');expect(s.properties.units.items.properties.candidateClauseIds.items.enum).toEqual(ids);
 expect(()=> (contract.parsePurposeUnitsWire as any)({clauses:[]},'purpose_units_v1')).toThrow('purpose_final_wire_schema');
 expect(()=>contract.parsePurposeFinalWire({units:[],contextClauseIds:[]})).toThrow('purpose_final_wire_schema');
});
it.each(['en','ko'] as const)('groups candidates and excludes background across projection/signed store/UI/copy/markdown (%s)',async locale=>{
 const r=await run(undefined,locale),review=r.report.purposeReview!;expect(review.clauses).toHaveLength(1);const c=review.clauses[0] as any;
 expect(c.intentMembers).toEqual(spec.goals[0].clauses.slice(0,2).map(m=>({clauseId:m.id,purpose:m.expectedObservable,conditions:m.conditions,exceptions:m.exceptions})));expect(c).not.toHaveProperty('conditions');expect(c).not.toHaveProperty('exceptions');
 expect(r.assessment!.goals).toHaveLength(1);expect(r.assessment!.goals[0]).toMatchObject({achievement:'partial',assurance:'evidence_assessed'});expect(c.clauseId).not.toBe(ids[0]);
 const q=r.seen.at(-1);expect(q.finalFormat).toBe('purpose_units_v1');expect(q).not.toHaveProperty('limitations');expect(q.coverage).not.toHaveProperty('changeInventory');expect(q.coverage.candidateCounterEvidence).toBeDefined();expect(q.spec).toEqual(spec);expect(r.seen.filter(q=>q.stage==='assess')).toHaveLength(1);expect(r.seen.some(q=>q.stage==='check')).toBe(false);
 const {prepareTenantDetailReportForStorage}=await import('./server-report-store');const {projectTenantPersistedReport,decodeTenantPersistedReport}=await import('./tenant-report-validation');const {sanitizeReportForShare}=await import('./report-share');
 const stored=projectTenantPersistedReport(prepareTenantDetailReportForStorage(r.report,'verified_agentproof','fixture-signing-secret'),'fixture-signing-secret');const decoded=decodeTenantPersistedReport(stored,{signingSecret:'fixture-signing-secret',createdAt:'2026-10-25T00:00:00Z'});expect(decoded.status).toBe('valid');if(decoded.status!=='valid')throw Error('decode');expect((decoded.report as any).purposeReview).toEqual(review);
 const changed=structuredClone(stored);(changed.purposeReview!.clauses[0] as any).intentMembers[0].conditions=[];expect(decodeTenantPersistedReport(changed,{signingSecret:'fixture-signing-secret',createdAt:'2026-10-25T00:00:00Z'}).status).toBe('invalid');
 expect((sanitizeReportForShare(r.report) as any).purposeReview).toBeUndefined();expect(JSON.stringify(stored)).not.toMatch(/"source_text"|"changeObservations"|"facts"|retain\(\)/);
 const text=formatPurposeReview(review),md=formatPurposeReview(review,{format:'markdown'}),html=renderToStaticMarkup(createElement(ReportTopSummary,{report:r.report as any}));for(const s of ['unless cancelled','when retrying','except expired work'])for(const out of [text,md,html])expect(out).toContain(s);for(const out of [text,md,html])expect(out).not.toContain('Standalone background');
 expect(isPurposeReview(review)).toBe(true);
 const directory=process.env.AGENTPROOF_CORE_UNIT_FIXTURE_DIR;if(directory){mkdirSync(directory,{recursive:true});writeFileSync(join(directory,locale+'.json'),JSON.stringify({purpose:r.report.purposeAssessmentSummary,purposeReview:review,testing:r.report.testing}));}
});
it('keeps independent outcomes separate and missing-evidence outcomes visible/unknown',async()=>{
 const r=await run(v=>{v.units[0].candidateClauseIds=[ids[0]];v.units.push({...v.units[0],candidateClauseIds:[ids[1]],purpose:'Independent requested result',implementation:'unknown',changeSummary:null,evidenceRefs:[],changeObservations:[]});return v;});
 expect(r.report.purposeReview!.clauses).toHaveLength(2);expect(purposeVisibleClauses(r.report.purposeReview!)).toHaveLength(2);expect(formatPurposeReview(r.report.purposeReview!)).toContain('Independent requested result');expect(r.assessment!.overall).not.toBe('fulfilled');
});
it.each(['missing','duplicate','overlap','foreign','quote','reference','counter'] as const)('fails closed on invalid unit %s',async kind=>{
 await expect(run(v=>{if(kind==='missing')v.contextClauseIds=[];if(kind==='duplicate')v.units.push({...v.units[0]});if(kind==='overlap')v.contextClauseIds.push(ids[0]);if(kind==='foreign')v.units[0].candidateClauseIds[0]='pc_unknown';if(kind==='quote')v.units[0].changeObservations=[{basis:'source_text',text:'not in source',evidenceId:v.units[0].evidenceRefs[0]}];if(kind==='reference')v.units[0].evidenceRefs=['pe_unsent'];if(kind==='counter')v.units[0].counterEvidenceRefs=['pe_unsent'];return v;})).rejects.toThrow(/purpose_final_/);
});
it('rejects all-context instead of returning an empty successful report',async()=>{await expect(run(()=>({units:[],contextClauseIds:ids}))).rejects.toThrow('purpose_no_core_goal');});
it('keeps legacy stored shapes valid and does not require intent members on old reports',async()=>{const r=await run(),old=structuredClone(r.report.purposeReview!);delete (old.clauses[0] as any).intentMembers;old.clauses[0].conditions=['old condition'];expect(isPurposeReview(old)).toBe(true);expect(formatPurposeReview(old)).toContain('old condition');});
it('new prompt treats clauses as candidates and never asks metadata/limitation enums to stand in for source',()=>{const p=purposeProviderInput({stage:'assess',flow:'explore_final_v1',finalFormat:'purpose_units_v1',spec,evidence:[]} as any);expect(p[0].content).toContain('reading candidates');expect(p[0].content).not.toContain('every supplied clause exactly once');expect(p[0].content).not.toContain('changeInventory');expect(p[0].content).toContain('Missing evidence is not a reason to exclude');});
it('keeps selected member counterevidence bound when merging, and cannot hide it in context',()=>{
 const e:any={id:'pe_'+'d'.repeat(24),content:'retain()'},links=[{clauseId:ids[1],counterEvidenceRefs:[e.id]}],v=wire([e]);
 const parse=(v:any)=>(contract.parsePurposeUnitsWire as any)(v,'purpose_units_v1');
 expect(()=>contract.validatePurposeUnits(parse(v),spec,[e],links)).toThrow('purpose_final_counter_reference');
 v.units[0].counterEvidenceRefs=[e.id];expect(contract.validatePurposeUnits(parse(v),spec,[e],links).units[0].counterEvidenceRefs).toEqual([e.id]);
 const context=wire([e],false);expect(()=>contract.validatePurposeUnits(parse(context),spec,[e],links)).toThrow('purpose_final_counter_reference');
});
it('does not transfer deterministic authority to merged or paraphrased units',async()=>{
 const {compilePurposeUnitSpec}=await import('./purpose-spec');const e:any={id:'pe_'+'d'.repeat(24),content:'retain()'};const v=(contract.parsePurposeUnitsWire as any)(wire([e]),'purpose_units_v1');
 const original=structuredClone(spec);original.goals[0].clauses.forEach(c=>{c.canonicalRequirementIds=['req_fixture'];c.evidenceNeed='static';});
 expect(compilePurposeUnitSpec(original,v,source).spec.goals[0].clauses[0].canonicalRequirementIds).toEqual([]);
 const single=wire([e],false);single.units[0].purpose=original.goals[0].clauses[0].expectedObservable;
 const exact=compilePurposeUnitSpec(original,(contract.parsePurposeUnitsWire as any)(single,'purpose_units_v1'),source);expect(exact.spec.goals[0].clauses[0].canonicalRequirementIds).toEqual(['req_fixture']);
});
it('rejects malformed member storage, duplicate source members, secrets and ownerless flat qualifiers',async()=>{
 const r=await run();for(const edit of [(v:any)=>v.clauses[0].intentMembers[0].purpose='api_key=fixture_secret_value',(v:any)=>v.clauses[0].intentMembers[0].conditions=['bad\u0000control'],(v:any)=>v.clauses[0].intentMembers.push(v.clauses[0].intentMembers[0]),(v:any)=>v.clauses[0].conditions=['misbound'],(v:any)=>v.clauses[0].intentMembers[0].clauseId='pc_wrong',(v:any)=>v.clauses[0].intentMembers[0].sourceText='private raw']){const v=structuredClone(r.report.purposeReview);edit(v);expect(isPurposeReview(v)).toBe(false);}
});
it('common DeepSeek schema/parser select the explicit unit format with real exact-quote validation downstream',async()=>{
 const {prepareDeepSeekPurposeRequest,decodeDeepSeekPurposeResponse}=await import('./purpose-provider-deepseek');const signal=new AbortController().signal,e:any={id:'pe_'+'d'.repeat(24),content:'retain()'};
 const q:any={stage:'assess',flow:'explore_final_v1',finalFormat:'purpose_units_v1',spec,evidence:[e]},p=prepareDeepSeekPurposeRequest(q,{model:'deepseek-flash',effort:'high'},signal),request=JSON.parse(p.bodyJson);
 expect(request.text.format.schema.properties).toHaveProperty('units');expect(request.max_output_tokens).toBe(32768);expect(request.reasoning.effort).toBe('high');
 const response=(v:any)=>({model:'deepseek-flash',status:'completed',usage:{input_tokens:10,output_tokens:8,total_tokens:18,output_tokens_details:{reasoning_tokens:3}},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(v)}]}]});
 const v=decodeDeepSeekPurposeResponse(p,response(wire([e])),signal);expect(contract.validatePurposeUnits(v.value,spec,[e]).units).toHaveLength(1);expect(v.usage.output).toBe(8);
 expect(()=>decodeDeepSeekPurposeResponse(p,response({clauses:[]}),signal)).toThrow('purpose_provider_schema');
});
it.each(['test_only','location_only','conflict'] as const)('preserves %s utility without promoting model execution or losing refs',async kind=>{
 const r=await run(v=>{const c=v.units[0];if(kind==='test_only'){c.testObservations=c.changeObservations;c.changeObservations=[];}if(kind==='location_only'){c.changeObservations=[];c.changeSummary=null;}if(kind==='conflict'){c.implementation='contradicts';c.counterEvidenceRefs=[...c.evidenceRefs];}return v;});
 const c=r.report.purposeReview!.clauses[0];expect(c.implementation).toBe(kind==='location_only'?'unknown':kind==='conflict'?'contradicts':'supports');expect(c.evidenceRefs!.length).toBeGreaterThan(0);expect(r.assessment!.goals[0].clauseResults[0].execution).toBe('not_observed');expect(r.assessment!.overall).not.toBe('fulfilled');
 if(kind==='conflict')expect(c.counterEvidenceRefs).toEqual(c.evidenceRefs);
});
