import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import * as grants from './tenant-control-plane';
import * as installations from './github-installations';
import * as visibility from './github-repository-visibility';
import {isPrivateAnalysisGrantCurrent} from './github-analysis-access';
import {createRuntimePurposeOptions} from './purpose-runtime';
import {withLocateTimings} from './purpose-locate-timing';

const identity={tenantId:'tenant.fixture',repositoryFullName:'owner/repo',repositoryId:9,installationId:42};
const allowed={...identity,enabled:true,analysisEnabled:true,saveReportsEnabled:true,repositoryPrivate:true,privateAnalysisConsentVersion:'2026-09-24.v1'};
const active={installationId:42,status:'active' as const};
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

function reads(options:{grantMs?:number;statusMs?:number;grantRows?:unknown[];statusRows?:unknown[];fail?:'grant'|'status'|'both'}={}) {
  const grant=vi.spyOn(grants,'listTenantRepositoryGrants').mockImplementation(async()=>{
    if(options.grantMs)await wait(options.grantMs);
    if(options.fail==='grant'||options.fail==='both')throw new Error('PRIVATE_FAILURE_CANARY');
    return structuredClone(options.grantRows??[allowed]) as any;
  });
  const status=vi.spyOn(installations,'listTenantGitHubInstallationStatuses').mockImplementation(async()=>{
    if(options.statusMs)await wait(options.statusMs);
    if(options.fail==='status'||options.fail==='both')throw new Error('PRIVATE_FAILURE_CANARY');
    return structuredClone(options.statusRows??[active]) as any;
  });
  return {grant,status};
}
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(()=>{throw Error('No network allowed');})));
afterEach(async()=>{
  if(vi.isFakeTimers())await vi.runAllTimersAsync();
  vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();
});

it.each([{grantMs:200,statusMs:300},{grantMs:300,statusMs:200}])('waits for both independent authorization reads in $statusMs/$grantMs ms rather than their sum',async options=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});const io=reads(options);
  let settled=false;const pending=isPrivateAnalysisGrantCurrent(identity).then(value=>{settled=true;return value;});
  await vi.advanceTimersByTimeAsync(299);expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);expect(settled).toBe(true);expect(await pending).toBe(true);
  expect(io.grant).toHaveBeenCalledExactlyOnceWith({tenantId:identity.tenantId},process.env);
  expect(io.status).toHaveBeenCalledExactlyOnceWith({tenantId:identity.tenantId,installationIds:[42]},process.env);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['grant','status','both'] as const)('denies when %s read fails without propagating private error text',async fail=>{
  reads({fail});expect(await isPrivateAnalysisGrantCurrent(identity)).toBe(false);expect(fetch).not.toHaveBeenCalled();
});

it.each([
  {name:'disabled',patch:{enabled:false}},
  {name:'analysis off',patch:{analysisEnabled:false}},
  {name:'save off',patch:{saveReportsEnabled:false}},
  {name:'consent revoked',patch:{privateAnalysisConsentVersion:null}},
  {name:'no private grant',patch:{repositoryPrivate:false}},
  {name:'wrong tenant',patch:{tenantId:'other'}},
  {name:'wrong installation',patch:{installationId:43}},
  {name:'wrong repo',patch:{repositoryId:10}},
  {name:'wrong full name',patch:{repositoryFullName:'owner/other'}}
])('preserves $name denial after parallel reads',async({patch})=>{
  reads({grantRows:[{...allowed,...patch}]});expect(await isPrivateAnalysisGrantCurrent({...identity,requireSave:true})).toBe(false);
});

it.each([{grantRows:[]},{grantRows:[{...allowed},{...allowed}]}])('rejects absent or ambiguous grants',async({grantRows})=>{
  reads({grantRows});expect(await isPrivateAnalysisGrantCurrent(identity)).toBe(false);
});

it.each([{statusRows:[]},{statusRows:[{...active,status:'suspended'}]},{statusRows:[{...active,status:'deleted'}]},{statusRows:[{...active,installationId:43}]}])('preserves inactive or mismatched installation denial',async({statusRows})=>{
  reads({statusRows});expect(await isPrivateAnalysisGrantCurrent(identity)).toBe(false);
});

