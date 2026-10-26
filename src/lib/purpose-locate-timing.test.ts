import {it,expect,vi,afterEach} from 'vitest';
import {createHash} from 'node:crypto';
import {createRuntimePurposeOptions} from './purpose-runtime';
const anchor={requestCorrelation:'12de46cf-1155-4284-b387-088f5ee38930',pullRequestNumber:45,repositoryHash:createHash('sha256').update('owner/repo').digest('hex')};
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('binds server-owned request/job and PR anchors to localization without exposing repository names',()=>{
 const input={url:'https://github.com/owner/repo/pull/45',repositoryPrivate:false} as any;
 const options=createRuntimePurposeOptions(input,{env:{DEEPSEEK_API_KEY:'KEY_CANARY'},requestCorrelation:anchor.requestCorrelation,readCurrentInput:async()=>input} as any);
 expect((options.localization as any).timingAnchor).toEqual(anchor);
});

import {withLocateTimings,setLocateTimingRound,timeLocate,timeLocateSync} from './purpose-locate-timing';
import {purposeDeadline} from './purpose-timeout';
import * as access from './github-analysis-access';
import * as visibility from './github-repository-visibility';
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
function capture(){const sink=vi.spyOn(console,'info').mockImplementation(()=>{});return {sink,events:()=>sink.mock.calls.filter(c=>c[0]==='agentproof_locate_timing').map(c=>JSON.parse(String(c[1])))};}
const abortWait=(signal:AbortSignal)=>new Promise<never>((_,reject)=>{if(signal.aborted)reject(signal.reason);else signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});

it('times the real private runtime grant/visibility checks with the same signal and no provider/network call',async()=>{
 vi.useFakeTimers();const {events}=capture();const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('unexpected network'));
 vi.spyOn(access,'isPrivateAnalysisGrantCurrent').mockImplementation(async()=>{await wait(30);return true;});
 const seen=vi.spyOn(visibility,'readGitHubRepositoryPrivate').mockImplementation(async(_r,_t,o)=>{await wait(40);expect(o?.signal).toBe(controller.signal);return true;});
 const controller=new AbortController();const input={url:'https://github.com/owner/repo/pull/45',repositoryPrivate:true} as any;
 const opts=createRuntimePurposeOptions(input,{env:{DEEPSEEK_API_KEY:'KEY_CANARY'},token:'TOKEN_CANARY',requestCorrelation:anchor.requestCorrelation,privateGrant:{tenantId:'TENANT_CANARY',repositoryFullName:'owner/repo',installationId:3,repositoryId:4},readCurrentInput:async()=>input});
 const result=withLocateTimings(anchor,controller.signal,async()=>{setLocateTimingRound(0);return opts.authorizePrivate!(controller.signal);});
 await vi.advanceTimersByTimeAsync(100);expect(await result).toBe(true);const event=events()[0];
 // First grant (30ms) overlaps visibility (40ms); the post-visibility grant recheck still follows.
 expect(event.totalMs).toBe(70);expect(event.operations).toEqual(expect.arrayContaining([expect.objectContaining({operation:'authorization',inclusiveMs:70,exclusiveMs:0,completed:1}),expect.objectContaining({operation:'private_grant',completed:2,inclusiveMs:60}),expect.objectContaining({operation:'repository_visibility',completed:1,inclusiveMs:40})]));
 expect(seen).toHaveBeenCalledOnce();expect(network).not.toHaveBeenCalled();expect(JSON.stringify(event)).not.toMatch(/CANARY|owner\/repo/);
});

it.each(['authorization','provider_transport','source_read'] as const)('captures %s still pending at the real90s timer, exactly once before an uncooperative promise finishes',async operation=>{
 vi.useFakeTimers();const {events}=capture(),deadline=purposeDeadline(90000,'localization_deadline');let release!:()=>void;
 const result=withLocateTimings(anchor,deadline.signal,async()=>{setLocateTimingRound(2);await timeLocate(operation,()=>new Promise<void>(resolve=>{release=resolve;}));deadline.signal.throwIfAborted();}).catch(e=>e);
 await vi.advanceTimersByTimeAsync(90000);expect(events()).toHaveLength(1);expect(events()[0]).toMatchObject({requestCorrelation:anchor.requestCorrelation,pullRequestNumber:45,outcome:'abort',totalMs:90000,remainingMs:0,failure:{code:'purpose_timeout',timeoutOrigin:'localization_deadline',timeoutMs:90000}});
 expect(events()[0].operations).toContainEqual(expect.objectContaining({round:2,operation,pending:1,completed:0,endMs:null,pendingElapsedMs:90000}));
 release();expect(await result).toBe(deadline.signal.reason);expect(events()).toHaveLength(1);deadline.dispose();expect(vi.getTimerCount()).toBe(0);
});

