import type { PushNotificationsPlugin } from '@capacitor/push-notifications';
import type { WorkspaceClient } from '../../src/lib/workspace-client';
export type PushState='off'|'on'|'denied'|'unavailable';
let osCleanup:Promise<unknown>=Promise.resolve();
const reportId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(v);
/** Only the random installation ID is durable locally. Provider/session tokens stay out of JS storage. */
export function pushDeviceId(storage:Storage) {
 const existing=storage.getItem('agentproof.push.device.v1');
 if(existing&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(existing))return existing;
 const id=crypto.randomUUID();storage.setItem('agentproof.push.device.v1',id);return id;
}
export function createPushRegistration(options:{plugin:PushNotificationsPlugin;runtime:WorkspaceClient;platform:'ios'|'android';deviceId:string;onState:(s:PushState)=>void;canDisplay?:()=>Promise<boolean>}) {
 let disposed=false,enabled=false,version=0,chain=Promise.resolve();
 const listeners:Array<{remove():Promise<void>}>=[];
 const request=async(method:string,token?:string)=>{
  const r=await options.runtime.request('/api/mobile/push-devices'+(method==='GET'?'?deviceId='+options.deviceId+'&platform='+options.platform:''),{method,...(method==='GET'?{}:{body:JSON.stringify({deviceId:options.deviceId,...(token?{platform:options.platform,token}:{})})})});
  if(!r.ok)throw Error('push_settings_unavailable');return r.json();
 };
 const set=(s:PushState)=>{if(!disposed)options.onState(s);};
 const registration=async({value}:{value:string})=>{
  const own=version;
  // Serial writes ensure late rotation cannot put the old token back after disable.
  chain=chain.catch(()=>{}).then(async()=>{if(disposed||!enabled||own!==version)return;
   try{const stored=await request('POST',value);if(stored.enabled!==true||stored.available!==true)throw Error('push_settings_unavailable');if(!disposed&&enabled&&own===version)set('on');}catch{if(own===version)set('unavailable');}
  });await chain;
 };
 let listenersReady=true;
 const ready=(async()=>{
  await osCleanup;
  for(const [event,callback] of [['registration',registration],['registrationError',()=>{if(enabled)set('unavailable');}]] as const){
   const listener=await options.plugin.addListener(event as 'registration',callback as (token:{value:string})=>void);
   if(disposed)void listener.remove();else listeners.push(listener);
  }
 })().catch(()=>{listenersReady=false;set('unavailable');});
 async function disable() {
  ++version;enabled=false;
  const stopped=options.plugin.unregister().then(()=>true,()=>false);
  // Stop OS delivery now; serialize OFF after any in-flight server registration.
  chain=chain.catch(()=>{}).then(async()=>{await request('DELETE');});
  let failed=false;try{await chain;}catch{failed=true;}
  if(!await stopped)failed=true;
  await options.plugin.removeAllDeliveredNotifications().catch(()=>{});
  set(failed?'unavailable':'off');
 }
 async function resume() {
  const own=++version;await ready;if(disposed||!listenersReady)return;
  try {
   const stored=await request('GET');if(disposed||own!==version)return;
   if(stored.available!==true){set('unavailable');return;}
   enabled=stored.enabled===true;
   if(!enabled){set('off');return;}
   const permission=await options.plugin.checkPermissions();if(disposed||own!==version)return;
   if(permission.receive!=='granted'||options.canDisplay&&!await options.canDisplay()){await disable();set('denied');return;}
   await options.plugin.register();
  }catch{set('unavailable');}
 }
 async function enable() {
  const own=++version;await ready;if(disposed||!listenersReady)return;
  try {
   const stored=await request('GET');if(disposed||own!==version)return;
   if(stored.available!==true){set('unavailable');return;}
   let permission=await options.plugin.checkPermissions();
   if(permission.receive==='prompt'||permission.receive==='prompt-with-rationale')permission=await options.plugin.requestPermissions();
   if(disposed||own!==version)return;
   if(permission.receive!=='granted'){enabled=false;set('denied');return;}
   if(options.canDisplay&&!await options.canDisplay()){await disable();set('denied');return;}
   enabled=true;
   if(options.platform==='android')await options.plugin.createChannel({id:'reports',name:'Reports',importance:4,visibility:0});
   await options.plugin.register();
  }catch{set('unavailable');}
 }
 function dispose() {
  if(disposed)return;disposed=true;enabled=false;++version;
  for(const listener of listeners)void listener.remove();
  // Best-effort OS cleanup; offline server/OS revocation can remain unconfirmed.
  osCleanup=osCleanup.catch(()=>{}).then(()=>options.plugin.unregister().catch(()=>{})).then(()=>options.plugin.removeAllDeliveredNotifications().catch(()=>{}));
 }
 return {resume,enable,disable,dispose};
}
export function reportFromPush(data:unknown):string|null {
 if(!data||typeof data!=='object'||!('reportId' in data))return null;
 const id=(data as {reportId?:unknown}).reportId;return reportId(id)?id:null;
}
