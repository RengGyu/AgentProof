import{resolveWorkspaceAccess,validWorkspaceMutation}from'./access';
import{csrfFailureResponse}from'../csrf';
import{noStoreJson}from'../http';
import{analysisHash}from'../analysis-diagnostics';
import{parseAnalysisClientEvent}from'../analysis-client-diagnostics';
// Ephemeral per-instance abuse bound only; never analysis admission or durable telemetry.
const rates=new Map<string,{since:number;count:number}>();
export async function POST(request:Request){
 if(process.env.AGENTPROOF_ANALYSIS_DIAGNOSTICS!=='1')return noStoreJson({error:'Not found.'},{status:404});
 try{
  if(!validWorkspaceMutation(request,'web'))return csrfFailureResponse();
  const access=await resolveWorkspaceAccess(request,'web');
  if(!access.authorized||!access.tenantId||!access.memberId)return noStoreJson({error:'Sign in required.'},{status:401});
  const tenantHash=analysisHash(access.tenantId),now=Date.now();
  for(const[key,v]of rates)if(now-v.since>=60000)rates.delete(key);
  let rate=rates.get(tenantHash);if(!rate){if(rates.size>=128)return noStoreJson({error:'Diagnostics busy.'},{status:429});rate={since:now,count:0};rates.set(tenantHash,rate);}
  if(++rate.count>20)return noStoreJson({error:'Diagnostic rate limit.'},{status:429});
  if(request.headers.get('content-type')?.split(';')[0]!=='application/json')return noStoreJson({error:'Invalid diagnostic content type.'},{status:415});
  const reader=request.body?.getReader();if(!reader)return noStoreJson({error:'Invalid diagnostic.'},{status:400});
  const chunks:Uint8Array[]=[];let bytes=0,expired=false;
  const cancel=()=>{expired=true;void reader.cancel().catch(()=>{});};
  const timeout=setTimeout(cancel,3000);request.signal.addEventListener('abort',cancel,{once:true});
  try{while(true){request.signal.throwIfAborted();const{value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>12288){await reader.cancel();return noStoreJson({error:'Diagnostic too large.'},{status:413});}chunks.push(value);}}finally{clearTimeout(timeout);request.signal.removeEventListener('abort',cancel);reader.releaseLock();}
  if(expired)return noStoreJson({error:'Diagnostic incomplete.'},{status:408});
  const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!Array.isArray(body.events)||body.events.length<1||body.events.length>16)return noStoreJson({error:'Invalid diagnostic.'},{status:400});
  const events=body.events.map(parseAnalysisClientEvent);
  if(events.some((e:Record<string,unknown>|null)=>!e||Date.parse(String(e.at))<now-900000||Date.parse(String(e.at))>now+60000))return noStoreJson({error:'Invalid diagnostic.'},{status:400});
  // Tenant is server-owned. Client events remain untrusted observations, never execution/report authority.
  for(const event of events)console.info('agentproof_analysis_client_diagnostic',JSON.stringify({...event,tenantHash}));
  return noStoreJson({accepted:events.length},{status:202});
 }catch(error){return noStoreJson({error:'Diagnostic unavailable.'},{status:error instanceof SyntaxError?400:503});}
}