it('subtracts the union of overlapping direct children, preserving inclusive times and honest unmeasured time',async()=>{
 vi.useFakeTimers();const {events}=capture();const result=withLocateTimings(anchor,new AbortController().signal,async()=>{
  await wait(5);setLocateTimingRound(0);await timeLocate('round_invoke',async()=>{
   await Promise.all([timeLocate('provider_transport',()=>wait(30)),timeLocate('authorization',()=>wait(20))]);await wait(10);
  });await wait(5);
 });await vi.advanceTimersByTimeAsync(50);await result;
 expect(events()).toHaveLength(1);expect(events()[0]).toMatchObject({totalMs:50,unmeasuredMs:10});expect(events()[0].operations).toEqual(expect.arrayContaining([expect.objectContaining({operation:'round_invoke',inclusiveMs:40,exclusiveMs:10}),expect.objectContaining({operation:'provider_transport',inclusiveMs:30}),expect.objectContaining({operation:'authorization',inclusiveMs:20})]));
});

it('retains a span start round when overlapping work completes in a later round and isolates another PR',async()=>{
 vi.useFakeTimers();const {events}=capture();const first=withLocateTimings(anchor,new AbortController().signal,async()=>{
  setLocateTimingRound(0);const a=timeLocate('source_read',()=>wait(30));await wait(10);setLocateTimingRound(1);await timeLocate('source_read',()=>wait(5));await a;
 });const second=withLocateTimings({...anchor,pullRequestNumber:46,requestCorrelation:'11111111-1111-4111-8111-111111111111'},new AbortController().signal,async()=>{setLocateTimingRound(3);await timeLocate('provider_transport',()=>wait(20));});
 await vi.advanceTimersByTimeAsync(30);await Promise.all([first,second]);expect(events()).toHaveLength(2);
 const a=events().find(e=>e.pullRequestNumber===45),b=events().find(e=>e.pullRequestNumber===46);
 expect(a.operations).toEqual(expect.arrayContaining([expect.objectContaining({round:0,inclusiveMs:30}),expect.objectContaining({round:1,inclusiveMs:5})]));expect(a.unmeasuredMs).toBe(0);expect(b.operations).toHaveLength(1);expect(b.operations[0].round).toBe(3);
});

it('keeps failures/unknown operations closed, rejects canary fields, and bounds repeated measurements without verbose diagnostics',async()=>{
 vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','0');vi.stubEnv('NEXT_PUBLIC_AGENTPROOF_ANALYSIS_DIAGNOSTICS','0');const {events}=capture();const e=new Error('RAW_CODE_TOKEN_BODY_CANARY');
 const promise=withLocateTimings({requestCorrelation:'TOKEN_CANARY',repositoryHash:'RAW_PATH_CANARY',pullRequestNumber:-1,raw:'RAW_CANARY'} as any,new AbortController().signal,async()=>{
  for(let n=0;n<1000;n++){setLocateTimingRound(n%4);timeLocateSync('request_prepare',()=>n);}
  await timeLocate('INVALID_CANARY' as any,async()=>true);await timeLocate('provider_parse',async()=>{throw e;});
 });await expect(promise).rejects.toBe(e);const event=events()[0];expect(events()).toHaveLength(1);expect(event).toMatchObject({requestCorrelation:null,unknownOperations:1,outcome:'failure',failure:{code:'unknown'}});expect(event).not.toHaveProperty('repositoryHash');expect(event).not.toHaveProperty('pullRequestNumber');
 expect(event.operations).toHaveLength(5);expect(Buffer.byteLength(JSON.stringify(event))).toBeLessThan(6000);expect(JSON.stringify(event)).not.toMatch(/CANARY|stack|message|raw/);
});

it('does not emit outside a localization scope and a throwing log sink cannot alter return values/errors',async()=>{
 const {sink}=capture();expect(timeLocateSync('request_prepare',()=>7)).toBe(7);expect(await timeLocate('source_read',async()=>8)).toBe(8);expect(sink).not.toHaveBeenCalled();
 sink.mockImplementation(()=>{throw new Error('LOG_CANARY');});expect(await withLocateTimings(anchor,new AbortController().signal,async()=>9)).toBe(9);
 const err=new Error('ORIGINAL_CANARY');await expect(withLocateTimings(anchor,new AbortController().signal,async()=>{throw err;})).rejects.toBe(err);
});

it('preserves caller abort identity with an honest unknown origin, and a settled scope does not emit on late abort',async()=>{
 vi.useFakeTimers();const {events}=capture(),c=new AbortController(),err=new DOMException('TOKEN_CANARY','AbortError');
 const result=withLocateTimings(anchor,c.signal,()=>timeLocate('source_read',()=>abortWait(c.signal))).catch(e=>e);c.abort(err);expect(await result).toBe(err);
 expect(events()).toHaveLength(1);expect(events()[0]).toMatchObject({failure:{code:'purpose_cancelled',timeoutOrigin:'external_unknown'}});expect(JSON.stringify(events())).not.toContain('TOKEN_CANARY');
 const d=new AbortController();await withLocateTimings(anchor,d.signal,async()=>true);d.abort();expect(events()).toHaveLength(2);
});
