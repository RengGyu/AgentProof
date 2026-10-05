import assert from 'node:assert/strict';
import { it } from 'vitest';
import { extractReviewSnippets } from './review-snippets';
import { redactSecretsPreservingLines } from './redact';

const head='a'.repeat(40);
const padding=Array(90).fill('# padding').join('\n');
const branch = ['def choose_route(request):','    method = request.method',...Array.from({length:14},(_,n)=>`    value${n} = ${n}`),'    if request.keep_verb:', '        return method','    return "GET"'].join('\n');
const python='def authenticate(password):\n    return build_auth(password=password)\n\n'+branch+'\n\ndef unrelated():\n    pass\n\n'+padding;
const tsBody=['export function chooseRoute(request: { keepVerb: boolean; method: string }) {','  const method = request.method;',...Array.from({length:14},(_,n)=>`  const value${n} = ${n};`),'  if (request.keepVerb) {','    return method;','  }','  return "GET";','}'].join('\n');
const typescript='function authenticate(password: string) {\n  return buildAuth(password=password);\n}\n\n'+tsBody;
const checks: Array<[string, () => Promise<void>]> = [
 ['Python structure survives credential-expression masking',async()=>{
   const r=await extractReviewSnippets([{path:'src/route.py',headSha:head,content:python}],[{id:'goal_1',terms:['choose_route'],anchors:[]}]);
   assert(r.snippets.some(s=>s.content===branch),'full function including keep_verb must be supplied');
 }],
 ['TypeScript structure survives credential-expression masking',async()=>{
   const r=await extractReviewSnippets([{path:'src/route.ts',headSha:head,content:typescript}],[{id:'goal_1',terms:['chooseroute'],anchors:[]}]);
   assert(!r.limitations.includes('retrieval_parse_failed'),'a valid original module must not fail parsing because it was masked');
   assert(r.snippets.some(s=>s.content===tsBody),'full function including keepVerb must be supplied');
 }],
 ['Outgoing snippets remain redacted and LF-line aligned',async()=>{
   const source=['def choose_route():','    password = "synthetic-sensitive-value"',...Array.from({length:12},(_,i)=>`    value${i} = ${i}`),'    return False','', 'def other():','    pass'].join('\r\n');
   const r=await extractReviewSnippets([{path:'src/secrets.py',headSha:head,content:source}],[{id:'goal_1',terms:['choose_route'],anchors:[]}]);
   assert(r.snippets.length>0);
   for(const s of r.snippets){assert(!s.content.includes('synthetic-sensitive-value'));assert.equal(s.content,redactSecretsPreservingLines(source.replace(/\r\n?/g,'\n')).split('\n').slice(s.startLine-1,s.endLine).join('\n'));}
 }],
 ['Oversized functions still use explicitly bounded fallback',async()=>{
   const source='def process(pending):\n'+Array.from({length:100},(_,i)=>`    value${i} = ${i}`).join('\n')+'\n    return False';
   const r=await extractReviewSnippets([{path:'src/worker.py',headSha:head,content:source}],[{id:'goal_1',terms:['pending'],anchors:[]}]);
   assert(r.limitations.includes('retrieval_unverified_fallback'));assert(r.snippets.every(s=>s.endLine-s.startLine<80&&Buffer.byteLength(s.content)<=8000));
 }]
];

for (const [name, check] of checks) it(name, check);

it('finds executable camel-case freshness checks beyond an incomplete import prefix',async()=>{
 const source=["import type { publicMetadata } from './public';",...Array(95).fill('// padding'),
  'async function invoke() {',...Array(90).fill('  const unused = 0;'),
  '  const beforeCall = await readCurrentPublicSubject();',
  '  await provider.observe();',
  '  const afterCall = await readCurrentPublicSubject();',
  '  return beforeCall === afterCall;',
  '}'].join('\n');
 const r=await extractReviewSnippets([{path:'src/callback.ts',headSha:head,content:source}],[{id:'goal_1',terms:['before','after','public','provider'],anchors:[]}]);
 assert(r.snippets.some(s=>s.content.includes('const beforeCall = await readCurrentPublicSubject();')),'before freshness check must reach the bounded context');
 assert(r.snippets.some(s=>s.content.includes('const afterCall = await readCurrentPublicSubject();')),'after freshness check must reach the bounded context');
 for(const s of r.snippets)assert.equal(s.content,source.split('\n').slice(s.startLine-1,s.endLine).join('\n'));
});

