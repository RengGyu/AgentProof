import {afterEach,expect,it,vi} from 'vitest';
import {analysisDiagnostic,analysisHash,withAnalysisDiagnostics} from './analysis-diagnostics';
import {annotatePurposeFailure} from './purpose-failure';
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
const request=()=>new Request('http://localhost/api/dashboard/analyze');
const events=(spy:{mock:{calls:unknown[][]}}):any[]=>spy.mock.calls.filter(c=>c[0]==='agentproof_analysis_diagnostic').map(c=>JSON.parse(String(c[1])));
it('OFF does not evaluate builders, log, or change the response',async()=>{
 vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','0');const info=vi.spyOn(console,'info').mockImplementation(()=>{}),builder=vi.fn(()=>({}));const response=Response.json({ok:true});
 expect(await withAnalysisDiagnostics(request(),async()=>{analysisDiagnostic('input','success',builder);return response;})).toBe(response);
 expect(builder).not.toHaveBeenCalled();expect(info).not.toHaveBeenCalled();expect(response.headers.get('x-agentproof-diagnostic-request')).toBeNull();
});
it('never accepts query/body enablement and ignores diagnostic/sink failures',async()=>{
 vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','0');const info=vi.spyOn(console,'info').mockImplementation(()=>{throw Error('secret-canary');});
 await withAnalysisDiagnostics(new Request('http://localhost/api/dashboard/analyze?diagnostics=1'),async()=>{analysisDiagnostic('read','start');return Response.json({ok:true});});expect(info).not.toHaveBeenCalled();
 vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','1');const r=await withAnalysisDiagnostics(request(),async()=>{analysisDiagnostic('read','success',()=>{throw Error('source-canary');});return Response.json({ok:true});});expect(await r.json()).toEqual({ok:true});
});
it('allowlists all fields including failures and drops canary text/paths/IDs and oversized metadata',async()=>{
 vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','1');const info=vi.spyOn(console,'info').mockImplementation(()=>{}),canary='sk-secret-canary private/path code()';
 await withAnalysisDiagnostics(request(),async()=>{analysisDiagnostic('purpose','success',()=>({hashes:{input:analysisHash(canary),prompt:canary},counts:{clauses:2,bytes:-1},model:canary,locale:canary,reason:canary,literal:canary,reportCreatedAt:canary,failure:{code:canary,phase:canary,stage:canary,providerHTTPStatus:999,message:canary},parts:[{idHash:analysisHash('clause'),textHash:analysisHash(canary),conditions:[analysisHash('when'),canary],refs:[analysisHash('ref')],text:canary}]} as any));return Response.json({ok:true});});
 expect(JSON.stringify(events(info))).not.toContain(canary);const event=events(info).find(e=>e.stage==='purpose');expect(event.hashes.input).toHaveLength(64);expect(event.counts).toEqual({clauses:2,droppedParts:0,droppedRefs:0});expect(event.parts[0].conditions).toHaveLength(1);expect(event.failure).toEqual({code:'unknown',providerHTTPStatus:null});
});
it('isolates out-of-order requests, aborts, and rethrows exact failures without later stages',async()=>{
 vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','1');const info=vi.spyOn(console,'info').mockImplementation(()=>{});let finish!:()=>void;const pending=new Promise<void>(r=>finish=r);const controller=new AbortController();const error=new Error('private provider body');annotatePurposeFailure(error,{stage:'locate',phase:'source',code:'localization_tool_reference',counts:{evidence:0}});
 const first=withAnalysisDiagnostics(new Request('http://localhost',{signal:controller.signal}),async()=>{await pending;throw error;});
 const second=await withAnalysisDiagnostics(request(),async()=>{controller.abort();analysisDiagnostic('store','success',()=>({hashes:{report:analysisHash('new-report')},reportCreatedAt:'2026-10-15T02:50:54.946Z'}));return Response.json({ok:true});});
 controller.abort();finish();await expect(first).rejects.toBe(error);
 const es=events(info),secondId=second.headers.get('x-agentproof-diagnostic-request'),a=es.filter(e=>e.correlation!==secondId),b=es.filter(e=>e.correlation===secondId);
 expect(new Set(es.map(e=>e.correlation)).size).toBe(2);expect(a.map(e=>e.stage)).not.toContain('store');expect(a.at(-1).failure.code).toBe('localization_tool_reference');expect(b.some(e=>e.outcome==='abort')).toBe(false);expect(b.find(e=>e.stage==='store').reportCreatedAt).toBe('2026-10-15T02:50:54.946Z');expect(a.some(e=>e.outcome==='abort')).toBe(true);expect(JSON.stringify(es)).not.toContain('private provider body');
});
it('bounds diagnostic output without imposing an analysis call/read limit',async()=>{
 vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','1');const info=vi.spyOn(console,'info').mockImplementation(()=>{});let executed=0;
 const r=await withAnalysisDiagnostics(request(),async()=>{for(let i=0;i<300;i++){executed++;analysisDiagnostic('read','success');}return Response.json({ok:true});});expect(executed).toBe(300);expect(info).toHaveBeenCalledTimes(257);expect(r.status).toBe(200);
});

it('drops oversized metadata with a terminal counter instead of affecting the analysis',async()=>{
 vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','1');const info=vi.spyOn(console,'info').mockImplementation(()=>{}),h=analysisHash('fixture');
 const response=await withAnalysisDiagnostics(request(),async()=>{analysisDiagnostic('purpose','success',()=>({parts:Array.from({length:96},()=>({idHash:h,conditions:Array(64).fill(h),exceptions:Array(64).fill(h),refs:Array(64).fill(h),counterRefs:Array(64).fill(h)}))}));return Response.json({ok:true});});
 expect(response.status).toBe(200);expect(events(info).filter(e=>e.stage==='purpose')).toHaveLength(0);expect(events(info).at(-1).counts.droppedEvents).toBe(1);
});
it('binds owner hashes from the authorized server context and isolates concurrent clients',async()=>{
 const {bindAnalysisDiagnosticTenant}=await import('./analysis-diagnostics');vi.stubEnv('AGENTPROOF_ANALYSIS_DIAGNOSTICS','1');const info=vi.spyOn(console,'info').mockImplementation(()=>{});let finish!:()=>void;const wait=new Promise<void>(r=>finish=r);
 const first=withAnalysisDiagnostics(request(),async()=>{bindAnalysisDiagnosticTenant('owner-A');await wait;analysisDiagnostic('input','success',()=>({hashes:{tenant:analysisHash('forged')}}));return Response.json({ok:true});});
 await withAnalysisDiagnostics(request(),async()=>{bindAnalysisDiagnosticTenant('owner-B');analysisDiagnostic('input','success');return Response.json({ok:true});});finish();await first;
 const owners=events(info).filter(e=>e.stage==='input').map(e=>e.hashes.tenant);expect(owners).toEqual([analysisHash('owner-B'),analysisHash('owner-A')]);expect(owners).not.toContain(analysisHash('forged'));
});
