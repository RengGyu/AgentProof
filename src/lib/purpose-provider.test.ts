import { it, expect, vi, afterEach } from 'vitest';
import { createPurposeProvider, createStagedPurposeProvider, purposeProviderInput, purposeWireSchema } from './purpose-provider';
import { withPaidAnalysis } from './paid-budget';
import { purposeExploreRequestSchema, purposeFinalRequestSchema } from './purpose-contract';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('routes each stage once to its assigned provider without retry or fallback', async () => {
 const purpose=vi.fn(async()=>({purpose:true})), exploration=vi.fn(async()=>({source:true})), final=vi.fn(async()=>({report:true}));
 const route=createStagedPurposeProvider({purpose,exploration,final}), signal=new AbortController().signal;
 for(const stage of ['purpose','locate','assess'] as const) await route({stage,flow:'explore_final_v1'},signal);
 expect([purpose.mock.calls.length,exploration.mock.calls.length,final.mock.calls.length]).toEqual([1,1,1]);
 purpose.mockRejectedValueOnce(new Error('source_contract_failed'));
 await expect(route({stage:'purpose',flow:'explore_final_v1'},signal)).rejects.toThrow('source_contract_failed');
 expect([exploration.mock.calls.length,final.mock.calls.length]).toEqual([1,1]);
 await expect(async()=>route({stage:'check',flow:'explore_final_v1'},signal)).rejects.toThrow('purpose_stage_provider_unavailable');
 await expect(async()=>route({stage:'purpose'},signal)).rejects.toThrow('purpose_stage_flow_required');
 const aborted=new AbortController();aborted.abort();
 await expect(async()=>route({stage:'assess',flow:'explore_final_v1'},aborted.signal)).rejects.toThrow();
 expect(final).toHaveBeenCalledTimes(1);
});
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
async function protocolCall(output: any[], request: any = {stage:'locate',spec:{goals:[{clauses:[{id:'pc_valid'}]}]},localization:{round:0}}, status = 'completed') {
 const requests:any[]=[];
 vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_URL','https://budget.fixture');vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY','fixture-service');
 vi.stubGlobal('fetch',vi.fn(async(_u:any,init:any)=>{const b=JSON.parse(init.body);return Response.json({allowed:true,...(b.p_action==='config'?{config:{timeZone:'UTC',krwPerUsd:'1500',validUntil:'2099-01-01T00:00:00Z',prices:{'openai/gpt-6-luna':{inputUsdPerMillion:'0.1',outputUsdPerMillion:'0.5',callReserveKrw:'100',source:'https://developers.openai.com/api/docs/models/gpt-6-luna'}}}}:{})});}));
 const fetchFn=vi.fn(async(url:any,init:any)=>{requests.push(JSON.parse(init.body));return String(url).endsWith('/input_tokens')?Response.json({object:'response.input_tokens',model:'gpt-6-luna',input_tokens:100}):Response.json({model:'gpt-6-luna',status,usage:{input_tokens:100,output_tokens:2,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}},output});});
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
const phaseMessage = (phase: string | null | undefined, text: string, status = 'completed') => ({
 type: 'message', role: 'assistant', phase, status, content: [{type: 'output_text', text}],
});
it('normalizes only explore purpose extras through the common adapter with count/generate input unchanged',async()=>{
 const clause={sourceRefs:['gpsp_fixture'],expectedObservable:'Retain pending work',conditions:[],exceptions:[],obligation:'required',evidenceNeed:'behavioral'};
 const raw={goals:[{clauses:[{...clause,authority:'FORGED_CANARY'}],id:'FORGED_CANARY'}],ambiguities:[],metadata:'DROP_CANARY'};
 const output=[phaseMessage('final_answer',JSON.stringify(raw))];
 const {result,requests}=await protocolCall(output,{stage:'purpose',flow:'explore_final_v1',sources:{spans:[{id:'gpsp_fixture'}]}});
 expect(result).toEqual({goals:[{clauses:[clause]}],ambiguities:[]});
 expect(requests[0].input).toEqual(requests[1].input);expect(requests[0].text).toEqual(requests[1].text);
 const legacy=await protocolCall(output,{stage:'purpose'});expect(legacy.result).toEqual(raw);
});
it('returns only the completed final answer, never commentary text or action proposals',async()=>{
 const {result,requests}=await protocolCall([
  {type:'reasoning'},
  phaseMessage('commentary','I will inspect the changed source.'),
  phaseMessage('commentary','{"actions":[{"targetId":"lf_not_final"}],"clauses":[],"stopReason":"continue"}'),
  phaseMessage('final_answer','{"actions":[],"clauses":[],"stopReason":"unresolved"}'),
 ]);
 expect(result).toEqual({actions:[],clauses:[],stopReason:'unresolved'});
 expect(requests).toHaveLength(2);
 expect(requests[0].input).toEqual(requests[1].input);expect(requests[0].text).toEqual(requests[1].text);
});
it('keeps null or absent phases compatible with legacy text-part concatenation',async()=>{
 const {result}=await protocolCall([phaseMessage(null,'{"actions":[],'),phaseMessage(undefined,'"clauses":[],"stopReason":"unresolved"}')]);
 expect(result).toEqual({actions:[],clauses:[],stopReason:'unresolved'});
});
it.each([
 {name:'multiple finals even when one is empty',output:[phaseMessage('final_answer',''),phaseMessage('final_answer','{}')]},
 {name:'unphased message mixed with a final',output:[phaseMessage(undefined,''),phaseMessage('final_answer','{}')]},
 {name:'null phase mixed with a final',output:[phaseMessage(null,''),phaseMessage('final_answer','{}')]},
 {name:'commentary without a final',output:[phaseMessage('commentary','{}')]},
 {name:'unknown phase',output:[phaseMessage('analysis',''),phaseMessage('final_answer','{}')]},
 {name:'invalid final despite valid commentary',output:[phaseMessage('commentary','{}'),phaseMessage('final_answer','not JSON')]},
 {name:'two JSON documents in one final',output:[phaseMessage('final_answer','{}{}')]},
 {name:'unsupported commentary content',output:[{...phaseMessage('commentary',''),content:[{type:'unknown',text:''}]},phaseMessage('final_answer','{}')]},
])('rejects phase ambiguity or invalid content: $name',async({output})=>{
 await expect(protocolCall(output)).rejects.toThrow('purpose_provider_schema');
});
it.each(['in_progress','incomplete',undefined])('rejects a final without completed message status: %s',async(status)=>{
 await expect(protocolCall([{...phaseMessage('final_answer','{}'),status}])).rejects.toThrow('purpose_provider_incomplete');
});
it('rejects an incomplete response even when its final message is completed',async()=>{
 await expect(protocolCall([phaseMessage('final_answer','{}')],undefined,'incomplete')).rejects.toThrow('purpose_provider_incomplete');
});
it.each(['commentary','final_answer'])('does not hide a %s refusal behind a usable final',async(phase)=>{
 const refusal={...phaseMessage(phase,''),content:[{type:'refusal',refusal:'fixture refusal'}]};
 await expect(protocolCall([refusal,phaseMessage('final_answer','{}')])).rejects.toThrow('purpose_provider_refusal');
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
 expect(JSON.stringify(requests[1].input)).toContain('Exploration is over');expect(JSON.stringify(requests[1].input)).toContain('Do not write testRelation, remainingQuestions or tool requests');
});
it.each([[['pe_sent']],[[]]])('final wire restricts every ID namespace and remains satisfiable without evidence %j',async(ids)=>{
 const {requests}=await protocolCall([{type:'message',content:[{type:'output_text',text:'{"clauses":[]}'}]}],{stage:'assess',flow:'explore_final_v1',spec:{goals:[{clauses:[{id:'pc_one'}]}]},evidence:ids.map(id=>({id})),sources:{spans:[{id:'gpsp_author'}]},coverage:{omittedEvidence:[{id:'pe_omitted'}]}});
 const schema=requests[1].text.format.schema;const Ajv=(await import('ajv')).default;const valid=new Ajv().compile(schema);
 const row={changeSummary:null,scopeNotes:[],clauseId:'pc_one',implementation:'unknown',evidenceRefs:ids,counterEvidenceRefs:[],changeObservations:[],testObservations:[]};
 expect(valid({clauses:[row]})).toBe(true);expect(valid({clauses:[]})).toBe(false);expect(valid({clauses:[{...row,clauseId:'wrong'}]})).toBe(false);
 for(const bad of ['gpsp_author','pe_omitted'])for(const field of ['evidenceRefs','counterEvidenceRefs','changeObservations','testObservations']){const altered={...row,[field]:field.endsWith('Observations')?[{basis:'model_interpretation',text:'Claim',evidenceRefs:[bad]}]:field==='remainingQuestions'?[{text:'Question',evidenceRefs:[bad]}]:[bad]};expect(valid({clauses:[altered]})).toBe(false);}
 expect(requests[0].text).toEqual(requests[1].text);
});

