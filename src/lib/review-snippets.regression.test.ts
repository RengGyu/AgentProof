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
