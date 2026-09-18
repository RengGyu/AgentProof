import { redactSecretsPreservingLines } from './redact';

// Search bounds are independent of the much smaller model context bounds.
export const REVIEW_FILE_BYTES = 256 * 1024;
export const REVIEW_GOAL_BYTES = 12_000;
export const REVIEW_GOAL_SNIPPETS = 4;
export const REVIEW_PAYLOAD_BYTES = 48_000;
interface GoalHint { id:string; terms:string[]; anchors:Array<{path:string;startLine:number;endLine:number}> }
interface ReadFile { path:string;headSha:string;content:string }
interface Snippet extends ReadFile { startLine:number;endLine:number;goalIds:string[];matched:boolean }
interface Range { startLine:number;endLine:number;priority:number }
const overlaps=(a:Pick<Range,'startLine'|'endLine'>,b:Pick<Range,'startLine'|'endLine'>)=>a.startLine<=b.endLine&&b.startLine<=a.endLine;

/** AST boundaries for JS/TS; other languages remain explicitly unparsed, anchored context. */
export async function extractReviewSnippets(files:ReadFile[],goals:GoalHint[]):Promise<{snippets:Snippet[];limitations:string[]}> {
 const limitations=new Set<string>();
 const candidates:Array<Snippet & {scores:Map<string,number>}>=[];
 for(const file of files){
  if(Buffer.byteLength(file.content)>REVIEW_FILE_BYTES){limitations.add('retrieval_file_budget_exceeded');continue;}
  const content=redactSecretsPreservingLines(file.content).replace(/\r\n?/g,'\n'),lines=content.split('\n');
  let ranges:Range[]=[];
  if(/\.[cm]?[jt]sx?$/.test(file.path)){
   try{
    const ts=(await import('typescript')).default;
    const kind=/\.tsx$/.test(file.path)?ts.ScriptKind.TSX:/\.jsx$/.test(file.path)?ts.ScriptKind.JSX:/\.[cm]?js$/.test(file.path)?ts.ScriptKind.JS:ts.ScriptKind.TS;
    const source=ts.createSourceFile(file.path,content,ts.ScriptTarget.Latest,true,kind);
    if((source as typeof source & {parseDiagnostics?:unknown[]}).parseDiagnostics?.length)limitations.add('retrieval_parse_failed');
    else{
     let nodes=0;
     const visit=(node:import('typescript').Node)=>{
      if(++nodes>20_000||ranges.length>=1024){limitations.add('retrieval_scan_budget_exceeded');return;}
      const symbol=ts.isFunctionDeclaration(node)||ts.isMethodDeclaration(node)||ts.isConstructorDeclaration(node)||ts.isArrowFunction(node)||ts.isFunctionExpression(node);
      if(symbol||ts.isBlock(node)||ts.isStatement(node)&&!ts.isSourceFile(node)){
       const startLine=source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,endLine=source.getLineAndCharacterOfPosition(Math.max(node.getStart(source),node.end-1)).line+1;
       if(endLine-startLine<80&&Buffer.byteLength(lines.slice(startLine-1,endLine).join('\n'))<=8000)ranges.push({startLine,endLine,priority:symbol?3:ts.isBlock(node)?2:1});
      }
      ts.forEachChild(node,visit);
     };
     visit(source);
    }
   }catch{limitations.add('retrieval_parse_failed');}
  }else limitations.add('retrieval_language_unsupported');
  // Scan the whole bounded file, including its tail. Never silently fall back to its first 800 lines.
  const matches=new Map<string,number[]>();
  for(const goal of goals){
   const terms=new Set(goal.terms.slice(0,64));const hits:number[]=[];
   for(let i=0;i<lines.length;i++){
    const words=(lines[i]!.toLowerCase().match(/[a-z_][a-z0-9_]*/g)??[]).flatMap(word=>[word,...word.split(/[_0-9]+/)]);
    if(words.some(word=>terms.has(word))||goal.anchors.some(a=>a.path===file.path&&i+1>=a.startLine&&i+1<=a.endLine)){if(hits.length<64)hits.push(i+1);else limitations.add('retrieval_scan_budget_exceeded');}
   }
   matches.set(goal.id,hits);
  }
  // Long symbols, unsupported languages and parse failures use small line windows, explicitly limited.
  const uncovered=[...new Set([...matches.values()].flat())].filter(line=>!ranges.some(r=>line>=r.startLine&&line<=r.endLine));
  if(uncovered.length){limitations.add('retrieval_unverified_fallback');for(const line of uncovered)ranges.push({startLine:Math.max(1,line-4),endLine:Math.min(lines.length,line+5),priority:0});}
  if(![...matches.values()].some(hits=>hits.length)){
   limitations.add('retrieval_no_matching_anchor');
   // A tiny explicitly supplied/read file can be inspected without pretending a semantic match.
   if(lines.length<=20&&Buffer.byteLength(content)<=2000){ranges=[{startLine:1,endLine:lines.length,priority:0}];limitations.add('retrieval_unverified_fallback');}
   else continue;
  }
  const seen=new Set<string>();
  for(const range of ranges){
   const key=`${range.startLine}:${range.endLine}`;if(seen.has(key))continue;seen.add(key);
   const text=lines.slice(range.startLine-1,range.endLine).join('\n');if(!text.trim()||Buffer.byteLength(text)>8000){limitations.add('retrieval_budget_exceeded');continue;}
   const scores=new Map<string,number>();
   for(const goal of goals){const count=matches.get(goal.id)!.filter(line=>line>=range.startLine&&line<=range.endLine).length;
    const anchor=goal.anchors.some(a=>a.path===file.path&&overlaps(a,range));
    if(count||anchor||range.priority===0&&lines.length<=20)scores.set(goal.id,(anchor?1000:0)+count*10+range.priority);
   }
   if(scores.size)candidates.push({...file,content:text,startLine:range.startLine,endLine:range.endLine,goalIds:[],matched:[...scores.values()].some(score=>score>0),scores});
  }
 }
 const selected:Snippet[]=[];
 for(const goal of goals){
  let bytes=2,count=0;const ranges:Snippet[]=[];
  const ordered=candidates.filter(c=>c.scores.has(goal.id)).sort((a,b)=>b.scores.get(goal.id)!-a.scores.get(goal.id)!||a.path.localeCompare(b.path)||a.startLine-b.startLine);
  const testIndex=ordered.findIndex(c=>/(?:^|\/)(?:tests?|__tests__)(?:\/|\.)|[._]test\./i.test(c.path));
  if(testIndex>0)ordered.splice(1,0,...ordered.splice(testIndex,1));
  for(const candidate of ordered){
   if(ranges.some(r=>r.path===candidate.path&&overlaps(r,candidate)))continue;
   const {scores:_,...snippet}=candidate;const size=Buffer.byteLength(JSON.stringify({...snippet,goalIds:[goal.id]}))+1;
   if(count>=REVIEW_GOAL_SNIPPETS||bytes+size>REVIEW_GOAL_BYTES){limitations.add('retrieval_budget_exceeded');continue;}
   bytes+=size;count++;ranges.push(snippet);
   const existing=selected.find(s=>s.path===snippet.path&&s.headSha===snippet.headSha&&s.startLine===snippet.startLine&&s.endLine===snippet.endLine);
   if(existing)existing.goalIds.push(goal.id);else selected.push({...snippet,goalIds:[goal.id]});
  }
 }
 // Merge overlapping windows only when their shared text agrees and the union stays bounded.
 const merged:Snippet[]=[];
 for(const snippet of selected.sort((a,b)=>a.path.localeCompare(b.path)||a.startLine-b.startLine)){
  const previous=merged.at(-1);
  if(previous&&previous.path===snippet.path&&previous.headSha===snippet.headSha&&overlaps(previous,snippet)){
   const endLine=Math.max(previous.endLine,snippet.endLine),a=previous.content.split('\n'),b=snippet.content.split('\n');
   const agrees=Array.from({length:Math.min(previous.endLine,snippet.endLine)-snippet.startLine+1},(_,i)=>a[snippet.startLine-previous.startLine+i]===b[i]).every(Boolean);
   const content=[...a,...b.slice(Math.max(0,previous.endLine-snippet.startLine+1))].join('\n');
   if(agrees&&endLine-previous.startLine<80&&Buffer.byteLength(content)<=8000){
    previous.endLine=endLine;previous.content=content;previous.goalIds=[...new Set([...previous.goalIds,...snippet.goalIds])];previous.matched||=snippet.matched;continue;
   }
  }
  merged.push(snippet);
 }
 return {snippets:merged,limitations:[...limitations]};
}
