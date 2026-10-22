import {afterEach,expect,it,vi} from 'vitest';
import {prepareDeepSeekPurposeTest,decodeDeepSeekPurposeTest,readDeepSeekTestUsage} from '../../../scripts/deepseek-purpose-test-adapter';
import {purposeProviderInput,purposeRequestSchema} from '../purpose-provider';
import {validatePurposeFinal} from '../purpose-contract';

const signal=()=>new AbortController().signal;
const profile={model:'deepseek-flash',effort:'high'} as const;
const spec:any={goals:[{clauses:[{id:'pc_one'}]}]},evidence:any=[{id:'pe_sent',content:'return value;'}];
const row={changeSummary:null,scopeNotes:[],clauseId:'pc_one',implementation:'unknown',evidenceRefs:['pe_sent'],counterEvidenceRefs:[],changeObservations:[{basis:'source_text',text:'return value;',evidenceId:'pe_sent'}],testObservations:[]};
const req={stage:'assess',flow:'explore_final_v1',spec,evidence} as const;
const raw=(value:unknown)=>({model:profile.model,status:'completed',usage:{input_tokens:100,output_tokens:20,total_tokens:120},output:[{type:'reasoning',content:[{type:'reasoning_text',text:'DO_NOT_LOG_REASONING'}]},{type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:JSON.stringify(value)}]}]});
afterEach(()=>vi.unstubAllGlobals());

