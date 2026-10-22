// Stored summary validation is shared by server and browser readers.
import type { PurposeAssessmentSummary, PurposeReview } from './purpose-contract';
import { enumeration, object, array, contract } from './purpose-schema';
const implementation = enumeration('supports', 'contradicts', 'unknown'), testRelation = enumeration('relevant', 'inadequate', 'unknown', 'not_required');
const achievement = enumeration('fulfilled', 'partial', 'unclear', 'not_fulfilled'), assurance = enumeration('deterministic_checked', 'evidence_assessed', 'insufficient'), authority = enumeration('authoritative', 'author_claim'), execution = enumeration('checked_pass', 'checked_fail', 'reported_pass', 'reported_fail', 'not_observed', 'not_required');
export const PURPOSE_DIFF_LIMITATIONS={hunkPartial:'patch_hunk_partial',baseUnconfirmed:'diff_base_unconfirmed'} as const;
const limitation = enumeration(...Object.values(PURPOSE_DIFF_LIMITATIONS), 'purpose_interpretation_unavailable', 'localization_finish_implicit', 'localization_selection_partial', 'localization_partial', 'localization_invalid', 'localization_read_budget', 'localization_source_budget', 'localization_packet_budget', 'locator_inventory_budget', 'case_execution_not_verified', 'normalized_manifest_unavailable', 'patch_unavailable', 'patch_index_budget', 'raw_patch_index_unavailable', 'source_unprocessed', 'source_ambiguous', 'search_supplied_no_hit', 'reassessment_budget', 'additional_evidence_uncollected', 'initial_batch_budget', 'checker_budget', 'checker_dispute', 'read_rejected', 'source_unavailable', 'read_budget', 'source_binding_unavailable', 'source_budget', 'interval_unavailable', 'artifact_budget', 'source_read_failed', 'limitation_overflow');
const summarySchema = object({ version: { const: 1 }, scope: { const: 'stated_purpose_at_snapshot' }, state: enumeration('complete', 'limited', 'unavailable'), overall: achievement, goals: array(object({ goalId: { type: 'string', pattern: '^pg_[a-f0-9]{24}$' }, authority, achievement, assurance, implementation, testRelation, execution }), 16), limitations: array(limitation, 32) });
const summaryShape = contract<PurposeAssessmentSummary>({...summarySchema, properties: {...summarySchema.properties, flow: enumeration('explore_final_v1')}});
export function isPurposeSummary(value:unknown):value is PurposeAssessmentSummary {
 if(!summaryShape(value)||new Set(value.goals.map(g=>g.goalId)).size!==value.goals.length)return false;
 const states=value.goals.map(g=>g.achievement);
 const overall=states.includes('not_fulfilled')?'not_fulfilled':states.length&&states.every(s=>s==='fulfilled')?'fulfilled':states.some(s=>s==='partial'||s==='fulfilled')?'partial':'unclear';
 return value.overall===overall&&value.goals.every(g=>g.achievement!=='fulfilled'||g.assurance==='deterministic_checked');
}