it('final wire has one quote evidenceId and converts it exactly once to legacy internal refs',async()=>{
 const quote={basis:'source_text',text:'return value;',evidenceId:'pe_sent'};
 const row={changeSummary:null,scopeNotes:[],clauseId:'pc_one',implementation:'unknown',evidenceRefs:['pe_sent'],counterEvidenceRefs:[],changeObservations:[quote],testObservations:[]};
 const req={stage:'assess',flow:'explore_final_v1',spec:{goals:[{clauses:[{id:'pc_one'}]}]},evidence:[{id:'pe_sent'}]};
 const {result,requests}=await protocolCall([{type:'message',content:[{type:'output_text',text:JSON.stringify({clauses:[row]})}]}],req);
 expect((result as any).clauses[0].changeObservations[0]).toEqual({basis:'source_text',text:'return value;',evidenceRefs:['pe_sent']});
 const Ajv=(await import('ajv')).default,valid=new Ajv().compile(requests[0].text.format.schema);
 expect(valid({clauses:[row]})).toBe(true);
 expect(valid({clauses:[{...row,changeObservations:[{...quote,evidenceId:'gpsp_wrong'}]}]})).toBe(false);
 expect(valid({clauses:[{...row,changeObservations:[{basis:'source_text',text:quote.text,evidenceRefs:['pe_sent']}]}]})).toBe(false);
 expect(requests[0].text).toEqual(requests[1].text);
 await expect(protocolCall([{type:'message',content:[{type:'output_text',text:JSON.stringify({clauses:[{...row,changeObservations:[{...quote,evidenceRefs:['pe_other']}]}]})}]}],req)).rejects.toThrow('purpose_final_wire_schema');
});
it('keeps purpose, diff-first and final instructions on the narrow purpose-fit contract',()=>{
 const text=(request:any)=>String(purposeProviderInput(request)[0].content);
 const purpose=text({stage:'purpose',sources:{}});
 expect(purpose).toContain('A clause is a requirement only when its expectedObservable can be checked in the repository snapshot');
 expect(purpose).toContain('reverting code to watch a test fail and other negative controls');
 expect(purpose).toContain('author context described below is not a condition');
 const commonPurpose=text({stage:'purpose',flow:'explore_final_v1',sources:{}});
 // One rule with its input variants and preserved behavior stays one clause; independent purposes split.
 for(const rule of ['Keep explicit changes even when phrased as completed work','Use one clause for one intended rule or outcome','Repeated statements, input variants and behavior explicitly preserved with that change belong together, with all their sourceRefs','Split independent purposes, not each condition, exception or implementation step','Preserve necessary qualifiers and uncertainty without strengthening the claim','Background is not a separate purpose unless it is itself the requested change','keep any boundary that changes the core meaning beside that purpose','Do not infer intent from code'])expect(commonPurpose).toContain(rule);
 expect(commonPurpose).not.toContain('expectedObservable states the intended change');
 // Only schema fields may be requested as output: authority/source IDs are server-owned, and scopeNotes carry refs.
 expect(commonPurpose).toContain('Copy supplied span IDs in sourceRefs; do not generate IDs, authority, parent sourceRefs or other fields');expect(commonPurpose).not.toContain('Preserve source authority');
 const clauseFields=Object.keys((purposeExploreRequestSchema({spans:[{id:'gpsp_one'}]}) as any).properties.goals.items.properties.clauses.items.properties);
 expect(clauseFields).not.toContain('authority');for(const field of ['obligation','evidenceNeed','sourceRefs','expectedObservable','conditions','exceptions'])expect(clauseFields).toContain(field);
 const final=text({stage:'assess',flow:'explore_final_v1',spec:{},evidence:[]});
 for(const rule of ['supports means the cited change fits','One supported subcase does not settle necessary conditions or exceptions','Preserve actual counterevidence','unrelated background is not a failed purpose','Do not write testRelation, remainingQuestions or tool requests','Use before evidence for transition claims','Write changeObservations for a developer new to this PR: what changes, when, and what result follows','Separate independent effects using the existing array; keep branches of one rule together','give the case and distinguishing assertion rather than narrating the implementation','Do not repeat routine disclaimers','Never infer execution','A complete, SHA-matched changeInventory describes changed paths and statuses only','Never manufacture a source citation for an inventory-only claim'])expect(final).toContain(rule);
 expect(final).not.toContain('Avoid repeating the same scope note');
 expect(final).toContain('Put useful background once in scopeNotes; otherwise use []');
 const note=(purposeFinalRequestSchema({goals:[{clauses:[{id:'pc_one'}]}]},[{id:'pe_one'}]) as any).properties.clauses.items.properties.scopeNotes.items;
 expect(note.required).toContain('evidenceRefs');expect(note.properties.evidenceRefs.minItems).toBe(1);
 // Guidance stays general: no case names, licenses or fixture wording from any one evaluated PR.
 for(const prompt of [commonPurpose,final]) expect(prompt).not.toMatch(/npmscan|\bMIT\b|warning-only|fixture/i);
 for(const removed of ['Generate current remainingQuestions','If an unresolved question directly affects','Qualify observations to the inspected paths','Omitted/failed scope in coverage remains unknown']) expect(final).not.toContain(removed);
 const locate=text({stage:'locate',flow:'explore_final_v1',spec:{},localization:{diff:{policy:'diff_first_v1'}}});
 expect(locate).toContain('Read original source only from supplied initial.changed file IDs');
 expect(locate).toContain('the server performs inspect source');
 expect(locate).toContain('Each action has exactly targetId, startLine, endLine, clauseId');
 for(const removed of ['Root search requires','definition lo_ IDs','reachable source is unread','definition/caller/test']) expect(locate).not.toContain(removed);
 const legacy=text({stage:'locate',flow:'explore_final_v1',spec:{},localization:{}});
 expect(legacy).not.toContain('Choose implementation, definitions, callers');
 expect(text({stage:'assess',spec:{}})).not.toContain('missing callers must remain open questions');
});

