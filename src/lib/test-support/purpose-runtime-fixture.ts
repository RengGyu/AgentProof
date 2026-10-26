import {createHash} from 'node:crypto';
/** Remote fixtures only; the entry, compiler, source validator, ledger and storage remain real. */
export function purposeRuntimeFetch(original:typeof fetch,repo:string,path:string,options:{privateRepository?:boolean;variant?:'test_only'|'quote_only'|'ref_only'|'observation_refs'|'partial_hunk';freshness?:'ci'|'body';finish?:'implicit'|'partial';failure?:'count'|'price'|'model'|'quote'|'usage'|'empty'|'sha'|'execution'|'locate';onRequest?:(body:any,count:boolean)=>void;onBudget?:(body:any)=>void;afterFinal?:()=>void}={}) : typeof fetch {
 let finalDone=false;
 const head='a'.repeat(40),base='b'.repeat(40),tree='d'.repeat(40);
 const content='pending = retain()\n';const blob=createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');
 return async(target,init)=>{
  const u=String(target);
  if(u==='https://budget.fixture/rest/v1/rpc/agentproof_paid_budget'){const p=JSON.parse(String(init?.body));options.onBudget?.(p);return Response.json({allowed:true,...(p.p_action==='config'?{config:{timeZone:'UTC',krwPerUsd:'1500',validUntil:'2099-01-01T00:00:00Z',prices:{...(options.failure==='price'?{}:{'deepseek/deepseek-flash':{inputUsdPerMillion:'0.3',outputUsdPerMillion:'1.2',callReserveKrw:'1000',source:'https://api-docs.deepseek.com/quick_start/pricing/'}}),'openai/gpt-6-luna':{inputUsdPerMillion:'0.1',outputUsdPerMillion:'0.5',callReserveKrw:'100',source:'https://developers.openai.com/api/docs/models/gpt-6-luna'}}}}:{})});}
  if(u.startsWith('https://api.openai.com/')||u==='https://api.deepseek.com/responses'){
   const body=JSON.parse(String(init?.body)),count=u.endsWith('/input_tokens');options.onRequest?.(body,count);
   if(count)return Response.json({object:'response.input_tokens',model:'gpt-6-luna',input_tokens:100},{status:options.failure==='count'?403:200});
   const q=JSON.parse(body.input[1].content);let proposal:any;
   if(q.stage==='purpose')proposal={goals:[{clauses:[{sourceRefs:[q.sources.spans[0].id],expectedObservable:q.reportLanguage==='ko'?'대기 중인 작업 유지':'Retain pending work',conditions:[],exceptions:[],obligation:'required',evidenceNeed:'static'}]}],ambiguities:[]};
   else if(q.stage==='locate'){
    const l=q.localization,clauseId=q.spec.goals[0].clauses[0].id;
    proposal=l.round===0?{actions:[{targetId:options.failure==='locate'?'lf_not_issued':l.initial.changed.find((e:any)=>e.side==='head').id,startLine:1,endLine:1,clauseId}],clauses:[],stopReason:'continue'}:{actions:[],clauses:[{clauseId,evidenceRefs:l.selectionSources.map((e:any)=>e.id),counterEvidenceRefs:[]}],stopReason:'selected'};
    if(l.round>0&&options.finish)proposal={actions:[],clauses:[],stopReason:options.finish==='implicit'?'continue':'selected'};
   }else proposal={clauses:q.spec.goals.flatMap((g:any)=>g.clauses.map((c:any)=>({changeSummary:null,scopeNotes:[],clauseId:c.id,implementation:'supports',evidenceRefs:q.evidence.map((e:any)=>e.id),counterEvidenceRefs:[],changeObservations:options.failure==='empty'?[]:[{basis:'source_text',text:options.failure==='quote'?'unseen code':'pending = retain()',evidenceId:q.evidence[0].id},{basis:'model_interpretation',text:options.failure==='execution'?'Tests passed.':q.reportLanguage==='ko'?'변경된 소스는 대기 중인 작업을 유지합니다.':'The changed source retains pending work.',evidenceRefs:[q.evidence[0].id]}],testObservations:[]})))};
   if(q.stage==='assess'){
    finalDone=true;for(const c of proposal.clauses){if(options.variant==='test_only'){c.testObservations=[{basis:'model_interpretation',text:'The static assertion checks retained work; execution is not established.',evidenceRefs:c.evidenceRefs}];c.changeObservations=[];}if(options.variant==='quote_only')c.changeObservations=c.changeObservations.filter((o:any)=>o.basis==='source_text');if(options.variant==='ref_only'){c.changeObservations=[];c.testObservations=[];}if(options.variant==='observation_refs')c.evidenceRefs=[];}
    if(q.finalFormat==='purpose_units_v1')proposal={units:proposal.clauses.map(({clauseId,...c}:any)=>({...c,candidateClauseIds:[clauseId],purpose:q.spec.goals.flatMap((g:any)=>g.clauses).find((s:any)=>s.id===clauseId).expectedObservable})),contextClauseIds:[]};
   }
   return Response.json({model:options.failure==='model'?'gpt-6.1-sol':u.includes('deepseek.com')?'deepseek-flash':'gpt-6-luna',status:'completed',usage:options.failure==='usage'?undefined:{input_tokens:100,output_tokens:2,total_tokens:102,output_tokens_details:{reasoning_tokens:1},input_tokens_details:{cached_tokens:0,cache_write_tokens:0}},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(proposal)}]}]});
  }
  // First GitHub read after the final response: a point after generation and before persistence.
  if(finalDone&&options.afterFinal&&u.startsWith('https://api.github.com/')){const hook=options.afterFinal;options.afterFinal=undefined;hook();}
  const root='https://api.github.com/repos/'+repo;
  if(u===root)return Response.json({id:9,private:options.privateRepository??false,full_name:repo});
  if(u===root+'/compare/'+base+'...'+head+'?per_page=1')return Response.json({base_commit:{sha:base},merge_base_commit:{sha:base}});
  if(u===root+'/git/commits/'+head||u===root+'/git/commits/'+base)return Response.json({sha:options.failure==='sha'?'f'.repeat(40):u.split('/').at(-1),tree:{sha:tree}});
  if(u===root+'/git/trees/'+tree+'?recursive=1')return Response.json({sha:tree,truncated:false,tree:[{path,mode:'100644',type:'blob',sha:blob,size:Buffer.byteLength(content)}]});
  if(u===root+'/git/blobs/'+blob)return new Response(content);
  if(u.includes('/pulls/')&&u.includes('/files'))return Response.json([{filename:path,status:'modified',patch:options.variant==='partial_hunk'?'@@ -1,3 +1,3 @@\n-pending = discard()\n+pending = retain()':'@@ -1 +1 @@\n-pending = discard()\n+pending = retain()',additions:1,deletions:1,changes:2}]);
  const response=await original(target,init);
  if(finalDone&&options.freshness){if(options.freshness==='body'&&/^\/pulls\/\d+$/.test(u.slice(root.length))){const body=await response.json();return Response.json({...body,body:'An updated author purpose'});}if(options.freshness==='ci'&&u.includes('/check-runs'))return Response.json({check_runs:[{name:'CI',status:'completed',conclusion:'success',output:{summary:'New CI record'}}]});}
  return response;
 };
}
