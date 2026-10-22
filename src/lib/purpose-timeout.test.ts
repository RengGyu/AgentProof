import {it,expect,vi,afterEach} from 'vitest';
import {purposeDeadline} from './purpose-timeout';
import {purposeFailureDiagnostic,annotatePurposeFailure} from './purpose-failure';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it.each(['analysis_deadline','localization_deadline','source_read_deadline','provider_timeout'] as const)('records %s only from its actual timer creator',async origin=>{
 vi.useFakeTimers();const d=purposeDeadline(20,origin);await vi.advanceTimersByTimeAsync(20);
 const e=new Error('private canary',{cause:d.signal.reason});annotatePurposeFailure(e,{stage:'locate',phase:'validation'});
 expect(purposeFailureDiagnostic(e)).toMatchObject({code:'purpose_timeout',timeoutOrigin:origin,timeoutMs:20,timeoutElapsedMs:expect.any(Number)});d.dispose();
 expect(JSON.stringify(purposeFailureDiagnostic(e))).not.toMatch(/private|canary|stack/);
});
it('preserves the first parent reason in a simultaneous deadline and disposes completed timers',async()=>{
 vi.useFakeTimers();const parent=purposeDeadline(20,'analysis_deadline');const child=purposeDeadline(20,'provider_timeout',parent.signal);
 await vi.advanceTimersByTimeAsync(20);expect(child.signal.reason).toBe(parent.signal.reason);expect(purposeFailureDiagnostic(child.signal.reason)).toMatchObject({timeoutOrigin:'analysis_deadline'});
 parent.dispose();child.dispose();const completed=purposeDeadline(20,'provider_timeout');completed.dispose();await vi.advanceTimersByTimeAsync(20);expect(completed.signal.aborted).toBe(false);expect(vi.getTimerCount()).toBe(0);
});
it('keeps caller cancellation identity, unknown origins and duration cleanup without inventing provenance',async()=>{
 vi.useFakeTimers();const c=new AbortController(),d=purposeDeadline(20,'provider_timeout',c.signal),e=new DOMException('secret','AbortError');c.abort(e);
 expect(d.signal.reason).toBe(e);expect(purposeFailureDiagnostic(e)).toMatchObject({code:'purpose_cancelled',timeoutOrigin:'external_unknown'});expect(vi.getTimerCount()).toBe(0);d.dispose();
 expect(purposeFailureDiagnostic(new Error('analysis_deadline'))).not.toHaveProperty('timeoutOrigin');
});
it('rejects non-closed timer provenance instead of logging arbitrary strings',async()=>{
 const {recordPurposeTimeout}=await import('./purpose-timeout');const e=new DOMException('secret','TimeoutError');recordPurposeTimeout(e,'SECRET_BODY' as any,20,performance.now());
 expect(purposeFailureDiagnostic(e)).toMatchObject({timeoutOrigin:'external_unknown'});expect(JSON.stringify(purposeFailureDiagnostic(e))).not.toContain('SECRET');
});
it('attributes the real provider count deadline before any budgeted generation or network call',async()=>{
 vi.useFakeTimers();const {createPurposeProvider}=await import('./purpose-provider');const {withPaidAnalysis}=await import('./paid-budget');
 const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('unexpected network'));
 const counted=vi.fn(async(_url:any,init:any)=>new Promise<Response>((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true})));
 const provider=createPurposeProvider({model:'gpt-6-luna',apiKey:'offline-fixture',contractConfirmed:true,fetchFn:counted});
 const pending=withPaidAnalysis('local-timeout-count-only',()=>provider({stage:'purpose',sources:{}},new AbortController().signal)).catch(e=>e);
 await vi.advanceTimersByTimeAsync(60001);expect(purposeFailureDiagnostic(await pending)).toMatchObject({stage:'purpose',phase:'count',code:'purpose_timeout',timeoutOrigin:'provider_timeout',timeoutMs:60000});expect(counted).toHaveBeenCalledTimes(1);expect(network).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