it('slim purpose wire derives parent closure and unprocessed source without inventing authority or requirements', async()=>{
 const {purposeRequestSchema}=await import('./purpose-provider');const {buildPurposeSources,compilePurposeSpec}=await import('./purpose-spec');
 const input:any={title:'Preserve work',description:'Only preserve safe work. Except cancelled work.',taskText:'',repositoryPrivate:false,url:'https://github.com/public/repo/pull/1',changedFiles:[],checks:[],logs:[],sourceProvenance:{version:1,origin:'github_snapshot',headSha:'a'.repeat(40),baseSha:'b'.repeat(40)}};
 const sources=buildPurposeSources(input),id=sources.spans[0].id;
 const wire={goals:[{clauses:[{sourceRefs:[id],expectedObservable:'Preserve safe work',conditions:['only safe work'],exceptions:['except cancelled work'],obligation:'required',evidenceNeed:'behavioral'}]}],ambiguities:[]};
 const schema=purposeRequestSchema({stage:'purpose',flow:'explore_final_v1',sources}),Ajv=(await import('ajv')).default,valid=new Ajv().compile(schema);
 expect(valid(wire)).toBe(true);expect(valid({...wire,contextRefs:[]})).toBe(false);
 const s=compilePurposeSpec(input,wire,'explore_final_v1');expect(s.goals[0].sourceRefs).toEqual([id]);expect(s.goals[0].authority).toBe('author_claim');expect(s.goals[0].clauses[0]).toMatchObject({conditions:['only safe work'],exceptions:['except cancelled work']});expect(s.unprocessedSourceRefs).toEqual(sources.spans.slice(1).map(x=>x.id));
 const multi=structuredClone(wire);multi.goals[0].clauses.push({...multi.goals[0].clauses[0],sourceRefs:[id,sources.spans[1].id],expectedObservable:'Expose preserved work'});expect(compilePurposeSpec(input,multi,'explore_final_v1').goals[0].sourceRefs).toEqual([id,sources.spans[1].id]);
 const bad=structuredClone(wire);bad.goals[0].clauses[0].sourceRefs=['gpsp_forged'];expect(valid(bad)).toBe(false);expect(()=>compilePurposeSpec(input,bad,'explore_final_v1')).toThrow(/purpose_source/);
 const empty=compilePurposeSpec(input,{goals:[],ambiguities:[]},'explore_final_v1');expect(empty.goals).toEqual([]);expect(empty.unprocessedSourceRefs).toEqual(sources.spans.map(x=>x.id));
});
it('slim final omits test sufficiency/questions, keeps single quote and rejects executed injection',async()=>{
 const row={clauseId:'pc_one',implementation:'supports',evidenceRefs:['pe_sent'],counterEvidenceRefs:[],changeObservations:[{basis:'source_text',text:'return value;',evidenceId:'pe_sent'}],testObservations:[]};
 const request:any={stage:'assess',flow:'explore_final_v1',spec:{goals:[{clauses:[{id:'pc_one'}]}]},evidence:[{id:'pe_sent'}]};
 const {result,requests}=await protocolCall([{type:'message',content:[{type:'output_text',text:JSON.stringify({clauses:[row]})}]}],request);
 expect(result).toEqual({clauses:[{...row,testRelation:'unknown',remainingQuestions:[],changeObservations:[{basis:'source_text',text:'return value;',evidenceRefs:['pe_sent']}]}]});
 const {validatePurposeFinal}=await import('./purpose-contract');const legacy:any=structuredClone(result);legacy.clauses[0].testRelation='relevant';legacy.clauses[0].remainingQuestions=[{text:'Legacy question',evidenceRefs:['pe_sent']}];expect(validatePurposeFinal(legacy,request.spec,[{id:'pe_sent',content:'return value;'}] as any)).toEqual(legacy);
 const Ajv=(await import('ajv')).default,valid=new Ajv().compile(requests[0].text.format.schema);
 for(const extra of [{testRelation:'relevant'},{remainingQuestions:[]},{execution:'checked_pass'}])expect(valid({clauses:[{...row,...extra}]})).toBe(false);
 expect(requests[0].text).toEqual(requests[1].text);expect(requests[0].input).toEqual(requests[1].input);
});

