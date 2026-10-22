import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {QuickSummaryPanel} from './PublicGitHubDashboard';
import {ReportTopSummary} from './ReportTopSummary';
import {PurposeCodeEvidence,readablePurposeReferenceIds} from './PurposeCodeEvidence';
import {buildDashboardPrEvidenceReview} from '@/lib/pr-evidence-review';
import {toQuickSummary} from '@/lib/github-dashboard-view-model';
const head='a'.repeat(40),base='b'.repeat(40),id=(p:string,n:string)=>p+'_'+n.repeat(24),a=id('pe','1'),b=id('pe','2'),goal=id('pg','1');
// The head file is a collected change at the exact head revision; the base location has no readable stored item.
function detail(evidenceIndex:any[]=[{id:'ev-one',kind:'changed_file',locator:'src/one/file.ts',codeLocation:{path:'src/one/file.ts',side:'head',revisionSha:head,line:2}}],locale:'en'|'ko'='en'):any{
 return {repositoryFullName:'owner/repo',id:'saved',pullRequestNumber:48,headSha:head,freshness:'current',copyEligible:true,report:{reportSchemaVersion:'verification-report.v2',requirements:[],evidenceIndex,testing:{ciStatus:'passed',lintStatus:'unknown',typecheckStatus:'unknown'},
  purposeAssessmentSummary:{version:1,flow:'explore_final_v1',scope:'stated_purpose_at_snapshot',state:'limited',overall:'partial',limitations:[],goals:[{goalId:goal,authority:'author_claim',achievement:'partial',assurance:'evidence_assessed',implementation:'supports',testRelation:'unknown',execution:'not_observed'}]},
  purposeReview:{version:1,flow:'explore_final_v1',locale,headSha:head,baseSha:base,references:[{id:a,path:'src/one/file.ts',side:'head',revision:head,startLine:1,endLine:3},{id:b,path:'src/one/file.ts',side:'base',revision:base,startLine:5,endLine:9}],
   clauses:[{clauseId:id('pc','1'),goalId:goal,purpose:'Original author intent',conditions:[],exceptions:[],implementation:'supports',changeDescriptions:[{text:'Independent claim A',evidenceRefs:[a]},{text:'Independent claim B',evidenceRefs:[b]}],testDescriptions:[],evidenceRefs:[a],counterEvidenceRefs:[]}]}}};
}
const review=(d:any)=>buildDashboardPrEvidenceReview(d)!;
it('offers code only for cited locations whose exact-revision file is a stored collected change',()=>{
 expect([...readablePurposeReferenceIds(review(detail()),true)]).toEqual([a]);
 expect(readablePurposeReferenceIds(review(detail()),false).size).toBe(0);
 // Same path at another revision is not the cited file: nothing is matched by path alone.
 const moved=detail([{id:'ev-one',kind:'changed_file',locator:'src/one/file.ts',codeLocation:{path:'src/one/file.ts',side:'head',revisionSha:'c'.repeat(40),line:2}}]);
 expect(readablePurposeReferenceIds(review({...moved,headSha:'c'.repeat(40)}),true).size).toBe(0);
});
it('opens the first readable cited location with its exact code reader; others stay selectable or GitHub-only',()=>{
 const html=renderToStaticMarkup(<PurposeCodeEvidence review={review(detail())} reportId="saved" runtime={{request:async()=>new Response('{}')} as any}/>);
 expect(html).toContain('Cited code');
 expect(html.match(/class="report-code-ref"/g)).toHaveLength(2);
 expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="src\/one\/file.ts, after change, lines 1-3"/);
 expect(html).toContain('Loading referenced code');
 expect(html).toContain('aria-label="Close code for src/one/file.ts"');
 const baseHtml=renderToStaticMarkup(<PurposeCodeEvidence review={review(detail())} reportId="saved" selection={{id:b,onSelect(){}}}/>);
 expect(baseHtml).toContain("This location can&#x27;t be read here. Open it on GitHub.");
 expect(baseHtml).toContain(`/blob/${base}/src/one/file.ts#L5-L9`);
 expect(baseHtml).not.toContain('Loading referenced code');
});
it('without a saved report id every location is GitHub-only, and a report without cited code says so',()=>{
 const html=renderToStaticMarkup(<PurposeCodeEvidence review={review(detail())}/>);
 expect(html).toContain("This location can&#x27;t be read here.");expect(html).not.toContain('report-code-viewer');
 const empty=review(detail());empty.purposeReview={...empty.purposeReview!,clauses:[]};
 expect(renderToStaticMarkup(<PurposeCodeEvidence review={empty}/>)).toContain('No cited code locations in this report.');
});
it('a readable location label opens the code pane; GitHub stays a separate exact link and nothing reads code before opening',()=>{
 const d=detail(),q=toQuickSummary(d);
 const closed=renderToStaticMarkup(<QuickSummaryPanel detail={d} quickSummary={q} onShowDetail={()=>{}} showDetailedEvidence={false} demoMode={false}/>);
 expect(closed.match(/class="report-ref-read"/g)).toHaveLength(1);
 expect(closed).toContain('aria-label="View code: src/one/file.ts, after change, lines 1-3"');
 expect(closed).toContain(`class="report-ref-github" href="https://github.com/owner/repo/blob/${head}/src/one/file.ts#L1-L3"`);
 // The base-side location is not readable here: it keeps its exact GitHub link only.
 expect(closed).toContain(`class="report-purpose-ref-link" href="https://github.com/owner/repo/blob/${base}/src/one/file.ts#L5-L9"`);
 expect(closed.match(/aria-controls="report-code-pane"/g)).toHaveLength(1);
 // Collected-change rows keep their closed per-file readers; no code panel is open and nothing has been read.
 expect(closed).not.toContain('id="report-code-pane"');expect(closed).not.toContain('report-code-panel');
 const open=renderToStaticMarkup(<QuickSummaryPanel detail={d} quickSummary={q} onShowDetail={()=>{}} showDetailedEvidence demoMode={false}/>);
 // One code pane with one reader; the materials disclosure does not mount a second one.
 expect(open.match(/id="report-code-pane"/g)).toHaveLength(1);
 expect(open.match(/class="report-code-evidence"/g)).toHaveLength(1);
 expect(open).toContain('class="report-materials"');expect(open).toContain('Close code');expect(open).toContain('Back to report');
 expect(open.split('Independent claim A').length-1).toBe(1);
 // Demo/sample reports have no code API: no read-code entry and no pane.
 const demo=renderToStaticMarkup(<QuickSummaryPanel detail={d} quickSummary={q} onShowDetail={()=>{}} showDetailedEvidence demoMode/>);
 expect(demo).not.toContain('report-ref-read');expect(demo).not.toContain('report-code-pane');
 // Without a readable location the code button is not offered; materials/export stay reachable.
 const none=renderToStaticMarkup(<QuickSummaryPanel detail={detail([])} quickSummary={toQuickSummary(detail([]))} onShowDetail={()=>{}} showDetailedEvidence={false} demoMode={false}/>);
 expect(none).not.toContain('aria-controls="report-code-pane"');expect(none).toContain('class="report-materials"');
});
it('marks only the clicked description when several descriptions cite the same location',()=>{
 const d=detail();d.report.purposeReview.clauses[0].changeDescriptions=[{text:'First claim',evidenceRefs:[a]},{text:'Second claim',evidenceRefs:[a]},{text:'Third claim',evidenceRefs:[a]}];
 const clauseId=d.report.purposeReview.clauses[0].clauseId;
 const html=renderToStaticMarkup(<ReportTopSummary report={d.report} review={review(d)} readCode={{readable:new Set([a]),onRead(){},selected:{id:a,origin:{clauseId,kind:'change',index:1}}}}/>);
 expect(html.match(/is-code-origin/g)).toHaveLength(1);
 expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
 expect(html.indexOf('is-code-origin')).toBeGreaterThan(html.indexOf('First claim'));
 expect(html.indexOf('is-code-origin')).toBeLessThan(html.indexOf('Second claim'));
 // A selection without an origin (toolbar or in-pane choice) marks no description.
 const plain=renderToStaticMarkup(<ReportTopSummary report={d.report} review={review(d)} readCode={{readable:new Set([a]),onRead(){},selected:{id:a}}}/>);
 expect(plain).not.toContain('is-code-origin');expect(plain).not.toContain('aria-pressed="true"');
});
it('labels the reader in the report locale',()=>{
 const html=renderToStaticMarkup(<PurposeCodeEvidence review={review(detail(undefined,'ko'))} reportId="saved"/>);
 expect(html).toContain('인용된 코드');expect(html).toContain('lang="ko"');expect(html).toContain('변경 후');
});
