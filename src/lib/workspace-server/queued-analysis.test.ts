import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {POST,GET} from './queued-analysis';
import {GET as reportGET} from './reports';
import {POST as webPOST} from '@/app/api/dashboard/analyze/route';
import {POST as mobilePOST} from '@/app/api/mobile/dashboard-analyze/route';
import {runNextAnalysisJob} from '@/lib/analysis-worker';
import {createTenantAuthSessionForMember,createTenantAuthSessionForMobileMember,clearTenantAuthSessionsForTests} from '@/lib/tenant-auth';
import {createTenantRepositoryGrant,clearTenantRepositoryGrantsForTests,PRIVATE_ANALYSIS_CONSENT_VERSION} from '@/lib/tenant-control-plane';
import {upsertTenantGitHubInstallation,clearTenantGitHubInstallationsForTests} from '@/lib/github-installations';
import {purposeRuntimeFetch} from '@/lib/test-support/purpose-runtime-fixture';

const uiHooks=vi.hoisted(()=>({slots:[] as any[],index:0,effects:[] as Array<()=>void>}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState(initial:any){const i=uiHooks.index++;if(!(i in uiHooks.slots))uiHooks.slots[i]=typeof initial==='function'?initial():initial;return[uiHooks.slots[i],(value:any)=>{uiHooks.slots[i]=typeof value==='function'?value(uiHooks.slots[i]):value;}];},
 useRef(initial:any){const i=uiHooks.index++;return uiHooks.slots[i]??={current:initial};},
 useEffect(work:()=>any,deps:any[]){const i=uiHooks.index++,old=uiHooks.slots[i];if(!old||deps.some((v,j)=>v!==old.deps[j]))uiHooks.effects.push(()=>{old?.cleanup?.();uiHooks.slots[i]={deps,cleanup:work()};});}
}));
import {RepositoryPullRequestWorkspace} from '@/components/RepositoryCommitBrowser';

const tenantId='tenant_workspace' ,url='https://github.com/owner/repo/pull/45',head='a'.repeat(40),base='b'.repeat(40);
const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();
let installationActive:boolean,grantTenant:string;
let cookie:string,mobile:string,jobs:any[],saved:any[],requests:any[],budget:any[],calls:string[],saveOn:boolean,grantOn:boolean,consent:boolean,privateRepo:boolean,locale:'en'|'ko',failUsage:boolean,failQuote:boolean,disableOnFinal:boolean;
const clone=(x:any)=>JSON.parse(JSON.stringify(x));
const response=(x:any,status=200)=>Response.json(clone(x),{status});
function request(source:'web'|'mobile'='web',key=randomUUID(),extra:Record<string,string>={}){return new Request('https://app.example/api/'+(source==='web'?'dashboard/analyze':'mobile/dashboard-analyze'),{method:'POST',headers:{'content-type':'application/json','x-agentproof-analysis-key':key,...(source==='web'?{origin:'https://app.example',cookie}:{Authorization:`Bearer apm_${mobile}`}),...extra},body:JSON.stringify({prUrl:url})});}
function statusRequest(job:any,source:'web'|'mobile'='web'){return new Request(`https://app.example/api/dashboard/analyze?jobId=${job.id}&repositoryId=9&revision=${job.revision}`,{headers:source==='web'?{cookie}:{Authorization:`Bearer apm_${mobile}`}});}
async function worker(){return runNextAnalysisJob({requestUrl:'https://app.example/api/cron/analysis-jobs/run',now:new Date(Date.now()+60_000)});}
function eq(row:any,q:URLSearchParams){return [...q].every(([k,v])=>['select','limit','offset','order','or'].includes(k)||v.startsWith('eq.')?['select','limit','offset','order','or'].includes(k)||String(row[k])===v.slice(3):v.startsWith('in.')?v.slice(4,-1).split(',').includes(String(row[k])):v.startsWith('lte.')?row[k]<=v.slice(4):v.startsWith('lt.')?row[k]<v.slice(3):true);}

