import { describe, expect, it } from 'vitest';
import { createNativeWorkspaceClient } from './workspace-client';

const origin='https://agentproof-pearl.vercel.app';
describe('native workspace account boundary',()=>{
 it('routes shared code reads and inbox dismissal through the native session endpoints',async()=>{
  const sent:any[]=[];
  const client=createNativeWorkspaceClient({origin,token:'apm_account-a',send:async options=>{sent.push(options);return {status:200,data:{ok:true}};},onExpired:()=>{},navigate:()=>{}});
  await client.runtime.request('/api/dashboard/report-code?reportId=one&reference=code%3A25');
  await client.runtime.request('/api/dashboard/activity',{method:'POST',body:'{}'});
  expect(sent.map(item=>[item.url,item.method])).toEqual([[`${origin}/api/mobile/report-code?reportId=one&reference=code%3A25`,'GET'],[`${origin}/api/mobile/activity`,'POST']]);
  expect(sent.every(item=>item.headers.Authorization==='Bearer apm_account-a'&&!item.headers.cookie)).toBe(true);
 });
 it('sends the chosen PR to the mobile analysis endpoint with only the native bearer',async()=>{
  const sent:any[]=[];
  const client=createNativeWorkspaceClient({origin,token:'apm_account-a',send:async options=>{sent.push(options);return {status:200,data:{report:{analysisId:'analysis-a'}}};},onExpired:()=>{},navigate:()=>{}});
  const response=await client.runtime.request('/api/analyze',{method:'POST',headers:{cookie:'web=unsafe',origin:'https://web.example','x-agentproof-analysis-key':'request-one'},body:JSON.stringify({prUrl:'https://github.com/owner/repo/pull/12'})});
  expect(await response.json()).toEqual({report:{analysisId:'analysis-a'}});
  expect(sent).toEqual([expect.objectContaining({url:`${origin}/api/mobile/analyze`,method:'POST',data:{prUrl:'https://github.com/owner/repo/pull/12'},headers:{Authorization:'Bearer apm_account-a','Content-Type':'application/json','Cache-Control':'no-store','x-agentproof-analysis-key':'request-one'}})]);
 });
 it('clears account memory on 401 and prevents late results or further calls from the old account',async()=>{
  let resolve!: (value:{status:number,data:unknown})=>void;
  let expired=0;
  let calls=0;
  const client=createNativeWorkspaceClient({origin,token:'apm_account-a',send:async()=>{calls++;return calls===1?new Promise(r=>{resolve=r;}):{status:401,data:{}};},onExpired:()=>{expired++;},navigate:()=>{}});
  client.runtime.storage.setItem('report','old account');
  const pending=client.runtime.request('/api/dashboard/reports');
  const rejected=expect(pending).rejects.toThrow('Session ended');
  await client.runtime.request('/api/dashboard/session');
  expect(client.runtime.storage.getItem('report')).toBeNull();
  expect(expired).toBe(1);
  resolve({status:200,data:{reports:['old account']}});await rejected;
  await expect(client.runtime.request('/api/dashboard/reports')).rejects.toThrow('Session ended');
  expect(calls).toBe(2);
 });
 it('keeps launch and report data isolated across clients and clears it on logout',async()=>{
  const options={origin,send:async()=>({status:200,data:{ok:true}}),onExpired:()=>{},navigate:()=>{}};
  const a=createNativeWorkspaceClient({...options,token:'apm_account-a'}), b=createNativeWorkspaceClient({...options,token:'apm_account-b'});
  a.runtime.launchStorage.setItem('pending','a');a.runtime.storage.setItem('report','a');
  expect(b.runtime.storage.getItem('report')).toBeNull();expect(b.runtime.launchStorage.getItem('pending')).toBeNull();
  await a.runtime.request('/api/tenants/auth/session',{method:'DELETE'});
  expect(a.runtime.storage.length).toBe(0);expect(a.runtime.launchStorage.length).toBe(0);
 });
 it('does not send bearer tokens to unrecognized or remote URLs',async()=>{
  let calls=0;
  const client=createNativeWorkspaceClient({origin,token:'apm_account-a',send:async()=>{calls++;return {status:200,data:{}};},onExpired:()=>{},navigate:()=>{}});
  for(const path of ['https://evil.example','//evil.example','/api/unknown','/api/dashboard/reports/../session'])await expect(client.runtime.request(path)).rejects.toThrow('Unsupported');
  expect(calls).toBe(0);
 });
});
it('blocks normal reads and clears late results when deletion becomes pending, while permitting deletion retry',async()=>{
 let resolve!:(value:{status:number,data:unknown})=>void;
 const client=createNativeWorkspaceClient({origin,token:'apm_a',navigate:()=>{},onExpired:()=>{},send:async options=>options.url.endsWith('/reports')?new Promise(r=>{resolve=r;}):{status:202,data:{status:'pending'}}});
 client.runtime.storage.setItem('old','report');
 const pending=client.runtime.request('/api/dashboard/reports');const rejected=expect(pending).rejects.toThrow('Session ended');
 await client.runtime.request('/api/mobile/account/deletion');
 expect(client.runtime.storage.length).toBe(0);
 resolve({status:200,data:{reports:['old']}});await rejected;
 await expect(client.runtime.request('/api/dashboard/reports')).rejects.toThrow('Account deletion');
 expect((await client.runtime.request('/api/mobile/account/deletion',{method:'POST',body:JSON.stringify({confirmation:'DELETE'})})).status).toBe(202);
});
