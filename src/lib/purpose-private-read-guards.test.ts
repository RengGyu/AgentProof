import {createHash} from 'node:crypto';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as grants from './tenant-control-plane';
import * as installations from './github-installations';
import * as visibility from './github-repository-visibility';
import {createRuntimePurposeOptions} from './purpose-runtime';
import {createPurposeRepository} from './purpose-repository';
import {createGitHubPurposeRepositoryBackend} from './purpose-repository-github';
import {timeLocate,withLocateTimings} from './purpose-locate-timing';
import {assessPurpose} from './purpose-assessment';

const head='a'.repeat(40),base='b'.repeat(40),tree='c'.repeat(40);
const identity={tenantId:'tenant.fixture',repositoryFullName:'owner/repo',repositoryId:9,installationId:42};
const blob=(text:string)=>createHash('sha1').update('blob '+Buffer.byteLength(text)+'\0'+text).digest('hex');
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function fixture(delayed=false){
  const state={allowed:true};
  const files=Array.from({length:5},(_,i)=>({path:`source${i}.js`,content:`const value${i} = ${i};\n`}));
  const entries=files.map(f=>({path:f.path,sha:blob(f.content),mode:'100644',type:'blob',size:Buffer.byteLength(f.content)}));
  const input:any={title:'Keep pending work',description:'Keep pending work until completion.',taskText:'Preserve pending work.',taskSource:'task',checks:[],logs:[],url:'https://github.com/owner/repo/pull/45',repositoryPrivate:true,changedFiles:files.map(f=>({path:f.path,status:'modified'})),sourceProvenance:{origin:'github_snapshot',headSha:head,baseSha:base}};
  const grant=vi.spyOn(grants,'listTenantRepositoryGrants').mockImplementation(async()=>{if(delayed)await wait(200);return [{...identity,enabled:state.allowed,analysisEnabled:true,saveReportsEnabled:true,repositoryPrivate:true,privateAnalysisConsentVersion:'2026-09-24.v1'}] as any;});
  const status=vi.spyOn(installations,'listTenantGitHubInstallationStatuses').mockImplementation(async()=>{if(delayed)await wait(300);return [{installationId:42,status:'active'}];});
  const visible=vi.spyOn(visibility,'readGitHubRepositoryPrivate').mockImplementation(async()=>{if(delayed)await wait(50);return true;});
  const transport=vi.fn(async(url:any)=>{
    const u=String(url);
    if(u.endsWith('/repos/owner/repo'))return Response.json({id:9,full_name:'owner/repo',private:true});
    if(u.includes('/git/commits/'))return Response.json({sha:u.split('/').at(-1),tree:{sha:tree}});
    if(u.includes('/git/trees/'))return Response.json({sha:tree,truncated:false,tree:entries});
    if(u.includes('/git/blobs/')){const f=files.find(f=>blob(f.content)===u.split('/').at(-1));if(f)return new Response(f.content);}
    throw Error('Unexpected network endpoint');
  });
  vi.stubGlobal('fetch',transport);
  const runtime=createRuntimePurposeOptions(input,{env:{DEEPSEEK_API_KEY:'KEY_CANARY'},token:'TOKEN_CANARY',privateGrant:identity,readCurrentInput:async()=>input});
  const open=(backend=runtime.localization!.backend,authorize=runtime.authorizePrivate!)=>createPurposeRepository(input,backend,{signal:new AbortController().signal,authorizePrivate:authorize});
  const inspect=(targetId:string)=>({kind:'inspect' as const,view:'source' as const,targetId,clauseId:'c',startLine:1,endLine:1,cursor:0,literal:''});
  return {state,input,grant,status,visible,transport,runtime,open,inspect,reset(){grant.mockClear();status.mockClear();visible.mockClear();transport.mockClear();}};
}
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('No external network');})));
afterEach(async()=>{if(vi.isFakeTimers())await vi.runAllTimersAsync();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

it('uses one current authorization before the first provider entry rather than an adjacent setup duplicate',async()=>{
  const c=fixture(),authorize=vi.fn(async()=>true),provider=vi.fn(async()=>{throw Error('stop_before_external_call');});
  await expect(assessPurpose({...c.input,title:'Keep pending work'},{} as any,{mode:'shadow',provider,authorizePrivate:authorize})).rejects.toThrow('stop_before_external_call');
  expect(authorize).toHaveBeenCalledOnce();expect(provider).toHaveBeenCalledOnce();expect(c.transport).not.toHaveBeenCalled();
});

it('assessment invoke still rejects a proposal when authority is revoked during the provider call',async()=>{
  const c=fixture(),provider=vi.fn(async()=>{c.state.allowed=false;return {goals:[],ambiguities:[]};});
  await expect(assessPurpose(c.input,{} as any,{mode:'shadow',provider,authorizePrivate:c.runtime.authorizePrivate})).rejects.toThrow('purpose_private_consent_required');
  expect(provider).toHaveBeenCalledOnce();
});

it('runtime DeepSeek provider leaves the adjacent pre/post checks to the assessment invoke and calls no budget RPC',async()=>{
  vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_URL','https://budget.fixture');vi.stubEnv('AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY','SERVICE_CANARY');
  const c=fixture(),order:string[]=[];c.visible.mockImplementation(async()=>{order.push('authorize');return true;});
  const config={timeZone:'UTC',krwPerUsd:'1500',validUntil:'2099-01-01T00:00:00Z',prices:{'deepseek/deepseek-flash':{inputUsdPerMillion:'0.3',outputUsdPerMillion:'1.2',callReserveKrw:'1000',source:'https://api-docs.deepseek.com/quick_start/pricing/'}}};
  c.transport.mockImplementation(async(url:any,init?:any)=>{
    if(String(url)==='https://api.deepseek.com/responses'){order.push('transport');return Response.json({model:'deepseek-flash',status:'completed',usage:{input_tokens:100,output_tokens:20,total_tokens:120},output:[{type:'message',content:[{type:'output_text',text:'{"goals":[],"ambiguities":[]}'}]}]});}
    const b=JSON.parse(String(init?.body));if(b.p_action!=='check')order.push(b.p_action);return Response.json({allowed:true,...(b.p_action==='config'?{config}:{})});
  });
  const {withPaidAnalysis}=await import('./paid-budget');
  expect(await withPaidAnalysis('runtime',()=>c.runtime.provider!({stage:'purpose',flow:'explore_final_v1',sources:{spans:[{id:'gpsp_one',text:'SOURCE_CANARY'}]}} as any,new AbortController().signal))).toEqual({goals:[],ambiguities:[]});
  expect(order,JSON.stringify(order)).toEqual(['transport']);
});

it.each([false,true])('still denies the first entry when revoked, including frozenSpec=%s',async frozen=>{
  const c=fixture(),authorize=vi.fn(async()=>false),provider=vi.fn();
  await expect(assessPurpose(c.input,{} as any,{mode:'shadow',provider,authorizePrivate:authorize,...(frozen?{frozenSpec:{} as any}:{})})).rejects.toThrow('purpose_private_consent_required');
  expect(provider).not.toHaveBeenCalled();expect(c.transport).not.toHaveBeenCalled();
});

it('uses the two guarded manifests without adjacent initialization or caller duplicates',async()=>{
  const c=fixture(),r=await c.open();expect(c.visible).toHaveBeenCalledTimes(4);r.dispose();
});

it('still denies before the first manifest request when authority was already revoked',async()=>{
  const c=fixture();c.state.allowed=false;
  await expect(c.open()).rejects.toThrow('purpose_private_consent_required');expect(c.transport).not.toHaveBeenCalled();
});

it('denies revocation during manifest acquisition before exposing repository entries',async()=>{
  const c=fixture(),original=c.transport.getMockImplementation()!;
  c.transport.mockImplementation(async u=>{const response=await original(u);if(String(u).includes('/git/trees/'))c.state.allowed=false;return response;});
  await expect(c.open()).rejects.toThrow('purpose_private_consent_required');expect(c.transport.mock.calls.some(([u])=>String(u).includes('/git/blobs/'))).toBe(false);
});

it('delegates fresh private blob guards only to the matching factory backend, while keeping both sides of I/O',async()=>{
  const c=fixture(),r=await c.open();c.reset();const target=r.initial().changed.find(x=>x.side==='head')!;
  expect((await r.execute(c.inspect(target.id))).evidence[0].revision).toBe(head);
  expect(c.visible).toHaveBeenCalledTimes(2);expect(c.grant).toHaveBeenCalledTimes(4);expect(c.status).toHaveBeenCalledTimes(4);
  expect(c.transport.mock.calls.filter(([u])=>String(u).includes('/git/blobs/'))).toHaveLength(1);r.dispose();
});

it('keeps repository guards for wrapped backends and a different authorization owner',async()=>{
  const c=fixture();let otherAllowed=true;const other=async(s?:AbortSignal)=>otherAllowed&&await c.runtime.authorizePrivate!(s);
  const r=await c.open({...c.runtime.localization!.backend},other);c.reset();const target=r.initial().changed.find(x=>x.side==='head')!;
  await r.execute(c.inspect(target.id));expect(c.visible).toHaveBeenCalledTimes(4);
  otherAllowed=false;await expect(r.execute(c.inspect(target.id))).rejects.toThrow('purpose_private_consent_required');r.dispose();
});

it('does not delegate an unmatched authorization owner even on the original registered backend',async()=>{
  const c=fixture();let otherAllowed=true;const other=async(s?:AbortSignal)=>otherAllowed&&await c.runtime.authorizePrivate!(s);
  const r=await c.open(c.runtime.localization!.backend,other);c.reset();otherAllowed=false;
  const target=r.initial().changed.find(x=>x.side==='head')!;
  await expect(r.execute(c.inspect(target.id))).rejects.toThrow('purpose_private_consent_required');expect(c.transport).not.toHaveBeenCalled();r.dispose();
});

it('does not trust a backend method replaced after repository construction',async()=>{
  const c=fixture(),r=await c.open(),target=r.initial().changed.find(x=>x.side==='head')!;
  const content='const value0 = 0;\n',replacement=vi.fn(async()=>({path:target.path,revision:head,blobSha:blob(content),content,complete:true,bytesRead:Buffer.byteLength(content)}));
  c.runtime.localization!.backend.readBlob=replacement;c.state.allowed=false;
  await expect(r.execute(c.inspect(target.id))).rejects.toThrow('purpose_private_consent_required');expect(replacement).not.toHaveBeenCalled();r.dispose();
});

it('binds the original private authorizer rather than a mutable options property',async()=>{
  const content='one\n',access={repositoryId:9,authorize:async()=>false},remote=vi.fn(async()=>new Response(content));
  const backend=createGitHubPurposeRepositoryBackend({url:'https://github.com/owner/repo/pull/45',repositoryPrivate:true,sourceProvenance:{headSha:head,baseSha:base}} as any,{token:'TOKEN_CANARY',fetchFn:remote,privateAccess:access});
  access.authorize=async()=>true;
  await expect(backend.readBlob({path:'source.js',blobSha:blob(content),mode:'100644',size:content.length},head,1,new AbortController().signal)).rejects.toThrow('purpose_private_consent_required');expect(remote).not.toHaveBeenCalled();
});

it('preserves cache-hit authorization and refuses cached private content after revocation',async()=>{
  const c=fixture(),r=await c.open(),target=r.initial().changed.find(x=>x.side==='head')!;
  await r.execute(c.inspect(target.id));c.reset();await r.execute(c.inspect(target.id));expect(c.visible).toHaveBeenCalledTimes(2);expect(c.transport).not.toHaveBeenCalled();
  c.state.allowed=false;await expect(r.execute(c.inspect(target.id))).rejects.toThrow('purpose_private_consent_required');expect(c.transport).not.toHaveBeenCalled();r.dispose();
});

it.each([200,403])('denies revocation during a blob fetch with HTTP%s before returning content or a null result',async status=>{
  const c=fixture(),r=await c.open(),target=r.initial().changed.find(x=>x.side==='head')!;const original=c.transport.getMockImplementation()!;
  c.transport.mockImplementation(async u=>{const response=await original(u);if(String(u).includes('/git/blobs/')){c.state.allowed=false;return status===403?new Response(null,{status:403}):response;}return response;});
  await expect(r.execute(c.inspect(target.id))).rejects.toThrow('purpose_private_consent_required');r.dispose();
});

it('checks authority after asynchronous body cleanup, including direct backend reads',async()=>{
  let current=true;const content='one\ntwo\n',entry={path:'large.js',blobSha:blob(content),mode:'100644' as const,size:300000};
  const remote=vi.fn(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(content));},async cancel(){await Promise.resolve();current=false;}})));
  const backend=createGitHubPurposeRepositoryBackend({url:'https://github.com/owner/repo/pull/45',repositoryPrivate:true,sourceProvenance:{headSha:head,baseSha:base}} as any,{token:'TOKEN_CANARY',fetchFn:remote,privateAccess:{repositoryId:9,authorize:async()=>current}});
  await expect(backend.readBlob(entry,head,1,new AbortController().signal)).rejects.toThrow('purpose_private_consent_required');expect(remote).toHaveBeenCalledOnce();
});

