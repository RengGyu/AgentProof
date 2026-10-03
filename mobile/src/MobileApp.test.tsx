import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MobileApp} from './MobileApp';
const hooks=vi.hoisted(()=>({slots:[] as any[],index:0,effects:[] as Array<()=>void>,listeners:{} as Record<string,(value:any)=>unknown>,requests:[] as any[]}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState(initial:any){const i=hooks.index++;if(!(i in hooks.slots))hooks.slots[i]=typeof initial==='function'?initial():initial;return [hooks.slots[i],(value:any)=>hooks.slots[i]=typeof value==='function'?value(hooks.slots[i]):value];},useRef(initial:any){const i=hooks.index++;return hooks.slots[i]??={current:initial};},useCallback(fn:any){return fn;},useEffect(work:any,deps:any[]){const i=hooks.index++,prior=hooks.slots[i];if(!prior||deps.some((v,j)=>v!==prior.deps[j]))hooks.effects.push(()=>{prior?.cleanup?.();hooks.slots[i]={deps,cleanup:work()};});}}));
vi.mock('@capacitor/app',()=>({App:{addListener:async(name:string,callback:any)=>{hooks.listeners[name]=callback;return {remove:async()=>{}};}}}));
vi.mock('@capacitor/browser',()=>({Browser:{open:vi.fn(async()=>{}),close:vi.fn(async()=>{}),addListener:async(name:string,callback:any)=>{hooks.listeners[name]=callback;return {remove:async()=>{}};}}}));
vi.mock('@capacitor/core',()=>({CapacitorHttp:{post:vi.fn(async(options:any)=>{hooks.requests.push(options);return {status:200,data:{token:'apm_'+'a'.repeat(43)}};}),request:vi.fn(async(options:any)=>{hooks.requests.push(options);return {status:200,data:options.url.endsWith('/deletion')?{status:'ready'}:{signedIn:true}};})}}));
// Child screens retain their own consumer tests; this harness exercises the actual shell lifecycle.
vi.mock('../../src/components/PublicGitHubDashboard',()=>({PublicGitHubDashboard:()=>null,WorkspaceSignIn:()=>null}));
vi.mock('../../src/components/AnalyzeWorkspace',()=>({AnalyzeWorkspace:()=>null}));
vi.mock('../../src/components/AccountDeletionPanel',()=>({default:()=>null,parseDeletionResult:(value:any)=>value}));
import {Browser} from '@capacitor/browser';
import {CapacitorHttp} from '@capacitor/core';
let tree:any;
function nodes(value:any=tree):any[]{return Array.isArray(value)?value.flatMap(nodes):value?.props?[value,...nodes(value.props.children??null)]:[];}
function render(){hooks.index=0;tree=MobileApp({apiOrigin:'https://agentproof-pearl.vercel.app'});hooks.effects.splice(0).forEach(fn=>fn());return tree;}
async function settle(){await new Promise(r=>setTimeout(r,0));render();}
function screen(name:string){return nodes().find(n=>typeof n.type==='function'&&n.type.name===name);}
beforeEach(()=>{hooks.slots=[];hooks.index=0;hooks.effects=[];hooks.listeners={};hooks.requests=[];vi.clearAllMocks();render();});
afterEach(()=>{hooks.slots.forEach(item=>item?.cleanup?.());vi.unstubAllGlobals();});
it('keeps the signed-in dashboard locally bundled after a native callback and routes PR launch into the shared analysis screen',async()=>{
 await screen('WorkspaceSignIn')?.props.onSignIn();await settle();
 expect(Browser.open).toHaveBeenCalledWith({url:expect.stringContaining('/api/mobile/auth/start?challenge=')});
 await hooks.listeners.appUrlOpen({url:'agentproof://auth/callback?code='+'c'.repeat(43)});await settle();await settle();
 const dashboard=screen('PublicGitHubDashboard');expect(dashboard).toBeDefined();
 dashboard.props.runtime.navigate('/analyze?launch=launch-id');render();
 expect(screen('AnalyzeWorkspace')?.props.launchNonce).toBe('launch-id');
 expect(screen('AnalyzeWorkspace')?.props.runtime).toBe(dashboard.props.runtime);
 expect(hooks.requests[0].data.verifier).toMatch(/^[\w-]{64}$/);
 expect(JSON.stringify(hooks.requests)).not.toContain('cookie');
});
it('drops the account screen immediately on logout even when server revocation fails',async()=>{
 await screen('WorkspaceSignIn')?.props.onSignIn();await hooks.listeners.appUrlOpen({url:'agentproof://auth/callback?code='+'c'.repeat(43)});await settle();await settle();
 const dashboard=screen('PublicGitHubDashboard');expect(dashboard).toBeDefined();
 vi.mocked(CapacitorHttp.request).mockRejectedValueOnce(new Error('offline'));
 const call=dashboard.props.runtime.request('/api/tenants/auth/session',{method:'DELETE'});
 await expect(call).rejects.toThrow();render();
 expect(screen('WorkspaceSignIn')).toBeDefined();expect(screen('PublicGitHubDashboard')).toBeUndefined();
});
it('does not exchange unsolicited callbacks or cancel an exchange when the browser closes',async()=>{
 await hooks.listeners.appUrlOpen?.({url:'agentproof://auth/callback?code='+'c'.repeat(43)});expect(CapacitorHttp.post).not.toHaveBeenCalled();
 await screen('WorkspaceSignIn')?.props.onSignIn();
 let resolve!:(value:any)=>void;
 vi.mocked(CapacitorHttp.post).mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const exchange=hooks.listeners.appUrlOpen?.({url:'agentproof://auth/callback?code='+'c'.repeat(43)});await Promise.resolve();await Promise.resolve();
 hooks.listeners.browserFinished?.({});resolve({status:200,data:{token:'apm_'+'a'.repeat(43)}});await exchange;await settle();await settle();
 expect(screen('PublicGitHubDashboard')).toBeDefined();
});