beforeEach(async()=>{
 uiHooks.slots=[];uiHooks.index=0;uiHooks.effects=[];installationActive=true;grantTenant=tenantId;jobs=[];saved=[];requests=[];budget=[];calls=[];saveOn=true;grantOn=true;consent=true;privateRepo=false;locale='ko';failUsage=false;failQuote=false;disableOnFinal=false;
 for(const n of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','AGENTPROOF_CONTROL_PLANE_SUPABASE_URL','AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY','AGENTPROOF_ONBOARDING_SUPABASE_URL','AGENTPROOF_ONBOARDING_SUPABASE_SERVICE_ROLE_KEY','AI_GATEWAY_API_KEY','GEMINI_API_KEY','AGENTPROOF_AUDIT_SUPABASE_URL','AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY'])vi.stubEnv(n,'');
 vi.stubEnv('AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY','true');vi.stubEnv('AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY','true');vi.stubEnv('AGENTPROOF_GITHUB_INSTALLATIONS_ALLOW_MEMORY','true');vi.stubEnv('AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED','true');
 vi.stubEnv('AGENTPROOF_TENANT_ACCOUNTS',JSON.stringify([{tenantId,name:'Fixture',status:'active',plan:'beta',members:[{memberId:'github:123',role:'owner',status:'active'}]}]));
 await createTenantRepositoryGrant({tenantId,installationId:42,repositoryId:9,repositoryFullName:'owner/repo',enabled:true,analysisEnabled:true,saveReportsEnabled:true,commentEnabled:false,repositoryPrivate:false,reportLanguage:'ko'});
 await upsertTenantGitHubInstallation({tenantId,installationId:42,status:'active'});
 cookie=(await createTenantAuthSessionForMember({tenantId,memberId:'github:123'})).sessionCookie;
 mobile=(await createTenantAuthSessionForMobileMember({tenantId,memberId:'github:123'})).sessionCookie.split(';')[0].split('=')[1];
 const webHash=createHash('sha256').update(decodeURIComponent(cookie.split(';')[0].split('=')[1])).digest('hex'),mobileHash=createHash('sha256').update(mobile).digest('hex');
 for(const [n,v] of Object.entries({AGENTPROOF_CONTROL_PLANE_SUPABASE_URL:'https://budget.fixture',AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY:'fixture-budget',AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED:'true',AGENTPROOF_ANALYSIS_JOBS_SUPABASE_URL:'https://jobs.fixture',AGENTPROOF_ANALYSIS_JOBS_SUPABASE_SERVICE_ROLE_KEY:'fixture-jobs',AGENTPROOF_REPORTS_SUPABASE_URL:'https://reports.fixture',AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY:'fixture-reports',AGENTPROOF_REPORT_SIGNING_SECRET:'fixture-signing-secret-that-is-long-enough',GITHUB_APP_ID:'42',GITHUB_WEBHOOK_SECRET:'fixture-webhook',GITHUB_PRIVATE_KEY:privateKey,AGENTPROOF_GENERAL_PR_OBSERVATION_MODE:'advisory',OPENAI_API_KEY:'fixture-model',DEEPSEEK_API_KEY:'fixture-deepseek',AGENTPROOF_GITHUB_APP_SAVE_REPORTS:'false',AGENTPROOF_GITHUB_APP_COMMENT_ENABLED:'false',VERCEL:'0'}))vi.stubEnv(n,v);
 const remote:typeof fetch=async(target,init)=>{
  const u=new URL(String(target)),p=JSON.parse(String(init?.body??'{}'));calls.push(u.origin+u.pathname);
  if(u.origin==='https://jobs.fixture'){
   if(u.pathname.endsWith('/agentproof_enqueue_workspace_analysis_job')){
    const r=p.job_payload,old=jobs.find(j=>j.canonical_key_hash===r.canonical_key_hash&&!j.is_historical);
    if(!old)jobs.push(r);else if(old.idempotency_key_hash!==r.idempotency_key_hash&&['completed','failed_terminal'].includes(old.status))Object.assign(old,r,{id:old.id,desired_revision:old.desired_revision+1});
    return response([old??r]);
   }
   const row=jobs.find(j=>j.id===p.job_id);
   if(u.pathname.endsWith('/agentproof_fence_analysis_job_revision'))return response(row&&row.claim_generation===p.claim_token?[row]:[]);
   if(u.pathname.endsWith('/agentproof_seal_analysis_job_revision')){if(row)Object.assign(row,{sealed_revision:row.running_revision,sealed_event:row.event,sealed_action:row.action,sealed_delivery_id:row.delivery_id,sealed_save_report:row.save_report,sealed_comment:row.comment,sealed_slack_summary:row.slack_summary,publication_sealed_at:p.seal_time});return response(row?[row]:[]);}
   if(u.pathname.endsWith('/agentproof_complete_analysis_job')){if(row)Object.assign(row,{status:'completed',result_summary:p.result_payload,updated_at:p.finish_time,completed_at:p.finish_time,locked_at:null,claim_generation:null,running_revision:null});return response(row?[row]:[]);}
   if(u.pathname.endsWith('/agentproof_fail_analysis_job')){if(row)Object.assign(row,{status:p.retryable_failure?'failed_retryable':'failed_terminal',error_code:p.failure_code,updated_at:p.fail_time});return response(row?[row]:[]);}
   if(u.pathname.endsWith('/agentproof_analysis_jobs')){
    const rows=jobs.filter(j=>eq(j,u.searchParams));
    if(init?.method==='PATCH')for(const j of rows)Object.assign(j,p);
    return response(rows.slice(0,Number(u.searchParams.get('limit')??50)));
   }
   throw Error('Unexpected mocked job operation');
  }
  if(u.origin==='https://reports.fixture'){
   if(u.pathname.endsWith('/agentproof_store_tenant_report')){const row=Object.fromEntries(Object.entries(p).map(([k,v])=>[k.slice(2),v]));saved.unshift({...row,stale_at:null});return response([saved[0]]);}
   if(u.pathname.endsWith('/agentproof_saved_reports'))return response(saved.filter(r=>eq(r,u.searchParams)));
  }
  if(u.origin==='https://budget.fixture'){
   if(u.pathname.includes('tenant_deletion_state'))return new Response(null,{headers:{'content-range':'*/0'}});
   if(u.pathname.includes('tenant_auth_sessions')){const h=u.searchParams.get('token_hash')?.slice(3);return response([webHash,mobileHash].includes(h??'')?[{id:'fixture-session-id-long',token_hash:h,tenant_id:tenantId,member_id:'github:123',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),auth_source:h===mobileHash?'mobile':'github',revoked_at:null}]:[]);}
   if(u.pathname.includes('tenant_repository_grants'))return response([{tenant_id:grantTenant,installation_id:42,repository_id:9,repository_full_name:'owner/repo',enabled:grantOn,analysis_enabled:grantOn,save_reports_enabled:saveOn,comment_enabled:false,repository_is_private:privateRepo,private_analysis_consent_version:privateRepo&&consent?PRIVATE_ANALYSIS_CONSENT_VERSION:null,report_language:locale,created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]);
   if(u.pathname.includes('tenant_members'))return response([{tenant_id:tenantId,member_id:'github:123',role:'owner',status:'active'}]);
   if(u.pathname.includes('agentproof_tenants'))return response([{tenant_id:tenantId,name:'Fixture',status:'active',plan:'beta'}]);
   if(u.pathname.includes('github_installations'))return response([{tenant_id:tenantId,installation_id:42,status:installationActive?'active':'suspended',created_at:new Date().toISOString(),updated_at:new Date().toISOString()}]);
   return response([]);
  }
  if(u.pathname.endsWith('/access_tokens'))return response({token:'fixture-installation-token'});
  if(u.pathname.endsWith('/pulls/45'))return response({number:45,url:'https://api.github.com/repos/owner/repo/pulls/45',title:'Retain pending work',body:'Retain pending work',html_url:url,base:{sha:base,ref:'main',repo:{private:privateRepo}},head:{sha:head,ref:'work'}});
  if(u.pathname.endsWith('/check-runs'))return response({check_runs:[],total_count:0});
  if(u.pathname.endsWith('/status'))return response({statuses:[]});
  throw Error('Unexpected mocked network operation');
 };
 vi.stubGlobal('fetch',async(t:Parameters<typeof fetch>[0],i?:RequestInit)=>{calls.push(String(t));return purposeRuntimeFetch(remote,'owner/repo','queue.py',{privateRepository:privateRepo,failure:failQuote?'quote':failUsage?'usage':undefined,onRequest:(b,count)=>{requests.push({b,count});if(!count&&JSON.parse(b.input[1].content).stage==='assess'&&disableOnFinal)saveOn=false;},onBudget:p=>budget.push(p)})(t,i);});
});
afterEach(()=>{uiHooks.slots.forEach(s=>s?.cleanup?.());vi.unstubAllGlobals();vi.unstubAllEnvs();clearTenantAuthSessionsForTests();clearTenantRepositoryGrantsForTests();clearTenantGitHubInstallationsForTests();});

it.each(['web','mobile','public'] as const)('accepts %s without a model call, survives request disconnect, then worker saves and authenticated GET reopens the signed ko report',async(source)=>{
 const timingLog=vi.spyOn(console,'info').mockImplementation(()=>{});
 privateRepo=source!=='public';const lane=source==='public'?'web':source;const controller=new AbortController(),req=new Request(request(lane),{signal:controller.signal});
 const accepted=await(lane==='web'?webPOST(req):mobilePOST(req));const body=await accepted.json();expect(accepted.status,JSON.stringify({body,calls,requests,jobs:jobs.length})).toBe(202);expect(body.report).toBeUndefined();expect(saved).toHaveLength(0);expect(requests).toHaveLength(0);expect(jobs).toHaveLength(1);
 controller.abort();locale='en'; // persisted job locale is frozen at acceptance
 const result=await worker();expect(result.status,JSON.stringify(result)).toBe('completed');expect(saved).toHaveLength(1);
 const status=await GET(statusRequest(body.job,lane),lane),state=await status.json();expect(status.status,JSON.stringify(state)).toBe(200);expect(state.job.status).toBe('saved');
 const reopened=await reportGET(new Request('https://app.example/api/dashboard/reports?id='+state.job.reportId,{headers:lane==='web'?{cookie}:{Authorization:`Bearer apm_${mobile}`}}),lane);const detail=await reopened.json();
 expect(detail.id).toBe(state.job.reportId);expect(detail.report.purposeReview.locale).toBe('ko');expect(detail.headSha).toBe(head);expect(detail.report.purposeReview.clauses[0].changeDescriptions).toHaveLength(1);
 expect(requests.every(r=>!r.count&&r.b.model==='deepseek-flash'&&r.b.reasoning.effort==='high')).toBe(true);expect(requests.filter(r=>!r.count).map(r=>JSON.parse(r.b.input[1].content).stage)).toEqual(['purpose','locate','locate','assess']);
 const timings=timingLog.mock.calls.filter(c=>c[0]==='agentproof_locate_timing').map(c=>JSON.parse(String(c[1])));expect(timings).toHaveLength(1);expect(timings[0]).toMatchObject({requestCorrelation:body.job.id,pullRequestNumber:45,outcome:'success'});expect(timings[0].operations).toEqual(expect.arrayContaining([expect.objectContaining({round:0,operation:'provider_transport',completed:1}),expect.objectContaining({round:0,operation:'source_read'}),expect.objectContaining({round:1,operation:'provider_parse',completed:1})]));if(privateRepo)expect(timings[0].operations.some((m:any)=>m.operation==='private_grant')).toBe(true);expect(JSON.stringify(timings)).not.toMatch(/fixture-installation-token|fixture-deepseek|owner\/repo|queue.py|source_text/);timingLog.mockRestore();
 expect(budget).toHaveLength(0);
 expect(JSON.stringify(state)).not.toMatch(/fixture-model|fixture-installation|error_summary|source_text|pending =/);
});
it.each(['save','grant','consent','installation','tenant','control'] as const)('rejects %s OFF before queue/model, and rechecks it after acceptance',async(kind)=>{
 privateRepo=true;if(kind==='save')saveOn=false;else if(kind==='grant')grantOn=false;else if(kind==='consent')consent=false;else if(kind==='installation')installationActive=false;else if(kind==='tenant')grantTenant='other';else vi.stubEnv('AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED','false');
 const denied=await POST(request());expect([403,409,...(kind==='control'?[503]:kind==='tenant'?[401]:[])]).toContain(denied.status);expect(jobs).toHaveLength(0);expect(requests).toHaveLength(0);
 saveOn=true;grantOn=true;consent=true;installationActive=true;grantTenant=tenantId;vi.stubEnv('AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED','true');expect((await POST(request())).status).toBe(202);
 if(kind==='save')saveOn=false;else if(kind==='grant')grantOn=false;else if(kind==='consent')consent=false;else if(kind==='installation')installationActive=false;else if(kind==='tenant')grantTenant='other';else vi.stubEnv('AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED','false');
 const result=await worker();expect(result.status).toBe('failed_terminal');expect(saved).toHaveLength(0);expect(requests.filter(r=>!r.count)).toHaveLength(0);
});
it.each(['quote','usage'] as const)('preserves %s failure as terminal rather than a saved result',async(kind)=>{
 failQuote=kind==='quote';failUsage=kind==='usage';const body=await(await POST(request())).json();const result=await worker();expect(result.status,JSON.stringify(result)).toBe('failed_terminal');expect(saved).toHaveLength(0);expect(requests.filter(r=>!r.count).length).toBe(kind==='quote'?4:1);
 const state=await(await GET(statusRequest(body.job))).json();expect(state.job.status).toBe('failed');expect(state.job.reportId).toBeUndefined();
});
it('blocks save after a public grant is changed during final generation',async()=>{
 disableOnFinal=true;expect((await POST(request())).status).toBe(202);const result=await worker();expect(result.status,JSON.stringify(result)).toBe('failed_terminal');expect(saved).toHaveLength(0);
});
it('rejects missing auth/CSRF and cross-tenant job selectors without exposing rows',async()=>{
 expect((await POST(new Request('https://app.example/api/dashboard/analyze',{method:'POST',body:'{}'}))).status).toBe(401);
 expect((await POST(request('web',randomUUID(),{origin:'https://other.example'}))).status).toBe(403);
 const body=await(await POST(request())).json();jobs[0].tenant_id='other';expect((await GET(statusRequest(body.job))).status).toBe(404);expect(requests).toHaveLength(0);
});

it('coalesces request replay and two active clicks, then permits explicit regeneration only after a terminal revision',async()=>{
 const key=randomUUID();const a=await(await POST(request('web',key))).json();
 const b=await(await POST(request('web',key))).json(),c=await(await POST(request())).json();
 expect([b.job.id,c.job.id]).toEqual([a.job.id,a.job.id]);expect([b.job.revision,c.job.revision]).toEqual([1,1]);expect(requests).toHaveLength(0);
 expect((await worker()).status).toBe('completed');const replay=await(await POST(request('web',key))).json();expect(replay.job.revision).toBe(1);
 const next=await(await POST(request())).json();expect(next.job.id).toBe(a.job.id);expect(next.job.revision).toBe(2);
 const old=await(await GET(statusRequest(a.job))).json();expect(old.job.status).toBe('superseded');expect(old.job.reportId).toBeUndefined();
});
it('does not label a completed job saved without a verified exact repository/PR/head report',async()=>{
 const body=await(await POST(request())).json();expect((await worker()).status).toBe('completed');
 saved[0].head_sha='f'.repeat(40);
 const state=await(await GET(statusRequest(body.job))).json();expect(state.job.status).toBe('unknown');expect(state.job.reportId).toBeUndefined();
});
it('fails closed before models when the new service RPC is not deployed, and keeps saved history readable during queue outage',async()=>{
 const network=fetch;vi.stubGlobal('fetch',(t:Parameters<typeof fetch>[0],i?:RequestInit)=>String(t).includes('jobs.fixture')?Promise.resolve(Response.json({code:'PGRST202'},{status:404})):network(t,i));
 expect((await POST(request())).status).toBe(503);expect(requests).toHaveLength(0);expect(saved).toHaveLength(0);
 const read=await reportGET(new Request('https://app.example/api/dashboard/reports?repositoryId=9&scope=history',{headers:{cookie}}));
 const body=await read.json();expect(read.status).toBe(200);expect(body.reports).toEqual([]);expect(body.jobsUnavailable).toBe(true);
});
it('keeps the manual RPC service-only and the active/replayed revision atomic without a new table',()=>{
 const sql=readFileSync('supabase/migrations/202610210001_workspace_analysis_queue.sql','utf8');
 expect(sql).toContain('agentproof_enqueue_workspace_analysis_job(job_payload jsonb)');
 expect(sql).toContain("agentproof_analysis_jobs.idempotency_key_hash <> excluded.idempotency_key_hash");
 expect(sql).toContain("agentproof_analysis_jobs.status in ('completed', 'failed_terminal')");
 expect(sql).toContain('revoke all on function public.agentproof_enqueue_workspace_analysis_job(jsonb) from public, anon, authenticated');
 expect(sql).toContain('grant execute on function public.agentproof_enqueue_workspace_analysis_job(jsonb) to service_role');
 expect(sql).not.toMatch(/create\s+table|drop\s+table/i);
});

it.each(['valid','wrong_id','wrong_repo','wrong_pr','wrong_head','wrong_signed_head','conflicting_source_head','wrong_revision','revoked','bad_signature'] as const)('joins the real PR45 queue/worker/signed GET/UI and rejects %s binding mismatches',async(mode)=>{
 let tree:any,legacyResponse=false;const reads:any[]=[];let completed=false;const onGeneratedReport=vi.fn(),post=vi.fn();
 const runtime={request:async(path:string,init?:RequestInit)=>{
  const headers=new Headers(init?.headers);headers.set('cookie',cookie);headers.set('origin','https://app.example');
  const req=new Request('https://app.example'+path,{...init,headers});
  if(path==='/api/dashboard/analyze'&&init?.method==='POST'){post();if(legacyResponse)return Response.json({unexpectedLegacyBody:true});return webPOST(req);}
  if(path.startsWith('/api/dashboard/analyze?')){const r=await GET(req);const b=await r.clone().json();if(completed&&mode==='wrong_revision')b.job.revision++;reads.push({kind:'job',status:r.status,body:b});return response(b,r.status);}
  if(path.startsWith('/api/dashboard/reports?')){const r=await reportGET(req);const b=await r.clone().json();if(completed&&b.report){if(mode==='wrong_id')b.id='other_report';if(mode==='wrong_repo')b.repositoryId=10;if(mode==='wrong_pr')b.pullRequestNumber=46;if(mode==='wrong_head')b.headSha='f'.repeat(40);if(mode==='wrong_signed_head')b.report.purposeReview.headSha='f'.repeat(40);if(mode==='conflicting_source_head')b.report.source.provenance={origin:'github_snapshot',headSha:'f'.repeat(40)};}reads.push({kind:'report',status:r.status,id:b.id,available:b.availability,head:b.headSha});return response(b,r.status);}
  if(path.includes('pull-requests'))return Response.json({pullRequests:[{number:45,title:'Fixture PR45',headSha:head,state:'open'}]});
  throw Error('Unexpected local UI fixture request');
 }};
 const render=()=>{uiHooks.index=0;tree=RepositoryPullRequestWorkspace({repositoryId:9,repositoryFullName:'owner/repo',runtime:runtime as any,onGeneratedReport,onOpenReport:vi.fn()});uiHooks.effects.splice(0).forEach(work=>work());};
 const nodes=(v:any):any[]=>Array.isArray(v)?v.flatMap(nodes):v?.props?[v,...nodes(v.props.children)]:[];
 const text=(v:any):string=>Array.isArray(v)?v.map(text).join(' '):v?.props?text(v.props.children):typeof v==='string'||typeof v==='number'?String(v):'';
 const settle=async()=>{for(let n=0;n<12;n++){for(let i=0;i<100;i++)await Promise.resolve();render();}};
 const click=(label:string)=>{const action=nodes(tree).find(n=>n.props['aria-label']===label);expect(action,label).toBeTruthy();action.props.onClick();render();};
 render();await settle();legacyResponse=true;click('Generate report for PR #45');await settle();
 expect(text(tree)).toContain('The result could not be matched to this PR');expect(jobs).toHaveLength(0);expect(requests).toHaveLength(0);
 legacyResponse=false;click('Generate report for PR #45');await settle();expect(jobs).toHaveLength(1);expect(text(tree)).toContain('Analysis queued');expect(text(tree)).not.toContain('The result could not be matched');expect(onGeneratedReport).not.toHaveBeenCalled();
 expect((await worker()).status).toBe('completed');completed=true;if(mode==='revoked')grantOn=false;if(mode==='bad_signature')saved[0].report.integrity.signature='0'.repeat(64);click('Check saved reports for PR #45');await settle();
 if(mode!=='valid'){expect(onGeneratedReport).not.toHaveBeenCalled();expect(text(tree)).not.toContain('Saved · analyzed head');expect(post).toHaveBeenCalledTimes(2);return;}
 expect(text(tree),JSON.stringify(reads)).toContain('Saved · analyzed head');expect(text(tree)).not.toContain('The result could not be matched');expect(onGeneratedReport).toHaveBeenCalledOnce();expect(onGeneratedReport).toHaveBeenCalledWith(expect.objectContaining({id:saved[0].id,repositoryId:9,pullRequestNumber:45,headSha:head}));expect(post).toHaveBeenCalledTimes(2);
});
