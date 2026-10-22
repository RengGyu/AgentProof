import {expect,it,vi} from 'vitest';
import {createPushRegistration,reportFromPush} from './push';
const id='00000000-0000-4000-8000-000000000001';
function fixture(){const callbacks:any={},states:string[]=[],writes:any[]=[];const plugin:any={addListener:vi.fn(async(n:string,f:any)=>{callbacks[n]=f;return {remove:vi.fn(async()=>{})};}),checkPermissions:vi.fn(async()=>({receive:'granted'})),requestPermissions:vi.fn(async()=>({receive:'granted'})),register:vi.fn(async()=>{}),unregister:vi.fn(async()=>{}),removeAllDeliveredNotifications:vi.fn(async()=>{}),createChannel:vi.fn(async()=>{})};const runtime:any={request:vi.fn(async(p:string,i:any)=>{writes.push([p,i]);return Response.json({enabled:i.method==='POST',available:true});})};const registration=createPushRegistration({plugin,runtime,platform:'android',deviceId:id,onState:s=>states.push(s)});return {plugin,runtime,callbacks,states,writes,registration};}
it('does not prompt on login/resume; only an explicit enable requests OS permission',async()=>{
 const x=fixture();await x.registration.resume();expect(x.plugin.requestPermissions).not.toHaveBeenCalled();expect(x.plugin.register).not.toHaveBeenCalled();
 x.plugin.checkPermissions.mockResolvedValue({receive:'prompt'});await x.registration.enable();expect(x.plugin.requestPermissions).toHaveBeenCalledTimes(1);
 await x.callbacks.registration({value:'first-token'});await x.callbacks.registration({value:'rotated-token'});
 expect(x.writes.filter(([,i])=>i.method==='POST').map(([,i])=>JSON.parse(i.body).token)).toEqual(['first-token','rotated-token']);expect(x.states.at(-1)).toBe('on');
 await x.registration.disable();expect(x.writes.at(-1)[1].method).toBe('DELETE');expect(x.plugin.unregister).toHaveBeenCalledTimes(1);
});
it('does not send a token after denied permission, logout, or late registration',async()=>{
 const x=fixture();x.plugin.checkPermissions.mockResolvedValue({receive:'denied'});await x.registration.enable();await x.callbacks.registration({value:'private-token'});
 expect(x.writes.every(([,i])=>i.method==='GET')).toBe(true);expect(x.states.at(-1)).toBe('denied');
 x.registration.dispose();await x.callbacks.registration({value:'private-token'});expect(x.writes.every(([,i])=>i.method==='GET')).toBe(true);expect(x.plugin.unregister).toHaveBeenCalled();
});
it('turns an OS permission revocation into a server opt-out without prompting again',async()=>{
 const x=fixture();x.runtime.request.mockResolvedValue(Response.json({enabled:true,available:true}));x.plugin.checkPermissions.mockResolvedValue({receive:'denied'});await x.registration.resume();
 expect(x.plugin.requestPermissions).not.toHaveBeenCalled();expect(x.writes.filter(([,i])=>i.method==='POST')).toHaveLength(0);expect(x.runtime.request.mock.calls.some(([,i]:any)=>i.method==='DELETE')).toBe(true);expect(x.states.at(-1)).toBe('denied');
});
it('keeps registry failures visible without exposing arbitrary exception text',async()=>{
 const x=fixture();x.runtime.request.mockRejectedValue(new Error('private-secret-canary'));await x.registration.resume();expect(x.states.at(-1)).toBe('unavailable');expect(JSON.stringify(x.states)).not.toContain('private-secret');
});
it('accepts only an opaque report ID, never a notification URL, path or session',()=>{
 expect(reportFromPush({reportId:'tenant_a_report_123',url:'https://evil.example'})).toBe('tenant_a_report_123');
 for(const data of [null,{url:'/reports/x'},{reportId:'../admin'},{reportId:'https://evil.example'}])expect(reportFromPush(data)).toBeNull();
});

it('does not claim On from a 200 registry response that did not acknowledge registration',async()=>{
 const x=fixture();await x.registration.enable();x.runtime.request.mockResolvedValueOnce(Response.json({enabled:false,available:true}));await x.callbacks.registration({value:'token'});expect(x.states.at(-1)).toBe('unavailable');
});
it('checks Android display permission even when the OS runtime permission API reports granted',async()=>{
 const x=fixture();const registration=createPushRegistration({plugin:x.plugin,runtime:x.runtime,platform:'android',deviceId:id,onState:s=>x.states.push(s),canDisplay:async()=>false});
 await registration.enable();expect(x.plugin.register).not.toHaveBeenCalled();expect(x.states.at(-1)).toBe('denied');
});