it('keeps specific runtime checks across files instead of filling context with a repeated metadata word',async()=>{
 const source=['interface Metadata {',...Array.from({length:60},(_,n)=>`  providerField${n}: "provider";`),'}',
  'async function invoke() {',...Array(90).fill('  const unused = 0;'),
  '  const beforeCall = await readCurrentPublicSubject();',
  '  await provider.observe();',
  '  const afterCall = await readCurrentPublicSubject();',
  '  return beforeCall === afterCall;','}'].join('\n');
 const files=Array.from({length:8},(_,n)=>({path:`src/callback-${n}.ts`,headSha:head,content:source}));
 const r=await extractReviewSnippets(files,[{id:'goal_1',terms:['before','after','public','provider'],anchors:[]}]);
 for(const file of files)assert(r.snippets.some(s=>s.path===file.path&&s.content.includes('readCurrentPublicSubject();')),`${file.path}: runtime freshness must survive the shared context bound`);
 assert(r.snippets.length<=16);
});

it('retains rare behavioral matches after a dense prefix exhausts early keyword hits',async()=>{
 const body='async function invoke(provider) {\n  const beforeCall = await readCurrentPublicSubject();\n  await provider.observe();\n  const afterCall = await readCurrentPublicSubject();\n  return beforeCall === afterCall;\n}';
 const source=Array.from({length:300},(_,n)=>`const providerMetadata${n} = "provider";`).join('\n')+'\n'+body;
 const r=await extractReviewSnippets([{path:'src/callback.ts',headSha:head,content:source}],[{id:'goal_1',terms:['before','after','public','provider'],anchors:[]}]);
 assert(r.snippets.some(s=>s.content.includes('const beforeCall = await readCurrentPublicSubject();')&&s.content.includes('const afterCall = await readCurrentPublicSubject();')),'late freshness checks must survive the retained-match bound');
 assert(r.limitations.includes('retrieval_scan_budget_exceeded'));
});

it('prefers a directly named behavior test over broad fixture vocabulary',async()=>{
 const source=[...Array.from({length:20},(_,i)=>`it('handles fixture ${i}', () => {\n const fixture = { deterministic: true, report: true, public: true, schema: true, outcome: true };\n expect(fixture.report).toBe(true);\n});`),`it('preserves deterministic report identity', () => {\n const result = execute({ mode: 'disabled' });\n expect(result.report).toBe(report);\n});`].join('\n');
 const result=await extractReviewSnippets([{path:'src/assessment.test.ts',headSha:'a'.repeat(40),content:source}],[{id:'goal_1',terms:['preserves','deterministic','report','public','schema','outcome'],anchors:[]}]);
 assert(result.snippets.some(s=>s.content.includes("execute({ mode: 'disabled' })")),'direct behavior test must survive broad fixture vocabulary');
});

it('keeps the bounded function body when its leading comment supplies the requirement wording',async()=>{
 const body=['export function execute(options) {',...Array.from({length:30},(_,i)=>` const value${i} = ${i};`),' return options.mode === "disabled" ? options.report : inspect(options);','}'].join('\n');
 const source='/** Private shadow pipeline is default-off. */\n'+body;
 const result=await extractReviewSnippets([{path:'src/assessment.ts',headSha:head,content:source}],[{id:'goal_1',terms:['private','shadow','pipeline','default'],anchors:[]}]);
 assert(result.snippets.some(s=>s.content.includes('return options.mode === "disabled"')),'a matching leading comment must not leave only the function signature');
});