it.each(['purpose','locate','assess'] as const)('prepares the current slim %s wire/common prompt, without credentials or live I/O',stage=>{
 const network=vi.fn(()=>{throw Error('No network permitted');});vi.stubGlobal('fetch',network);
 const request={...req,stage,reportLanguage:'ko' as const,sources:{spans:[{id:'gpsp_one',text:'PRIVATE_CANARY'}]}};
 const prepared=prepareDeepSeekPurposeTest(request,profile,signal()),body=JSON.parse(prepared.bodyJson),input=purposeProviderInput(request);
 expect(body.input.map((m:any)=>m.content)).toEqual(input.map(m=>m.content));expect(body.input[0].role).toBe('system');
 expect(body.max_output_tokens).toBe(32768);expect(body.store).toBe(false);expect(body.stream).toBe(false);
 expect(JSON.parse(prepared.schemaJson)).toEqual(purposeRequestSchema(request));expect(body.text.format.type).toBe('json_schema');
 expect(prepared.manifest).toMatchObject({provider:'deepseek',model:profile.model,preCount:'UNVERIFIED',liveAdmission:'BLOCKED'});
 expect(JSON.stringify(prepared.manifest)).not.toMatch(/PRIVATE_CANARY|DO_NOT_LOG_REASONING|gpsp_one|Authorization|apiKey/);
 expect(network).not.toHaveBeenCalled();
});
it.each(['en','ko'] as const)('decodes a %s final with the existing parser and exact quote validator',reportLanguage=>{
 const prepared=prepareDeepSeekPurposeTest({...req,reportLanguage},profile,signal());
 const result=decodeDeepSeekPurposeTest(prepared,raw({clauses:[row]}),signal());
 const final=validatePurposeFinal(result.value,spec,evidence);
 expect(final.clauses[0].changeObservations[0]).toEqual({basis:'source_text',text:'return value;',evidenceRefs:['pe_sent']});
 expect(final.clauses[0]).toMatchObject({testRelation:'unknown',remainingQuestions:[]});
 expect(result.usage).toEqual({input:100,output:20,total:120,cachedInput:null,reasoning:null});
});
it.each(['purpose','locate'] as const)('decodes %s only through the current local schema',stage=>{
 const prepared=prepareDeepSeekPurposeTest({...req,stage},profile,signal());
 const value=stage==='purpose'?{goals:[],ambiguities:[]}:{actions:[{targetId:'lf_one',startLine:1,endLine:1,clauseId:'pc_one'}],clauses:[],stopReason:'continue'};
 expect(decodeDeepSeekPurposeTest(prepared,raw(value),signal()).value).toEqual(value);
});
it.each(['unknown_id','extra_execution','wrong_quote'] as const)('retains %s rejection without retry/correction',kind=>{
 const prepared=prepareDeepSeekPurposeTest(req,profile,signal()),changed:any=structuredClone(row);
 if(kind==='unknown_id')changed.changeObservations[0].evidenceId='gpsp_unknown';
 if(kind==='extra_execution')changed.execution='checked_pass';
 if(kind==='wrong_quote')changed.changeObservations[0].text='invented text';
 expect(()=>{const result=decodeDeepSeekPurposeTest(prepared,raw({clauses:[changed]}),signal());validatePurposeFinal(result.value,spec,evidence);}).toThrow();
});
it.each(['model','incomplete','missing_usage','wrong_total','too_much_output','bad_json'] as const)('rejects %s with closed errors instead of provider body text',kind=>{
 const prepared=prepareDeepSeekPurposeTest(req,profile,signal()),body:any=raw({clauses:[row]});
 if(kind==='model')body.model='other';if(kind==='incomplete')body.status='incomplete';if(kind==='missing_usage')delete body.usage;
 if(kind==='wrong_total')body.usage.total_tokens=99;
 if(kind==='too_much_output')Object.assign(body.usage,{output_tokens:32769,total_tokens:32869});
 if(kind==='bad_json')body.output=[{type:'message',content:[{type:'output_text',text:'PRIVATE_BODY_CANARY'}]}];
 try{decodeDeepSeekPurposeTest(prepared,body,signal());throw Error('Expected closed rejection');}catch(error){expect((error as Error).message).toMatch(/^purpose_/);expect((error as Error).message).not.toContain('PRIVATE');}
});
it('keeps cache/reasoning usage distinct and rejects invalid quantities',()=>{
 expect(readDeepSeekTestUsage({input_tokens:100,output_tokens:20,total_tokens:120,input_tokens_details:{cached_tokens:5},output_tokens_details:{reasoning_tokens:12}})).toMatchObject({cachedInput:5,reasoning:12,output:20});
 for(const u of [{input_tokens:1.5,output_tokens:1,total_tokens:2.5},{input_tokens:1,output_tokens:1,total_tokens:2,input_tokens_details:{cached_tokens:2}},{input_tokens:1,output_tokens:1,total_tokens:2,output_tokens_details:{reasoning_tokens:2}}])expect(()=>readDeepSeekTestUsage(u)).toThrow('purpose_usage_unconfirmed');
});
it('honors parent cancellation before preparation and decoding; never reads environment keys',()=>{
 const controller=new AbortController(),prepared=prepareDeepSeekPurposeTest(req,profile,controller.signal);controller.abort();
 expect(()=>prepareDeepSeekPurposeTest(req,profile,controller.signal)).toThrow();expect(()=>decodeDeepSeekPurposeTest(prepared,raw({clauses:[row]}),controller.signal)).toThrow();
});
it('rejects unsupported aliases, implicit medium remapping and check/fallback stages',()=>{
 expect(()=>prepareDeepSeekPurposeTest(req,{...profile,model:'deepseek-chat'} as any,signal())).toThrow('purpose_stage_provider_unavailable');
 expect(()=>prepareDeepSeekPurposeTest(req,{...profile,effort:'medium'} as any,signal())).toThrow('purpose_stage_provider_unavailable');
 expect(()=>prepareDeepSeekPurposeTest({...req,stage:'check'},profile,signal())).toThrow('purpose_stage_flow_required');
});

it.each([0,32769,1.5])('rejects a requested output allowance of %s before any I/O',maxOutputTokens=>{
 expect(()=>prepareDeepSeekPurposeTest(req,profile,signal(),maxOutputTokens)).toThrow('purpose_provider_schema');
});
it('allows the full32768 output allowance through the common final wire and exact quote validator',()=>{
 const prepared=prepareDeepSeekPurposeTest(req,profile,signal(),32768),body:any=raw({clauses:[row]});
 body.usage={input_tokens:100,output_tokens:32768,total_tokens:32868,output_tokens_details:{reasoning_tokens:32000}};
 const decoded=decodeDeepSeekPurposeTest(prepared,body,signal());expect(validatePurposeFinal(decoded.value,spec,evidence).clauses[0].evidenceRefs).toContain('pe_sent');
 expect(decoded.usage).toMatchObject({output:32768,reasoning:32000});
});
