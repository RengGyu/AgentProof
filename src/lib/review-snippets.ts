import { redactSecretsPreservingLines } from './redact';

// Search bounds are independent of the much smaller model context bounds.
export const REVIEW_FILE_BYTES = 256 * 1024;
export const REVIEW_PAYLOAD_SNIPPETS = 16;
export const REVIEW_PAYLOAD_BYTES = 48_000;
interface GoalHint { id:string; terms:string[]; anchors:Array<{path:string;startLine:number;endLine:number;weak?:boolean}> }
interface ReadFile { path:string;headSha:string;content:string }
interface Snippet extends ReadFile { startLine:number;endLine:number;goalIds:string[];matched:boolean;goalScores:Record<string,number> }
interface Range { startLine:number;endLine:number;priority:number;titleTerms?:string[] }
const overlaps=(a:Pick<Range,'startLine'|'endLine'>,b:Pick<Range,'startLine'|'endLine'>)=>a.startLine<=b.endLine&&b.startLine<=a.endLine;
const wordsFor=(text:string)=>{
 const split=text.replace(/([a-z0-9])([A-Z])/g,'$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g,'$1 $2');
 return [...(text.toLowerCase().match(/[a-z_][a-z0-9_]*/g)??[]),...(split.toLowerCase().match(/[a-z_][a-z0-9_]*/g)??[])].flatMap(word=>[word,...word.split(/[_0-9]+/)]);
};

/** AST boundaries for JS/TS; other languages remain explicitly unparsed, anchored context. */
export async function extractReviewSnippets(files:ReadFile[],goals:GoalHint[]):Promise<{snippets:Snippet[];limitations:string[]}> {
 const limitations=new Set<string>();
 const candidates:Array<Snippet & {score:number}>=[];
 for(const file of files){
  if(Buffer.byteLength(file.content)>REVIEW_FILE_BYTES){limitations.add('retrieval_file_budget_exceeded');continue;}
  // Masking can remove delimiters (for example password=password)), so use the
  // transient original only for boundaries. Matching, budgets and output stay redacted.
  const sourceContent=file.content.replace(/\r\n?/g,'\n'),sourceLines=sourceContent.split('\n');
  const content=redactSecretsPreservingLines(sourceContent),lines=content.split('\n');
  let ranges:Range[]=[];
  const oversizedSymbols:Range[]=[];
  if(/\.[cm]?[jt]sx?$/.test(file.path)){
   try{
    const ts=(await import('typescript')).default;
    const kind=/\.tsx$/.test(file.path)?ts.ScriptKind.TSX:/\.jsx$/.test(file.path)?ts.ScriptKind.JSX:/\.[cm]?js$/.test(file.path)?ts.ScriptKind.JS:ts.ScriptKind.TS;
    const source=ts.createSourceFile(file.path,sourceContent,ts.ScriptTarget.Latest,true,kind);
    if((source as typeof source & {parseDiagnostics?:unknown[]}).parseDiagnostics?.length)limitations.add('retrieval_parse_failed');
    else{
     let nodes=0;
     const visit=(node:import('typescript').Node)=>{
      if(++nodes>20_000||ranges.length>=1024){limitations.add('retrieval_scan_budget_exceeded');return;}
      const symbol=ts.isFunctionDeclaration(node)||ts.isMethodDeclaration(node)||ts.isConstructorDeclaration(node)||ts.isArrowFunction(node)||ts.isFunctionExpression(node);
      if(symbol||ts.isBlock(node)||ts.isStatement(node)&&!ts.isSourceFile(node)){
       const start=symbol?Math.min(node.getStart(source),...ts.getJSDocCommentsAndTags(node).map(doc=>doc.getStart(source))):node.getStart(source);
       const startLine=source.getLineAndCharacterOfPosition(start).line+1,endLine=source.getLineAndCharacterOfPosition(Math.max(node.getStart(source),node.end-1)).line+1;
       const metadata=ts.isImportDeclaration(node)||ts.isInterfaceDeclaration(node)||ts.isTypeAliasDeclaration(node)||ts.isEnumDeclaration(node);
       if(symbol&&endLine-startLine>=80)oversizedSymbols.push({startLine,endLine,priority:3});
       // A test's declared behavior is a retrieval hint, not proof that it passed.
       const call=symbol&&ts.isCallExpression(node.parent)?node.parent:undefined;
       const title=call&&/^(?:it|test)(?:\.(?:only|skip))?$/.test(call.expression.getText(source))&&call.arguments[0]&&ts.isStringLiteralLike(call.arguments[0])?call.arguments[0].text:'';
       if(endLine-startLine<80&&Buffer.byteLength(lines.slice(startLine-1,endLine).join('\n'))<=8000)ranges.push({startLine,endLine,priority:symbol?3:ts.isBlock(node)?2:metadata?-1:1,...(title?{titleTerms:wordsFor(redactSecretsPreservingLines(title.slice(0,512)))}:{})});
      }
      ts.forEachChild(node,visit);
     };
     visit(source);
    }
   }catch{limitations.add('retrieval_parse_failed');}
  }else if(/\.py$/.test(file.path)){
   // Indentation is a bounded range heuristic, not a Python parse or verification result.
   limitations.add('retrieval_python_indentation');
   // Strip strings/comments before counting brackets; a colon inside a default is not a header end.
   const statements:Array<{start:number;end:number;text:string}>=[];
   let quote='',depth=0,start=-1,text='';
   for(let lineIndex=0;lineIndex<sourceLines.length;lineIndex++){
    const line=sourceLines[lineIndex]!;let clean='';
    for(let c=0;c<line.length;c++){
     if(quote){
      if(line[c]==='\\'){c++;continue;}
      if(line.startsWith(quote,c)){c+=quote.length-1;quote='';}
      continue;
     }
     if(line[c]==='#')break;
     if(line[c]==='"'||line[c]==="'"){
      quote=line.startsWith(line[c]!.repeat(3),c)?line[c]!.repeat(3):line[c]!;
      c+=quote.length-1;clean+='x';continue;
     }
     clean+=line[c];
     if('([{'.includes(line[c]!))depth++;
     if(')]}'.includes(line[c]!))depth=Math.max(0,depth-1);
    }
    if(start<0&&clean.trim())start=lineIndex;
    if(start>=0)text+=clean+' ';
    if(!quote&&!depth&&!clean.trimEnd().endsWith('\\')&&start>=0){statements.push({start,end:lineIndex,text:text.trim()});start=-1;text='';}
   }
   const indent=(line:string)=>line.match(/^\s*/)?.[0].replace(/\t/g,'        ').length??0;
   for(let n=0;n<statements.length;n++){
    const statement=statements[n]!;
    if(!/^(?:async\s+)?(?:def|class)\s+\w+.*:\s*$/.test(statement.text))continue;
    if(ranges.length>=1024){limitations.add('retrieval_scan_budget_exceeded');break;}
    let first=statement.start,end=sourceLines.length;const level=indent(sourceLines[first]!);
    for(let prior=n-1;prior>=0;prior--){const decorator=statements[prior]!;if(!decorator.text.startsWith('@')||indent(sourceLines[decorator.start]!)!==level)break;first=decorator.start;}
    for(let next=n+1;next<statements.length;next++)if(indent(sourceLines[statements[next]!.start]!)<=level){end=statements[next]!.start;break;}
    while(end>statement.end+1&&!sourceLines[end-1]!.trim())end--;
    if(end-first<=80&&Buffer.byteLength(lines.slice(first,end).join('\n'))<=8000)ranges.push({startLine:first+1,endLine:end,priority:3});
   }
  }else limitations.add('retrieval_language_unsupported');
  // Scan the whole bounded file, including its tail. Never silently fall back to its first 800 lines.
  const matches=new Map(goals.map(g=>[g.id,[] as number[]]));
  const queryTerms=[...new Set(goals.flatMap(g=>g.terms))].sort();
  if(queryTerms.length>1024)limitations.add('retrieval_scan_budget_exceeded');
  const allowedTerms=new Set(queryTerms.slice(0,1024));
  const terms=new Map(goals.map(g=>[g.id,new Set(g.terms.filter(t=>allowedTerms.has(t)))]));
  const matchingLines:Array<{line:number;goals:string[]}>=[];
  const lineTerms:Array<Set<string>>=[],frequency=new Map<string,number>();
  for(let i=0;i<lines.length;i++){
   const words=wordsFor(lines[i]!);
   const hits=new Set(words.filter(word=>allowedTerms.has(word)));lineTerms.push(hits);
   for(const word of hits)frequency.set(word,(frequency.get(word)??0)+1);
   const matching=goals.filter(g=>words.some(word=>terms.get(g.id)!.has(word))||g.anchors.some(a=>a.path===file.path&&i+1>=a.startLine&&i+1<=a.endLine));
   if(!matching.length)continue;
   matchingLines.push({line:i+1,goals:matching.map(g=>g.id)});
  }
  // Retain the most specific matches across the entire file rather than allowing
  // a dense metadata prefix to consume all retained positions.
  if(matchingLines.length>256)limitations.add('retrieval_scan_budget_exceeded');
  const lineScore=(line:number)=>[...lineTerms[line-1]!].reduce((score,term)=>score+Math.log(1+lines.length/(frequency.get(term)??1)),0)
    +(goals.some(g=>g.anchors.some(a=>!a.weak&&a.path===file.path&&line>=a.startLine&&line<=a.endLine))?1000:0);
  const retained=matchingLines.map(match=>({...match,score:lineScore(match.line)})).sort((a,b)=>b.score-a.score||a.line-b.line).slice(0,256).sort((a,b)=>a.line-b.line);
  for(const match of retained)for(const id of match.goals)matches.get(id)!.push(match.line);
  // Long symbols, unsupported languages and parse failures use small line windows, explicitly limited.
  const uncovered=[...new Set([...matches.values()].flat())].filter(line=>!ranges.some(r=>line>=r.startLine&&line<=r.endLine));
  if(uncovered.length){limitations.add('retrieval_unverified_fallback');for(const line of uncovered)ranges.push({startLine:Math.max(1,line-4),endLine:Math.min(lines.length,line+5),priority:0});}
  // Statements inside an oversized function still need nearby control-flow
  // context. Group neighboring matches into bounded, explicitly unparsed windows.
  for(const hits of matches.values())for(const scope of oversizedSymbols){
   let cluster:number[]=[];
   const flush=()=>{
    if(cluster.length>1){const startLine=Math.max(1,cluster[0]!-4),endLine=Math.min(lines.length,cluster.at(-1)!+5);
     if(!ranges.some(r=>r.priority>=2&&r.startLine<=cluster[0]!&&r.endLine>=cluster.at(-1)!)){
      const metadata=ranges.some(r=>r.priority<0&&r.startLine<=startLine&&r.endLine>=endLine);
      ranges.push({startLine,endLine,priority:metadata?-1:0});limitations.add('retrieval_unverified_fallback');
     }
    }cluster=[];
   };
   for(const line of hits.filter(line=>line>=scope.startLine&&line<=scope.endLine)){if(cluster.length&&(line-cluster.at(-1)!>8||line-cluster[0]!>48))flush();cluster.push(line);}flush();
  }
  if(![...matches.values()].some(hits=>hits.length)){
   limitations.add('retrieval_no_matching_anchor');
   // A tiny explicitly supplied/read file can be inspected without pretending a semantic match.
   if(lines.length<=20&&Buffer.byteLength(content)<=2000){ranges=[{startLine:1,endLine:lines.length,priority:0}];limitations.add('retrieval_unverified_fallback');}
   else continue;
  }
  const seen=new Set<string>();
  // A word repeated through a type/metadata block must not outweigh a specific
  // behavioral check. Score distinct query terms, with file-local rarity.
  const termScore=(term:string)=>Math.round(10*Math.log(1+lines.length/(frequency.get(term)??1)));
  const relevance=(range:Range,wanted:Set<string>)=>[...new Set(lineTerms.slice(range.startLine-1,range.endLine).flatMap(set=>[...set]))].filter(term=>wanted.has(term)).reduce((n,term)=>n+termScore(term),0)*(range.priority<0?0.1:1)
    +2*[...new Set(range.titleTerms??[])].filter(term=>wanted.has(term)).reduce((n,term)=>n+termScore(term),0);
  // Calls and their callback can share line boundaries. Keep the symbol/test
  // hint rather than letting the enclosing statement discard it first.
  for(const range of ranges.sort((a,b)=>b.priority-a.priority)){
   const key=`${range.startLine}:${range.endLine}`;if(seen.has(key))continue;seen.add(key);
   const text=lines.slice(range.startLine-1,range.endLine).join('\n');if(!text.trim()||Buffer.byteLength(text)>8000){limitations.add('retrieval_budget_exceeded');continue;}
   const scores=new Map<string,number>();
   for(const goal of goals){const count=matches.get(goal.id)!.filter(line=>line>=range.startLine&&line<=range.endLine).length;
    const anchor=goal.anchors.some(a=>!a.weak&&a.path===file.path&&overlaps(a,range));
    if(count||anchor||range.priority===0&&lines.length<=20)scores.set(goal.id,(anchor?1000:0)+relevance(range,terms.get(goal.id)!)+range.priority);
   }
   if(scores.size)candidates.push({...file,content:text,startLine:range.startLine,endLine:range.endLine,goalIds:[...scores.keys()],goalScores:Object.fromEntries(scores),matched:[...scores.values()].some(score=>score>0),score:(goals.some(g=>g.anchors.some(a=>!a.weak&&a.path===file.path&&overlaps(a,range)))?1000:0)+relevance(range,allowedTerms)+range.priority});
  }
 }
 const selected:Snippet[]=[];let bytes=2;
 const ranked=candidates.sort((a,b)=>b.score-a.score||a.path.localeCompare(b.path)||a.startLine-b.startLine);
 const firstPaths=new Set<string>();const leading=ranked.filter(c=>{if(firstPaths.has(c.path))return false;firstPaths.add(c.path);return true;});
 const goalLeading=goals.flatMap(g=>[false,true].flatMap(test=>ranked.filter(c=>/(?:^|\/)(?:tests?|__tests__)(?:\/|\.)|[._]test\./i.test(c.path)===test&&(c.goalScores[g.id]??0)>0).sort((a,b)=>(b.goalScores[g.id]??0)-(a.goalScores[g.id]??0)).slice(0,test?1:2)));
 const ordered=[...new Set([...goalLeading,...leading,...ranked])];
 const testIndex=ordered.findIndex(c=>/(?:^|\/)(?:tests?|__tests__)(?:\/|\.)|[._]test\./i.test(c.path));
 if(testIndex>0)ordered.splice(1,0,...ordered.splice(testIndex,1));
 for(const candidate of ordered){
  const covering=selected.find(r=>r.path===candidate.path&&r.headSha===candidate.headSha&&r.startLine<=candidate.startLine&&r.endLine>=candidate.endLine);
  if(covering){covering.goalIds=[...new Set([...covering.goalIds,...candidate.goalIds])];for(const [id,score] of Object.entries(candidate.goalScores))covering.goalScores[id]=Math.max(covering.goalScores[id]??0,score);continue;}
  const {score:_,...snippet}=candidate;
  const {goalScores:__,...payloadSnippet}=snippet;
  const size=Buffer.byteLength(JSON.stringify({...payloadSnippet,goalIds:Array.from({length:16},(_,n)=>`goal_${n+1}`)}))+1;
  if(selected.length>=REVIEW_PAYLOAD_SNIPPETS||bytes+size>REVIEW_PAYLOAD_BYTES){limitations.add('retrieval_budget_exceeded');continue;}
  bytes+=size;selected.push(snippet);
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
    previous.endLine=endLine;previous.content=content;previous.goalIds=[...new Set([...previous.goalIds,...snippet.goalIds])];for(const [id,score] of Object.entries(snippet.goalScores))previous.goalScores[id]=Math.max(previous.goalScores[id]??0,score);previous.matched||=snippet.matched;continue;
   }
  }
  merged.push(snippet);
 }
 return {snippets:merged,limitations:[...limitations]};
}
