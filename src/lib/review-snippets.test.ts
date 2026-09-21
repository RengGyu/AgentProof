import {expect,it} from 'vitest';
import {extractReviewSnippets} from './review-snippets';
const head='a'.repeat(40);
it('supplies the same shared pool when identical concerns are grouped or split',async()=>{
 const files=Array.from({length:8},(_,n)=>({path:`${n%2?'tests':'src'}/case${n}.ts`,headSha:head,content:`function concern${n}() {\n return concern${n};\n}`}));
 const terms=Array.from({length:8},(_,n)=>`concern${n}`);
 const grouped=await extractReviewSnippets(files,[{id:'goal_1',terms,anchors:[]}]);
 const split=await extractReviewSnippets(files,terms.map((term,n)=>({id:`goal_${n+1}`,terms:[term],anchors:[]})));
 expect(grouped.snippets).toHaveLength(8);expect(grouped.snippets.map(s=>[s.path,s.startLine,s.endLine,s.content])).toEqual(split.snippets.map(s=>[s.path,s.startLine,s.endLine,s.content]));
});
it('supplies Python function branches, decorators and a related test beyond the keyword window',async()=>{
 const body=['@decorator','def process(pending):','    """Process queued work."""','    if pending:',...Array.from({length:12},(_,i)=>`        value${i} = ${i}`),'        return True','    else:','        return False'];
 const test=['def test_pending():',...Array.from({length:12},(_,i)=>`    value${i} = ${i}`),'    assert process([]) is False'];
 const r=await extractReviewSnippets([{path:'src/worker.py',headSha:head,content:body.join('\n')+'\n\ndef unrelated():\n    pass'},{path:'tests/test_worker.py',headSha:head,content:test.join('\n')}],[{id:'goal_1',terms:['pending'],anchors:[]}]);
 expect(r.snippets.find(s=>s.path==='src/worker.py')).toMatchObject({startLine:1,endLine:body.length,content:body.join('\n')});expect(r.snippets.find(s=>s.path.startsWith('tests/'))?.content).toContain('assert process([]) is False');expect(r.limitations).toContain('retrieval_python_indentation');
});
it('bounds oversized Python functions and labels fallback rather than claiming a full function',async()=>{
 const r=await extractReviewSnippets([{path:'src/worker.py',headSha:head,content:'def process(pending):\n'+Array.from({length:100},(_,i)=>`    value${i} = ${i}`).join('\n')+'\n    return False'}],[{id:'goal_1',terms:['pending'],anchors:[]}]);
 expect(r.limitations).toContain('retrieval_unverified_fallback');expect(r.snippets.every(s=>s.endLine-s.startLine<80&&Buffer.byteLength(s.content)<=8000)).toBe(true);
});
it('does not mistake a dedented line inside a Python docstring for a function boundary',async()=>{
 const body=["def process(pending):","    '''text",'dedented explanation',"    '''",'    if pending:','        return True','    return False'].join('\n');const r=await extractReviewSnippets([{path:'src/worker.py',headSha:head,content:body+'\n\ndef other():\n    pass'}],[{id:'goal_1',terms:['pending'],anchors:[]}]);expect(r.snippets[0]?.content).toBe(body);
});
it.each([0,37,900])('retains multiline Python declarations and independent tests at offset %s',async(offset)=>{
 const body=['@decorate(', '    value="colon: ) #",', ')','async def reconcile(', '    pending: list[str],', '    flag: bool = True,', ') -> bool:', '    if pending:',...Array.from({length:11},(_,n)=>`        value${n} = ${n}`),'        return flag','    return False'];
 const other=['def test_pending(', '    fixture,', '):',...Array.from({length:12},(_,n)=>`    item${n} = ${n}`),'    assert reconcile([]) is False'];
 const content=[...Array(offset).fill('# padding'),...body,'',...other].join('\n');
 const r=await extractReviewSnippets([{path:'tests/test_delivery.py',headSha:head,content}],[{id:'goal_1',terms:['pending'],anchors:[]}]);
 expect(r.snippets.map(s=>s.content)).toContain(body.join('\n'));expect(r.snippets.map(s=>s.content)).toContain(other.join('\n'));
 expect(r.snippets[0].startLine).toBe(offset+1);expect(r.limitations).not.toContain('retrieval_unverified_fallback');
});