// Tenant-only reviewer projection; source quotations and private rationale are not fields.
export function safePurposeReviewText(text: unknown): text is string {
 // Model prose has only text hygiene here; the DTO contract checks secrets.
 return typeof text === 'string' && text.length > 0 && text.length <= 600 && text.trim() === text && !/[\u0000-\u001f\u007f]/.test(text);
}
const id = (prefix: string) => ({type:'string',pattern:'^'+prefix+'_[a-f0-9]{24}$'}), sha = {type:'string',pattern:'^[a-f0-9]{40}$'};
const prose = {type:'string',minLength:1,maxLength:600};
const description = object({text:prose,evidenceRefs:array(id('pe'),16)});
// New fields are optional: old HMAC payloads are accepted without rewriting them.
const clauseShape=object({changeSummary:description,scopeNotes:array(description,8),clauseId:id('pc'),goalId:id('pg'),purpose:prose,implementation,changeDescriptions:array(description,8),testDescriptions:array(description,8),conditions:array(prose,32),exceptions:array(prose,32),evidenceRefs:array(id('pe'),16),counterEvidenceRefs:array(id('pe'),16)});
const reviewSchema = object({version:{const:1},flow:{const:'explore_final_v1'},locale:enumeration('en','ko'),headSha:sha,baseSha:sha,clauses:array({...clauseShape,required:['clauseId','goalId','purpose','implementation','changeDescriptions','testDescriptions']},32),references:array(object({id:id('pe'),path:{type:'string',minLength:1,maxLength:600},side:enumeration('head','base'),revision:sha,startLine:{type:'integer',minimum:1,maximum:1000000},endLine:{type:'integer',minimum:1,maximum:1000000}}),16)});
const reviewShape = contract<PurposeReview>({...reviewSchema,required:['version','flow','headSha','baseSha','clauses','references']});
export function purposeClauseReferences(c:PurposeReview['clauses'][number]):string[] {return [...new Set([...(c.evidenceRefs??[]),...(c.counterEvidenceRefs??[]),...[...(c.changeSummary?[c.changeSummary]:[]),...(c.scopeNotes??[]),...c.changeDescriptions,...c.testDescriptions].flatMap(d=>d.evidenceRefs)])];}
export function purposeVisibleClauses(review:PurposeReview):PurposeReview['clauses'] {return review.clauses.filter(c=>purposeClauseReferences(c).length>0);}
export function purposeClauseHasInterpretation(c:PurposeReview['clauses'][number]):boolean {return !!(c.changeDescriptions.length||c.testDescriptions.length);}
export function purposeClauseFitText(c:PurposeReview['clauses'][number]):string {return !purposeClauseHasInterpretation(c)?'Selected source locations; purpose fit was not interpreted.':c.implementation==='supports'?'Changed material fits this purpose item.':c.implementation==='contradicts'?'Changed material conflicts with this purpose item.':'Not confirmed from the selected changed source.';}
export function safePurposeReviewPath(path:string):boolean {return path.length>0&&path.length<=600&&!path.startsWith('/')&&!/[\\\u0000-\u001f\u007f]/.test(path)&&!path.split('/').some(p=>!p||p==='.'||p==='..');}
/** Closed discriminator; no text, paths or validator error body leaves this boundary. */
export function purposeReviewFailure(value:unknown):'purpose_projection_shape'|'purpose_no_citable_material'|'purpose_projection_text'|'purpose_projection_refs'|'purpose_projection_source'|null {
 if(!reviewShape(value)||!value.clauses.length||new Set(value.clauses.map(c=>c.clauseId)).size!==value.clauses.length||new Set(value.references.map(e=>e.id)).size!==value.references.length)return 'purpose_projection_shape';
 const ids=new Set(value.references.map(e=>e.id));
 if(!value.clauses.some(c=>purposeClauseReferences(c).length))return 'purpose_no_citable_material';
 for(const c of value.clauses){
  if(!safePurposeReviewText(c.purpose)||[...(c.conditions??[]),...(c.exceptions??[]),...[...(c.changeSummary?[c.changeSummary]:[]),...(c.scopeNotes??[]),...c.changeDescriptions,...c.testDescriptions].map(d=>d.text)].some(t=>!safePurposeReviewText(t)))return 'purpose_projection_text';
  if((c.evidenceRefs!==undefined||c.counterEvidenceRefs!==undefined||c.changeSummary!==undefined||c.scopeNotes!==undefined)&&!purposeClauseHasInterpretation(c)&&c.implementation!=='unknown')return 'purpose_projection_shape';
  if([c.evidenceRefs??[],c.counterEvidenceRefs??[]].some(refs=>new Set(refs).size!==refs.length)||purposeClauseReferences(c).some(id=>!ids.has(id))||[...(c.changeSummary?[c.changeSummary]:[]),...(c.scopeNotes??[]),...c.changeDescriptions,...c.testDescriptions].some(d=>!d.evidenceRefs.length||new Set(d.evidenceRefs).size!==d.evidenceRefs.length))return 'purpose_projection_refs';
 }
 if(value.references.some(e=>e.endLine<e.startLine||e.revision!==(e.side==='head'?value.headSha:value.baseSha)||!safePurposeReviewPath(e.path)))return 'purpose_projection_source';
 return null;
}
export function isPurposeReview(value:unknown):value is PurposeReview {return purposeReviewFailure(value)===null;}

export function isPurposeReviewForSummary(value:unknown,summary:unknown):value is PurposeReview {
 if(!isPurposeReview(value)||!isPurposeSummary(summary)||summary.flow!=='explore_final_v1')return false;
 return value.clauses.every(c=>summary.goals.some(g=>g.goalId===c.goalId));
}
