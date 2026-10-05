import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
const hooks = vi.hoisted(() => ({updates:[] as unknown[],effects:[] as Array<()=>void>,stateIndex:0,states:[] as unknown[]}));
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial:unknown) => { const index=hooks.stateIndex++; return [index in hooks.states ? hooks.states[index] : initial,(value:unknown)=>hooks.updates.push(value)]; },
  useMemo: (factory:()=>unknown) => factory(),
  useRef: () => ({current:null}),
  useEffect: (effect:()=>void) => hooks.effects.push(effect),
}));
import { AnalyzeWorkspace } from './AnalyzeWorkspace';
import { ReportView } from './ReportView';
import { generateVerificationReport } from '@/lib/verifier';
import { demoScenarios } from '@/lib/sample-data';

// Invoke the components' real event handlers with browser failures injected;
// these are handler tests, not a mounted browser or layout test.
function button(tree:ReactNode,name:string):{onClick:()=>unknown} {
  const text=(node:ReactNode):string=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'&&'props' in node?text((node as ReactElement<{children?:ReactNode}>).props.children):'';
  const find=(node:ReactNode):{onClick:()=>unknown}|undefined=>{
    if(Array.isArray(node)){for(const child of node){const found=find(child);if(found)return found;}return;}
    if(!node||typeof node!=='object'||!('props' in node))return;
    const element=node as ReactElement<{children?:ReactNode;onClick:()=>unknown;'aria-label'?:string}>;
    if(element.type==='button'&&(text(element.props.children).trim()===name||element.props['aria-label']===name))return element.props;
    return find(element.props.children);
  };
  const found=find(tree);if(!found)throw Error(`Button unavailable: ${name}`);return found;
}
function visibleText(node:ReactNode):string {
  return typeof node==='string'?node:Array.isArray(node)?node.map(visibleText).join(' '):node&&typeof node==='object'&&'props' in node?visibleText((node as ReactElement<{children?:ReactNode}>).props.children):'';
}
const report=generateVerificationReport(demoScenarios.clean);
const launchNonce='11111111-1111-4111-8111-111111111111';
const selectedPrUrl='https://github.com/owner/repo/pull/12';
const selectedHead='a'.repeat(40);
beforeEach(()=>{
 hooks.updates=[];hooks.effects=[];hooks.stateIndex=0;hooks.states=[];
 vi.stubGlobal('window',{location:{origin:'http://localhost:3100'},localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},sessionStorage:{getItem:()=>JSON.stringify({nonce:launchNonce,prUrl:selectedPrUrl,listedHeadSha:selectedHead}),removeItem:vi.fn()},setTimeout:()=>0});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({report})));
});
afterEach(()=>vi.unstubAllGlobals());

describe('analysis and share failure states',()=>{
 it('shows when a browser-local summary was saved in Recent',()=>{
  hooks.states[6]=[{id:'local-report',savedAt:'2026-09-30T01:00:00.000Z',title:'PR 12',priority:'medium',evidenceCoverage:50,report}];
  const copy=visibleText(AnalyzeWorkspace({}));
  expect(copy).toContain('PR 12');
  expect(copy).toContain('Saved');
  expect(copy).toContain('2026');
 });
 it('retains a successful report and reports a history-only warning when storage is full',async()=>{
  window.localStorage.setItem=()=>{throw new DOMException('QUOTA_PRIVATE_DETAIL','QuotaExceededError');};
  await button(AnalyzeWorkspace({}), 'Generate report').onClick();
  expect(hooks.updates).toContainEqual(report);
  expect(hooks.updates).toContain('Report generated, but browser history could not be saved. Keep this page open or download the report.');
  expect(JSON.stringify(hooks.updates)).not.toContain('Could not reach the analysis service');
  expect(JSON.stringify(hooks.updates)).not.toContain('QUOTA_PRIVATE_DETAIL');
 });
 it('does not crash initial history loading when browser storage access is denied',()=>{
  Object.defineProperty(window,'localStorage',{get:()=>{throw new DOMException('BLOCKED','SecurityError');}});
  AnalyzeWorkspace({});
  expect(()=>hooks.effects[0]!()).not.toThrow();
 });
 it('reports a local history clear failure without erasing its displayed state',()=>{
  window.localStorage.removeItem=()=>{throw Error('PRIVATE_STORAGE_DETAIL');};
  expect(()=>button(AnalyzeWorkspace({}),'Clear recent reports').onClick()).not.toThrow();
  expect(hooks.updates).toContain('Browser history could not be cleared. Check this browser’s storage permissions.');
 });
 it('preserves the previous report when a network request fails without exposing the raw error',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('PRIVATE_NETWORK_DETAIL');}));
  await button(AnalyzeWorkspace({initialReport:report}),'Generate report').onClick();
  expect(hooks.updates).toContainEqual(expect.objectContaining({message:'Could not reach the analysis service.'}));
  expect(hooks.updates).not.toContainEqual(report);
  expect(JSON.stringify(hooks.updates)).not.toContain('PRIVATE_NETWORK_DETAIL');
 });
 it('hides portable sharing while retaining explicit report exports',()=>{
  const full=ReportView({report});
  expect(()=>button(full,'Copy Share Link')).toThrow('Button unavailable: Copy Share Link');
  expect(()=>button(full,'Copy Report')).not.toThrow();
  expect(()=>button(full,'Copy PR Comment')).not.toThrow();
  expect(()=>button(full,'Download')).not.toThrow();
  expect(()=>button(ReportView({report,mode:'summary'}),'Copy Share Link')).toThrow('Button unavailable: Copy Share Link');
 });
});

