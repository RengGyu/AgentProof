import {describe,it,expect} from 'vitest';
import type {PurposeReview} from './purpose-contract';
import {formatPurposeReview,purposeClauseDisplay} from './shared-report-copy';
import {isPurposeReview,purposeClauseReferences} from './purpose-summary';
const id=(p:string,n:string)=>p+'_'+n.repeat(24),head='a'.repeat(40),base='b'.repeat(40);
const ref1=id('pe','1'),ref2=id('pe','2');
function fixture():PurposeReview{return {version:1,flow:'explore_final_v1',locale:'en',headSha:head,baseSha:base,clauses:[{clauseId:id('pc','1'),goalId:id('pg','1'),purpose:'Preserve pending work unless cancelled',implementation:'supports',conditions:['Unless cancelled'],exceptions:[],changeSummary:{text:'Retain pending work',evidenceRefs:[ref1]},scopeNotes:[{text:'Covers the cited queue change only.',evidenceRefs:[ref2]}],changeDescriptions:[{text:'The changed path retains pending work.',evidenceRefs:[ref1]},{text:'The earlier path discarded pending work.',evidenceRefs:[ref2]}],testDescriptions:[],evidenceRefs:[ref1],counterEvidenceRefs:[ref2]}],references:[{id:ref1,path:'src/큐.ts',side:'head',revision:head,startLine:4,endLine:8},{id:ref2,path:'src/큐.ts',side:'base',revision:base,startLine:4,endLine:6}]};}
describe('shared reviewer hierarchy output',()=>{
 it.each(['en','ko'] as const)('preserves independent claims and their own exact references in %s',locale=>{
  const review=fixture();review.locale=locale;
  expect(isPurposeReview(review)).toBe(true);
  const text=formatPurposeReview(review),md=formatPurposeReview(review,{format:'markdown',referenceUrl:r=>`https://github.com/acme/work/blob/${r.revision}/src/file.ts#L${r.startLine}-L${r.endLine}`});
  expect(text).toContain('Retain pending work');expect(text).toContain('Unless cancelled');expect(text).toContain('Covers the cited queue change only.');
  expect(md).toContain('- The changed path retains pending work.\n  - [큐.ts:4-8](');
  expect(md).toContain('The earlier path discarded pending work.\n  - [큐.ts:4-6 (');expect(md).toContain(base);expect(md).toContain(head);
  expect(md).not.toMatch(/#### (Test meaning|테스트 의미)/);expect(purposeClauseReferences(review.clauses[0])).toEqual([ref1,ref2]);
 });
 it('keeps legacy fallback, test-only, location-only and multiple purposes distinct',()=>{
  const review=fixture(),original=structuredClone(review.clauses[0]);
  delete review.clauses[0].changeSummary;delete review.clauses[0].scopeNotes;
  expect(purposeClauseDisplay(review.clauses[0]).title).toBe(original.purpose);expect(formatPurposeReview(review)).not.toContain('Retain pending work');
  review.clauses[0].changeDescriptions=[];review.clauses[0].testDescriptions=[{text:'The static assertion checks retention.',evidenceRefs:[ref1]}];
  review.clauses.push({...original,changeSummary:undefined,clauseId:id('pc','2'),goalId:id('pg','2'),purpose:'Second independent purpose',implementation:'unknown',changeDescriptions:[],testDescriptions:[]});
  const text=formatPurposeReview(review);expect(text).toContain('The static assertion checks retention.');expect(text).toContain('Second independent purpose');expect(text.match(/\nFits\n/g)).toHaveLength(1);expect(text).toContain('Selected change locations');expect(text).toContain('Counterevidence');
  expect(purposeClauseDisplay(review.clauses[1]).hasInterpretation).toBe(false);
 });
 it('does not render empty, invalid or secret-bearing projections or interpret summary-only as support',()=>{
  expect(formatPurposeReview({...fixture(),clauses:[]})).toBe('');
  const review=fixture();review.clauses[0].changeSummary!.text='api_key=fixture_secret_value';expect(formatPurposeReview(review)).toBe('');
  const summaryOnly=fixture();summaryOnly.clauses[0].changeDescriptions=[];delete summaryOnly.clauses[0].evidenceRefs;delete summaryOnly.clauses[0].counterEvidenceRefs;expect(isPurposeReview(summaryOnly)).toBe(false);
  const unsafe=fixture();unsafe.clauses[0].scopeNotes![0].evidenceRefs=['unknown'];expect(isPurposeReview(unsafe)).toBe(false);
 });
 it('escapes prose Markdown without deleting original text in plain copy or changing stored fields',()=>{
  const review=fixture();review.clauses[0].changeDescriptions[0].text='Keep *literal* [text](example) and <tag>.';const before=JSON.stringify(review);
  expect(formatPurposeReview(review)).toContain('Keep *literal* [text](example) and <tag>.');
  expect(formatPurposeReview(review,{format:'markdown'})).toContain('Keep \\*literal\\* \\[text\\](example) and \\<tag\\>.');expect(JSON.stringify(review)).toBe(before);
 });
});

it.each(['en','ko'] as const)('exports the same concise hierarchy as the UI in %s, leaving prose, important qualifiers and storage intact',locale=>{
 const review=fixture();review.locale=locale;
 const before=JSON.stringify(review);
 const url=(r:PurposeReview['references'][number])=>`https://github.com/acme/work/blob/${r.revision}/${r.path}#L${r.startLine}-L${r.endLine}`;
 const text=formatPurposeReview(review,{referenceUrl:url}),md=formatPurposeReview(review,{format:'markdown',referenceUrl:url});
 for(const body of [text,md]){
  expect(body).not.toMatch(/Changed material fits|do not verify behavior|quotations were not retained|Stated intent:|작성자 의도:|소스 읽기와|소스 인용문은 보관/);
  expect(body.match(locale==='ko'?/모델 해석/g:/Model interpretation/g)).toHaveLength(1);
  for(const value of ['Retain pending work','Unless cancelled','Covers the cited queue change only.','The changed path retains pending work.','The earlier path discarded pending work.'])expect(body).toContain(value);
  expect(body).toContain(locale==='ko'?'반대 근거':'Counterevidence');
  expect(body).not.toContain(`(head, ${head})`);
  expect(body).not.toContain(locale==='ko'?'참조한 소스':'Referenced source');
  expect(body).toContain(`/blob/${head}/`);expect(body).toContain(`/blob/${base}/`);
 }
 expect(text).toContain('큐.ts:4-8');expect(md).toContain('[큐.ts:4-8](');
 expect(JSON.stringify(review)).toBe(before);
});
it('retains unbound locations without repeating all refs, and distinguishes same basenames and before/after links',()=>{
 const review=fixture(),third=id('pe','3');
 review.references.push({id:third,path:'other/큐.ts',side:'head',revision:head,startLine:20,endLine:24});review.clauses[0].evidenceRefs!.push(third);
 const md=formatPurposeReview(review,{format:'markdown',referenceUrl:r=>`https://github.com/acme/work/blob/${r.revision}/${r.path}#L${r.startLine}-L${r.endLine}`});
 expect(md).toContain('Selected locations');expect(md.match(/other\/큐.ts:20-24/g)).toHaveLength(1);expect(md).toContain('src/큐.ts:4-8');
 expect(md).toContain('before change');
});
it.each(['text','markdown'] as const)('puts the primary behavior before supporting details in %s without rewriting or dropping fields',format=>{
 const review=fixture(),secondary=structuredClone(review.clauses[0]);secondary.clauseId=id('pc','9');secondary.purpose='Retain the accompanying notice';secondary.counterEvidenceRefs=[];secondary.changeSummary={text:'Keep redistribution notice',evidenceRefs:[ref2]};secondary.changeDescriptions=[{text:'The accompanying notice is retained.',evidenceRefs:[ref2]}];review.clauses.push(secondary);
 const before=JSON.stringify(review),text=formatPurposeReview(review,{format});
 expect(text.indexOf('The changed path retains pending work.')).toBeLessThan(text.indexOf('Covers the cited queue change only.'));
 expect(text.indexOf('The changed path retains pending work.')).toBeLessThan(text.indexOf('Unless cancelled'));
 expect(text.indexOf('Keep redistribution notice')).toBeLessThan(text.indexOf('Details'));
 expect(JSON.stringify(review)).toBe(before);
 // Ordering follows the supplied purposes, not a blacklist of licensing words.
 review.clauses.reverse();const license=formatPurposeReview(review,{format});expect(license.indexOf('Keep redistribution notice')).toBeLessThan(license.indexOf('Details'));
});

it('keeps every selected purpose in main and puts each verdict after its own claims',()=>{
 const review=fixture(),other=structuredClone(review.clauses[0]);other.clauseId=id('pc','8');other.counterEvidenceRefs=[];other.changeSummary={text:'Second behavior',evidenceRefs:[ref1]};other.changeDescriptions=[{text:'Second independently requested behavior.',evidenceRefs:[ref1]}];review.clauses.push(other);
 const text=formatPurposeReview(review,{part:'main'});expect(text).toContain('Second independently requested behavior.');expect(text.indexOf('The changed path retains pending work.')).toBeLessThan(text.indexOf('Fits'));expect(text).not.toContain('Retain pending work · Fits');
});
it('shows contradictory static assertions in main without duplicating them in details',()=>{
 const review=fixture();review.clauses[0].implementation='contradicts';review.clauses[0].testDescriptions=[{text:'The assertion expects the conflicting behavior.',evidenceRefs:[ref2]}];
 expect(formatPurposeReview(review,{part:'main'})).toContain('The assertion expects the conflicting behavior.');expect(formatPurposeReview(review,{part:'details'})).not.toContain('The assertion expects the conflicting behavior.');
});
