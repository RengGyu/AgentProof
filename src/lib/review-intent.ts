import { getNavigationTransportDiagnostics, type NavigationTransportDiagnostics } from './review-navigation-diagnostics';
import { extractReviewSnippets, REVIEW_PAYLOAD_SNIPPETS, REVIEW_PAYLOAD_BYTES, REVIEW_FILE_BYTES } from './review-snippets';
import { createHash } from "crypto";
import { parseGeneralPrStructureV1 } from "./general-pr-structure";
import { redactSecrets, redactSecretsPreservingLines } from "./redact";
import type { EvidenceItem, PullRequestInput, RequirementFinding } from "./types";

export interface ReviewSourceRefV1 { start: number; end: number; hash: string }
export type ReviewFacetKind = "condition" | "exception" | "reproduction" | "acceptance" | "artifact_hint";
export interface ReviewIntentGraphV1 {
  version: 1;
  source: { kind: "task" | "description"; hash: string; length: number; coordinates: "redacted_lf_utf16" };
  repository: string | null;
  goals: Array<{ id: string; requirementIds: string[]; sourceRefs: ReviewSourceRefV1[]; facets: Array<{ kind: ReviewFacetKind; sourceRef: ReviewSourceRefV1 }> }>;
  chunks: Array<{ id: string; pool: "changed" | "snapshot"; path: string; revision: string | null; side: "head" | "base"; startLine: number; endLine: number; hash: string; evidenceId: string | null }>;
  edges: Array<{ goalId: string; chunkId: string; relation: "candidate"; basis: Array<"lexical" | "identifier" | "source_path" | "changed_declaration">; score: number; line?: number; lineBasis?: "test_body_match" }>;
  capabilities: { wholeRepository: "unavailable"; embeddings: "unavailable"; symbolResolution: "unavailable"; semantic: "existing_relations_only"; snapshotChunks: number; rejectedSnapshots: number; truncated: boolean };
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const exact = (s: string | null | undefined): s is string => Boolean(s && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(s));
const safePath = (p: string) => p.length <= 240 && redactSecrets(p) === p && /^[A-Za-z0-9_.@+/#:()\[\]-]+$/.test(p) && !p.startsWith("/") && !p.split("/").some(x => !x || x === "." || x === "..");
const COMMON = new Set("must should when then with from this that have into return function class const service request response result test code file implementation preserve support".split(" "));
const allTerms = (s: string) => [...new Set((s.toLowerCase().match(/[a-z][a-z0-9_]{3,}/g) ?? []).filter(x => !COMMON.has(x)))];
const allIdentifiers = (s: string) => [...new Set((s.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []).filter(x => /[a-z][A-Z]|[a-z]_[a-z]/.test(x)).map(x => x.toLowerCase()))];
function facet(s: string): ReviewFacetKind | undefined {
  if (/^(except|unless|exception)\b/i.test(s)) return "exception";
  if (/^(when|if|under|conditions?|given)\b/i.test(s)) return "condition";
  if (/^(reproduc|steps|reproduction)/i.test(s)) return "reproduction";
  if (/^(acceptance|expected|verify|assert)\b/i.test(s)) return "acceptance";
  if (/^(artifact|files?|implementation hints?)\b/i.test(s)) return "artifact_hint";
}
const clean = (s: string) => s.replace(/^\s*(?:#{1,6}\s+|[-*+]\s+(?:\[[ x]\]\s*)?|\d+[.)]\s+)?/, "").replace(/^\*\*|\*\*:?$/g, "").trim();

export function isTestFocusedReviewGoal(text: string): boolean {
  return /^(?:test\b|(?:add|write|extend|update|improve|implement)\s+(?:(?!with\b|and\b|for\b|to\b)[a-z-]+\s+){0,3}(?:tests?|test coverage)\b)/i.test(clean(text));
}

/** Bounded structural intent + local retrieval. Text stays transient; only offsets/hashes leave here. */
export function buildReviewIntentGraph(input: PullRequestInput, requirements: RequirementFinding[], evidence: EvidenceItem[]): ReviewIntentGraphV1 {
  const full = redactSecrets(input.taskText.trim() ? input.taskText : input.description).replace(/\r\n?/g,"\n");
  const source = full.slice(0,64000), structure = parseGeneralPrStructureV1(source);
  const graph: ReviewIntentGraphV1 = {version:1, source:{kind:input.taskText.trim()?"task":"description",hash:sha(source),length:source.length,coordinates:"redacted_lf_utf16"},repository:null,goals:[],chunks:[],edges:[],capabilities:{wholeRepository:"unavailable",embeddings:"unavailable",symbolResolution:"unavailable",semantic:"existing_relations_only",snapshotChunks:0,rejectedSnapshots:0,truncated:full.length>source.length || structure.parseState!=="complete"}};
  try { const u = new URL(input.url ?? ""); if(u.origin==="https://github.com" && /^\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*$/.test(u.pathname)){const repository=u.pathname.split("/").slice(1,3).join("/");if(redactSecrets(repository)===repository)graph.repository=repository;} } catch { /* pasted input has no repository binding */ }
  if (!requirements.length) return graph;
  const ref = (start:number,end:number):ReviewSourceRefV1 => ({start,end,hash:sha(source.slice(start,end))});
  let lastEnd=0;
  const paragraphs=structure.spans.filter(s=>!s.excluded && (s.kind==="paragraph" || s.kind==="list_item"));
  let labelKind: ReviewFacetKind | undefined;
  for (const span of paragraphs) {
    if(structure.spans.some(s=>s.kind==="heading"&&s.start>=lastEnd&&s.end<=span.start))labelKind=undefined;
    lastEnd=span.end;
    const text=clean(source.slice(span.start,span.end));
    if (!text || /^\w+(?: \w+){0,2}:$/.test(text) || /^\*\*[^*]+\*\*:?$/.test(source.slice(span.start,span.end))) { labelKind=facet(text); continue; }
    const heading=structure.spans.find(s=>s.id===span.headingPath.at(-1));
    const kind=facet(text) ?? (heading ? facet(clean(source.slice(heading.start,heading.end))) : undefined) ?? labelKind;
    let goal=graph.goals.at(-1);
    const startsGoal = !goal || !kind && (/\b(must|should|shall|need(?:s)? to)\b/i.test(text) || /^(?:please\s+)?(?:add|fix|ensure|implement|support|prevent|allow|remove|make)\b/i.test(text));
    if (startsGoal) {
      if (graph.goals.length>=40) {graph.capabilities.truncated=true;break;}
      goal={id:`intent_${sha(`${span.start}:${span.end}`).slice(0,16)}`,requirementIds:[],sourceRefs:[ref(span.start,span.end)],facets:[]}; graph.goals.push(goal);
    } else if (kind) {
      if(goal!.facets.length<255)goal!.facets.push({kind,sourceRef:ref(span.start,span.end)});else graph.capabilities.truncated=true;
    } else if(goal!.sourceRefs.length<32)goal!.sourceRefs.push(ref(span.start,span.end));else graph.capabilities.truncated=true;
    if(!goal)continue;
    for(const match of source.slice(span.start,span.end).matchAll(/\b(when|if|unless|except)\b/gi)) {
      const kind:ReviewFacetKind=/unless|except/i.test(match[1]!)?"exception":"condition";
      const start=span.start+match.index!;
      if(goal.facets.length<256 && !goal.facets.some(f=>f.kind===kind&&f.sourceRef.start===start))goal.facets.push({kind,sourceRef:ref(start,span.end)});
    }
    if (goal.facets.length<256 && /[\w.-]+\/[\w./-]+\.[A-Za-z]+/.test(text)) goal.facets.push({kind:"artifact_hint",sourceRef:ref(span.start,span.end)});
  }
  // Match existing strict IDs by source positions only. They remain unchanged and can share an intent.
  for (const r of requirements) {
    const text=redactSecrets(r.requirementText), start=source.indexOf(text);
    if(start<0)continue;
    const span=structure.spans.find(s=>(s.kind==="heading" || s.kind==="paragraph" && /^\*\*[^*]+\*\*:?$/.test(source.slice(s.start,s.end))) && s.start<=start && s.end>=start+text.length);
    const goal=graph.goals.find(g=>[...g.sourceRefs,...g.facets.map(f=>f.sourceRef)].some(s=>start>=s.start&&start<s.end)) ?? (span ? graph.goals.find(g=>g.sourceRefs[0]!.start>=span.end) : undefined);
    if(goal) { if(start>=goal.sourceRefs[0]!.start && start<goal.sourceRefs[0]!.end)goal.requirementIds.unshift(r.requirementId); else goal.requirementIds.push(r.requirementId); }
  }
  const bodies=new Map<string,string>();
  const locations=new Map<string,Array<{line:number;text:string;changed:boolean}>>();
  const add=(pool:"changed"|"snapshot",path:string,body:string,revision:string|null,side:"head"|"base",evidenceId:string|null) => {
    const bounded=body.slice(0,16000); if(bounded.length<body.length)graph.capabilities.truncated=true;
    const lines=bounded.split("\n");
    let sourceLine:number|undefined;
    const mapped=lines.map(text=>{
      const hunk=text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if(hunk){sourceLine=Number(hunk[side==="head"?2:1]);return undefined;}
      const changed=text.startsWith(side==="head"?"+":"-");
      if(sourceLine===undefined||!changed&&!text.startsWith(" "))return undefined;
      const line=sourceLine++;
      return line>0&&line<=100000?{line,text:text.slice(1),changed}:undefined;
    });
    // ponytail: fixed line windows; syntax-aware chunks need a supported language parser and measured benefit.
    for(let i=0;i<lines.length;i+=80) {
      if(graph.chunks.length>=128){graph.capabilities.truncated=true;break;}
      const text=lines.slice(i,i+80).join("\n"), hash=sha(text), id=`chunk_${sha(JSON.stringify([pool,path,revision,i,hash])).slice(0,24)}`;
      if(graph.chunks.some(c=>c.id===id))continue;
      const positions=pool==="changed"?mapped.slice(i,i+80).filter((row):row is NonNullable<typeof row>=>!!row):[];
      locations.set(id,positions);
      graph.chunks.push({id,pool,path,revision,side,startLine:pool==="snapshot"?i+1:positions[0]?.line??1,endLine:pool==="snapshot"?Math.min(i+80,lines.length):positions.at(-1)?.line??1,hash,evidenceId});bodies.set(id,text);
    }
  };
  for(const file of [...input.changedFiles].sort((a,b)=>a.path.localeCompare(b.path))) {
    if(!safePath(file.path))continue;
    const item=evidence.find(e=>e.locator===file.path && ["diff","changed_file","test"].includes(e.kind));
    if(!item)continue;
    const side=file.status==="removed"?"base":"head", revision=side==="base"?input.sourceProvenance?.baseSha:input.sourceProvenance?.headSha;
    add("changed",file.path,redactSecretsPreservingLines(file.patch??""),exact(revision)?revision:null,side,item.id);
  }
  const snapshots=input.verificationCriterionEvidenceV2?.artifactBlobs??[];
  for(const blob of [...snapshots].sort((a,b)=>a.path.localeCompare(b.path)||sha(a.content).localeCompare(sha(b.content)))) {
    if(!safePath(blob.path)||!exact(blob.headSha)||blob.headSha!==input.sourceProvenance?.headSha || snapshots.some(other=>other.path===blob.path&&other.headSha===blob.headSha&&other.content!==blob.content)) {graph.capabilities.rejectedSnapshots++;continue;}
    add("snapshot",blob.path,redactSecretsPreservingLines(blob.content),blob.headSha,"head",null);
  }
  graph.capabilities.snapshotChunks=graph.chunks.filter(c=>c.pool==="snapshot").length;
  const frequencies=new Map<string,number>(), features=new Map<string,string[]>();
  for(const chunk of graph.chunks) {
    const words=allTerms(bodies.get(chunk.id)!);if(words.length>256)graph.capabilities.truncated=true;
    features.set(chunk.id,words.slice(0,256));
    for(const t of words.slice(0,256))frequencies.set(t,(frequencies.get(t)??0)+1);
  }
  for(const goal of graph.goals) {
    const wholeQuery=[...goal.sourceRefs,...goal.facets.map(f=>f.sourceRef)].map(s=>source.slice(s.start,s.end)).join("\n");
    const query=wholeQuery.slice(0,8000);
    if(wholeQuery.length>query.length)graph.capabilities.truncated=true;
    const words=allTerms(query), identifiers=allIdentifiers(query);
    if(words.length>256 || identifiers.length>64)graph.capabilities.truncated=true;
    const queryTerms=words.slice(0,256), ids=identifiers.slice(0,64);
    const candidates=graph.chunks.flatMap(chunk=>{
      const body=bodies.get(chunk.id)!, tokens=features.get(chunk.id)!, matches=queryTerms.filter(t=>tokens.includes(t));
      const identifiersHit=ids.some(id=>new RegExp(`\\b${id}\\b`,"i").test(body));
      const path=query.split(/[\s`"'()<>]+/).includes(chunk.path);
      const lexical=matches.length>=2 && matches.some(t=>t.length>=6&&(frequencies.get(t)??0)<=Math.max(1,Math.ceil(graph.chunks.length/2)));
      if(!path&&!identifiersHit&&!lexical)return [];
      const declaration=chunk.pool==="changed" && ids.some(id=>new RegExp(`(?:function|class|def|const|let)\\s+${id}\\b`,"i").test(body));
      const basis:ReviewIntentGraphV1["edges"][number]["basis"]=[];
      if(path)basis.push("source_path");if(identifiersHit)basis.push("identifier");if(lexical)basis.push("lexical");if(declaration)basis.push("changed_declaration");
      const score=Math.min(1000,(path?400:0)+(identifiersHit?80:0)+(declaration?30:0)+matches.reduce((n,t)=>n+Math.round(10*Math.log(1+graph.chunks.length/(frequencies.get(t)??1))),0)+(chunk.pool==="changed"?5:0));
      const lineMatches=(locations.get(chunk.id)??[]).map(row=>{
        const terms=allTerms(row.text), identifiers=allIdentifiers(row.text);
        const hits=queryTerms.filter(t=>terms.includes(t)).length+ids.filter(id=>identifiers.includes(id)).length*4;
        // Imports/comments can mention the same symbol as its use. For equal
        // matches, prefer a body location; stronger import-specific matches still win.
        const contextOnly=/^\s*(?:import\b|from\s+.+\bimport\b|(?:const|let|var)\s+.*=\s*require\s*\(|export\s*(?:\*|\{).*\bfrom\b|\/\/|#|\/\*|\*)/.test(row.text);
        const testBody=!contextOnly && /\b(?:test|it|describe|expect|assert)(?:\.\w+)*\s*\(|^\s*(?:async\s+)?def\s+test_\w+\s*\(|^\s*assert\s+/.test(row.text);
        return {line:row.line,score:hits?hits*2+Number(row.changed):0,contextOnly,testBody};
      }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score||Number(a.contextOnly)-Number(b.contextOnly)||a.line-b.line);
      const matchedLine=isTestFocusedReviewGoal(query)?lineMatches.find(row=>row.testBody):lineMatches[0];
      return [{goalId:goal.id,chunkId:chunk.id,relation:"candidate" as const,basis,score,...(matchedLine?{line:matchedLine.line,...(matchedLine.testBody?{lineBasis:"test_body_match" as const}:{})}:{})}];
    }).sort((a,b)=>b.score-a.score||a.chunkId.localeCompare(b.chunkId));
    if(candidates.length>12)graph.capabilities.truncated=true;
    graph.edges.push(...candidates.slice(0,12));
  }
  return graph;
}

/** Closed, text-free metadata shape for both full and signed tenant boundaries. */
export function validReviewIntentGraph(value: unknown, requirementIds: ReadonlySet<string>, evidence: ReadonlyArray<{id:string}>): value is ReviewIntentGraphV1 {
  const obj=(v:unknown):v is Record<string,any>=>!!v&&typeof v==="object"&&!Array.isArray(v);
  const keys=(v:unknown,ks:string[])=>obj(v)&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
  const hash=(s:unknown)=>typeof s==="string"&&/^[a-f0-9]{64}$/.test(s);
  const integer=(n:unknown,max:number)=>Number.isSafeInteger(n)&&Number(n)>=0&&Number(n)<=max;
  if(!keys(value,["version","source","repository","goals","chunks","edges","capabilities"]))return false;
  const g=value as ReviewIntentGraphV1;
  if(g.version!==1||!keys(g.source,["kind","hash","length","coordinates"])||!["task","description"].includes(g.source.kind)||!hash(g.source.hash)||!integer(g.source.length,64000)||g.source.coordinates!=="redacted_lf_utf16"||!(g.repository===null||typeof g.repository==="string"&&/^[\w.-]+\/[\w.-]+$/.test(g.repository)&&redactSecrets(g.repository)===g.repository))return false;
  const ref=(s:unknown)=>keys(s,["start","end","hash"])&&obj(s)&&integer(s.start,g.source.length)&&integer(s.end,g.source.length)&&s.end>s.start&&hash(s.hash);
  if(!Array.isArray(g.goals)||g.goals.length>40||!Array.isArray(g.chunks)||g.chunks.length>128||!Array.isArray(g.edges)||g.edges.length>480)return false;
  const goals=new Set<string>(),chunks=new Set<string>(),pairs=new Set<string>();
  for(const goal of g.goals){
    if(!keys(goal,["id","requirementIds","sourceRefs","facets"])||!/^intent_[a-f0-9]{16}$/.test(goal.id)||goals.has(goal.id)||!Array.isArray(goal.requirementIds)||goal.requirementIds.length>40||new Set(goal.requirementIds).size!==goal.requirementIds.length||!goal.requirementIds.every(id=>requirementIds.has(id))||!Array.isArray(goal.sourceRefs)||(!goal.sourceRefs.length || goal.sourceRefs.length>32)||!goal.sourceRefs.every(ref)||!Array.isArray(goal.facets)||goal.facets.length>256||!goal.facets.every(f=>keys(f,["kind","sourceRef"])&&["condition","exception","acceptance","reproduction","artifact_hint"].includes(f.kind)&&ref(f.sourceRef)))return false;
    goals.add(goal.id);
  }
  for(const chunk of g.chunks){
    if(!keys(chunk,["id","pool","path","revision","side","startLine","endLine","hash","evidenceId"])||!/^chunk_[a-f0-9]{24}$/.test(chunk.id)||chunks.has(chunk.id)||typeof chunk.path!=="string"||!safePath(chunk.path)||!["changed","snapshot"].includes(chunk.pool)||!["head","base"].includes(chunk.side)||!hash(chunk.hash)||!integer(chunk.startLine,100000)||chunk.startLine<1||!integer(chunk.endLine,100000)||chunk.endLine<chunk.startLine||!(chunk.revision===null||exact(chunk.revision))||!(chunk.pool==="snapshot"?chunk.evidenceId===null&&exact(chunk.revision)&&chunk.side==="head":evidence.some(e=>e&&e.id===chunk.evidenceId)))return false;
    chunks.add(chunk.id);
  }
  for(const edge of g.edges){const pair=`${edge?.goalId}:${edge?.chunkId}`;
    if(!keys(edge,["goalId","chunkId","relation","basis","score",...["line","lineBasis"].filter(key=>Object.hasOwn(edge??{},key))])||!goals.has(edge.goalId)||!chunks.has(edge.chunkId)||pairs.has(pair)||edge.relation!=="candidate"||!integer(edge.score,1000)||!Array.isArray(edge.basis)||!edge.basis.length||edge.basis.length>4||new Set(edge.basis).size!==edge.basis.length||!edge.basis.every(x=>["source_path","identifier","lexical","changed_declaration"].includes(x)))return false;
    const chunk=g.chunks.find(c=>c.id===edge.chunkId)!;
    if(edge.line!==undefined&&(!integer(edge.line,100000)||edge.line<chunk.startLine||edge.line>chunk.endLine))return false;
    if(edge.lineBasis!==undefined&&(edge.lineBasis!=="test_body_match"||edge.line===undefined||chunk.pool!=="changed"))return false;
    pairs.add(pair);
  }
  const c=g.capabilities;
  return keys(c,["wholeRepository","embeddings","symbolResolution","semantic","snapshotChunks","rejectedSnapshots","truncated"])&&c.wholeRepository==="unavailable"&&c.embeddings==="unavailable"&&c.symbolResolution==="unavailable"&&c.semantic==="existing_relations_only"&&c.snapshotChunks===g.chunks.filter(c=>c.pool==="snapshot").length&&integer(c.rejectedSnapshots,100000)&&typeof c.truncated==="boolean";
}

/** Semantic navigation is independent of strict verification and never upgrades evidence. */
export interface ReviewNavigation {
  version: 1; model: string; state: 'ranked'|'partial'|'fallback'; repository: string|null; headSha: string|null; baseSha: string|null;
  sources: Array<{id:string;authority:'issue_source'|'provided_source'|'pr_author_claim';hash:string;length:number;processedLength:number;url:string|null}>;
  goals: Array<{id:string;summary:string;emphasis:'primary'|'supporting'|'optional'|'uncertain';authority:'issue_source'|'provided_source'|'pr_author_claim'|'mixed_sources';sourceRefs:Array<ReviewSourceRefV1 & {sourceId:string}>;facets:Array<{kind:string;summary:string;sourceRefs:Array<ReviewSourceRefV1 & {sourceId:string}>}>;openQuestions:string[];firstInspection:string|null;candidates:Array<{artifactId:string;relevance:'relevant'|'possible';whyInspect:string;reviewQuestion:string;uncertainty:string}>;uncertainty:string[]}>;
  artifacts: Array<{id:string;path:string;revision:string;side:'head'|'base';startLine:number;endLine:number;hash:string;kind:'code'|'test';origin:'diff'|'snapshot'}>;
  unprocessed: string[]; limitations:string[];
  rankingStatus?: 'ready'|'partial'|'unavailable';
  coverageStatus?: 'complete'|'partial';
  failures?: Array<{stage:'intent'|'ranking'|'refinement'|'read';category:NavigationFailureCategory;reason?:NavigationFailureReason}>;
}
const navigationFailureReasons=['provider_incomplete','provider_invalid_json','provider_output_unavailable','provider_invalid_output','provider_response_invalid','provider_timeout','provider_rate_limited','provider_unavailable','local_shape','unknown_source_ref','unsafe_summary','unknown_goal_ref','duplicate_goal_ref','unknown_artifact_ref','first_not_candidate','read_unavailable','unknown'] as const;
type NavigationFailureReason=typeof navigationFailureReasons[number];
class NavigationValidationError extends SyntaxError {
  constructor(readonly reason:NavigationFailureReason){super('Navigation validation failed.');}
}
function navigationFailureReason(error:unknown):NavigationFailureReason {
  if(error instanceof NavigationValidationError)return error.reason;
  if(error instanceof SyntaxError)return 'local_shape';
  if(!navRecord(error))return 'unknown';
  if(error.incompleteReason==='max_output_tokens')return 'provider_incomplete';
  if(error.navigationReason==='provider_invalid_json'||error.navigationReason==='provider_output_unavailable')return error.navigationReason;
  if(error.code==='openai_output_invalid')return 'provider_invalid_output';
  if(error.code==='openai_response_invalid')return 'provider_response_invalid';
  if(error.code==='openai_timeout')return 'provider_timeout';
  if(error.code==='openai_rate_limited')return 'provider_rate_limited';
  if(['openai_network_error','openai_provider_unavailable','openai_auth_failed','openai_request_invalid'].includes(String(error.code)))return 'provider_unavailable';
  return 'unknown';
}
const navigationFailureCategories = ['output_limit','invalid_json_or_shape','timeout','rate_limited','provider_unavailable','read_unavailable','unknown'] as const;
type NavigationFailureCategory = typeof navigationFailureCategories[number];
function navigationFailureCategory(error:unknown):NavigationFailureCategory {
  if(error instanceof SyntaxError)return 'invalid_json_or_shape';
  if(!navRecord(error))return 'unknown';
  if(error.incompleteReason==='max_output_tokens')return 'output_limit';
  if(error.code==='openai_timeout')return 'timeout';
  if(error.code==='openai_rate_limited')return 'rate_limited';
  if(['openai_output_invalid','openai_response_invalid'].includes(String(error.code)))return 'invalid_json_or_shape';
  if(['openai_network_error','openai_provider_unavailable','openai_auth_failed','openai_request_invalid'].includes(String(error.code)))return 'provider_unavailable';
  return 'unknown';
}
const navigationFacetKinds=['condition','exception','context','constraint','acceptance','reproduction','motivation','implementation_claim','test_claim'];
function rankingStatus(n:ReviewNavigation):NonNullable<ReviewNavigation['rankingStatus']> {
  const primary=n.goals.filter(g=>g.emphasis==='primary');
  const required=primary.length?primary:n.goals;
  return required.length&&required.every(g=>g.firstInspection)?'ready':n.goals.some(g=>g.firstInspection)?'partial':'unavailable';
}
const coverageStatus=(n:ReviewNavigation):NonNullable<ReviewNavigation['coverageStatus']>=>n.unprocessed.length||n.limitations.length||n.failures?.length?'partial':'complete';
export interface ReviewNavigationRequest {
  stage:'intent'|'ranking'; model:string; sources:Array<ReviewNavigation['sources'][number] & {spans:Array<{id:string;start:number;end:number;text:string}>}>;
  // goalIds are retrieval hints, never authorization or relevance judgments.
  goals:ReviewNavigation['goals']; artifacts:Array<ReviewNavigation['artifacts'][number] & {content:string;goalIds?:string[]}>;
  inventory:Array<{path:string;status:string}>; capabilities:{readPaths:boolean;searchScope:'supplied_artifacts';wholeRepository:false};
}
type NavigationLifecycleEvent =
 | {kind:'freshness';phase:'initial'|'final';outcome:'unchanged'|'not_checked'|'snapshot_changed'|'source_changed'|'access_changed'|'context_changed'|'collection_failed';code?:string}
 | {kind:'read';trigger:'automatic'|'model';requested:number;accepted:number;outcome:'supplied'|'unavailable'|'no_valid_files'|'no_new_context'|'budget_exhausted'}
 | {kind:'stop';reason:'guard'|'freshness'|'no_goals'|'no_snapshot'|'no_read_requested'|'no_new_context'|'round_limit'|'provider_failure'};
export interface ReviewNavigationDiagnostics {
  version:1; stage:'intent'|'ranking'|'refinement'|'preflight'; requestHash:string; artifactBytes:number;
  providerCalled?:boolean; lifecycle?:NavigationLifecycleEvent[];
  limits:{artifactBytes:number;artifactCount:number}; resultLimitations:string[];
  artifacts:Array<ReviewNavigation['artifacts'][number] & {goalIds:string[]}>;
  sources:Array<{id:string;hash:string;spans:Array<{start:number;end:number;hash:string}>}>;
  goals:Array<{id:string;summaryHash:string;sourceRefs:ReviewNavigation['goals'][number]['sourceRefs'];facets:Array<{summaryHash:string;sourceRefs:ReviewNavigation['goals'][number]['sourceRefs']}>}>;
  limitations:string[];
  decisions:Array<{reason:NavigationFailureReason|'remapped'|'accepted'|'shared_supplied_artifact';goalId?:string;artifactId?:string;referenceHash?:string}>;
  transport?:NavigationTransportDiagnostics;
}
const navigationDiagnostics=new WeakMap<ReviewNavigation,ReviewNavigationDiagnostics[]>();
/** Transient, text-free execution evidence. Callers may explicitly collect it without storing source. */
export const getReviewNavigationDiagnostics=(navigation:ReviewNavigation)=>structuredClone(navigationDiagnostics.get(navigation)??[]);
export interface ReviewNavigationOptions {
  onDiagnostics?:(event:ReviewNavigationDiagnostics)=>void;
  model:string; provider?:(request:ReviewNavigationRequest)=>Promise<unknown>;
  /** Recheck the repository grant before each private provider/read phase. */
  authorizePrivate?:()=>Promise<boolean>;
  /** Metadata-only visibility check before any fresh source, model, or code read. */
  readRepositoryPrivate?:()=>Promise<boolean|null>;
  readArtifacts?:(paths:string[],headSha:string)=>Promise<Array<{path:string;headSha:string;content:string}>>;
  readCurrentInput?:()=>Promise<PullRequestInput|null>;
}
const navContexts=new WeakMap<object,{inputHash:string;outputHash:string}>();
const inputNavigationHash=(i:PullRequestInput)=>sha(JSON.stringify([i.url,i.repositoryPrivate,i.taskSource,i.taskText,i.description,i.title,i.sourceProvenance?.origin,i.sourceProvenance?.headSha,i.sourceProvenance?.baseSha,i.requirementSourceIdentityHash,i.verificationContractBindingV2?.sourceIdentity,i.changedFiles,i.verificationCriterionEvidenceV2]));
export function hasReviewNavigationContext(value:ReviewNavigation,input:PullRequestInput):boolean {
  const context=navContexts.get(value);return Boolean(context&&context.inputHash===inputNavigationHash(input)&&context.outputHash===sha(JSON.stringify(value)));
}
const navRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const navText=(v:unknown):v is string=>typeof v==='string'&&v.length<=600&&redactSecrets(v)===v&&!/[\r\n]|```/.test(v);
const navTexts=(v:unknown):v is string[]=>Array.isArray(v)&&v.length<=12&&v.every(navText);
const navKeys=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));

export async function enrichReviewNavigation(input:PullRequestInput,report:import('./types').VerificationReportV2,options:ReviewNavigationOptions):Promise<import('./types').VerificationReportV2> {
  if(report.verificationContract?.state!=='absent'||!report.reviewCandidates)return report;
  let repository:string|null=null;
  try {const u=new URL(input.url??'');if(u.origin==='https://github.com'&&/^\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(u.pathname))repository=u.pathname.split('/').slice(1,3).join('/');}catch{}
  const navigation:ReviewNavigation={version:1,model:options.model,state:'fallback',repository,headSha:exact(input.sourceProvenance?.headSha)?input.sourceProvenance!.headSha!:null,baseSha:exact(input.sourceProvenance?.baseSha)?input.sourceProvenance!.baseSha!:null,sources:[],goals:[],artifacts:[],unprocessed:[],limitations:[],failures:[]};
  const sources:ReviewNavigationRequest['sources']=[];
  for(const [id,raw,authority] of [['task',input.taskText,input.taskSource==='issue'?'issue_source':'provided_source'],['description',input.description,'pr_author_claim'],['title',input.title,'pr_author_claim']] as const){
    if(!raw.trim())continue;
    const full=redactSecretsPreservingLines(raw).replace(/\r\n?/g,'\n'),text=full.slice(0,24000);
    const spans:Array<{id:string;start:number;end:number;text:string}>=[];
    for(const match of text.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/g)) {if(spans.length>=256)break;const start=match.index!;spans.push({id:`${id}:${start}`,start,end:start+match[0].length,text:match[0]});}
    const issue=input.verificationContractBindingV2?.sourceIdentity.match(/^github:issue:([\w.-]+\/[\w.-]+)#([1-9]\d*)$/);
    const url=(id==='description'||id==='title')&&repository?input.url!:id==='task'&&authority==='issue_source'&&issue?`https://github.com/${issue[1]}/issues/${issue[2]}`:null;
    const processedLength=spans.at(-1)?.end??0;
    sources.push({id,authority,hash:sha(full),length:full.length,processedLength,url,spans});
    if(full.slice(processedLength).trim())navigation.unprocessed.push(`${id}:${processedLength}-${full.length}`);
  }
  navigation.sources=sources.map(({spans:_,...source})=>source);
  const artifacts:ReviewNavigationRequest['artifacts']=[];
  const incompletePaths=new Set<string>();
  const preferredSnapshotIds=new Set<string>(),artifactGoals=new Map<string,Set<string>>();
  const suppliedSnapshots:Array<{path:string;headSha:string;content:string}>=[];
  const add=(path:string,revision:string,side:'head'|'base',start:number,content:string,origin:'diff'|'snapshot')=>{
    if(artifacts.length>=96){navigation.limitations.push('artifact_context_truncated');return;}
    if(!safePath(path)||!exact(revision)||start<1){navigation.limitations.push('invalid_reference');return;}
    if(!content.trim())return;
    const lines=redactSecretsPreservingLines(content).split('\n');
    const bounded=lines.slice(0,80).join('\n').slice(0,8000);if(bounded.length<content.length){navigation.limitations.push('artifact_context_truncated');if(side==='head')incompletePaths.add(path);}
    const endLine=start+bounded.split('\n').length-1,hash=sha(bounded),id=`read_${sha(JSON.stringify([path,revision,start,endLine,hash])).slice(0,24)}`;
    if(!artifacts.some(a=>a.id===id))artifacts.push({id,path,revision,side,startLine:start,endLine,hash,kind:/(?:^|\/)(?:tests?|__tests__)(?:\/|\.)|[._]test\./i.test(path)?'test':'code',origin,content:bounded});
    return id;
  };
  if(repository&&input.sourceProvenance?.origin==='github_snapshot'){
    for(const file of input.changedFiles){
      const side=file.status==='removed'?'base':'head',revision=side==='base'?navigation.baseSha:navigation.headSha;if(!revision)continue;
      let patch=file.patch??'';
      const marker=patch.indexOf('\n...[truncated for privacy and token control]');
      if(marker>=0){
        // The summary may end in the middle of a source line; never label that fragment exact code.
        patch=patch.slice(0,Math.max(0,patch.lastIndexOf('\n',marker-1)));
        navigation.limitations.push('diff_context_incomplete');
        if(side==='head')incompletePaths.add(file.path);
      }else if(!patch.trim()){
        navigation.limitations.push('diff_context_incomplete');if(side==='head')incompletePaths.add(file.path);
      }
      const hunks=[...patch.matchAll(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@.*\n/gm)];
      for(let n=0;n<hunks.length;n++){
        const h=hunks[n]!,body=patch.slice(h.index!+h[0].length,hunks[n+1]?.index??patch.length);
        const lines=body.split('\n').filter(line=>line.startsWith(' ')||line.startsWith(side==='head'?'+':'-')).map(line=>line.slice(1));
        add(file.path,revision,side,Number(h[side==='head'?2:1]),lines.join('\n'),'diff');
        // A deletion in a modified file needs the old revision too. Head-only
        // context cannot show what was removed, even when the file still exists.
        if(side==='head'&&file.status!=='added'&&body.split('\n').some(line=>line.startsWith('-'))){
          const basePath=file.status==='renamed'?file.previousPath:file.path;
          if(!navigation.baseSha||!basePath||!safePath(basePath))navigation.limitations.push('invalid_reference');
          else{
            const baseLines=body.split('\n').filter(line=>line.startsWith(' ')||line.startsWith('-')).map(line=>line.slice(1));
            add(basePath,navigation.baseSha,'base',Number(h[1]),baseLines.join('\n'),'diff');
          }
        }
      }
    }
    for(const b of input.verificationCriterionEvidenceV2?.artifactBlobs??[]){
      if(b.headSha!==navigation.headSha||!b.headSha||(input.verificationCriterionEvidenceV2?.artifactBlobs??[]).some(other=>other.path===b.path&&other.headSha===b.headSha&&other.content!==b.content)){navigation.limitations.push('invalid_reference');continue;}
      suppliedSnapshots.push({...b,headSha:b.headSha});
    }
  }
  const traces:ReviewNavigationDiagnostics[]=[];
  const lifecycle:NavigationLifecycleEvent[]=[];
  const returned=new Set<string>(),aliases=new Map<string,string>();
  const canonical=(id:string):string=>aliases.has(id)?canonical(aliases.get(id)!):id;
  const finish=()=>{
    if(!navigation.goals.length)navigation.unprocessed=[...new Set([...navigation.unprocessed,...sources.flatMap(s=>s.spans.map(p=>p.id))])];
    navigation.artifacts=artifacts.filter(a=>returned.has(a.id)).map(({content:_,...a})=>a);navigation.limitations=[...new Set(navigation.limitations)];
    navigation.rankingStatus=rankingStatus(navigation);navigation.coverageStatus=coverageStatus(navigation);
    if(!traces.length)traces.push({version:1,stage:'preflight',providerCalled:false,requestHash:inputNavigationHash(input),artifactBytes:0,limits:{artifactBytes:REVIEW_PAYLOAD_BYTES,artifactCount:REVIEW_PAYLOAD_SNIPPETS},resultLimitations:[],artifacts:[],sources:[],goals:[],limitations:[...navigation.limitations],decisions:[]});
    traces.at(-1)!.lifecycle=structuredClone(lifecycle);
    for(const trace of traces)trace.resultLimitations=[...navigation.limitations];
    navigationDiagnostics.set(navigation,structuredClone(traces));
    for(const trace of traces)try{options.onDiagnostics?.(structuredClone(trace));}catch{/* Observability must not invalidate results. */}
    navContexts.set(navigation,{inputHash:inputNavigationHash(input),outputHash:sha(JSON.stringify(navigation))});
    return {...report,reviewCandidates:{...report.reviewCandidates!,navigation}};
  };
  if(!options.provider||!sources.length||(input.repositoryPrivate!==false&&!(input.repositoryPrivate===true&&options.authorizePrivate))){navigation.limitations.push(input.repositoryPrivate!==false?'private_or_unknown_access':'semantic_unavailable');lifecycle.push({kind:'stop',reason:'guard'});return finish();}
  const privateAllowed=async()=>input.repositoryPrivate!==true||Boolean(await options.authorizePrivate?.().catch(()=>false));
  const phaseAllowed=async()=>{
    if(!await privateAllowed())return false;
    if(!options.readRepositoryPrivate)return true;
    try{return await options.readRepositoryPrivate()===input.repositoryPrivate;}catch{return false;}
  };
  const addSnapshots=async(blobs:Array<{path:string;headSha:string;content:string}>)=>{
    const safe=blobs.filter(b=>safePath(b.path)&&b.headSha===navigation.headSha);
    if(safe.length<blobs.length)navigation.limitations.push('invalid_reference');
    if(safe.length>8)navigation.limitations.push('retrieval_file_budget_exceeded');
    const hints=navigation.goals.map(g=>({id:g.id,terms:allTerms([g.summary,...g.facets.map(f=>f.summary),...[...g.sourceRefs,...g.facets.flatMap(f=>f.sourceRefs)].map(r=>sources.find(s=>s.id===r.sourceId)?.spans.find(p=>p.start===r.start)?.text??'')].join(' ')).sort().slice(0,1024),anchors:artifacts.filter(a=>a.side==='head'&&(a.origin==='diff'&&(incompletePaths.has(a.path)||artifactGoals.get(a.id)?.has(g.id))||a.id===g.firstInspection||g.candidates.some(c=>c.artifactId===a.id))).map(a=>({path:a.path,startLine:a.startLine,endLine:a.endLine}))}));
    const selected=await extractReviewSnippets(safe.slice(0,8),hints);
    navigation.limitations.push(...selected.limitations);
    for(const snippet of selected.snippets){const id=add(snippet.path,snippet.headSha,'head',snippet.startLine,snippet.content,'snapshot');if(id){if(snippet.matched)preferredSnapshotIds.add(id);artifactGoals.set(id,new Set([...(artifactGoals.get(id)??[]),...snippet.goalIds]));}}
  };
  const returnedArtifacts=()=>{
    const associations=new Map(artifacts.map(a=>[a.id,new Set(artifactGoals.get(a.id)??[])]));
    const pool=artifacts.filter(a=>canonical(a.id)===a.id).slice();
    // Canonicalize only overlapping, byte-identical source at the same revision and side.
    for(let i=0;i<pool.length;i++)for(let j=i+1;j<pool.length;j++){
      const a=pool[i]!,b=pool[j]!;
      if(a.path!==b.path||a.revision!==b.revision||a.side!==b.side||a.startLine>b.endLine||b.startLine>a.endLine)continue;
      const start=Math.min(a.startLine,b.startLine),end=Math.max(a.endLine,b.endLine),al=a.content.split('\n'),bl=b.content.split('\n');
      if(end-start>=80)continue;
      let agrees=true;for(let line=Math.max(a.startLine,b.startLine);line<=Math.min(a.endLine,b.endLine);line++)if(al[line-a.startLine]!==bl[line-b.startLine])agrees=false;
      if(!agrees)continue;
      const content=Array.from({length:end-start+1},(_,offset)=>{const line=start+offset;return line>=a.startLine&&line<=a.endLine?al[line-a.startLine]!:bl[line-b.startLine]!;}).join('\n');
      if(Buffer.byteLength(content)>8000)continue;
      const id=add(a.path,a.revision,a.side,start,content,a.origin==='snapshot'||b.origin==='snapshot'?'snapshot':'diff');if(!id)continue;
      const goals=new Set([...(associations.get(a.id)??[]),...(associations.get(b.id)??[])]);
      associations.set(id,goals);artifactGoals.set(id,goals);
      if(preferredSnapshotIds.has(a.id)||preferredSnapshotIds.has(b.id))preferredSnapshotIds.add(id);
      if(a.id!==id)aliases.set(a.id,id);if(b.id!==id)aliases.set(b.id,id);
      pool[i]=artifacts.find(c=>c.id===id)!;pool.splice(j,1);j=i;
    }
    const selected=new Map<string,Set<string>>();let bytes=2;
    // A fixed overhead allowance makes grouping labels irrelevant to the source-code budget.
    const budgetGoalIds=Array.from({length:16},(_,n)=>`goal_${n+1}`);
    const cost=(id:string)=>Buffer.byteLength(JSON.stringify({...artifacts.find(a=>a.id===id)!,goalIds:budgetGoalIds}))+1;
    const include=(artifactId:string,ids:string[])=>{
      if(selected.has(artifactId)){for(const id of ids)selected.get(artifactId)!.add(id);return true;}
      const size=cost(artifactId);
      if(selected.size>=REVIEW_PAYLOAD_SNIPPETS||bytes+size>REVIEW_PAYLOAD_BYTES)return false;
      bytes+=size;selected.set(artifactId,new Set(ids));return true;
    };
    const required=navigation.goals.map(g=>({goal:g.id,ids:[...new Set([...(g.firstInspection?[g.firstInspection]:[]),...g.candidates.map(c=>c.artifactId)])]}));
    const expanded=required.map(g=>({...g,ids:[...new Set(g.ids.map(canonical))]}));
    const expandedIds=[...new Set(expanded.flatMap(g=>g.ids))];
    const fits=expandedIds.length<=REVIEW_PAYLOAD_SNIPPETS&&2+expandedIds.reduce((n,id)=>n+cost(id),0)<=REVIEW_PAYLOAD_BYTES;
    const reservation=fits?expanded:required;
    if(!fits)navigation.limitations.push('retrieval_budget_exceeded');
    for(let slot=0;slot<REVIEW_PAYLOAD_SNIPPETS;slot++)for(const g of reservation){
      const id=g.ids[slot];if(id&&!include(id,[g.goal]))navigation.limitations.push('retrieval_budget_exceeded');
    }
    const ranked=pool.sort((a,b)=>Number(preferredSnapshotIds.has(b.id))-Number(preferredSnapshotIds.has(a.id))||a.path.localeCompare(b.path)||a.startLine-b.startLine);
    const firstPaths=new Set<string>();const leading=ranked.filter(a=>{if(firstPaths.has(a.path))return false;firstPaths.add(a.path);return true;});
    const ordered=[...leading,...ranked.filter(a=>!leading.includes(a))];
    const testIndex=ordered.findIndex(a=>a.kind==='test');if(testIndex>0)ordered.splice(1,0,...ordered.splice(testIndex,1));
    for(const a of ordered){
      if([...selected.keys()].some(key=>key!==a.id&&canonical(key)===a.id))continue;
      if(!include(a.id,[...(associations.get(a.id)??[])]))navigation.limitations.push('retrieval_budget_exceeded');
    }
    // Remap a validated location only if its replacement is in the shared packet.
    for(const g of navigation.goals){
      const resolve=(id:string)=>selected.has(canonical(id))?canonical(id):id;
      if(g.firstInspection)g.firstInspection=resolve(g.firstInspection);
      g.candidates=g.candidates.map(c=>({...c,artifactId:resolve(c.artifactId)})).filter((c,index,all)=>all.findIndex(other=>other.artifactId===c.artifactId)===index);
    }
    return [...selected].map(([id,ids])=>{returned.add(id);return {...artifacts.find(a=>a.id===id)!,goalIds:[...ids]};}).sort((a,b)=>a.path.localeCompare(b.path)||a.startLine-b.startLine||a.id.localeCompare(b.id));
  };
  const request=(stage:'intent'|'ranking'):ReviewNavigationRequest=>{
    const packet=stage==='ranking'?returnedArtifacts():[];
    return {stage,model:options.model,sources:stage==='intent'?sources:[],goals:navigation.goals.map(g=>({...g,firstInspection:null,candidates:[],uncertainty:[]})),artifacts:packet,inventory:stage==='ranking'?input.changedFiles.filter(f=>safePath(f.path)).slice(0,128).map(f=>({path:f.path,status:f.status??'modified'})):[],capabilities:{readPaths:!!options.readArtifacts,searchScope:'supplied_artifacts',wholeRepository:false}};
  };
  const invoke=async(packet:ReviewNavigationRequest,stage:ReviewNavigationDiagnostics['stage'])=>{
    if(!await phaseAllowed())throw new Error('Repository access changed.');
    const trace:ReviewNavigationDiagnostics={version:1,stage,providerCalled:true,limits:{artifactBytes:REVIEW_PAYLOAD_BYTES,artifactCount:REVIEW_PAYLOAD_SNIPPETS},resultLimitations:[],requestHash:sha(JSON.stringify(packet)),artifactBytes:Buffer.byteLength(JSON.stringify(packet.artifacts)),artifacts:packet.artifacts.map(({content:_,...a})=>({...a,goalIds:[...(a.goalIds??[])]})),sources:packet.sources.map(s=>({id:s.id,hash:s.hash,spans:s.spans.map(p=>({start:p.start,end:p.end,hash:sha(p.text)}))})),goals:packet.goals.map(g=>({id:g.id,summaryHash:sha(g.summary),sourceRefs:structuredClone(g.sourceRefs),facets:g.facets.map(f=>({summaryHash:sha(f.summary),sourceRefs:structuredClone(f.sourceRefs)}))})),limitations:[...new Set(navigation.limitations)],decisions:[]};
    traces.push(trace);
    try{return await options.provider!(packet);}finally{trace.transport=getNavigationTransportDiagnostics(packet);}
  };
  const refs=(ids:unknown)=>{
    if(!Array.isArray(ids)||!ids.length||ids.length>24){recordFailure('invalid_json_or_shape','local_shape');return [];}
    return ids.flatMap(id=>{for(const s of sources){const span=s.spans.find(p=>p.id===id);if(span)return [{sourceId:s.id,start:span.start,end:span.end,hash:sha(span.text)}];}recordFailure('invalid_json_or_shape','unknown_source_ref');return [];});
  };
  const safeSummary=(text:unknown):string|undefined=>{
    if(typeof text!=='string'){recordFailure('invalid_json_or_shape','local_shape');return undefined;}
    let safe=redactSecrets(text).replace(/```[\s\S]*?(?:```|$)/g,'').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim();
    const sourceOverlap=sources.some(s=>s.spans.some(p=>p.text.trim().length>=24&&text.includes(p.text.trim())));
    const codeLines=[...artifacts,...suppliedSnapshots.filter(b=>Buffer.byteLength(b.content)<=REVIEW_FILE_BYTES)].flatMap(a=>a.content.split('\n').map(line=>line.replace(/\s+/g,' ').trim())).filter(line=>line.length>=12);
    // Drop the affected field rather than splicing a guessed phrase into prose.
    // Other fields and the validated inspection location remain independently usable.
    const codeOverlap=codeLines.some(line=>safe.includes(line));
    safe=safe.slice(0,600);
    if(safe!==text||sourceOverlap||codeOverlap){recordFailure('invalid_json_or_shape','unsafe_summary');navigation.limitations.push('unsafe_summary_omitted');}
    return !codeOverlap&&!(input.repositoryPrivate===true&&sourceOverlap)&&safe&&safe!=='[redacted]'?safe:undefined;
  };
  const fresh=async(phase:'initial'|'final')=>{
    let outcome:Extract<NavigationLifecycleEvent,{kind:'freshness'}>['outcome']='not_checked',code:string|undefined;
    if(!await phaseAllowed())outcome='access_changed';
    else if(options.readCurrentInput)try{
      const current=await options.readCurrentInput();
      if(!current)outcome='collection_failed';
      else if(current.repositoryPrivate!==input.repositoryPrivate||current.url!==input.url)outcome='access_changed';
      else if(current.sourceProvenance?.headSha!==input.sourceProvenance?.headSha||current.sourceProvenance?.baseSha!==input.sourceProvenance?.baseSha||current.sourceProvenance?.origin!==input.sourceProvenance?.origin)outcome='snapshot_changed';
      else if(JSON.stringify([current.taskSource,current.taskText,current.title,current.description,current.requirementSourceIdentityHash,current.verificationContractBindingV2?.sourceIdentity])!==JSON.stringify([input.taskSource,input.taskText,input.title,input.description,input.requirementSourceIdentityHash,input.verificationContractBindingV2?.sourceIdentity]))outcome='source_changed';
      else outcome=inputNavigationHash({...current,verificationCriterionEvidenceV2:input.verificationCriterionEvidenceV2})===inputNavigationHash(input)?'unchanged':'context_changed';
    }catch(error){
      // Collector errors are classified by their public discriminator, never their raw message.
      const name=error instanceof Error?error.name:'';
      outcome=name==='GitHubPullRequestHeadChangedError'?'snapshot_changed':name==='GitHubPullRequestSourceChangedError'?'source_changed':'collection_failed';
      if(navRecord(error)&&['github_rate_limited','github_secondary_rate_limited','github_token_rejected','github_auth_required','github_permission_denied','github_not_found','github_fetch_failed'].includes(String(error.code)))code=String(error.code);
      if(code&&['github_token_rejected','github_auth_required','github_permission_denied','github_not_found'].includes(code))outcome='access_changed';
    }
    lifecycle.push({kind:'freshness',phase,outcome,...(code?{code}:{})});
    if(outcome==='unchanged'||outcome==='not_checked')return true;
    // The initial collector already checked source and base/head at its final
    // read. A later public rate limit cannot invalidate that pinned snapshot;
    // it only prevents confirming that the live PR is still current.
    if(outcome==='collection_failed'&&['github_rate_limited','github_secondary_rate_limited'].includes(code??'')&&input.repositoryPrivate===false&&input.sourceProvenance?.origin==='github_snapshot'&&exact(input.sourceProvenance.headSha)&&exact(input.sourceProvenance.baseSha)){
      navigation.limitations.push('freshness_unavailable');
      return true;
    }
    navigation.limitations.push(outcome==='snapshot_changed'||outcome==='source_changed'?'stale_snapshot':outcome==='access_changed'?'freshness_access_changed':outcome==='context_changed'?'freshness_context_changed':'freshness_unavailable');
    return false;
  };
  let stage:'intent'|'ranking'|'refinement'='intent';
  const recordFailure=(category:NavigationFailureCategory,reason:NavigationFailureReason,failureStage:NonNullable<ReviewNavigation['failures']>[number]['stage']=stage)=>{
    const trace=traces.at(-1);if(trace&&trace.decisions.length<512)trace.decisions.push({reason});
    if(navigation.failures!.length<4&&!navigation.failures!.some(f=>f.stage===failureStage&&f.reason===reason))navigation.failures!.push({stage:failureStage,category,reason});
  };
  const readPaths=new Set<string>();
  const readSnapshots=async(requested:unknown[],trigger:'automatic'|'model')=>{
    const safe=[...new Set(requested.filter((p):p is string=>typeof p==='string'&&safePath(p)))];
    if(safe.length!==requested.length)navigation.limitations.push('invalid_reference');
    const available=safe.filter(p=>!readPaths.has(p));
    const paths=available.slice(0,Math.max(0,8-readPaths.size));
    if(paths.length<available.length)navigation.limitations.push('retrieval_file_budget_exceeded');
    const event:Extract<NavigationLifecycleEvent,{kind:'read'}>={kind:'read',trigger,requested:safe.length,accepted:0,outcome:'no_new_context'};
    lifecycle.push(event);
    if(!paths.length){event.outcome=available.length?'budget_exhausted':'no_new_context';return false;}
    if(!options.readArtifacts){event.outcome='unavailable';navigation.limitations.push('read_unavailable');return false;}
    if(!await phaseAllowed()){event.outcome='unavailable';navigation.limitations.push('freshness_access_changed');return false;}
    for(const path of paths)readPaths.add(path);
    let blobs:Array<{path:string;headSha:string;content:string}>;
    try{blobs=await options.readArtifacts(paths,navigation.headSha!);}catch{event.outcome='unavailable';navigation.limitations.push('read_unavailable');recordFailure('read_unavailable','read_unavailable','read');return false;}
    const valid=blobs.filter(b=>paths.includes(b.path)&&b.headSha===navigation.headSha&&!blobs.some(other=>other.path===b.path&&other.content!==b.content));
    if(valid.length<blobs.length)navigation.limitations.push('invalid_reference');
    event.accepted=new Set(valid.map(b=>b.path)).size;
    if(paths.some(p=>!valid.some(b=>b.path===p)))navigation.limitations.push('requested_path_unread');
    const before=artifacts.length;await addSnapshots(valid);
    event.outcome=!valid.length?'no_valid_files':artifacts.length>before?'supplied':'no_new_context';
    return artifacts.length>before;
  };
  try {
    if(!await fresh('initial')){lifecycle.push({kind:'stop',reason:'freshness'});return finish();}
    const result=await invoke(request('intent'),'intent');
    if(!navRecord(result)||!Array.isArray(result.goals)||result.goals.length>16||!Array.isArray(result.unprocessed))throw new NavigationValidationError('local_shape');
    navigation.goals=result.goals.flatMap((g,index)=>{
      if(!navRecord(g)||!['primary','supporting','optional','uncertain'].includes(String(g.emphasis))||!Array.isArray(g.facets)||g.facets.length>12||!Array.isArray(g.openQuestions)||g.openQuestions.length>12){recordFailure('invalid_json_or_shape','local_shape');return [];}
      const sourceRefs=refs(g.sourceRefs);if(!sourceRefs.length)return [];const authorities=[...new Set(sourceRefs.map(r=>sources.find(s=>s.id===r.sourceId)!.authority))];
      const summary=safeSummary(g.summary);
      return [{id:`goal_${index+1}`,summary:summary??'Review source-linked goal',emphasis:g.emphasis as ReviewNavigation['goals'][number]['emphasis'],authority:authorities.length===1?authorities[0]!:'mixed_sources',sourceRefs,facets:g.facets.flatMap(f=>{
        if(!navRecord(f)||!navigationFacetKinds.includes(String(f.kind))){recordFailure('invalid_json_or_shape','local_shape');return [];}
        const sourceRefs=refs(f.sourceRefs),summary=safeSummary(f.summary);
        // A withheld description must not erase the validated condition kind or its source.
        return !sourceRefs.length?[]:[{kind:String(f.kind),summary:summary??'Summary omitted; inspect the referenced source.',sourceRefs}];
      }),openQuestions:g.openQuestions.flatMap(text=>safeSummary(text)??[]),firstInspection:null,candidates:[],uncertainty:[]}];
    });
    for(const id of result.unprocessed){if(typeof id!=='string'||!sources.some(s=>s.spans.some(p=>p.id===id))){recordFailure('invalid_json_or_shape','unknown_source_ref');continue;}navigation.unprocessed.push(id);}
    const processed=new Set(navigation.goals.flatMap(g=>[...g.sourceRefs,...g.facets.flatMap(f=>f.sourceRefs)].map(r=>`${r.sourceId}:${r.start}`)));
    navigation.unprocessed.push(...sources.flatMap(s=>s.spans.filter(p=>!processed.has(p.id)).map(p=>p.id)));
    navigation.goals.sort((a,b)=>['primary','supporting','optional','uncertain'].indexOf(a.emphasis)-['primary','supporting','optional','uncertain'].indexOf(b.emphasis));
    if(!navigation.goals.length){navigation.limitations.push('no_interpreted_goal');lifecycle.push({kind:'stop',reason:'no_goals'});return finish();}
    navigation.state='partial';
    // Associate changed evidence by each goal's own source and wording, not every goal's anchors.
    for(const g of navigation.goals){
      const text=[g.summary,...g.facets.map(f=>f.summary),...[...g.sourceRefs,...g.facets.flatMap(f=>f.sourceRefs)].map(r=>sources.find(s=>s.id===r.sourceId)?.spans.find(p=>p.start===r.start)?.text??'')].join(' '),terms=allTerms(text).sort().slice(0,1024);
      const matching=artifacts.filter(a=>text.includes(a.path)||allTerms(a.content+' '+a.path).some(t=>terms.some(term=>t.startsWith(term)||term.startsWith(t))));
      for(const a of artifacts.filter(a=>matching.some(m=>m.path===a.path))){const ids=artifactGoals.get(a.id)??new Set<string>();ids.add(g.id);artifactGoals.set(a.id,ids);}
    }
    await addSnapshots(suppliedSnapshots);
    if(!repository||!navigation.headSha){navigation.limitations.push('exact_snapshot_unavailable');lifecycle.push({kind:'stop',reason:'no_snapshot'});return finish();}
    const missing=[...incompletePaths].filter(path=>!suppliedSnapshots.some(b=>b.path===path)).sort();
    if(missing.length)await readSnapshots(missing,'automatic');
    for(let round=0;round<2;round++){
      stage=round===0?'ranking':'refinement';
      const previouslyReturned=new Set(returned),packet=request('ranking');
      if(round===1&&!packet.artifacts.some(a=>!previouslyReturned.has(a.id))){lifecycle.push({kind:'stop',reason:'no_new_context'});break;}
      const result:unknown=await invoke(packet,stage);
      if(!navRecord(result)||!Array.isArray(result.rankings)||result.rankings.length>16||!Array.isArray(result.readPaths))throw new NavigationValidationError('local_shape');
      // Validate each result locally while retaining previously usable locations.
      const nextGoals=structuredClone(navigation.goals);
      const seenGoals=new Set<string>();
      for(const row of result.rankings){
        if(!navRecord(row)){recordFailure('invalid_json_or_shape','local_shape');continue;}
        const goal=nextGoals.find(g=>g.id===row.goalId);
        if(!Array.isArray(row.candidates)||row.candidates.length>12||!Array.isArray(row.uncertainty)||row.uncertainty.length>12){recordFailure('invalid_json_or_shape','local_shape');continue;}
        if(!goal||seenGoals.has(goal.id)){recordFailure('invalid_json_or_shape',!goal?'unknown_goal_ref':'duplicate_goal_ref');navigation.limitations.push('invalid_reference');continue;}
        seenGoals.add(goal.id);
        const candidates:ReviewNavigation['goals'][number]['candidates']=[];
        for(const edge of row.candidates){
          const rawId=navRecord(edge)?String(edge.artifactId):'',id=packet.artifacts.some(a=>a.id===canonical(rawId))?canonical(rawId):rawId;
          const allowed=returned.has(rawId)&&returned.has(id);
          traces.at(-1)?.decisions.push({goalId:goal.id,...(allowed?{artifactId:id}:{referenceHash:sha(rawId)}),reason:!allowed?'unknown_artifact_ref':!navRecord(edge)||!['relevant','possible'].includes(String(edge.relevance))?'local_shape':id!==rawId?'remapped':packet.artifacts.find(a=>a.id===id)?.goalIds?.includes(goal.id)?'accepted':'shared_supplied_artifact'});
          if(!navRecord(edge)||!returned.has(rawId)||!returned.has(id)||!allowed||!['relevant','possible'].includes(String(edge.relevance))){recordFailure('invalid_json_or_shape',!returned.has(rawId)||!returned.has(id)||!allowed?'unknown_artifact_ref':'local_shape');navigation.limitations.push('invalid_reference');continue;}
          const previous=goal.candidates.find(c=>c.artifactId===id);
          candidates.push({artifactId:id,relevance:edge.relevance as 'relevant'|'possible',whyInspect:safeSummary(edge.whyInspect)??previous?.whyInspect??'',reviewQuestion:safeSummary(edge.reviewQuestion)??previous?.reviewQuestion??'',uncertainty:safeSummary(edge.uncertainty)??previous?.uncertainty??''});
        }
        const first=typeof row.firstInspection==='string'&&returned.has(row.firstInspection)?candidates.find(e=>e.artifactId===row.firstInspection||e.artifactId===canonical(row.firstInspection as string)):undefined;
        if(row.firstInspection!==null&&!first){recordFailure('invalid_json_or_shape','first_not_candidate');navigation.limitations.push('invalid_reference');}
        const previousFirst=goal.candidates.find(c=>c.artifactId===goal.firstInspection),ids=new Set<string>();
        // Omission does not reject a previously validated candidate. Explicit new first choice wins.
        goal.candidates=[...(first?[first]:previousFirst?[previousFirst]:[]),...candidates,...goal.candidates].filter(e=>{if(ids.has(e.artifactId))return false;ids.add(e.artifactId);return true;}).slice(0,12);
        goal.firstInspection=first?.artifactId??goal.firstInspection;goal.uncertainty=row.uncertainty.flatMap(text=>safeSummary(text)??[]);
      }
      navigation.goals=nextGoals;
      if(round===0&&result.readPaths.length){
        if(await readSnapshots(result.readPaths,'model'))continue;
        lifecycle.push({kind:'stop',reason:'no_new_context'});
      }else lifecycle.push({kind:'stop',reason:round===1?'round_limit':'no_read_requested'});
      break;
    }
    navigation.state=navigation.goals.every(g=>g.firstInspection)&&!navigation.unprocessed.length&&!navigation.limitations.length?'ranked':'partial';
  }catch(error){recordFailure(navigationFailureCategory(error),navigationFailureReason(error));navigation.limitations.push('semantic_unavailable');lifecycle.push({kind:'stop',reason:'provider_failure'});}
  // Retained provisional locations still require final authorization after failure.
  if(!await fresh('final')){navigation.goals.forEach(g=>{g.firstInspection=null;g.candidates=[];});navigation.state='partial';lifecycle.push({kind:'stop',reason:'freshness'});}
  return finish();
}

/** Shape/reference validation establishes provenance structure, never relevance. */
export function validReviewNavigation(value:unknown):value is ReviewNavigation {
  try {
    if(!navRecord(value)||!navKeys(value,['version','model','state','repository','headSha','baseSha','sources','goals','artifacts','unprocessed','limitations',...['rankingStatus','coverageStatus','failures'].filter(k=>Object.hasOwn(value,k))]))return false;
    const n=value as unknown as ReviewNavigation;
    if(n.version!==1||!navText(n.model)||!['ranked','partial','fallback'].includes(n.state)||!(n.repository===null||/^[\w.-]+\/[\w.-]+$/.test(n.repository))||![n.headSha,n.baseSha].every(s=>s===null||exact(s))||!Array.isArray(n.sources)||n.sources.length>3||!Array.isArray(n.goals)||n.goals.length>16||!Array.isArray(n.artifacts)||n.artifacts.length>96||!Array.isArray(n.unprocessed)||n.unprocessed.length>2000||!n.unprocessed.every(navText)||!navTexts(n.limitations))return false;
    const hash=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
    const integer=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>=0;
    if(new Set(n.sources.map(s=>s.id)).size!==n.sources.length||new Set(n.goals.map(g=>g.id)).size!==n.goals.length||new Set(n.artifacts.map(a=>a.id)).size!==n.artifacts.length)return false;
    for(const s of n.sources)if(!navRecord(s)||!navKeys(s,['id','authority','hash','length','processedLength','url'])||!['task','description','title'].includes(s.id)||!['issue_source','provided_source','pr_author_claim'].includes(s.authority)||s.id!=='task'&&s.authority!=='pr_author_claim'||!hash(s.hash)||!integer(s.length)||!integer(s.processedLength)||s.processedLength>s.length||s.processedLength>24000||!(s.url===null||typeof s.url==='string'&&/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(?:pull|issues)\/[1-9]\d*$/.test(s.url)))return false;
    const refs=(rs:unknown)=>Array.isArray(rs)&&rs.length>0&&rs.length<=24&&rs.every(r=>navRecord(r)&&navKeys(r,['sourceId','start','end','hash'])&&integer(r.start)&&integer(r.end)&&Number(r.end)>Number(r.start)&&hash(r.hash)&&n.sources.some(s=>s.id===r.sourceId&&Number(r.end)<=s.processedLength));
    for(const a of n.artifacts)if(!navRecord(a)||!navKeys(a,['id','path','revision','side','startLine','endLine','hash','kind','origin'])||!/^read_[a-f0-9]{24}$/.test(a.id)||!safePath(a.path)||!exact(a.revision)||!['head','base'].includes(a.side)||a.revision!==(a.side==='head'?n.headSha:n.baseSha)||!integer(a.startLine)||a.startLine<1||!integer(a.endLine)||a.endLine<a.startLine||a.endLine-a.startLine>=80||!hash(a.hash)||!['code','test'].includes(a.kind)||!['diff','snapshot'].includes(a.origin))return false;
    for(const g of n.goals){
      if(!navRecord(g)||!navKeys(g,['id','summary','emphasis','authority','sourceRefs','facets','openQuestions','firstInspection','candidates','uncertainty'])||!/^goal_\d+$/.test(g.id)||!navText(g.summary)||!['primary','supporting','optional','uncertain'].includes(g.emphasis)||!refs(g.sourceRefs)||!Array.isArray(g.facets)||g.facets.length>12||!navTexts(g.openQuestions)||!navTexts(g.uncertainty)||!Array.isArray(g.candidates)||g.candidates.length>12)return false;
      const authorities=[...new Set(g.sourceRefs.map(r=>n.sources.find(s=>s.id===r.sourceId)!.authority))];if(g.authority!==(authorities.length===1?authorities[0]:'mixed_sources'))return false;
      if(!g.facets.every(f=>navRecord(f)&&navKeys(f,['kind','summary','sourceRefs'])&&navigationFacetKinds.includes(f.kind)&&navText(f.summary)&&refs(f.sourceRefs)))return false;
      if(!g.candidates.every(e=>navRecord(e)&&navKeys(e,['artifactId','relevance','whyInspect','reviewQuestion','uncertainty'])&&n.artifacts.some(a=>a.id===e.artifactId)&&['relevant','possible'].includes(e.relevance)&&[e.whyInspect,e.reviewQuestion,e.uncertainty].every(navText)))return false;
      if(g.firstInspection!==null&&!g.candidates.some(e=>e.artifactId===g.firstInspection))return false;
    }
    if(n.failures!==undefined&&(!Array.isArray(n.failures)||n.failures.length>4||!n.failures.every(f=>navRecord(f)&&navKeys(f,['stage','category',...(Object.hasOwn(f,'reason')?['reason']:[])])&&(!Object.hasOwn(f,'reason')||navigationFailureReasons.includes(f.reason!))&&['intent','ranking','refinement','read'].includes(f.stage)&&navigationFailureCategories.includes(f.category))))return false;
    if(n.rankingStatus!==undefined&&n.rankingStatus!==rankingStatus(n)||n.coverageStatus!==undefined&&n.coverageStatus!==coverageStatus(n))return false;
    if(n.rankingStatus!==undefined&&n.goals.some(g=>new Set(g.candidates.map(e=>e.artifactId)).size!==g.candidates.length))return false;
    return true;
  }catch{return false;}
}
