import type { WorkspaceClient } from '../../src/lib/workspace-client';
type NativeRequest = { url: string; method: string; headers: Record<string,string>; data?: unknown; connectTimeout: number; readTimeout: number };
type Options = { origin: string; token: string; send: (options: NativeRequest) => Promise<{ status: number; data: unknown }>; onExpired: (reason: 'expired' | 'logout') => void; navigate: (path: string) => void };
const routes: Record<string, { path: string; methods: string[] }> = {
  '/api/dashboard/session': {path:'/api/mobile/session',methods:['GET']},
  '/api/dashboard/repositories': {path:'/api/mobile/repositories',methods:['GET']},
  '/api/dashboard/reports': {path:'/api/mobile/reports',methods:['GET']},
  '/api/dashboard/activity': {path:'/api/mobile/activity',methods:['GET','POST']},
  '/api/dashboard/report-code': {path:'/api/mobile/report-code',methods:['GET']},
  '/api/dashboard/pull-requests': {path:'/api/mobile/pull-requests',methods:['GET']},
  '/api/tenants/repositories': {path:'/api/mobile/repository-settings',methods:['PATCH']},
  '/api/tenants/auth/session': {path:'/api/mobile/session',methods:['DELETE']},
  '/api/analyze': {path:'/api/mobile/analyze',methods:['POST']},
  '/api/mobile/account/deletion': {path:'/api/mobile/account/deletion',methods:['GET','POST']}
};
function memoryStorage(): Storage {
  const data = new Map<string,string>();
  return {get length(){return data.size;},getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);},removeItem:key=>{data.delete(key);},clear:()=>data.clear(),key:index=>[...data.keys()][index]??null};
}
export function createNativeWorkspaceClient(options: Options): { runtime: WorkspaceClient; close: () => void } {
  const origin = new URL(options.origin);
  if(origin.protocol !== 'https:' || origin.origin !== options.origin) throw new Error('Secure API origin required');
  let token: string | null = options.token;
  let epoch=0, deleting=false;
  const storage = memoryStorage(), launchStorage = memoryStorage();
  const close = () => { token=null; epoch++; storage.clear(); launchStorage.clear(); };
  const runtime: WorkspaceClient = {
    storage, launchStorage, navigate: options.navigate,
    async request(path, init={}) {
      if(!token) throw new Error('Session ended');
      const question=path.indexOf('?');
      const pathname=question<0?path:path.slice(0,question);
      const route=routes[pathname];
      const method=(init.method??'GET').toUpperCase();
      if(!route || !route.methods.includes(method))throw new Error('Unsupported workspace request');
      if(init.signal?.aborted)throw new DOMException('Aborted','AbortError');
      if(deleting && pathname!=='/api/mobile/account/deletion' && pathname!=='/api/tenants/auth/session')throw new Error('Account deletion is pending');
      const requestEpoch=epoch;
      const session=token;
      const headers: Record<string,string> = {Authorization:`Bearer ${session}`,'Content-Type':'application/json','Cache-Control':'no-store'};
      const key=new Headers(init.headers).get('x-agentproof-analysis-key');
      if(key)headers['x-agentproof-analysis-key']=key;
      const logout=pathname==='/api/tenants/auth/session';
      if(logout){close();options.onExpired('logout');}
      const response=await options.send({url:`${options.origin}${route.path}${question<0?'':path.slice(question)}`,method,headers,...(typeof init.body==='string'?{data:JSON.parse(init.body)}:{}),connectTimeout:10000,readTimeout:method==='POST'&&pathname==='/api/analyze'?300000:30000});
      if(init.signal?.aborted)throw new DOMException('Aborted','AbortError');
      if(!logout && (token!==session || epoch!==requestEpoch))throw new Error('Session ended');
      if(response.status===401){close();options.onExpired('expired');}
      if(pathname==='/api/mobile/account/deletion' && ['pending','completed'].includes(String((response.data as {status?: unknown})?.status))){deleting=true;epoch++;storage.clear();launchStorage.clear();}
      return new Response(response.status===204?null:JSON.stringify(response.data),{status:response.status,headers:{'Content-Type':'application/json'}});
    }
  };
  return {runtime,close};
}
