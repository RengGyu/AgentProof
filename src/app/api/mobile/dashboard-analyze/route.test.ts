import {expect,it,vi} from 'vitest';
const analyze=vi.hoisted(()=>vi.fn(async()=>Response.json({ok:true})));
vi.mock('@/lib/workspace-server/queued-analysis',()=>({POST:analyze,GET:vi.fn()}));
import {POST}from'./route';
it('selects the same retained workspace boundary for native PR analysis, not a temporary evaluation route',async()=>{
 const request=new Request('https://app.example/api/mobile/dashboard-analyze',{method:'POST'});await POST(request);expect(analyze).toHaveBeenCalledWith(request,'mobile');
});
