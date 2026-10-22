import {it,expect,vi,afterEach} from 'vitest';import {createHash} from 'node:crypto';
import {prepareEvidenceExperiment,chooseDeterministicEvidence,chooseJevEvidence,submitJevEvidence,jevProviderFallback} from './jev-evidence-experiment';
import {applyJevSelection,type JevSelectionContext} from './jev-selection';import {reviewArtifactId} from './review-navigation-diagnostics';import {PaidBudgetError,withPaidAnalysis} from './paid-budget';
const head='a'.repeat(40),base='b'.repeat(40);
const a=(n:number,text:string)=>{const content=text,raw={path:`src/entry${n}.ts`,side:'head' as const,revision:head,startLine:1,endLine:1,content,hash:createHash('sha256').update(content).digest('hex'),kind:'code' as const,origin:'snapshot' as const,goalIds:['goal_1']};return {...raw,id:reviewArtifactId(raw)};};
function context():JevSelectionContext {return {repositoryPrivate:false,headSha:head,baseSha:base,protectedIds:[],packet:{stage:'ranking',model:'unchanged',sources:[],goals:[{id:'goal_1',summary:'Preserve rollback and quota behavior',authority:'provided_source',emphasis:'primary',sourceRefs:[],facets:[],openQuestions:[],firstInspection:null,candidates:[],uncertainty:[]}],artifacts:[a(0,'rollback sharedValue'),a(1,'sharedValue')],inventory:[],capabilities:{readPaths:false,searchScope:'supplied_artifacts',wholeRepository:false}},candidates:[a(2,'quota distinctValue')]};}
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('uses common proposals, positive marginal coverage and minimum-loss legal replacement',()=>{
 const c=context();c.packet.artifacts.push(...Array.from({length:14},(_,n)=>a(n+10,'sharedValue')));const p=prepareEvidenceExperiment(c)!;
 expect(p.entries[0].proposal.removeId).not.toBe(c.packet.artifacts[0].id);expect(p.entries[0].loss).toBe(0);expect(chooseDeterministicEvidence(p)).toEqual(p.entries[0].proposal);expect(applyJevSelection(c,chooseDeterministicEvidence(p)).accepted).toBe(true);
 expect(p.request.state.baseline.map(a=>a.content)).toEqual(c.packet.artifacts.map(a=>a.content));expect(p.request.questions.gain_1.instructions).toMatchObject({candidate:{content:c.candidates[0].content}});
});
it('deduplicates before the pool cap, preserves revision/side and admits at most4/8/40k',()=>{
 const c=context();c.candidates=[...Array(96).fill(c.candidates[0]),...Array.from({length:8},(_,n)=>a(n+30,'quota uniqueTerm'+n))];const before=structuredClone(c),p=prepareEvidenceExperiment(c)!;
 expect(p.admission.unique).toBe(9);expect(p.entries).toHaveLength(4);expect(Object.keys(p.request.questions).length).toBeLessThanOrEqual(8);expect(Buffer.byteLength(JSON.stringify(p.request))).toBeLessThanOrEqual(40000);expect(c).toEqual(before);
 const wrong={...c.candidates[0],revision:base};c.candidates=[wrong];expect(prepareEvidenceExperiment(c)!.entries).toHaveLength(0);
});
it('uses fixed independent gain/preservation labels and does not synthesize probabilities',()=>{
 const c=context();c.protectedIds=c.packet.artifacts.map(a=>a.id);const p=prepareEvidenceExperiment(c)!;expect(chooseJevEvidence(p,{gain_1:{type:'choice',choice:'new_evidence',confidence:0.8,probabilities:{new_evidence:0.9,redundant_or_irrelevant:0.05,insufficient_context:0.05}}})).toEqual(p.entries[0].proposal);
 expect(chooseJevEvidence(p,{gain_1:{type:'choice',choice:'insufficient_context',confidence:0.99,probabilities:{new_evidence:0.01,redundant_or_irrelevant:0,insufficient_context:0.99}}})).toBeNull();
 c.protectedIds=[];c.packet.artifacts.push(...Array.from({length:14},(_,n)=>a(n+10,'sharedValue')));const swap=prepareEvidenceExperiment(c)!;
 expect(chooseJevEvidence(swap,{gain_1:{type:'choice',choice:'new_evidence',confidence:0.9,probabilities:{new_evidence:0.95,redundant_or_irrelevant:0.03,insufficient_context:0.02}},preservation_1:{type:'choice',choice:'lost',confidence:1,probabilities:{preserved:0,lost:1,insufficient_context:0}}})).toBeNull();
});
it('fails closed on protected loss, baseline overflow, secrets and nonpositive deterministic gain',()=>{
 const c=context();c.candidates=[a(5,'sharedValue')];expect(chooseDeterministicEvidence(prepareEvidenceExperiment(c)!)).toBeNull();
 c.repositoryPrivate=true;expect(prepareEvidenceExperiment(c)).toBeNull();c.repositoryPrivate=false;c.candidates=[a(6,'password="secret-value"')];expect(prepareEvidenceExperiment(c)!.entries).toHaveLength(0);
 c.packet.artifacts=Array.from({length:6},(_,i)=>a(i,'x'.repeat(7500)));expect(prepareEvidenceExperiment(c)).toBeNull();
});
it('fallbacks ordinary provider failures but propagates budget denial and cancellation',()=>{
 expect(jevProviderFallback(Error('jev_http_400'))).toMatchObject({proposal:null,reason:'provider_failure'});
 expect(()=>jevProviderFallback(new PaidBudgetError('hard_pause'))).toThrow(PaidBudgetError);expect(()=>jevProviderFallback(Error('jev_cancelled'))).toThrow('jev_cancelled');
});
it('reserves/settles once, validates every closed answer and does not leak source into ledger',async()=>{
 const c=context();c.protectedIds=c.packet.artifacts.map(a=>a.id);const p=prepareEvidenceExperiment(c)!,events:any[]=[];let calls=0;
 vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_URL','https://ledger.invalid');vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY','fixture');
 vi.stubGlobal('fetch',async(url:any,init:any)=>{if(String(url).startsWith('https://ledger.invalid')){const b=JSON.parse(init.body);events.push(b);return Response.json(b.p_action==='config'?{allowed:true,config:{timeZone:'Asia/Seoul',validUntil:'2099-01-01T00:00:00Z',krwPerUsd:'1500',prices:{'typesafe/jev-1.13.0':{inputUsdPerMillion:'0.042',outputUsdPerMillion:'0',callReserveKrw:'4.032',source:'https://docs.typesafe.ai/models'}}}}:{allowed:true});}calls++;return Response.json({model:'jev-1.13.0',usage:{input_tokens:2000,output_tokens:60},answers:{gain_1:{type:'choice',choice:'new_evidence',confidence:0.9,probabilities:{new_evidence:0.95,redundant_or_irrelevant:0.04,insufficient_context:0.01}}}});});
 const result=await withPaidAnalysis('fixture',()=>submitJevEvidence(p,{apiKey:'fixture-key'}));expect(result.proposal).toEqual(p.entries[0].proposal);expect(result.usage).toEqual({input:2000,output:60});expect(calls).toBe(1);expect(events.find(x=>x.p_action==='settle')).toMatchObject({p_charge:126});expect(events.at(-1).p_action).toBe('close');expect(JSON.stringify(events)).not.toMatch(/fixture-key|distinctValue/);
});
