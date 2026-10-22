import type { PurposeReview } from './purpose-contract';
import { reportCopy } from '@/components/report-copy';
import { isPurposeReview, purposeClauseHasInterpretation, purposeClauseReferences, purposeVisibleClauses } from './purpose-summary';

/** Shared display contract. Missing legacy fields stay missing; titles never synthesize claims. */
export function purposeClauseDisplay(clause: PurposeReview['clauses'][number]) {
  const primaryDescriptions=clause.changeDescriptions.length?clause.changeDescriptions:clause.testDescriptions;
  const primaryTests=clause.changeDescriptions.length&&(clause.implementation==='contradicts'||clause.counterEvidenceRefs?.length)?clause.testDescriptions:[];
  const cited=new Set([...primaryDescriptions.flatMap(d=>d.evidenceRefs),...primaryTests.flatMap(d=>d.evidenceRefs),...(clause.counterEvidenceRefs??[])]);
  return {title: clause.changeSummary?.text ?? clause.purpose, changeSummary: clause.changeSummary,
    primaryDescriptions, primaryTests, primaryKind:clause.changeDescriptions.length?'change' as const:'test' as const,
    summaryRefs:(clause.changeSummary?.evidenceRefs??[]).filter(id=>!cited.has(id)),
    detailTests:clause.changeDescriptions.length&&!primaryTests.length?clause.testDescriptions:[],
    scopeNotes: clause.scopeNotes ?? [], changeDescriptions: clause.changeDescriptions,
    testDescriptions: clause.testDescriptions, hasInterpretation: purposeClauseHasInterpretation(clause)};
}

/** All selected purposes stay visible in supplied order; only background and auxiliary tests fold away. */
export function purposeReviewSections(review:PurposeReview) {
  const visible=purposeVisibleClauses(review);
  const primary=visible;
  const details=visible.filter(c=>c.scopeNotes?.length||c.conditions?.length||c.exceptions?.length||purposeClauseDisplay(c).detailTests.length);
  return {primary,details};
}

/** Compact display label only; full path, side, revision and ID still own the source link. */
export function purposeReferenceLabel(reference: PurposeReview['references'][number], all: PurposeReview['references']) {
  const parts = reference.path.split('/'); let count = 1;
  while (count < parts.length && all.some(other => other.path !== reference.path && other.path.split('/').slice(-count).join('/') === parts.slice(-count).join('/'))) count++;
  return parts.slice(-count).join('/') + ':' + reference.startLine + '-' + reference.endLine;
}

export function purposeUnboundReferences(clause: PurposeReview['clauses'][number]) {
  const bound = new Set([...(clause.changeSummary?.evidenceRefs ?? []), ...(clause.scopeNotes ?? []).flatMap(d => d.evidenceRefs),
    ...[...clause.changeDescriptions, ...clause.testDescriptions].flatMap(d => d.evidenceRefs), ...(clause.counterEvidenceRefs ?? [])]);
  return purposeClauseReferences(clause).filter(id => !bound.has(id));
}

/** Tenant-authorized reviewer prose only. Never call this on a portable/public summary. */
export function formatPurposeReview(review: PurposeReview, options: {
  format?: 'text' | 'markdown';
  part?: 'main' | 'details';
  referenceUrl?: (reference: PurposeReview['references'][number]) => string | undefined;
} = {}): string {
  if (!isPurposeReview(review)) return '';
  const markdown = options.format === 'markdown', t = reportCopy(review.locale);
  const escape = (text: string) => markdown ? text.replace(/[\\`*_{}[\]<>#!|]/g, '\\$&') : text;
  const heading = (text: string, level = 3) => markdown ? '#'.repeat(level) + ' ' + escape(text) : text;
  const lines:string[] = [];
  const {primary,details}=purposeReviewSections(review);
  const cite = (ids: string[]) => ids.flatMap(id => {
    const ref = review.references.find(r => r.id === id)!;
    const url = options.referenceUrl?.(ref);
    const sameRangeAtOtherRevision = review.references.some(other => other.id !== ref.id && other.path === ref.path && other.side === ref.side && other.startLine === ref.startLine && other.endLine === ref.endLine && other.revision !== ref.revision);
    const marker = [ref.side === 'base' ? t.beforeChange : '', sameRangeAtOtherRevision ? ref.revision.slice(0, 7) : ''].filter(Boolean).join(' · ');
    const label = (url ? purposeReferenceLabel(ref, review.references) : `${ref.path}:${ref.startLine}-${ref.endLine}`) + (marker ? ` (${marker})` : '');
    return markdown ? [`  - ${url ? `[${escape(label)}](${url.replace(/[()]/g, c => c === '(' ? '%28' : '%29')})` : escape(label)}`]
      : [label, ...(url ? [url] : [])];
  });
  const description = (d: {text: string; evidenceRefs: string[]}) => {
    lines.push((markdown ? '- ' : '') + escape(d.text), ...cite(d.evidenceRefs), '');
  };
  const title=(clause:PurposeReview['clauses'][number])=>{const d=purposeClauseDisplay(clause);lines.push(heading(d.title),'');};
  const main=(clause:PurposeReview['clauses'][number])=>{
    const d=purposeClauseDisplay(clause);title(clause);
    if(d.primaryDescriptions.length){lines.push(heading(d.primaryKind==='change'?t.changes:t.relatedTests,4),'');d.primaryDescriptions.forEach(description);}
    if(d.primaryTests.length){lines.push(heading(t.relatedTests,4),'');d.primaryTests.forEach(description);}
    if(d.summaryRefs.length)lines.push(...cite(d.summaryRefs),'');
    const unbound=purposeUnboundReferences(clause);if(unbound.length)lines.push(heading(t.selectedLocations,4),'',...cite(unbound),'');
    if(clause.counterEvidenceRefs?.length)lines.push(heading(t.counterEvidence,4),'',...cite(clause.counterEvidenceRefs),'');
    lines.push(d.hasInterpretation?t.fit[clause.implementation]:t.locatedOnly,'');
  };
  if(options.part!=='details'){lines.push(heading(t.changeSummary+' · '+t.fitLabel,2),'');primary.forEach(main);}
  if(options.part!=='main'&&details.length){
    lines.push(heading(t.details,2),'');
    for(const clause of details){
      const d=purposeClauseDisplay(clause);
      if(!primary.includes(clause))main(clause);else if(review.clauses.length>1)lines.push(heading(d.title),'');
      if(d.scopeNotes.length){lines.push(heading(t.scopeLabel,4),'');d.scopeNotes.forEach(description);}
      for(const [label,values]of [[t.conditions,clause.conditions],[t.exceptions,clause.exceptions]] as const)if(values?.length)lines.push(heading(label,4),'',...values.map(v=>(markdown?'- ':'')+escape(v)),'');
      if(d.detailTests.length){lines.push(heading(t.relatedTests,4),'');d.detailTests.forEach(description);}
    }
  }
  return lines.join('\n').trimEnd();
}
