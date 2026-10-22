import { after } from 'next/server';
import { createCipheriv, createDecipheriv, createHash, randomBytes, sign } from 'node:crypto';
import { connect } from 'node:http2';
import { getControlPlaneSupabaseEnv } from './control-plane-supabase';

export type PushOutcome = 'sent'|'invalid'|'retryable'|'failed'|'unknown'|'unconfigured';
type PushMessage = {platform:'ios'|'android';token:string;reportId?:string;eventKey:string};
type Transport = {firebaseProject?:string;firebaseAccessToken?:()=>Promise<string>;apnsKey?:string;apnsKeyId?:string;apnsTeamId?:string;apnsEnvironment?:'production'|'sandbox'};
export const pushId = (v:unknown):v is string => typeof v==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(v);
export const deviceId = (v:unknown):v is string => typeof v==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export const pushHash = (v:string) => createHash('sha256').update(v).digest('hex');
export function validPushToken(platform:unknown,token:unknown):token is string {
 return typeof token==='string' && (platform==='ios'?/^[a-f0-9]{32,512}$/i.test(token):platform==='android'&&/^[A-Za-z0-9_:.-]{32,4096}$/.test(token));
}
export function sealPushToken(token:string,binding:string,secret:string) {
 if(secret.length<32)throw Error('push_store_unavailable');
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',createHash('sha256').update('mobile-push-v1\0'+secret).digest(),iv);cipher.setAAD(Buffer.from(binding));
 const data=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');
}
export function openPushToken(value:string,binding:string,secret:string):string {
 const b=Buffer.from(value,'base64url'),cipher=createDecipheriv('aes-256-gcm',createHash('sha256').update('mobile-push-v1\0'+secret).digest(),b.subarray(0,12));cipher.setAAD(Buffer.from(binding));cipher.setAuthTag(b.subarray(12,28));return Buffer.concat([cipher.update(b.subarray(28)),cipher.final()]).toString('utf8');
}
export function pushPayload(reportId:string|undefined,eventKey:string) {
 if((reportId!==undefined&&!pushId(reportId))||!/^([a-f0-9]{64})$/.test(eventKey))throw Error('push_payload_invalid');
 return {notification:{title:'DiffEvidence',body:reportId?'A report is ready. Open the app to view it.':'Analysis needs attention. Open the app to view its status.'},data:{...(reportId?{reportId}:{}),eventId:eventKey,eventKind:reportId?'report_ready':'analysis_failed'}};
}
const json64=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');
function signedJwt(header:object,claims:object,key:string,algorithm:'RSA-SHA256'|'SHA256') {
 const text=json64(header)+'.'+json64(claims);return text+'.'+sign(algorithm,Buffer.from(text),{key,...(algorithm==='SHA256'?{dsaEncoding:'ieee-p1363' as const}:{})}).toString('base64url');
}
function transport(env:NodeJS.ProcessEnv):Transport {
 const email=env.AGENTPROOF_FCM_CLIENT_EMAIL,key=env.AGENTPROOF_FCM_PRIVATE_KEY,project=env.AGENTPROOF_FCM_PROJECT_ID;let bearer:Promise<string>|undefined;
 return {firebaseProject:project, firebaseAccessToken:email&&key&&project?async()=>{
  return bearer??=(async()=>{const now=Math.floor(Date.now()/1000),assertion=signedJwt({alg:'RS256',typ:'JWT'},{iss:email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600},key,'RSA-SHA256');
  const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(10000)});
  const body=await r.json();if(!r.ok||typeof body.access_token!=='string')throw Error('push_provider_auth');return body.access_token;})();
 }:undefined,apnsKey:env.AGENTPROOF_APNS_PRIVATE_KEY,apnsKeyId:env.AGENTPROOF_APNS_KEY_ID,apnsTeamId:env.AGENTPROOF_APNS_TEAM_ID,apnsEnvironment:env.AGENTPROOF_APNS_ENVIRONMENT==='sandbox'?'sandbox':'production'};
}
export async function sendNativePush(message:PushMessage,config:Transport):Promise<PushOutcome> {
 const payload=pushPayload(message.reportId,message.eventKey);
 if(message.platform==='android'){
  if(!config.firebaseAccessToken||!config.firebaseProject||!/^[-a-z0-9]+$/.test(config.firebaseProject))return 'unconfigured';
  try{
   const r=await fetch(`https://fcm.googleapis.com/v1/projects/${config.firebaseProject}/messages:send`,{method:'POST',headers:{Authorization:'Bearer '+await config.firebaseAccessToken(),'Content-Type':'application/json'},body:JSON.stringify({message:{token:message.token,...payload,android:{priority:'high',ttl:'0s',notification:{tag:message.eventKey,channel_id:'reports',icon:'ic_stat_diffevidence'}}}}),signal:AbortSignal.timeout(10000)});
   if(r.ok)return 'sent';
   const body=await r.json().catch(()=>null);
   if(r.status===404&&body?.error?.details?.some((d:{errorCode?:string})=>d.errorCode==='UNREGISTERED'))return 'invalid';
   return r.status>=500&&!r.headers.has('retry-after')?'retryable':'failed';
  }catch{return 'unknown';}
 }
 if(!config.apnsKey||!config.apnsKeyId||!config.apnsTeamId)return 'unconfigured';
 try {
  const jwt=signedJwt({alg:'ES256',kid:config.apnsKeyId},{iss:config.apnsTeamId,iat:Math.floor(Date.now()/1000)},config.apnsKey,'SHA256');
  return await new Promise<PushOutcome>(resolve=>{
   const client=connect(config.apnsEnvironment==='sandbox'?'https://api.sandbox.push.apple.com':'https://api.push.apple.com');let done=false;
   const finish=(v:PushOutcome)=>{if(done)return;done=true;clearTimeout(timer);client.destroy();resolve(v);};
   const timer=setTimeout(()=>finish('unknown'),10000);client.on('error',()=>finish('unknown'));
   const req=client.request({':method':'POST',':path':'/3/device/'+message.token,authorization:'bearer '+jwt,'apns-topic':'app.agentproof.mobile','apns-push-type':'alert','apns-priority':'10','apns-collapse-id':message.eventKey,'apns-expiration':'0'});
   let status=0,body='',retryAfter=false;req.on('data',chunk=>{if(body.length<2048)body+=String(chunk).slice(0,2048-body.length);});req.on('response',h=>{status=Number(h[':status']);retryAfter=h['retry-after']!==undefined;});req.on('error',()=>finish('unknown'));req.on('end',()=>{let reason='';try{reason=JSON.parse(body).reason;}catch{}finish(status===200?'sent':status===410||(status===400&&['BadDeviceToken','DeviceTokenNotForTopic'].includes(reason))?'invalid':status>=500&&!retryAfter?'retryable':'failed');});
   req.end(JSON.stringify({aps:{alert:payload.notification,sound:'default'},...payload.data}));
  });
 }catch{return 'failed';}
}

