import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {ReportTopSummary} from './ReportTopSummary';
import {QuickSummaryPanel} from './PublicGitHubDashboard';
import {ReportView} from './ReportView';
import {generateVerificationReportV2FromInput} from '@/lib/verifier';
import {demoScenarios} from '@/lib/sample-data';
import {toQuickSummary} from '@/lib/github-dashboard-view-model';
const head='a'.repeat(40),base='b'.repeat(40),id=(p:string,n:string)=>p+'_'+n.repeat(24),a=id('pe','1'),b=id('pe','2');
function fixture(locale:'en'|'ko'='en'):any{const goal=id('pg','1');return {repositoryFullName:'owner/repo',id:'saved',pullRequestNumber:46,headSha:head,freshness:'current',copyEligible:true,report:{reportSchemaVersion:'verification-report.v2',requirements:[],testing:{ciStatus:'passed',lintStatus:'unknown',typecheckStatus:'unknown'},purposeAssessmentSummary:{version:1,flow:'explore_final_v1',scope:'stated_purpose_at_snapshot',state:'limited',overall:'partial',limitations:[],goals:[{goalId:goal,authority:'author_claim',achievement:'partial',assurance:'evidence_assessed',implementation:'supports',testRelation:'unknown',execution:'not_observed'}]},purposeReview:{version:1,flow:'explore_final_v1',locale,headSha:head,baseSha:base,references:[{id:a,path:'src/one/file.ts',side:'head',revision:head,startLine:1,endLine:3},{id:b,path:'tests/two/file.ts',side:'base',revision:base,startLine:5,endLine:9}],clauses:[{clauseId:id('pc','1'),goalId:goal,purpose:'Original author intent',changeSummary:{text:'Short change title',evidenceRefs:[a]},scopeNotes:[{text:'Important bounded scope',evidenceRefs:[b]}],conditions:['Necessary condition'],exceptions:['Necessary exception'],implementation:'supports',changeDescriptions:[{text:'Independent claim A',evidenceRefs:[a]},{text:'Independent claim B',evidenceRefs:[b]}],testDescriptions:[],evidenceRefs:[a],counterEvidenceRefs:[b]}]}}};}
it.each(['en','ko'] as const)('keeps claims open and scope/conditions in details with their exact refs (%s)',locale=>{
 const detail=fixture(locale),html=renderToStaticMarkup(<QuickSummaryPanel detail={detail} quickSummary={toQuickSummary(detail)} demoMode showDetailedEvidence={false} onShowDetail={()=>{}}/>);
 expect(html).toContain('Short change title');expect(html).toContain('Important bounded scope');expect(html).toContain('data-claim="change"');
 const claims=html.split('data-claim="change"');expect(claims[1]).toContain('Independent claim A');expect(claims[1]).toContain(`${head}/src/one/file.ts#L1-L3`);expect(claims[1]).not.toContain('tests/two/file.ts');expect(claims[2]).toContain('Independent claim B');expect(claims[2]).toContain(`${base}/tests/two/file.ts#L5-L9`);
 const withoutDetails=html.split('<details class="report-purpose-details">')[0];for(const text of ['Important bounded scope','Necessary condition','Necessary exception']){expect(withoutDetails).not.toContain(text);expect(html).toContain(text);}
 expect(html).toContain(locale==='ko'?'>적합</span>':'>Fits</span>');expect(html).toContain(locale==='ko'?'CI 통과':'CI passed');expect(html).not.toContain('Conclusion');
 // Removed at the user's request: repeated disclaimers, freshness explainer, receipt sentence, revision dump and footer.
 expect(html).not.toMatch(/개별 테스트 실행 목록|Individual test execution lists|최신 리비전 보장|latest-revision guarantee|이 상태의 의미|What this status means|Evidence only|human review required|전체 리비전|Show full revisions|작성자 의도 상세|Stated intent details|model interpretations, not verified|모델 해석이며 실행이나/);
 expect(html.match(locale==='ko'?/모델 해석/g:/Model interpretation/g)).toHaveLength(1);
});
it('renders the purpose content once in ReportView and never invents saved receipt absence for actual check names',()=>{
 const data=fixture(),report:any=generateVerificationReportV2FromInput(demoScenarios.clean);report.purposeReview=data.report.purposeReview;report.purposeAssessmentSummary=data.report.purposeAssessmentSummary;
 report.evidenceIndex.push({id:'ci_named',kind:'check',label:'Named execution check',summary:'passed',confidence:1});
 const html=renderToStaticMarkup(<ReportView report={report}/>);expect(html.split('Independent claim A')).toHaveLength(2);expect(html).toContain('Named execution check');expect(html).not.toContain('Individual test execution lists are not retained');
});
it('legacy/test-only/location-only/multiple purposes retain exact text without summary fabrication',()=>{
 const data=fixture(),c=data.report.purposeReview.clauses[0];delete c.changeSummary;delete c.scopeNotes;c.changeDescriptions=[];c.testDescriptions=[{text:'Static assertion only',evidenceRefs:[a]}];
 data.report.purposeReview.clauses.push({...c,clauseId:id('pc','2'),purpose:'Second located purpose',implementation:'unknown',testDescriptions:[]});
 const html=renderToStaticMarkup(<ReportTopSummary report={data.report}/>);expect(html).toContain('Original author intent');expect(html).toContain('Static assertion only');expect(html).toContain('Selected change locations');expect(html).not.toContain('Short change title');expect(html).not.toContain('report-purpose-overflow');
});
it('disambiguates same basenames and revisions without replacing any evidence ID or source URL',()=>{
 const data=fixture(),review:any={mode:'objectives',objectives:[],changes:[],source:null,nextInspection:'',repositoryFullName:'owner/repo',purpose:data.report.purposeAssessmentSummary};
 const html=renderToStaticMarkup(<ReportTopSummary report={data.report} review={review}/>);
 expect(html).toContain('<code translate="no">one/file.ts:1-3</code>');expect(html).toContain('<code translate="no">two/file.ts:5-9</code>');
 expect(html).toContain(`data-reference-id="${a}"`);expect(html).toContain(`data-reference-id="${b}"`);
 const extra={...data.report.purposeReview.references[0],id:id('pe','3'),side:'base',revision:base};
 data.report.purposeReview.references.push(extra);data.report.purposeReview.clauses[0].changeDescriptions.push({text:'Separate revision observation',evidenceRefs:[extra.id]});
 const different=renderToStaticMarkup(<ReportTopSummary report={data.report} review={review}/>);expect(different).toContain('before change');expect(different).toContain('/blob/'+extra.revision+'/src/one/file.ts#L1-L3');
});
it.each(['en','ko'] as const)('owner Markdown preserves named execution receipts and uses the same concise language labels (%s)',async locale=>{
 const {reportToMarkdown}=await import('@/lib/markdown');
 const data=fixture(locale),report:any=generateVerificationReportV2FromInput(demoScenarios.clean);
 report.purposeReview=data.report.purposeReview;report.purposeAssessmentSummary=data.report.purposeAssessmentSummary;
 report.evidenceIndex.push({id:'ci_named',kind:'check',label:'Named unit tests',summary:'Status: passed. Named unit tests passed',confidence:1});
 const before=JSON.stringify(report),markdown=reportToMarkdown(report);
 for(const text of ['Short change title','Important bounded scope','Necessary condition','Necessary exception','Independent claim A','Independent claim B','Named unit tests'])expect(markdown).toContain(text);
 expect(markdown).toContain(locale==='ko'?'### 실행 기록':'### Execution records');
 expect(markdown).not.toMatch(/Individual test execution lists|quotations were not retained|Changed material fits|do not verify behavior or test execution/);
 expect(JSON.stringify(report)).toBe(before);
});