describe('analysis login handlers',()=>{
 it('starts existing OAuth with only an allowlisted return destination',async()=>{
  // Error is the ninth state slot in this handler-only harness.
  hooks.states[8]={message:'Sign in',loginRequired:true};
  const assign=vi.fn();window.location.assign=assign;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({authorizationUrl:'https://github.com/login/oauth/authorize?state=test'})));
  await button(AnalyzeWorkspace({}), 'Sign in with GitHub').onClick();
  expect(fetch).toHaveBeenCalledWith('/api/auth/github/start',expect.objectContaining({body:JSON.stringify({returnTo:'/analyze'}),headers:expect.objectContaining({'x-agentproof-csrf':'same-origin'})}));
  expect(assign).toHaveBeenCalledWith('https://github.com/login/oauth/authorize?state=test');
 });
 it('keeps sign-in failure bounded and retryable',async()=>{
  hooks.states[8]={message:'Sign in',loginRequired:true};
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('PRIVATE_OAUTH_ERROR',{status:503})));
  await button(AnalyzeWorkspace({}), 'Sign in with GitHub').onClick();
  expect(hooks.updates).toContainEqual(expect.objectContaining({loginRequired:true,message:'GitHub sign-in is temporarily unavailable.'}));
  expect(JSON.stringify(hooks.updates)).not.toContain('PRIVATE_OAUTH_ERROR');
 });
 it('starts GitHub App installation for an owned repository',async()=>{
  hooks.states[8]={message:'Install',installRequired:true};
  const assign=vi.fn();window.location.assign=assign;
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({installUrl:'https://github.com/apps/agentproof/installations/new?state=test'})));
  await button(AnalyzeWorkspace({}), 'Install GitHub App').onClick();
  expect(fetch).toHaveBeenCalledWith('/api/github/onboarding/start',expect.objectContaining({body:'{}',headers:expect.objectContaining({'x-agentproof-csrf':'same-origin'})}));
  expect(assign).toHaveBeenCalledWith('https://github.com/apps/agentproof/installations/new?state=test');
 });
});

