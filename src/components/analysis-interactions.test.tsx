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
const report=generateVerificationReport(demoScenarios.clean);
beforeEach(()=>{
 hooks.updates=[];hooks.effects=[];hooks.stateIndex=0;hooks.states=[];
 vi.stubGlobal('window',{location:{origin:'http://localhost:3100'},localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},setTimeout:()=>0});
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({report})));
});
afterEach(()=>vi.unstubAllGlobals());

describe('analysis and share failure states',()=>{
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
 it('never reports share-copy success when both clipboard paths fail',async()=>{
  vi.stubGlobal('navigator',{clipboard:{writeText:async()=>{throw Error('denied');}}});
  vi.stubGlobal('document',undefined);
  await button(ReportView({report}),'Copy Share Link').onClick();
  expect(hooks.updates).toContainEqual(expect.objectContaining({tone:'error'}));
  expect(hooks.updates).not.toContainEqual(expect.objectContaining({text:'Summary share link copied.'}));
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