it('does not reuse a previous grant or status across authorization boundaries',async()=>{
  const state={grantRows:[{...allowed}],statusRows:[{...active}]};const io=reads(state);
  expect(await isPrivateAnalysisGrantCurrent(identity)).toBe(true);
  state.grantRows[0].analysisEnabled=false;expect(await isPrivateAnalysisGrantCurrent(identity)).toBe(false);
  state.grantRows[0].analysisEnabled=true;state.statusRows=[];expect(await isPrivateAnalysisGrantCurrent(identity)).toBe(false);
  expect(io.grant).toHaveBeenCalledTimes(3);expect(io.status).toHaveBeenCalledTimes(3);
});

it('denies a revocation observed while the independent reads are still pending',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});const state={grantMs:300,statusMs:200,grantRows:[{...allowed}]};reads(state);
  const pending=isPrivateAnalysisGrantCurrent(identity);
  await vi.advanceTimersByTimeAsync(200);state.grantRows[0].privateAnalysisConsentVersion='revoked';
  await vi.advanceTimersByTimeAsync(100);expect(await pending).toBe(false);
});

it('denies an installation revoked while its status read is still pending',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});const state={grantMs:200,statusMs:300,statusRows:[{...active}]};reads(state);
  const pending=isPrivateAnalysisGrantCurrent(identity);
  await vi.advanceTimersByTimeAsync(200);state.statusRows=[];
  await vi.advanceTimersByTimeAsync(100);expect(await pending).toBe(false);
});

it('keeps runtime visibility and post-visibility grant rechecks, including parent abort',async()=>{
  reads();const source=vi.spyOn(visibility,'readGitHubRepositoryPrivate').mockImplementation(async()=>{
    vi.mocked(grants.listTenantRepositoryGrants).mockResolvedValue([{...allowed,analysisEnabled:false}] as any);return true;
  });
  const runtime=createRuntimePurposeOptions({repositoryPrivate:true,url:'https://github.com/owner/repo/pull/45'} as any,{env:{DEEPSEEK_API_KEY:'KEY_CANARY'},token:'TOKEN_CANARY',privateGrant:identity,readCurrentInput:async()=>null});
  expect(await runtime.authorizePrivate!()).toBe(false);expect(source).toHaveBeenCalledOnce();expect(grants.listTenantRepositoryGrants).toHaveBeenCalledTimes(2);
  const controller=new AbortController();controller.abort();await expect(runtime.authorizePrivate!(controller.signal)).rejects.toThrow();expect(source).toHaveBeenCalledOnce();expect(fetch).not.toHaveBeenCalled();
});

it('measures33 unchanged runtime authorization boundaries with66 fresh grant checks, first grant overlapping visibility, in19800ms',async()=>{
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','performance']});const io=reads({grantMs:200,statusMs:300});
  const source=vi.spyOn(visibility,'readGitHubRepositoryPrivate').mockImplementation(async()=>{await wait(50);return true;});
  const sink=vi.spyOn(console,'info').mockImplementation(()=>{});
  const runtime=createRuntimePurposeOptions({repositoryPrivate:true,url:'https://github.com/owner/repo/pull/45'} as any,{env:{DEEPSEEK_API_KEY:'KEY_CANARY'},token:'TOKEN_CANARY',privateGrant:identity,readCurrentInput:async()=>null});
  const run=withLocateTimings({pullRequestNumber:45},new AbortController().signal,async()=>{
    for(let i=0;i<33;i++)expect(await runtime.authorizePrivate!()).toBe(true);
  });
  await vi.runAllTimersAsync();await run;
  const event=JSON.parse(String(sink.mock.calls.find(c=>c[0]==='agentproof_locate_timing')![1]));
  expect(event.totalMs).toBe(19800);expect(event.operations).toEqual(expect.arrayContaining([
    expect.objectContaining({operation:'authorization',completed:33,inclusiveMs:19800}),
    expect.objectContaining({operation:'private_grant',completed:66,inclusiveMs:19800}),
    expect.objectContaining({operation:'repository_visibility',completed:33,inclusiveMs:1650})
  ]));
  expect(io.grant).toHaveBeenCalledTimes(66);expect(io.status).toHaveBeenCalledTimes(66);expect(source).toHaveBeenCalledTimes(33);
  expect(JSON.stringify(event)).not.toMatch(/CANARY|owner\/repo|tenant.fixture/);expect(fetch).not.toHaveBeenCalled();
});
