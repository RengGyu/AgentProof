import { submitReviewNavigationWithOpenAI } from './openai-semantic';
import type { ReviewNavigationOptions, ReviewNavigationRequest } from './review-intent';

const AI_GATEWAY_RESPONSES_URL='https://ai-gateway.vercel.sh/v1/responses';
const gatewayModel=(model:string)=>model.includes('/')?model:`google/${model}`;

export async function submitReviewNavigationWithGemini(request:ReviewNavigationRequest,options:{apiKey:string;fetchFn?:typeof fetch}):Promise<unknown> {
  const gatewayFetch=options.fetchFn??fetch;
  return submitReviewNavigationWithOpenAI(request,{apiKey:options.apiKey,fetchFn:(_url,init)=>gatewayFetch(AI_GATEWAY_RESPONSES_URL,init)});
}

/** Only navigation opts into Gemini through Vercel AI Gateway; other OpenAI features retain their own configuration. */
export function resolveNavigationProvider(env:Record<string,string|undefined>):Pick<ReviewNavigationOptions,'model'|'provider'> {
  const geminiKey=env.AI_GATEWAY_API_KEY?.trim();
  if(geminiKey)return {model:gatewayModel(env.AGENTPROOF_LLM_MODEL?.trim()||'gemini-3.8-flash'),provider:request=>submitReviewNavigationWithGemini(request,{apiKey:geminiKey})};
  const apiKey=env.OPENAI_API_KEY?.trim(),model=env.OPENAI_MODEL?.trim();
  return {model:model??'unconfigured',...(apiKey&&model?{provider:(request:ReviewNavigationRequest)=>submitReviewNavigationWithOpenAI(request,{apiKey})}:{})};
}
