import {createHash} from 'node:crypto';
import {timeLocate} from './purpose-locate-timing';
import {resolveReportLanguage,type ReportLanguage} from './tenant-report-language';
import {isPrivateAnalysisGrantCurrent} from './github-analysis-access';
import {readGitHubRepositoryPrivate} from './github-repository-visibility';
import {isPurposeReviewForSummary} from './purpose-summary';
import {annotatePurposeFailure} from './purpose-failure';
import {createDeepSeekPurposeProvider} from './purpose-provider-deepseek';
import {createGitHubPurposeRepositoryBackend} from './purpose-repository-github';
import type {PurposeAssessmentOptions} from './purpose-assessment';
import type {PullRequestInput,VerificationReportV2} from './types';
/** Closed failure, safe to return to a tenant. Provider proposals stay request-local. */
export class PurposeAnalysisError extends Error {
 readonly code='purpose_unavailable';
 constructor(cause?:unknown){super('Core purpose analysis could not be completed. No report was saved.',{cause});this.name='PurposeAnalysisError';}
}
/** Operational advisory analyses use one pinned provider; off/shadow legacy contracts remain separate. */
export function createRuntimePurposeOptions(input:PullRequestInput,options:{env:Record<string,string|undefined>;requestCorrelation?:string|null;token?:string;signal?:AbortSignal;readCurrentInput:()=>Promise<PullRequestInput|null>;reportLanguage?:ReportLanguage;privateGrant?:{tenantId:string;repositoryFullName:string;installationId:number;repositoryId:number}}):PurposeAssessmentOptions {
 const grant=options.privateGrant, repo=/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/\d+$/.exec(input.url??'')?.[1];
 if(input.repositoryPrivate!==false && (input.repositoryPrivate!==true||!grant||!options.token||!repo||repo.toLowerCase()!==grant.repositoryFullName.toLowerCase()||!Number.isSafeInteger(grant.repositoryId)||grant.repositoryId<=0||!Number.isSafeInteger(grant.installationId)||grant.installationId<=0))throw new PurposeAnalysisError(new Error('purpose_private_consent_required'));
 const authorizePrivate=input.repositoryPrivate===true?async(signal?:AbortSignal)=>timeLocate('authorization',async()=>{
  signal?.throwIfAborted();
  if(!await timeLocate('private_grant',()=>isPrivateAnalysisGrantCurrent(grant!,options.env as NodeJS.ProcessEnv)))return false;
  const privateNow=await timeLocate('repository_visibility',()=>readGitHubRepositoryPrivate(grant!.repositoryFullName,options.token!,{repositoryId:grant!.repositoryId,signal}));
  signal?.throwIfAborted();
  return privateNow===true&&await timeLocate('private_grant',()=>isPrivateAnalysisGrantCurrent(grant!,options.env as NodeJS.ProcessEnv));
 }):undefined;
 if(!options.env.DEEPSEEK_API_KEY?.trim())throw new PurposeAnalysisError(new Error('purpose_key_missing'));
 return {mode:'advisory',flow:'explore_final_v1',reportLanguage:resolveReportLanguage(options.reportLanguage),provider:createDeepSeekPurposeProvider({apiKey:options.env.DEEPSEEK_API_KEY.trim(),authorizePrivate}),signal:options.signal,authorizePrivate,readCurrentInput:async()=>{
   if(authorizePrivate&&!await authorizePrivate(options.signal))throw new Error('purpose_private_consent_required');
   const current=await options.readCurrentInput();
   if(authorizePrivate&&!await authorizePrivate(options.signal))throw new Error('purpose_private_consent_required');
   return current;
  },localization:{mode:'ai',timingAnchor:{requestCorrelation:options.requestCorrelation,repositoryHash:createHash('sha256').update(repo?.toLowerCase()??'').digest('hex'),pullRequestNumber:Number(input.url?.match(/\/pull\/(\d+)$/)?.[1])},backend:createGitHubPurposeRepositoryBackend(input,{token:options.token,...(authorizePrivate?{privateAccess:{repositoryId:grant!.repositoryId,authorize:authorizePrivate}}:{})}),onInvalid:({reason})=>{const cause=new Error(reason);annotatePurposeFailure(cause,{stage:'locate',phase:'validation'});throw new PurposeAnalysisError(cause);}}};
}
export function requireCompletedPurpose(report:VerificationReportV2):void {
 if(!report.purposeAssessment||!isPurposeReviewForSummary(report.purposeReview,report.purposeAssessmentSummary))throw new PurposeAnalysisError(new Error('purpose_core_unavailable'));
}
