import { recordNavigationTransport, type NavigationTransportDiagnostics } from './review-navigation-diagnostics';
import { GoogleGenAI } from '@google/genai';
import {
  OpenAISemanticError,
  REVIEW_NAVIGATION_INTENT_SCHEMA,
  REVIEW_NAVIGATION_RANKING_SCHEMA,
  reviewNavigationSystemInstruction,
  submitReviewNavigationWithOpenAI
} from './openai-semantic';
import type { ReviewNavigationOptions, ReviewNavigationRequest } from './review-intent';

interface GeminiGenerateRequest {
  model:string;
  contents:string;
  config:{systemInstruction:string;responseMimeType:string;responseJsonSchema:unknown;maxOutputTokens:number};
}
interface GeminiResponse {text?:string;modelVersion?:string;usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number;thoughtsTokenCount?:number};candidates?:Array<{finishReason?:string}>}
type GeminiGenerateContent=(request:GeminiGenerateRequest)=>Promise<GeminiResponse>;
const directModel=(model:string)=>model.replace(/^google\//,'');

export async function submitReviewNavigationWithGemini(
  request:ReviewNavigationRequest,
  options:{apiKey:string;generateContent?:GeminiGenerateContent;onDiagnostics?:(data:NavigationTransportDiagnostics)=>void}
):Promise<unknown> {
  const generateContent=options.generateContent??(input=>new GoogleGenAI({apiKey:options.apiKey}).models.generateContent(input));
  const started=Date.now();
  let response:GeminiResponse;
  try {
    response=await generateContent({
      model:directModel(request.model),
      contents:JSON.stringify(request),
      config:{
        systemInstruction:reviewNavigationSystemInstruction(request.stage),
        responseMimeType:'application/json',
        responseJsonSchema:request.stage==='intent'?REVIEW_NAVIGATION_INTENT_SCHEMA:REVIEW_NAVIGATION_RANKING_SCHEMA,
        maxOutputTokens:6000
      }
    });
  } catch {
    recordNavigationTransport(request,{provider:'google',started,finishReasons:['failed']},options.onDiagnostics);
    throw new OpenAISemanticError('openai_provider_unavailable',true,'Gemini navigation provider unavailable.');
  }
  const text=response.text;
  recordNavigationTransport(request,{provider:'google',started,text,modelVersion:response.modelVersion,inputTokens:response.usageMetadata?.promptTokenCount,outputTokens:response.usageMetadata?.candidatesTokenCount,thoughtTokens:response.usageMetadata?.thoughtsTokenCount,finishReasons:response.candidates?.map(c=>c.finishReason)},options.onDiagnostics);
  if(!text||text.length>48000)throw new OpenAISemanticError('openai_output_invalid',false,'Navigation output unavailable.',undefined,undefined,undefined,'provider_output_unavailable');
  try{return JSON.parse(text);}catch{throw new OpenAISemanticError('openai_output_invalid',false,'Navigation output invalid.',undefined,undefined,undefined,'provider_invalid_json');}
}

/** Navigation uses Google Gemini directly; the legacy variable name remains a compatibility alias. */
export function resolveNavigationProvider(env:Record<string,string|undefined>):Pick<ReviewNavigationOptions,'model'|'provider'> {
  const geminiKey=env.GEMINI_API_KEY?.trim()||env.AI_GATEWAY_API_KEY?.trim();
  if(geminiKey){
    const model=directModel(env.AGENTPROOF_LLM_MODEL?.trim()||'gemini-3.8-flash');
    return {model,provider:request=>submitReviewNavigationWithGemini(request,{apiKey:geminiKey})};
  }
  const apiKey=env.OPENAI_API_KEY?.trim(),model=env.OPENAI_MODEL?.trim();
  return {model:model??'unconfigured',...(apiKey&&model?{provider:(request:ReviewNavigationRequest)=>submitReviewNavigationWithOpenAI(request,{apiKey})}:{})};
}