describe('selected PR analysis handoff',()=>{
 const prUrl=selectedPrUrl;
 const listedHead=selectedHead;
 const capturedHead='b'.repeat(40);
 it('automatically submits the selected PR URL once through the existing analysis endpoint',async()=>{
  const matched={...report,source:{...report.source,url:prUrl,provenance:{...report.source.provenance!,origin:'github_snapshot' as const,headSha:capturedHead}}};
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({report:matched})));
  AnalyzeWorkspace({launchNonce});
  for(const effect of hooks.effects) await effect();
  for(const effect of hooks.effects) await effect();
  await new Promise(resolve=>setTimeout(resolve,0));
  const calls=vi.mocked(fetch).mock.calls.filter(([url])=>url==='/api/analyze');
  expect(calls).toHaveLength(1);
  expect(window.sessionStorage.removeItem).toHaveBeenCalledWith('agentproof.pendingAnalysis.v1');
  expect(JSON.parse(String(calls[0]![1]?.body))).toEqual({prUrl,taskText:'',prDescription:'',changedFiles:'',checks:'',logs:''});
  expect(hooks.updates).toContainEqual(matched);
 });
 it('rejects a returned report for a different PR or without GitHub head provenance',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({report})));
  AnalyzeWorkspace({launchNonce});
  for(const effect of hooks.effects) await effect();
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(hooks.updates).toContainEqual(expect.objectContaining({message:'Analysis response did not match the selected PR.'}));
  expect(hooks.updates).not.toContainEqual(report);
 });
 it('shows the captured head separately when the PR advanced after the list was read',()=>{
  const matched={...report,source:{...report.source,url:prUrl,provenance:{...report.source.provenance!,origin:'github_snapshot' as const,headSha:capturedHead}}};
  hooks.states[10]={prUrl,listedHeadSha:listedHead};
  const text=visibleText(AnalyzeWorkspace({initialReport:matched}));
  expect(text).toContain(listedHead);
  expect(text).toContain(capturedHead);
  expect(text).toContain('PR head changed since the list was loaded');
 });
 it.each([
  [409,'Private repository analysis is off until its code-analysis notice is accepted.','github_private_consent_required'],
  [401,'Sign in with GitHub to analyze a PR URL.','github_login_required'],
  [429,'Too many requests. Please wait before retrying.','paid_budget_exhausted'],
 ])('keeps the existing %i analysis error on screen',async(status,message,code)=>{
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:message,code},{status})));
  AnalyzeWorkspace({launchNonce});
  for(const effect of hooks.effects) await effect();
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(hooks.updates).toContainEqual(expect.objectContaining({message}));
  expect(hooks.updates).not.toContainEqual(report);
 });
 it('does not start analysis when a link has no matching one-time browser handoff',async()=>{
  window.sessionStorage.getItem=()=>null;
  AnalyzeWorkspace({launchNonce});
  for(const effect of hooks.effects) await effect();
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(fetch).not.toHaveBeenCalled();
  expect(hooks.updates).toContainEqual(expect.objectContaining({message:'Selected PR analysis could not be started.'}));
 });
});

it('submits the selected native PR through its session transport and saves only to supplied memory',async()=>{
 const writes = new Map<string,string>();
 const memory: Storage = {get length(){return writes.size;},clear:()=>writes.clear(),key:(index:number)=>[...writes.keys()][index]??null,getItem:(key:string)=>writes.get(key)??null,setItem:(key:string,value:string)=>{writes.set(key,value);},removeItem:(key:string)=>{writes.delete(key);}};
 memory.setItem('agentproof.pendingAnalysis.v1',JSON.stringify({nonce:launchNonce,prUrl:selectedPrUrl,listedHeadSha:selectedHead}));
 const matched={...report,source:{...report.source,url:selectedPrUrl,provenance:{...report.source.provenance!,version:1 as const,origin:'github_snapshot' as const,headSha:selectedHead,evidenceCapturedAt:'2026-09-30T00:00:00Z',inputFingerprint:{version:1 as const,algorithm:'sha256' as const,value:'d'.repeat(64),coverage:'github_metadata' as const}}}};
 const requests: Array<{path:string, body:unknown}> = [];
 const runtime = {storage:memory,launchStorage:memory,navigate:()=>{},request:async(path:string,init?:RequestInit)=>{requests.push({path,body:JSON.parse(String(init?.body))});return Response.json({report:matched});}};
 AnalyzeWorkspace({launchNonce, runtime} as any);
 hooks.effects.forEach(work=>work());
 await new Promise(resolve=>setTimeout(resolve,0));
 expect(requests).toEqual([{path:'/api/analyze',body:expect.objectContaining({prUrl:selectedPrUrl})}]);
 expect(memory.getItem('agentproof.pendingAnalysis.v1')).toBeNull();
 expect(memory.getItem('agentproof.recentReports.v1')).toContain(report.analysisId);
 expect(fetch).not.toHaveBeenCalled();
});
