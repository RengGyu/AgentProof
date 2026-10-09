import { it, expect, vi, afterEach } from 'vitest';
import { createPurposeProvider, purposeWireSchema } from './purpose-provider';
import { withPaidAnalysis } from './paid-budget';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('account contract is required before token count or generation', async () => { const f = vi.fn(); const p = createPurposeProvider({ model: 'gpt-6.1-sol', apiKey: 'fixture-key', fetchFn: f, contractConfirmed: false }); await expect(p({ stage: 'purpose', sources: {} }, new AbortController().signal)).rejects.toThrow('purpose_account_contract_unconfirmed'); expect(f).not.toHaveBeenCalled(); });
it.each(['gpt-6.1-sol','gpt-6-luna'] as const)('counts identical schema/input and settles exact uncached usage for explicit %s', async (model) => {
    const actions: string[] = [], requests: any[] = [];
    process.env.AGENTPROOF_CONTROL_PLANE_SUPABASE_URL = 'https://budget.fixture';
    process.env.AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY = 'fixture-service';
    vi.stubGlobal('fetch', vi.fn(async (_u: any, init: any) => { const b = JSON.parse(init.body); actions.push(b.p_action); return new Response(JSON.stringify({ allowed: true, ...(b.p_action === 'config' ? { config: { timeZone: 'UTC', krwPerUsd: '1500', validUntil: '2099-01-01T00:00:00Z', prices: { ['openai/'+model]: { inputUsdPerMillion: '2', outputUsdPerMillion: '10', callReserveKrw: '1000', source: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol' } } } } : {}) })); }));
    const f = vi.fn(async (url: any, init: any) => { const b = JSON.parse(init.body); requests.push(b); return new Response(JSON.stringify(String(url).endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 100 } : { model, status: 'completed', usage: { input_tokens: 100, output_tokens: 2, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 } }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ goals: [], contextRefs: [], unprocessedSourceRefs: [], ambiguities: [] }) }] }] })); });
    const p = createPurposeProvider({ model, apiKey: 'fixture-key', fetchFn: f, contractConfirmed: true });
    await withPaidAnalysis('fixture-purpose', () => p({ stage: 'purpose', sources: {} }, new AbortController().signal));
    expect(actions).toEqual(['config', 'reserve', 'settle', 'close']);
    expect(requests[0].input).toEqual(requests[1].input);
    expect(requests[0].text).toEqual(requests[1].text);
    expect(requests[1].prompt_cache_options).toEqual({ mode: 'explicit' });
    delete process.env.AGENTPROOF_CONTROL_PLANE_SUPABASE_URL;
    delete process.env.AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY;
});
it.each(['undersized_reserve', 'unknown_cache', 'count_failure'])('fails closed for %s without retries or guessed charges', async (kind) => {
    const actions: any[] = [];
    vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_URL', 'https://budget.fixture');
    vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY', 'fixture-service');
    vi.stubGlobal('fetch', vi.fn(async (_u: any, init: any) => { const b = JSON.parse(init.body); actions.push(b); return Response.json({ allowed: true, ...(b.p_action === 'config' ? { config: { timeZone: 'UTC', krwPerUsd: '1500', validUntil: '2099-01-01T00:00:00Z', prices: { 'openai/gpt-6.1-sol': { inputUsdPerMillion: '2', outputUsdPerMillion: '10', callReserveKrw: kind === 'undersized_reserve' ? '0.001' : '1000', source: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol' } } } } : {}) }); }));
    const f = vi.fn(async (url: any) => String(url).endsWith('/input_tokens') ? Response.json({ object: 'response.input_tokens', input_tokens: 100 }, { status: kind === 'count_failure' ? 403 : 200 }) : Response.json({ model: 'gpt-6.1-sol', status: 'completed', usage: { input_tokens: 100, output_tokens: 2 }, output: [] }));
    const p = createPurposeProvider({ model: 'gpt-6.1-sol', apiKey: 'fixture-key', fetchFn: f, contractConfirmed: true });
    await expect(withPaidAnalysis('fixture-fail-' + kind, () => p({ stage: 'purpose', sources: {} }, new AbortController().signal))).rejects.toThrow();
    expect(f).toHaveBeenCalledTimes(kind === 'unknown_cache' ? 2 : 1);
    if (kind === 'unknown_cache')
        expect(actions.find(x => x.p_action === 'settle')?.p_charge).toBeNull();
    else
        expect(actions.some(x => x.p_action === 'reserve')).toBe(false);
    expect(JSON.stringify(actions)).not.toMatch(/fixture-key|fixture-service|"sources"|"developer"/);
});

it('requires an active budget scope before transmitting source to the token counter',async()=>{
 const f=vi.fn(async()=>Response.json({object:'response.input_tokens',input_tokens:100}));const p=createPurposeProvider({model:'gpt-6.1-sol',apiKey:'fixture-key',fetchFn:f,contractConfirmed:true});await expect(p({stage:'purpose',sources:{}},new AbortController().signal)).rejects.toThrow();expect(f).not.toHaveBeenCalled();
});

it('wire schema omits unsupported uniqueItems, rejects other unsupported keywords, while local duplicate validation remains',async()=>{
 const {purposeProposalSchema,isPurposeProposal}=await import('./purpose-contract');
 const wire=purposeWireSchema(purposeProposalSchema);
 expect(JSON.stringify(wire)).not.toContain('uniqueItems');
 expect(JSON.stringify(wire)).not.toMatch(/minLength|maxLength/);
 expect(JSON.stringify(purposeProposalSchema)).toContain('uniqueItems');
 expect(()=>purposeWireSchema({type:'object',allOf:[]})).toThrow('purpose_wire_schema_unsupported');
 expect(isPurposeProposal({goals:[],contextRefs:['same','same'],unprocessedSourceRefs:[],ambiguities:[]})).toBe(false);
});
it('Luna locate uses same count/schema input, authoritative reserve/settle/close and no cache rates guessed',async()=>{
 const actions:any[]=[],requests:any[]=[];vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_URL','https://budget.fixture');vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY','fixture-service');
 vi.stubGlobal('fetch',vi.fn(async(_u:any,init:any)=>{const b=JSON.parse(init.body);actions.push(b);return Response.json({allowed:true,...(b.p_action==='config'?{config:{timeZone:'UTC',krwPerUsd:'1500',validUntil:'2099-01-01T00:00:00Z',prices:{'openai/gpt-6-luna':{inputUsdPerMillion:'0.1',outputUsdPerMillion:'0.5',callReserveKrw:'100',source:'https://developers.openai.com/api/docs/models/gpt-6-luna'}}}}:{})});}));
 const f=vi.fn(async(url:any,init:any)=>{requests.push(JSON.parse(init.body));return String(url).endsWith('/input_tokens')?Response.json({object:'response.input_tokens',model:'gpt-6-luna',input_tokens:100}):Response.json({model:'gpt-6-luna',status:'completed',usage:{input_tokens:100,output_tokens:2,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}},output:[{type:'message',content:[{type:'output_text',text:'{"actions":[],"clauses":[],"stopReason":"unresolved"}'}]}]});});
 const p=createPurposeProvider({model:'gpt-6-luna',apiKey:'fixture-key',contractConfirmed:true,fetchFn:f});const result=await withPaidAnalysis('fixture-locate',()=>p({stage:'locate',spec:{},localization:{}},new AbortController().signal));expect(result).toEqual({actions:[],clauses:[],stopReason:'unresolved'});expect(requests[0].input).toEqual(requests[1].input);expect(requests[0].text).toEqual(requests[1].text);expect(requests[1].text.format.name).toBe('purpose_locate_v1');expect(requests[1].reasoning.effort).toBe('high');expect(actions.map(x=>x.p_action)).toEqual(['config','reserve','settle','close']);expect(actions.find(x=>x.p_action==='settle').p_charge).toBe(17);expect(JSON.stringify(actions)).not.toContain('fixture-key');
});

// Exercises the real provider/count/budget boundary; only remote services are fixtures.
async function protocolCall(output: any[], request: any = {stage:'locate',spec:{goals:[{clauses:[{id:'pc_valid'}]}]},localization:{round:0}}) {
 const requests:any[]=[];
 vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_URL','https://budget.fixture');vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY','fixture-service');
 vi.stubGlobal('fetch',vi.fn(async(_u:any,init:any)=>{const b=JSON.parse(init.body);return Response.json({allowed:true,...(b.p_action==='config'?{config:{timeZone:'UTC',krwPerUsd:'1500',validUntil:'2099-01-01T00:00:00Z',prices:{'openai/gpt-6-luna':{inputUsdPerMillion:'0.1',outputUsdPerMillion:'0.5',callReserveKrw:'100',source:'https://developers.openai.com/api/docs/models/gpt-6-luna'}}}}:{})});}));
 const fetchFn=vi.fn(async(url:any,init:any)=>{requests.push(JSON.parse(init.body));return String(url).endsWith('/input_tokens')?Response.json({object:'response.input_tokens',model:'gpt-6-luna',input_tokens:100}):Response.json({model:'gpt-6-luna',status:'completed',usage:{input_tokens:100,output_tokens:2,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}},output});});
 const provider=createPurposeProvider({model:'gpt-6-luna',apiKey:'fixture-key',contractConfirmed:true,fetchFn});
 const result=await withPaidAnalysis('fixture-protocol',()=>provider(request,new AbortController().signal));return {result,requests};
}
it('accepts retained Responses empty text plus JSON across messages without discarding strict JSON parsing',async()=>{
 const body='{"actions":[],"clauses":[],"stopReason":"unresolved"}';
 const {result}=await protocolCall([{type:'reasoning'},{type:'message',content:[{type:'output_text',text:''}]},{type:'reasoning'},{type:'message',content:[{type:'output_text',text:body}]}]);
 expect(result).toEqual({actions:[],clauses:[],stopReason:'unresolved'});
});
it.each(['refusal','unsupported','two_json'])('rejects %s rather than selecting a convenient response block',async(kind)=>{
 const content=kind==='refusal'?[{type:'refusal',refusal:'fixture refusal'},{type:'output_text',text:'{}'}]:kind==='unsupported'?[{type:'unknown',text:'{}'}]:[{type:'output_text',text:'{}'},{type:'output_text',text:'{}'}];
 await expect(protocolCall([{type:'message',content}])).rejects.toThrow(kind==='refusal'?'purpose_provider_refusal':'purpose_provider_schema');
});
it('locate wire preserves tool target kinds and frozen nonempty clause IDs; final round forbids actions',async()=>{
 const {default:Ajv}=await import('ajv');
 const {requests}=await protocolCall([{type:'message',content:[{type:'output_text',text:'{}'}]}]);
 const validate=new Ajv().compile(requests[0].text.format.schema);
 const a={kind:'inspect',targetId:'lf_fixture',view:'source',startLine:1,endLine:80,cursor:0,literal:'',clauseId:'pc_valid'};
 expect(validate({actions:[a],clauses:[],stopReason:'continue'})).toBe(true);
 expect(validate({actions:[{...a,kind:'browse'}],clauses:[],stopReason:'continue'})).toBe(false);
 expect(validate({actions:[{...a,clauseId:''}],clauses:[],stopReason:'continue'})).toBe(false);
 expect(validate({actions:[{...a,clauseId:'pc_unissued'}],clauses:[],stopReason:'continue'})).toBe(false);
 const final=await protocolCall([{type:'message',content:[{type:'output_text',text:'{}'}]}],{stage:'locate',spec:{goals:[{clauses:[{id:'pc_valid'}]}]},localization:{round:3}});
 expect(new Ajv().compile(final.requests[0].text.format.schema)({actions:[a],clauses:[],stopReason:'continue'})).toBe(false);
 expect(requests[0].input).toEqual(requests[1].input);expect(requests[0].text).toEqual(requests[1].text);
});

it('final interpretation count/generate share a strict no-tool schema and explicit one-shot instructions',async()=>{
 const {requests}=await protocolCall([{type:'message',content:[{type:'output_text',text:'{"clauses":[]}'}]}],{stage:'assess',flow:'explore_final_v1',spec:{},evidence:[],coverage:{omittedEvidence:[],readOutcomes:[],omittedToolResults:[]}});
 expect(requests[0].input).toEqual(requests[1].input);expect(requests[0].text).toEqual(requests[1].text);
 expect(requests[1].text.format.name).toBe('purpose_final_v1');expect(Object.keys(requests[1].text.format.schema.properties)).toEqual(['clauses']);
 expect(JSON.stringify(requests[1].text.format.schema)).not.toMatch(/readRequests|searchRequests|execution/);
 expect(JSON.stringify(requests[1].input)).toContain('no readRequests, searchRequests');
});
it.each([[['pe_sent']],[[]]])('final wire restricts every ID namespace and remains satisfiable without evidence %j',async(ids)=>{
 const {requests}=await protocolCall([{type:'message',content:[{type:'output_text',text:'{"clauses":[]}'}]}],{stage:'assess',flow:'explore_final_v1',spec:{goals:[{clauses:[{id:'pc_one'}]}]},evidence:ids.map(id=>({id})),sources:{spans:[{id:'gpsp_author'}]},coverage:{omittedEvidence:[{id:'pe_omitted'}]}});
 const schema=requests[1].text.format.schema;const Ajv=(await import('ajv')).default;const valid=new Ajv().compile(schema);
 const row={clauseId:'pc_one',implementation:'unknown',testRelation:'unknown',evidenceRefs:ids,counterEvidenceRefs:[],changeObservations:[],testObservations:[],remainingQuestions:[{text:'Missing scope?',evidenceRefs:[]}]};
 expect(valid({clauses:[row]})).toBe(true);expect(valid({clauses:[]})).toBe(false);expect(valid({clauses:[{...row,clauseId:'wrong'}]})).toBe(false);
 for(const bad of ['gpsp_author','pe_omitted'])for(const field of ['evidenceRefs','counterEvidenceRefs','changeObservations','testObservations','remainingQuestions']){const altered={...row,[field]:field.endsWith('Observations')?[{basis:'model_interpretation',text:'Claim',evidenceRefs:[bad]}]:field==='remainingQuestions'?[{text:'Question',evidenceRefs:[bad]}]:[bad]};expect(valid({clauses:[altered]})).toBe(false);}
 expect(requests[0].text).toEqual(requests[1].text);
});
