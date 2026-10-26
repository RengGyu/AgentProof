import {it,expect,vi} from 'vitest';
import Ajv from 'ajv';
import {createDeepSeekPurposeProvider,prepareDeepSeekPurposeRequest,decodeDeepSeekPurposeResponse} from './purpose-provider-deepseek';
import {purposeProviderInput} from './purpose-provider';
import {withPaidAnalysis} from './paid-budget';
import {buildPurposeSources,compilePurposeSpec} from './purpose-spec';
import {isPurposeExploreProposal} from './purpose-contract';
const input:any={title:'Retain pending work',description:'Keep unfinished work for retry.',taskText:'',url:'https://github.com/example/work/pull/9',repositoryPrivate:false,changedFiles:[],checks:[],logs:[],sourceProvenance:{version:1,origin:'github_snapshot',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),evidenceCapturedAt:'2026-10-26T00:00:00Z',inputFingerprint:{version:1,algorithm:'sha256',value:'c'.repeat(64),coverage:'github_metadata'}}};
const sources=buildPurposeSources(input),sourceRef=sources.spans[0].id;
const clause=()=>({sourceRefs:[sourceRef],expectedObservable:'Retain pending work',conditions:[],exceptions:[],obligation:'required',evidenceNeed:'behavioral'});
const proposal=()=>({goals:[{clauses:[clause()]}],ambiguities:[]});
const request:any={stage:'purpose',flow:'explore_final_v1',sources};
const body=(value:unknown)=>({model:'deepseek-flash',status:'completed',usage:{input_tokens:20,output_tokens:12,total_tokens:32,output_tokens_details:{reasoning_tokens:6}},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
async function actual(value:unknown){const fetchFn=vi.fn(async()=>Response.json(body(value)));const provider=createDeepSeekPurposeProvider({apiKey:'KEY_CANARY',fetchFn});const result=await withPaidAnalysis('purpose-extra-fixture',()=>provider(request,new AbortController().signal));expect(fetchFn).toHaveBeenCalledOnce();return result;}
it.each(['top','goal','clause'] as const)('drops only unused %s keys through the actual adapter before the unchanged source compiler',async level=>{
 const value:any=proposal(),extra={id:'pc_forged',authority:'authoritative',metadata:{private:'DO_NOT_LOG_CANARY'}};
 Object.assign(level==='top'?value:level==='goal'?value.goals[0]:value.goals[0].clauses[0],extra);const original=JSON.stringify(value);
 const result=await actual(value);expect(result).toEqual(proposal());expect(JSON.stringify(value)).toBe(original);expect(JSON.stringify(result)).not.toMatch(/forged|authoritative|CANARY|metadata/);
 const spec=compilePurposeSpec(input,result,'explore_final_v1');expect(spec.goals[0].authority).toBe('author_claim');expect(spec.goals[0].clauses[0].id).toMatch(/^pc_[a-f0-9]{24}$/);expect(spec.goals[0].clauses[0].id).not.toBe(extra.id);expect(spec.goals[0].sourceRefs).toEqual([sourceRef]);
});
it('normalizes all supported levels together but never moves values to repair required fields',async()=>{
 const value:any={...proposal(),contextRefs:['outside'],authority:'authoritative'};Object.assign(value.goals[0],{sourceRefs:['outside'],id:'pg_forged'});Object.assign(value.goals[0].clauses[0],{canonicalRequirementIds:['req_fake']});expect(await actual(value)).toEqual(proposal());
 delete value.goals[0].clauses[0].conditions;value.goals[0].conditions=[];await expect(actual(value)).rejects.toThrow('purpose_provider_schema');
});
it.each(['rootRequired','clauseRequired','wrongGoals','wrongClause','wrongRefsType','wrongConditions','enum','foreignRef','length','ambiguities'] as const)('retains strict %s rejection even when extra keys are present',async kind=>{
 const value:any=proposal();value.unused='IGNORE_CANARY';const c=value.goals[0].clauses[0];
 if(kind==='rootRequired')delete value.ambiguities;if(kind==='clauseRequired')delete c.expectedObservable;if(kind==='wrongGoals')value.goals={};if(kind==='wrongClause')value.goals[0].clauses=['text'];if(kind==='wrongRefsType')c.sourceRefs=sourceRef;if(kind==='wrongConditions')c.conditions=null;if(kind==='enum')c.obligation='certain';if(kind==='foreignRef')c.sourceRefs=['gpsp_missing'];if(kind==='length')c.expectedObservable='x'.repeat(601);if(kind==='ambiguities')value.ambiguities=[1];
 await expect(actual(value)).rejects.toThrow('purpose_provider_schema');
});
it('preserves privacy checking on consumed text and leaves shared/compiler validators strict',async()=>{
 const raw:any=proposal();raw.id='unused';expect(isPurposeExploreProposal(raw)).toBe(false);expect(()=>compilePurposeSpec(input,raw,'explore_final_v1')).toThrow('purpose_spec_invalid');
 raw.goals[0].clauses[0].expectedObservable='api_key=fixture_secret_value';const normalized=await actual(raw);expect(isPurposeExploreProposal(normalized)).toBe(false);expect(()=>compilePurposeSpec(input,normalized,'explore_final_v1')).toThrow('purpose_spec_invalid');
});
it.each(['locate','assess'] as const)('keeps %s extra-key validation strict and never repairs final partition/refs',stage=>{
 const spec=compilePurposeSpec(input,proposal(),'explore_final_v1'),id=spec.goals[0].clauses[0].id;
 const q:any={...request,stage,spec,...(stage==='assess'?{finalFormat:'purpose_units_v1',evidence:[]}:{localization:{round:0}})};
 const prepared=prepareDeepSeekPurposeRequest(q,{model:'deepseek-flash',effort:'high'},new AbortController().signal);
 const value:any=stage==='assess'?{units:[],contextClauseIds:[id]}:{actions:[],clauses:[{clauseId:id,evidenceRefs:[],counterEvidenceRefs:[]}],stopReason:'unresolved'};
 const valid=new Ajv().compile(JSON.parse(prepared.schemaJson));expect(valid(value)).toBe(true);value.authority='EXTRA_CANARY';expect(()=>decodeDeepSeekPurposeResponse(prepared,body(value),new AbortController().signal)).toThrow('purpose_provider_schema');
});
it('states the exact purpose key contract without changing later-stage instructions',()=>{
 const p=purposeProviderInput(request)[0].content;expect(p).toContain('Top-level keys: goals, ambiguities');expect(p).toContain('Goal keys: clauses');expect(p).toContain('Clause keys: sourceRefs, expectedObservable, conditions, exceptions, obligation, evidenceNeed');expect(purposeProviderInput({...request,stage:'locate'})[0].content).not.toContain('Top-level keys: goals');
});
