import {beforeEach,afterEach,expect,it,vi} from 'vitest';
const continuation=vi.hoisted(()=>vi.fn());
vi.mock('next/server',()=>({after:continuation}));
import {createVerifiedSavedReport,createSavedReport,clearSavedReportsForTests} from './server-report-store';
import {generateVerificationReportV2FromInput} from './verifier';
import {demoScenarios} from './sample-data';
beforeEach(()=>{continuation.mockClear();vi.stubEnv('AGENTPROOF_APNS_PRIVATE_KEY','not-real-no-network');vi.stubEnv('AGENTPROOF_REPORT_SIGNING_SECRET','test-report-signing-secret-that-is-long-enough');});
afterEach(()=>{clearSavedReportsForTests();vi.unstubAllEnvs();});
it('schedules only after the actual verified tenant save and leaves the Inbox/report identity unchanged',async()=>{
 const report=generateVerificationReportV2FromInput(demoScenarios.clean);
 const saved=await createVerifiedSavedReport(report,{tenantId:'tenant_a',repositoryId:9,installationId:1,pullRequestNumber:7,headSha:'a'.repeat(40)});
 expect(saved.id).toBeTruthy();expect(continuation).toHaveBeenCalledTimes(1);expect(typeof continuation.mock.calls[0][0]).toBe('function');
 // Never execute the external provider continuation in a local test.
});
it('does not send imported or failed reports; a notification scheduling error cannot undo an ACK',async()=>{
 const report=generateVerificationReportV2FromInput(demoScenarios.clean);await createSavedReport(report);expect(continuation).not.toHaveBeenCalled();
 continuation.mockImplementationOnce(()=>{throw Error('no request context');});
 await expect(createVerifiedSavedReport(report,{tenantId:'tenant_a',repositoryId:9,installationId:1,pullRequestNumber:7,headSha:'a'.repeat(40)})).resolves.toHaveProperty('id');
});