export function pushPlatformConfigured(platform:'ios'|'android',env=process.env) {
 return platform==='ios'?Boolean(env.AGENTPROOF_APNS_PRIVATE_KEY&&env.AGENTPROOF_APNS_KEY_ID&&env.AGENTPROOF_APNS_TEAM_ID):Boolean(env.AGENTPROOF_FCM_PROJECT_ID&&env.AGENTPROOF_FCM_CLIENT_EMAIL&&env.AGENTPROOF_FCM_PRIVATE_KEY);
}
export async function pushRpc(name:string,body:object,env=process.env) {
 const {url,serviceRoleKey}=getControlPlaneSupabaseEnv(env);if(!url||!serviceRoleKey)throw Error('push_store_unavailable');
 const r=await fetch(url.replace(/\/$/,'')+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:serviceRoleKey,Authorization:'Bearer '+serviceRoleKey,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('push_store_unavailable');return r.status===204?null:r.json();
}
export type ReadyEvent={tenantId:string;reportId:string;repositoryId:number};
/** Called only after an acknowledged server-owned save. No report prose enters push storage or payloads. */
type FailedEvent={tenantId:string;jobId:string;repositoryId:number};
export function dispatchMobileReportReady(event:ReadyEvent,env=process.env){return dispatchPush(event,env);}
async function dispatchPush(event:ReadyEvent|FailedEvent,env:NodeJS.ProcessEnv) {
 const config=transport(env);
 if(!config.firebaseAccessToken&&!config.apnsKey)return {status:'unconfigured' as const};
 const reportId='reportId' in event?event.reportId:undefined,jobId='jobId' in event?event.jobId:undefined;
 const eventKey=pushHash(reportId?'report:'+reportId:'failed:'+jobId),secret=env.AGENTPROOF_PUBLIC_AUTH_SECRET??'';
 if(!pushId(event.tenantId)||!(reportId?pushId(reportId):pushId(jobId))||!Number.isSafeInteger(event.repositoryId)||secret.length<32)return {status:'unavailable' as const};
 const counts:Partial<Record<PushOutcome,number>>={};
 try{
  // Durable claim + explicit 5xx (without Retry-After) retry once; unknown delivery is never retried.
  for(let pass=0;pass<2;pass++){
   const rows=await pushRpc('agentproof_claim_mobile_push',{p_tenant:event.tenantId,p_event:eventKey,p_report:reportId??null,p_repository:event.repositoryId,p_job:jobId??null},env);
   if(!Array.isArray(rows))throw Error('push_store_unavailable');
   await Promise.all(rows.map(async row=>{
    if(!deviceId(row.device_id)||!['ios','android'].includes(row.platform))return;
    let outcome:PushOutcome='failed';
    try{
     // Recheck opt-out/session revocation immediately before provider invocation.
     if(row.platform==='android'&&config.firebaseAccessToken)await config.firebaseAccessToken();
     const current=await pushRpc('agentproof_mobile_push_current',{p_device:row.device_id,p_token_hash:row.token_hash,p_session_hash:row.session_hash,p_repository:event.repositoryId},env);
     if(current!==true)return;
     const token=openPushToken(row.token_ciphertext,row.device_id+':'+event.tenantId,secret);
     outcome=await sendNativePush({platform:row.platform,token,reportId,eventKey},config);
    }catch{outcome='unknown';}
    counts[outcome]=(counts[outcome]??0)+1;
    await pushRpc('agentproof_finish_mobile_push',{p_event:eventKey,p_device:row.device_id,p_token_hash:row.token_hash,p_outcome:outcome},env);
   }));
   if(pass===0&&(counts.retryable??0)>0)await new Promise(ok=>setTimeout(ok,1100));else break;
  }
  return {status:'processed' as const,counts};
 }catch{return {status:'unavailable' as const,counts};}
}

/** Request-lifetime continuation; a push/config failure must never undo an acknowledged report save. */
export function scheduleMobileReportReady(event:ReadyEvent) {
 if(!process.env.AGENTPROOF_APNS_PRIVATE_KEY&&!process.env.AGENTPROOF_FCM_PRIVATE_KEY)return;
 try { after(async()=>{await dispatchMobileReportReady(event);}); } catch { /* No request continuation: do not start an untracked network task. */ }
}

export function scheduleMobileAnalysisFailed(event:FailedEvent) {
 if(!process.env.AGENTPROOF_APNS_PRIVATE_KEY&&!process.env.AGENTPROOF_FCM_PRIVATE_KEY)return;
 try { after(async()=>{await dispatchPush(event,process.env);}); } catch { /* Caller may be outside a server request. */ }
}
