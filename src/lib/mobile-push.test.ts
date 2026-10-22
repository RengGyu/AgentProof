import {generateKeyPairSync} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {connect} from 'node:http2';
vi.mock('node:http2',()=>({connect:vi.fn()}));
import { afterEach, expect, it, vi } from 'vitest';
import { sealPushToken, openPushToken, pushPayload, sendNativePush, dispatchMobileReportReady, pushRpc } from './mobile-push';
const secret='push-encryption-test-secret-32-characters';
afterEach(()=>vi.unstubAllGlobals());
it('encrypts tokens with device/tenant binding and never places private content in OS payloads',()=>{
 const cipher=sealPushToken('token-secret','device:tenant',secret);
 expect(cipher).not.toContain('token-secret');expect(openPushToken(cipher,'device:tenant',secret)).toBe('token-secret');
 expect(()=>openPushToken(cipher,'other:tenant',secret)).toThrow();
 const p=pushPayload('report_one','a'.repeat(64));expect(JSON.stringify(p)).not.toMatch(/repository|code|rationale|headSha|pullRequest/);
 expect(p.data.reportId).toBe('report_one');
});
it('sends a visible FCM notification with only the opaque report/event identifiers',async()=>{
 const calls:any[]=[];vi.stubGlobal('fetch',vi.fn(async(url,init)=>{calls.push([url,init]);return Response.json({name:'delivered'});}));
 // The transport accepts an already-minted server token, never a client credential.
 expect(await sendNativePush({platform:'android',token:'fcm-device',reportId:'report_one',eventKey:'a'.repeat(64)}, {firebaseProject:'demo-project',firebaseAccessToken:async()=> 'server-only'})).toBe('sent');
 const body=JSON.parse(calls[0][1].body);expect(body.message.notification.title).toBe('DiffEvidence');expect(body.message.data).toEqual({reportId:'report_one',eventId:'a'.repeat(64),eventKind:'report_ready'});
 expect(body.message.android.notification.tag).toBe('a'.repeat(64));
});
it.each([[404,'UNREGISTERED','invalid'],[400,'INVALID_ARGUMENT','failed'],[429,'QUOTA_EXCEEDED','failed'],[503,'UNAVAILABLE','retryable']])('classifies FCM %s without leaking error bodies',async(status,code,expected)=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:{details:[{errorCode:code}],message:'PRIVATE_CANARY'}},{status:Number(status)})));
 expect(await sendNativePush({platform:'android',token:'fcm-device',reportId:'report_one',eventKey:'a'.repeat(64)}, {firebaseProject:'demo-project',firebaseAccessToken:async()=> 'server-only'})).toBe(expected);
});
it('does not retry an unconfirmed transport or treat a missing provider as delivered',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('private-network-message');}));
 expect(await sendNativePush({platform:'android',token:'fcm-device',reportId:'report_one',eventKey:'a'.repeat(64)}, {firebaseProject:'demo-project',firebaseAccessToken:async()=> 'server-only'})).toBe('unknown');
 expect(await sendNativePush({platform:'ios',token:'apns-device',reportId:'report_one',eventKey:'a'.repeat(64)}, {})).toBe('unconfigured');
});
it('is inert with no provider configuration or no tenant report identity',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 expect(await dispatchMobileReportReady({tenantId:'tenant_a',reportId:'report_one',repositoryId:9},{NODE_ENV:'test'})).toEqual({status:'unconfigured'});
 expect(fetch).not.toHaveBeenCalled();
});

it.each([[200,'','sent'],[410,'Unregistered','invalid'],[400,'BadDeviceToken','invalid'],[403,'InvalidProviderToken','failed'],[503,'ServiceUnavailable','retryable']])('uses APNs HTTP2 with ES256 and classifies %s safely',async(status,reason,expected)=>{
 const key=generateKeyPairSync('ec',{namedCurve:'P-256',privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;
 const connection:any=new EventEmitter();connection.destroy=vi.fn();let wire:any,body:any;
 connection.request=(headers:any)=>{wire=headers;const stream:any=new EventEmitter();stream.end=(value:any)=>{body=JSON.parse(value);queueMicrotask(()=>{stream.emit('response',{':status':status});stream.emit('data',JSON.stringify({reason}));stream.emit('end');});};return stream;};
 vi.mocked(connect).mockReturnValue(connection);
 expect(await sendNativePush({platform:'ios',token:'a'.repeat(64),reportId:'report_one',eventKey:'a'.repeat(64)},{apnsKey:key,apnsKeyId:'test-key',apnsTeamId:'test-team',apnsEnvironment:'sandbox'})).toBe(expected);
 expect(wire['apns-topic']).toBe('app.agentproof.mobile');expect(wire['apns-push-type']).toBe('alert');expect(body.aps.alert.title).toBe('DiffEvidence');expect(body.reportId).toBe('report_one');expect(connection.destroy).toHaveBeenCalled();
});
it('claims a device once, binds current auth before sending and reuses one event without another delivery',async()=>{
 const key=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;
 const env={NODE_ENV:'test',AGENTPROOF_PUBLIC_AUTH_SECRET:secret,SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'not-real',AGENTPROOF_FCM_CLIENT_EMAIL:'test@example.invalid',AGENTPROOF_FCM_PRIVATE_KEY:key,AGENTPROOF_FCM_PROJECT_ID:'test-project'} as NodeJS.ProcessEnv;
 const id='00000000-0000-4000-8000-000000000001';let claims=0;const calls:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{calls.push([url,init]);
  if(String(url).endsWith('agentproof_claim_mobile_push'))return Response.json(claims++===0?[{device_id:id,platform:'android',token_hash:'b'.repeat(64),session_hash:'c'.repeat(64),token_ciphertext:sealPushToken('private-device-token',id+':tenant_a',secret)}]:[]);
  if(String(url).endsWith('agentproof_mobile_push_current'))return Response.json(true);
  if(String(url).includes('oauth2.googleapis.com'))return Response.json({access_token:'synthetic-access'});
  if(String(url).includes('fcm.googleapis.com'))return Response.json({name:'accepted'});
  return Response.json(null);
 }));
 expect(await dispatchMobileReportReady({tenantId:'tenant_a',repositoryId:9,reportId:'report_one'},env)).toMatchObject({status:'processed',counts:{sent:1}});
 expect(await dispatchMobileReportReady({tenantId:'tenant_a',repositoryId:9,reportId:'report_one'},env)).toMatchObject({counts:{}});
 expect(calls.filter(([url])=>url.includes('fcm.googleapis.com'))).toHaveLength(1);
 const dbBodies=calls.filter(([url])=>url.startsWith('https://db.example')).map(([,init])=>init.body);expect(JSON.stringify(dbBodies)).not.toContain('private-device-token');
 expect(JSON.parse(dbBodies.at(-1))).toHaveProperty('p_event');
});

it('does not immediately retry a provider Retry-After response',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({}, {status:503,headers:{'Retry-After':'60'}})));
 expect(await sendNativePush({platform:'android',token:'fcm-device',reportId:'report_one',eventKey:'a'.repeat(64)},{firebaseProject:'demo',firebaseAccessToken:async()=> 'synthetic'})).toBe('failed');
});

it('accepts a PostgREST void/204 delivery ACK without turning a successful write into unavailable',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(null,{status:204})));
 await expect(pushRpc('agentproof_finish_mobile_push',{p_outcome:'sent'},{NODE_ENV:'test',SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'synthetic'})).resolves.toBeNull();
});
