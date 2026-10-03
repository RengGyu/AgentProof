import { beforeEach,afterEach,expect,it,vi } from 'vitest';
import { createMobileHandoff,exchangeMobileHandoff,hashMobileVerifier,clearMobileCodesForTests } from '@/lib/mobile-auth';
import { clearTenantAuthSessionsForTests,createTenantAuthSessionForMember } from '@/lib/tenant-auth';
import { clearTenantRepositoryGrantsForTests,createTenantRepositoryGrant,listTenantRepositoryGrants } from '@/lib/tenant-control-plane';
import { GET as repositories } from './repositories/route';
import { GET as activity } from './activity/route';
import { GET as pullRequests } from './pull-requests/route';
import { PATCH as settings } from './repository-settings/route';
import { PATCH as webSettings } from '../tenants/repositories/route';
vi.mock('@/lib/github-installations',async original=>({...await original<typeof import('@/lib/github-installations')>(),listTenantGitHubInstallationStatuses:async()=>[{installationId:321,status:'active'}]}));
vi.mock('@/lib/github-app',()=>({createGitHubInstallationAccessToken:async()=> 'installation-credential'}));
let token:string;
function request(path:string,method='GET',body?:unknown,extra?:Record<string,string>){return new Request(`https://app.example/api/mobile/${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{})});}
beforeEach(async()=>{
 vi.stubEnv('AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY','true');vi.stubEnv('AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED','true');vi.stubEnv('AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY','true');
 vi.stubEnv('AGENTPROOF_TENANT_ACCOUNTS',JSON.stringify([{tenantId:'tenant_a',name:'A',status:'active',plan:'beta',members:[{memberId:'github:1',role:'owner',status:'active'}]},{tenantId:'tenant_b',name:'B',status:'active',plan:'beta',members:[{memberId:'github:2',role:'owner',status:'active'}]}]));
 const verifier='v'.repeat(64);token=(await exchangeMobileHandoff({verifier,code:await createMobileHandoff({verifierChallenge:hashMobileVerifier(verifier),tenantId:'tenant_a',memberId:'github:1'})}))!;
 await createTenantRepositoryGrant({tenantId:'tenant_a',installationId:321,repositoryId:100,repositoryFullName:'Owner/repo',analysisEnabled:true,saveReportsEnabled:true,commentEnabled:false});
 await createTenantRepositoryGrant({tenantId:'tenant_b',installationId:999,repositoryId:200,repositoryFullName:'Other/secret'});
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>Response.json(url.includes('/repositories/')?{id:100,full_name:'Owner/repo'}:[])));
});
afterEach(()=>{clearMobileCodesForTests();clearTenantAuthSessionsForTests();clearTenantRepositoryGrantsForTests();vi.unstubAllEnvs();vi.unstubAllGlobals();});
it('returns the same consent and settings fields needed by the shared repository UI',async()=>{
 const response=await repositories(request('repositories'));expect(response.status).toBe(200);
 const body=await response.json();expect(body.repositories).toHaveLength(1);expect(body.repositories[0]).toMatchObject({repositoryId:100,hybridPlannerConsentVersion:null,privateAnalysisConsentVersion:null});
});
it('uses native tenant authorization for activity and prior PRs',async()=>{
 expect((await activity(request('activity'))).status).toBe(200);
 const response=await pullRequests(request('pull-requests?repositoryId=100'));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({repositoryId:100,pullRequests:[]});
 expect((await pullRequests(request('pull-requests?repositoryId=200'))).status).toBe(404);
});
it('allows own settings changes but refuses cross-tenant body selection and repository mutation',async()=>{
 const body={installationId:321,repositoryId:100,settings:{saveReportsEnabled:false}};
 expect((await settings(request('repository-settings','PATCH',body))).status).toBe(200);
 expect((await listTenantRepositoryGrants({tenantId:'tenant_a'}))[0].saveReportsEnabled).toBe(false);
 expect((await settings(request('repository-settings','PATCH',{...body,tenantId:'tenant_b',installationId:999,repositoryId:200}))).status).toBe(403);
 expect((await settings(request('repository-settings','PATCH',{...body,installationId:999,repositoryId:200}))).status).toBe(404);
});
it('rejects origin/cookie bearing native calls and keeps web source and CSRF boundaries',async()=>{
 for(const extra of [{origin:'https://app.example'},{cookie:'agentproof_mobile_session='+token.slice(4)}] as Record<string,string>[])expect((await settings(request('repository-settings','PATCH',{installationId:321,repositoryId:100,settings:{saveReportsEnabled:false}},extra))).status).toBeGreaterThanOrEqual(400);
 expect((await webSettings(request('repository-settings','PATCH',{installationId:321,repositoryId:100,settings:{saveReportsEnabled:false}},{origin:'https://app.example'}))).status).toBe(401);
 const web=await createTenantAuthSessionForMember({tenantId:'tenant_a',memberId:'github:1'});
 const raw=web.sessionCookie.split(';')[0].split('=')[1];token=`apm_${raw}`;
 expect((await repositories(request('repositories'))).status).toBe(401);
});
