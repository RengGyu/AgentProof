import {afterEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({after:vi.fn(),claim:vi.fn(),run:vi.fn()}));
vi.mock('next/server',()=>({after:mocks.after}));
vi.mock('./analysis-jobs',()=>({DEFAULT_ANALYSIS_JOB_CI_DISCOVERY_MS:45_000,claimAnalysisJobById:mocks.claim}));
vi.mock('./analysis-worker',()=>({runClaimedAnalysisJob:mocks.run}));
import {scheduleAnalysisJobWake} from './analysis-job-wake';
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.clearAllMocks();});
it('executes the existing post-response wake without a client signal and leaves recovery to cron on failure',async()=>{
 vi.stubEnv('VERCEL','1');vi.useFakeTimers();const request=new Request('https://app.example/api/dashboard/analyze');
 const controller=new AbortController();mocks.claim.mockResolvedValue({job:{id:'job'}});mocks.run.mockResolvedValue({status:'completed'});
 scheduleAnalysisJobWake('job',request.url);expect(mocks.after).toHaveBeenCalledOnce();expect(mocks.claim).not.toHaveBeenCalled();
 controller.abort();const callback=mocks.after.mock.calls[0][0];const running=callback();await vi.advanceTimersByTimeAsync(45_000);await running;
 expect(mocks.run).toHaveBeenCalledWith({id:'job'},{requestUrl:'https://app.example/api/ops/analysis-jobs/run'});
 mocks.claim.mockRejectedValue(new Error('synthetic-unavailable'));const recovery=callback();await vi.advanceTimersByTimeAsync(45_000);await expect(recovery).resolves.toBeUndefined();expect(mocks.run).toHaveBeenCalledTimes(1);
});
it('does not dispatch local work outside the platform post-response scheduler',()=>{vi.stubEnv('VERCEL','0');scheduleAnalysisJobWake('job','https://app.example');expect(mocks.after).not.toHaveBeenCalled();});