it('common purpose count and generation share slim clause schema; forbidden bookkeeping and authority stay rejected',async()=>{
 const raw={goals:[{clauses:[{sourceRefs:['gpsp_one'],expectedObservable:'Keep work',conditions:['when pending'],exceptions:['unless cancelled'],obligation:'required',evidenceNeed:'behavioral'}]}],ambiguities:[]};
 const {result,requests}=await protocolCall([{type:'message',content:[{type:'output_text',text:JSON.stringify(raw)}]}],{stage:'purpose',flow:'explore_final_v1',sources:{spans:[{id:'gpsp_one'},{id:'gpsp_context'}]}});
 const Ajv=(await import('ajv')).default,valid=new Ajv().compile(requests[0].text.format.schema);expect(valid(result)).toBe(true);expect(requests[0].text).toEqual(requests[1].text);expect(requests[0].input).toEqual(requests[1].input);
 for(const extra of [{sourceRefs:['gpsp_one']},{authority:'authoritative'}])expect(valid({...raw,goals:[{...raw.goals[0],...extra}]})).toBe(false);
 expect(valid({...raw,goals:[{clauses:[{...raw.goals[0].clauses[0],sourceRefs:['gpsp_forged']}]}]})).toBe(false);
});

it('retains count HTTP status and closed rejection without leaking provider message or reserving generation',async()=>{
 const {purposeFailureDiagnostic}=await import('./purpose-failure');
 vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_URL','https://budget.fixture');vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY','fixture-service');
 const actions:string[]=[];vi.stubGlobal('fetch',vi.fn(async(_u:any,i:any)=>{actions.push(JSON.parse(i.body).p_action);return Response.json({allowed:true});}));
 const fetchFn=vi.fn(async()=>Response.json({error:{code:'unsupported_parameter',message:'raw prompt private-source fixture-key',param:'raw field'}},{status:400}));
 const p=createPurposeProvider({model:'gpt-6-luna',apiKey:'fixture-key',contractConfirmed:true,fetchFn});
 let error:unknown;try{await withPaidAnalysis('safe-count',()=>p({stage:'purpose',sources:{}},new AbortController().signal));}catch(e){error=e;}
 expect(purposeFailureDiagnostic(error)).toEqual({stage:'purpose',phase:'count',code:'provider_unsupported_parameter',providerHTTPStatus:400,requestCorrelation:null});
 expect(JSON.stringify(purposeFailureDiagnostic(error))).not.toMatch(/private-source|fixture-key|raw field/);expect(fetchFn).toHaveBeenCalledTimes(1);expect(actions).toEqual([]);
});

