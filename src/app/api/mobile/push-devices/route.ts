import { noStoreJson } from '@/lib/http';
import { resolveWorkspaceAccess, validWorkspaceMutation } from '@/lib/workspace-server/access';
import { mobileCookieFromRequest } from '@/lib/mobile-auth';
import { deviceId, validPushToken, pushHash, sealPushToken, pushRpc, pushPlatformConfigured } from '@/lib/mobile-push';

async function handle(request:Request) {
 try {
  if(!validWorkspaceMutation(request,'mobile'))return noStoreJson({error:'Sign in again.'},{status:401});
  const access=await resolveWorkspaceAccess(request,'mobile');
  if(!access.authorized||!access.tenantId||!access.memberId)return noStoreJson({error:'Sign in again.'},{status:401});
  let body:Record<string,unknown>;
  if(request.method==='GET')body={deviceId:new URL(request.url).searchParams.get('deviceId'),platform:new URL(request.url).searchParams.get('platform')};
  else {
   const reader=request.body?.getReader();if(!reader)return noStoreJson({error:'Invalid device request.'},{status:400});
   const chunks:Uint8Array[]=[];let size=0;
   for(;;){const r=await reader.read();if(r.done)break;size+=r.value.byteLength;if(size>8192){await reader.cancel();return noStoreJson({error:'Device request too large.'},{status:413});}chunks.push(r.value);}
   body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  const registering=request.method==='POST',allowed=registering?['deviceId','platform','token']:request.method==='GET'?['deviceId','platform']:['deviceId'];
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k))||!deviceId(body.deviceId)||registering&&!validPushToken(body.platform,body.token))return noStoreJson({error:'Invalid device request.'},{status:400});
  const available=(body.platform==='ios'||body.platform==='android')&&pushPlatformConfigured(body.platform);
  if(registering&&!available)return noStoreJson({error:'Notifications are not available yet.'},{status:503});
  const cookie=mobileCookieFromRequest(request)!;const sessionHash=pushHash(cookie.slice(cookie.indexOf('=')+1));
  const result=await pushRpc('agentproof_mobile_push_device',{p_session_hash:sessionHash,p_device:body.deviceId,p_operation:registering?'register':request.method==='DELETE'?'disable':'read',...(registering?{p_platform:body.platform,p_token_hash:pushHash(String(body.platform)+':'+body.token),p_ciphertext:sealPushToken(String(body.token),body.deviceId+':'+access.tenantId,process.env.AGENTPROOF_PUBLIC_AUTH_SECRET??'')}:{})});
  return noStoreJson({enabled:result?.enabled===true,available});
 }catch(error){return noStoreJson({error:error instanceof SyntaxError?'Invalid device request.':'Notification settings are unavailable. Try again.'},{status:error instanceof SyntaxError?400:503});}
}
export const GET=handle;export const POST=handle;export const DELETE=handle;
