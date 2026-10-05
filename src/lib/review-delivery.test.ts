import {expect,it} from 'vitest';
import {extractReviewSnippets,REVIEW_PAYLOAD_BYTES,REVIEW_PAYLOAD_SNIPPETS} from './review-snippets';
const head='a'.repeat(40);
for(const suffix of ['go','py'])it(`accounts overlapping fallback context once before snippet budget (${suffix})`,async()=>{
 const content=[...Array.from({length:60},(_,n)=>suffix==='py'?`# common context ${n}`:`// common context ${n}`),...Array(40).fill(''),suffix==='py'?'fresh_constant = FreshWarning()':'var fresh_constant = FreshWarning()'].join('\n');
 const result=await extractReviewSnippets([{path:`src/policy.${suffix}`,headSha:head,content}],[{id:'goal_1',terms:['common','fresh'],anchors:[{path:`src/policy.${suffix}`,startLine:1,endLine:60}]}]);
 expect(result.snippets.some(s=>s.content.includes('fresh_constant'))).toBe(true);
 expect(result.snippets.length).toBeLessThanOrEqual(REVIEW_PAYLOAD_SNIPPETS);
 expect(Buffer.byteLength(JSON.stringify(result.snippets))).toBeLessThan(REVIEW_PAYLOAD_BYTES);
 for(const s of result.snippets){expect(s.endLine-s.startLine).toBeLessThan(80);expect(s.content).toBe(content.split('\n').slice(s.startLine-1,s.endLine).join('\n'));}
});
it('does not merge different files or revisions or disclose masked secrets',async()=>{
 const result=await extractReviewSnippets([{path:'src/a.go',headSha:head,content:'var fresh = true\npassword="sensitive-value"'},{path:'src/b.go',headSha:'b'.repeat(40),content:'var fresh = false'}],[{id:'goal_1',terms:['fresh'],anchors:[]}]);
 expect(new Set(result.snippets.map(s=>s.path)).size).toBe(2);
 expect(JSON.stringify(result.snippets)).not.toContain('sensitive-value');
});

it('does not treat inconsistent covering source at the same revision as identical overlap',async()=>{
 const a='def fresh():\n    return fresh_value';const b='def fresh():\n    return other_value';
 const r=await extractReviewSnippets([{path:'src/policy.py',headSha:head,content:a},{path:'src/policy.py',headSha:head,content:b}],[{id:'goal_1',terms:['fresh'],anchors:[]}]);
 expect(r.snippets.map(s=>s.content)).toContain(a);
 expect(r.snippets.map(s=>s.content)).toContain(b);
});

it('keeps all bounded source intervals at the exact UTF-8 array budget and rejects one byte over',async()=>{
 const goalIds=Array.from({length:16},(_,n)=>`goal_${n+1}`);
 const files=Array.from({length:6},(_,n)=>({path:`src/boundary_${n}.py`,headSha:head,content:'def fresh():\n    return fresh # '+'é'.repeat(3500)}));
 const payload=()=>files.map(file=>({...file,startLine:1,endLine:2,goalIds,matched:true}));
 let remaining=REVIEW_PAYLOAD_BYTES-Buffer.byteLength(JSON.stringify(payload()));
 expect(remaining).toBeGreaterThan(0);
 for(const file of files){const add=Math.min(remaining,8000-Buffer.byteLength(file.content));file.content+='x'.repeat(add);remaining-=add;}
 expect(remaining).toBe(0);
 expect(Buffer.byteLength(JSON.stringify(payload()))).toBe(REVIEW_PAYLOAD_BYTES);
 const goals=goalIds.map(id=>({id,terms:['fresh'],anchors:[]}));
 const exact=await extractReviewSnippets(files,goals);
 expect(exact.snippets.map(s=>s.path)).toEqual(files.map(f=>f.path));
 const {snippets}=await extractReviewSnippets(files.map((f,n)=>({...f,content:f.content+(n===files.length-1?'x':'')})),goals);
 expect(snippets.length).toBeLessThan(files.length);
 expect(Buffer.byteLength(JSON.stringify(snippets.map(({goalScores:_,...s})=>s)))).toBeLessThanOrEqual(REVIEW_PAYLOAD_BYTES);
});