it('uses the selected report language in the same counted/generated input without translating quotes or enums',async()=>{
 for(const language of ['en','ko'] as const){
  const request={stage:'purpose' as const,flow:'explore_final_v1' as const,reportLanguage:language,sources:{text:'Retain pending work'}};
  const input=purposeProviderInput(request as any);
  expect(input[0].content).toContain(language==='ko'?'Write purpose and report explanations in Korean.':'Write purpose and report explanations in English.');
  expect(input[0].content).toContain('Keep source quotes, code, paths, IDs and enum values unchanged.');
  expect(JSON.parse(input[1].content).sources.text).toBe('Retain pending work');
 }
 // en/ko share one editing rule; only the output-language sentence differs.
 for(const stage of [{stage:'purpose',flow:'explore_final_v1',sources:{}},{stage:'assess',flow:'explore_final_v1',spec:{},evidence:[]}]){
  const [en,ko]=(['en','ko'] as const).map(reportLanguage=>String(purposeProviderInput({...stage,reportLanguage} as any)[0].content));
  expect(ko.replace('in Korean.','in English.')).toBe(en);
 }
 expect(()=>purposeProviderInput({stage:'purpose',reportLanguage:'ja'} as any)).toThrow('report_language_invalid');
});

it('hierarchy wire constrains cited fields while legacy omissions stay readable and nullable summary is request-local',async()=>{
 const {purposeFinalRequestSchema,parsePurposeFinalWire,validatePurposeFinal}=await import('./purpose-contract');
 const spec:any={goals:[{clauses:[{id:'pc_one'}]}]},evidence:any=[{id:'pe_sent',content:'original'}];
 const row={clauseId:'pc_one',implementation:'unknown',evidenceRefs:[],counterEvidenceRefs:[],changeObservations:[],testObservations:[]};
 const Ajv=(await import('ajv')).default,valid=new Ajv().compile(purposeFinalRequestSchema(spec,evidence));
 expect(valid({clauses:[{...row,changeSummary:null,scopeNotes:[]}]})).toBe(true);
 const newRow={...row,changeSummary:{text:'Change title',evidenceRefs:['pe_sent']},scopeNotes:[{text:'Important scope',evidenceRefs:['pe_sent']}]};
 expect(valid({clauses:[newRow]})).toBe(true);
 for(const field of ['changeSummary','scopeNotes'] as const){const bad=structuredClone(newRow);const d=field==='changeSummary'?bad.changeSummary:bad.scopeNotes[0];d.evidenceRefs=['gpsp_wrong'];expect(valid({clauses:[bad]})).toBe(false);expect(()=>validatePurposeFinal(parsePurposeFinalWire({clauses:[bad]}),spec,evidence)).toThrow('purpose_final_reference');}
 const legacy={clauses:[row]},before=JSON.stringify(legacy);expect(parsePurposeFinalWire(legacy).clauses[0]).not.toHaveProperty('changeSummary');expect(JSON.stringify(legacy)).toBe(before);
 expect(parsePurposeFinalWire({clauses:[{...row,changeSummary:null,scopeNotes:[]}]}).clauses[0]).not.toHaveProperty('changeSummary');
 expect(()=>parsePurposeFinalWire({clauses:[{...newRow,execution:'checked_pass'}]})).toThrow('purpose_final_wire_schema');
});