it('does not accept a backend bound to another repository or revision',async()=>{
  const c=fixture();const other={...c.input,url:'https://github.com/other/repo/pull/45'};
  await expect(createPurposeRepository(other,c.runtime.localization!.backend,{signal:new AbortController().signal,authorizePrivate:c.runtime.authorizePrivate})).rejects.toThrow('localization_manifest_invalid');
  const wrongRevision={...c.input,sourceProvenance:{...c.input.sourceProvenance,headSha:'d'.repeat(40)}};
  await expect(createPurposeRepository(wrongRevision,c.runtime.localization!.backend,{signal:new AbortController().signal,authorizePrivate:c.runtime.authorizePrivate})).rejects.toThrow('localization_manifest_invalid');
  expect(c.transport.mock.calls.some(([u])=>String(u).includes('/git/blobs/'))).toBe(false);
});

it('reduces the same33-check mock topology to23 checks/115 external lookups/13800ms without a provider call',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});const c=fixture(true);
  const opening=c.open();await vi.runAllTimersAsync();const r=await opening;c.reset();
  const sink=vi.spyOn(console,'info').mockImplementation(()=>{});
  const run=withLocateTimings({pullRequestNumber:45},new AbortController().signal,async()=>{
    // Same13 non-source checks as two completed rounds plus a third pre-response round.
    for(let i=0;i<13;i++)expect(await c.runtime.authorizePrivate!()).toBe(true);
    for(const target of r.initial().changed.filter(x=>x.side==='head'))await timeLocate('source_read',()=>r.execute(c.inspect(target.id)));
  });
  await vi.runAllTimersAsync();await run;
  const event=JSON.parse(String(sink.mock.calls.find(c=>c[0]==='agentproof_locate_timing')![1]));
  expect(event.totalMs).toBe(13800);expect(event.operations).toEqual(expect.arrayContaining([expect.objectContaining({operation:'authorization',completed:23}),expect.objectContaining({operation:'private_grant',completed:46}),expect.objectContaining({operation:'source_read',completed:5})]));
  expect(c.grant.mock.calls.length+c.status.mock.calls.length+c.visible.mock.calls.length).toBe(115);
  expect(c.grant).toHaveBeenCalledTimes(46);expect(c.status).toHaveBeenCalledTimes(46);expect(c.visible).toHaveBeenCalledTimes(23);
  expect(c.transport.mock.calls.filter(([u])=>String(u).includes('/git/blobs/'))).toHaveLength(5);expect(c.transport.mock.calls.some(([u])=>String(u).includes('deepseek'))).toBe(false);
  expect(JSON.stringify(event)).not.toMatch(/CANARY|owner\/repo|const value/);r.dispose();
});
