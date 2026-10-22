import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import {GET,POST,DELETE} from './route';
import {createMobileHandoff,exchangeMobileHandoff,hashMobileVerifier,clearMobileCodesForTests} from '@/lib/mobile-auth';
import {clearTenantAuthSessionsForTests,revokeTenantAuthSession,MOBILE_AUTH_SESSION_COOKIE} from '@/lib/tenant-auth';
const rpc=vi.hoisted(()=>vi.fn(async()=>({enabled:true})));
vi.mock('@/lib/mobile-push',async original=>({...await original<typeof import('@/lib/mobile-push')>(),pushRpc:rpc}));
let token:string;const id='00000000-0000-4000-8000-000000000001';
const req=(method='GET',body?:object,headers:Record<string,string>={})=>new Request('https://app.example/api/mobile/push-devices?deviceId='+id+'&platform=ios',{method,headers:{Authorization:'Bearer '+token,...headers},...(body?{body:JSON.stringify(body)}:{})});
beforeEach(async()=>{vi.stubEnv('AGENTPROOF_APNS_PRIVATE_KEY','test-only-not-real-key');vi.stubEnv('AGENTPROOF_APNS_KEY_ID','test');vi.stubEnv('AGENTPROOF_APNS_TEAM_ID','test');vi.stubEnv('AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY','true');vi.stubEnv('AGENTPROOF_PUBLIC_AUTH_SECRET','test-only-encryption-secret-32-characters');vi.stubEnv('AGENTPROOF_TENANT_ACCOUNTS',JSON.stringify([{tenantId:'tenant_a',name:'A',status:'active',plan:'beta',members:[{memberId:'github:1',role:'owner',status:'active'}]}]));const verifier='v'.repeat(64);token=(await exchangeMobileHandoff({verifier,code:await createMobileHandoff({verifierChallenge:hashMobileVerifier(verifier),tenantId:'tenant_a',memberId:'github:1'})}))!;rpc.mockClear();});
afterEach(()=>{clearTenantAuthSessionsForTests();clearMobileCodesForTests();vi.unstubAllEnvs();});
it('binds to the verified mobile session and stores encrypted token only; read never returns token',async()=>{
 const response=await POST(req('POST',{deviceId:id,platform:'ios',token:'a'.repeat(64)}));expect(response.status).toBe(200);expect(await response.json()).toEqual({enabled:true,available:true});
 const args=rpc.mock.calls[0] as any;expect(args[1].p_session_hash).toMatch(/^[a-f0-9]{64}$/);expect(args[1].p_ciphertext).not.toContain('a'.repeat(64));expect(JSON.stringify(args)).not.toContain(token);
 expect((await GET(req())).status).toBe(200);expect((await DELETE(req('DELETE',{deviceId:id}))).status).toBe(200);
});
it.each([{tenantId:'other'},{memberId:'other'},{enabled:true},{token:'short'},{platform:'web'}])('rejects caller-owned binding or malformed fields %j',async override=>{
 expect((await POST(req('POST',{deviceId:id,platform:'ios',token:'a'.repeat(64),...override}))).status).toBe(400);expect(rpc).not.toHaveBeenCalled();
});
it('rejects browser credentials and revoked sessions before registry access',async()=>{
 expect((await GET(req('GET',undefined,{origin:'https://app.example'}))).status).toBe(401);
 expect((await GET(req('GET',undefined,{cookie:'mobile=unsafe'}))).status).toBe(401);
 await revokeTenantAuthSession({cookieHeader:MOBILE_AUTH_SESSION_COOKIE+'='+token.slice(4),source:'mobile'});
 expect((await GET(req())).status).toBe(401);expect(rpc).not.toHaveBeenCalled();
});
it('bounds request bodies and returns a neutral failure without provider/DB text',async()=>{
 expect((await POST(req('POST',{deviceId:id,token:'x'.repeat(9000)}))).status).toBe(413);
 rpc.mockRejectedValueOnce(new Error('SECRET_RAW_PROVIDER'));const response=await GET(req());expect(response.status).toBe(503);expect(await response.text()).not.toContain('SECRET_RAW_PROVIDER');
});