it('sends the same accessible core-writing rules in en/ko without adding a semantic gate or case answers',()=>{
 for(const stage of ['purpose','assess'] as const){
  const [en,ko]=(['en','ko'] as const).map(reportLanguage=>String(purposeProviderInput({stage,flow:'explore_final_v1',reportLanguage,spec:{},evidence:[],sources:{}} as any)[0].content));
  expect(en).toContain(stage==='purpose'?'Do not infer intent from code':'Never translate or alter literal quotes, source code excerpts, paths, protocol IDs or enum values');
  expect(ko.replace('in Korean.','in English.')).toBe(en);
 }
 const final=String(purposeProviderInput({stage:'assess',flow:'explore_final_v1',spec:{},evidence:[]} as any)[0].content);
 expect(final).toContain('Describe the role of a code element before using its name');
 expect(final).toContain('Leave unsupported observation arrays empty; never invent content to fill them');
 expect(final).toContain('Never translate or alter literal quotes, source code excerpts, paths, protocol IDs or enum values');
 expect(final).not.toMatch(/PR48|envvar|npmscan/);
});
it('requests a concrete behavior headline and keeps actual behavioral constraints in the change, with background in details',()=>{
 const purpose=String(purposeProviderInput({stage:'purpose',flow:'explore_final_v1',sources:{}})[0].content),final=String(purposeProviderInput({stage:'assess',flow:'explore_final_v1',spec:{},evidence:[]})[0].content);
 expect(purpose).toContain('Background is not a separate purpose');
 expect(final).toContain('short, cited description of the actual change');
 expect(final).toContain('Keep necessary qualifiers with their action');
 expect(final).toContain('Put useful background once in scopeNotes');
 expect(final).toContain('A limitation that changes the judgment belongs with the affected action');
 expect(final).not.toContain('do not restate purpose conditions or exceptions already given except');
});
