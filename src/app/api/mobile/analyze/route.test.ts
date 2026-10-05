import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {POST} from './route';
import {POST as webAnalyze} from '../../analyze/route';
import {createMobileHandoff,exchangeMobileHandoff,hashMobileVerifier,clearMobileCodesForTests} from '@/lib/mobile-auth';
import {clearTenantAuthSessionsForTests} from '@/lib/tenant-auth';
import {clearTenantRepositoryGrantsForTests,createTenantRepositoryGrant} from '@/lib/tenant-control-plane';
import * as github from '@/lib/github';
import * as observation from '@/lib/general-pr-observation-service';
import {demoScenarios} from '@/lib/sample-data';
vi.mock('@/lib/github-installations',async original=>({...await original<typeof import('@/lib/github-installations')>(),listTenantGitHubInstallationStatuses:async()=>[{installationId:321,status:'active'}]}));
vi.mock('@/lib/github-app',()=>({createGitHubInstallationAccessToken:async()=> 'installation-credential'}));
let token:string;
const prUrl='https://github.com/Owner/repo/pull/12';
function request(headers:Record<string,string>={},body:unknown={prUrl}){return new Request('https://app.example/api/mobile/analyze',{method:'POST',headers:{Authorization:`Bearer ${token}`, ...headers},body:JSON.stringify(body)});}
beforeEach(async()=>{
 for(const key of ['OPENAI_API_KEY','OPENAI_MODEL','GEMINI_API_KEY','AI_GATEWAY_API_KEY'])vi.stubEnv(key,'');
 vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE','disabled');
 vi.stubEnv('AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY','true');vi.stubEnv('AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED','true');vi.stubEnv('AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY','true');
 vi.stubEnv('AGENTPROOF_TENANT_ACCOUNTS',JSON.stringify([{tenantId:'tenant_a',name:'A',status:'active',plan:'beta',members:[{memberId:'github:1',role:'owner',status:'active'}]}]));
 const verifier='v'.repeat(64);token=(await exchangeMobileHandoff({verifier,code:await createMobileHandoff({verifierChallenge:hashMobileVerifier(verifier),tenantId:'tenant_a',memberId:'github:1'})}))!;
 await createTenantRepositoryGrant({tenantId:'tenant_a',installationId:321,repositoryId:100,repositoryFullName:'Owner/repo',analysisEnabled:true});
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>{if(url==='https://api.github.com/repos/Owner/repo')return Response.json({id:100,private:false});throw Error('Unexpected external call');}));
 vi.spyOn(github,'buildPullRequestInput').mockResolvedValue({...demoScenarios.clean,url:prUrl,repositoryPrivate:false,sourceProvenance:{version:1,origin:'github_snapshot',headSha:'a'.repeat(40),baseSha:'b'.repeat(40),evidenceCapturedAt:'2026-09-30T00:00:00Z',inputFingerprint:{version:1,algorithm:'sha256',value:'d'.repeat(64),coverage:'github_metadata'}}});
 vi.spyOn(observation,'runGeneralPrObservationNowV2').mockImplementation(async options=>({report:options.generateReport(options.input),bundle:null,ordinaryDocumentationDiagnostic:{state:'assessment_hidden'} as never}));
});
afterEach(()=>{clearMobileCodesForTests();clearTenantAuthSessionsForTests();clearTenantRepositoryGrantsForTests();vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('returns a report for a selected connected PR through the existing analysis pipeline without a paid call',async()=>{
 const response=await POST(request());expect(response.status,await response.clone().text()).toBe(200);
 expect((await response.json()).report.source).toMatchObject({url:prUrl,provenance:{origin:'github_snapshot',headSha:'a'.repeat(40)}});
 expect(github.buildPullRequestInput).toHaveBeenCalledWith(expect.objectContaining({prUrl,githubToken:'installation-credential'}),expect.anything());
});
it('rejects browser-origin bearer, browser cookies, invalid tokens and web use of a mobile session before evidence reads',async()=>{
 for(const headers of [{origin:'https://app.example'},{cookie:'agentproof_mobile_session='+token.slice(4)},{Authorization:'Bearer forged'}] as Record<string,string>[])expect((await POST(request(headers))).status).toBe(401);
 expect((await webAnalyze(request({origin:'https://app.example',cookie:'agentproof_tenant_auth_session='+token.slice(4)}))).status).toBe(401);
 expect(github.buildPullRequestInput).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('requires a valid mobile session even for a demo and never falls back to a web cookie',async()=>{
 expect((await POST(request({Authorization:'Bearer forged'},{demoScenario:'clean'}))).status).toBe(401);
 expect(observation.runGeneralPrObservationNowV2).not.toHaveBeenCalled();
});
it('does not authorize a repository from another tenant or accept caller supplied GitHub credentials',async()=>{
 const response=await POST(request({},{prUrl:'https://github.com/Other/private/pull/12',githubToken:'forged',tenantId:'tenant_b'}));
 expect(response.status).toBe(401);expect(github.buildPullRequestInput).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('preserves private-analysis consent checks before collecting PR evidence',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({id:100,private:true})));
 const response=await POST(request());expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'github_private_consent_required'});
 expect(github.buildPullRequestInput).not.toHaveBeenCalled();
});
