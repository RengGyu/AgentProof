import { ReportTopSummary } from "./ReportTopSummary";
import { reportCopy } from "./report-copy";
import type { PrEvidenceReview as PrEvidenceReviewModel, PrEvidenceReviewItem, PrEvidenceRelation } from "@/lib/pr-evidence-review";
import { ReportCodeViewer } from "./ReportCodeViewer";
import { PurposeCodeEvidence, type CodeSelection } from "./PurposeCodeEvidence";
import type { WorkspaceClient } from "@/lib/workspace-client";

type CodeContext = { reportId: string; runtime?: WorkspaceClient };

/** leadInSummary: a ReportTopSummary above already shows every purpose, so its sentences are not repeated; the cited code reader takes their place.
 *  externalCodePane: the dashboard renders that reader in its own code pane, so it is not mounted here a second time. */
export function PrEvidenceReview({ review, compact = false, codeContext, leadInSummary = false, codeSelection, externalCodePane = false }: { review: PrEvidenceReviewModel; compact?: boolean; codeContext?: CodeContext; leadInSummary?: boolean; codeSelection?: CodeSelection; externalCodePane?: boolean }) {
  const objectives = review.mode === "objectives" ? review.objectives : [];
  // Files already listed under an objective are not repeated as "other" changes.
  const shown = new Set(objectives.flatMap(objective => [objective.firstInspection, ...objective.code, ...objective.tests, ...(objective.moreContext ?? [])]).filter(Boolean).map(item => `${item!.label}:${item!.line ?? 0}`));
  const otherChanges = review.mode === "objectives" ? review.changes.filter(item => !shown.has(`${item.label}:${item.line ?? 0}`)) : review.changes;
  return <section className={`pr-evidence-review${compact ? " compact" : ""}`} aria-label="PR-to-Evidence Review">
    <div className="pr-evidence-review-heading">
      <h2 className="pr-evidence-accessible-heading">PR-to-Evidence Review</h2>
    </div>
    {leadInSummary && review.purposeReview && !externalCodePane ? <PurposeCodeEvidence review={review} reportId={codeContext?.reportId} runtime={codeContext?.runtime} selection={codeSelection} /> : null}
    {review.purpose?.flow === "explore_final_v1" ? <PurposeFacts review={review} leadInSummary={leadInSummary} /> : review.purpose ? <details className="pr-evidence-context"><summary>Stated purpose: {review.purpose.overall.replaceAll("_", " ")} ({review.purpose.state})</summary><p>Assessment at this snapshot; implementation, static test relation and execution are separate evidence levels. Semantic interpretation is model-assessed, not verified execution.</p>{review.purpose.goals.map((goal,index)=><section key={goal.goalId}><h4>Purpose {index + 1}: {goal.achievement.replaceAll("_", " ")}</h4><p>Source: {goal.authority === "author_claim" ? "author claim" : "selected requirement source"}. Assurance: {goal.assurance.replaceAll("_", " ")}.</p><p>Implementation: {goal.implementation}; test relation: {goal.testRelation.replaceAll("_", " ")}; execution: {goal.execution.replaceAll("_", " ")}.</p></section>)}{review.purpose.limitations.length ? <p>Evidence limits: {review.purpose.limitations.map(reason=>reason.replaceAll("_", " ")).join("; ")}</p> : null}</details> : null}
    {review.purposeReview ? (otherChanges.length?<details className="pr-evidence-context"><summary>{reportCopy(review.purposeReview.locale).collectedChanges} ({otherChanges.length})</summary><EvidenceGroups items={otherChanges} codeContext={codeContext} /></details>:null) : review.mode === "change_summary" ? <>
      <h3>Collected changes</h3>
      <EvidenceGroups items={review.changes} codeContext={codeContext} />
      <NextInspection text={review.nextInspection} />
    </> : <>{objectives.map((objective, index) => <details className="pr-evidence-objective" key={objective.id} open={index === 0}>
      <summary><span className="pr-objective-label">Objective {index + 1}</span><span className="pr-objective-title">{objective.text}</span></summary>
      {objective.firstInspection ? <EvidenceGroup title="Inspect first" items={[objective.firstInspection]} codeContext={codeContext} /> : null}
      <div className="pr-evidence-groups">
        {(objective.moreContext ? objective.code.slice(0,1) : objective.code).length ? <EvidenceGroup title={objective.moreContext ? "Inspect first" : "Code"} items={objective.moreContext ? objective.code.slice(0,1) : objective.code} codeContext={codeContext} /> : null}
        {objective.moreContext?.length ? <EvidenceGroup title="More context (possible links)" items={objective.moreContext} codeContext={codeContext} /> : null}
        {objective.tests.length ? <EvidenceGroup title="Tests" items={objective.tests} codeContext={codeContext} /> : null}
        {objective.execution.length ? <EvidenceGroup title="Execution" items={objective.execution} /> : null}
      </div>
      <NextInspection text={objective.nextInspection} first={objective.firstInspection ?? objective.code[0] ?? objective.tests[0] ?? objective.execution[0]} />
    </details>)}{otherChanges.length ? <details className="pr-evidence-context"><summary>Other collected changes ({otherChanges.length})</summary><EvidenceGroups items={otherChanges} codeContext={codeContext} /></details> : null}</>}
    {review.retrievalNote || review.sourceLinks?.length ? <details className="pr-evidence-context"><summary>{reportCopy(review.purposeReview?.locale).sourcesAndScope}</summary>{review.retrievalNote ? <p>{review.retrievalNote}</p> : null}{review.sourceLinks?.map(link=><p key={link.url}><a href={link.url} target="_blank" rel="noreferrer">Open {link.label}</a></p>)}</details> : null}
  </section>;
}

function EvidenceGroups({ items, codeContext }: { items: PrEvidenceReviewItem[]; codeContext?: CodeContext }) {
  return <div className="pr-evidence-groups">
    <EvidenceGroup title="Code" items={items.filter((item) => item.kind === "code")} codeContext={codeContext} />
    <EvidenceGroup title="Tests" items={items.filter((item) => item.kind === "test")} codeContext={codeContext} />
    <EvidenceGroup title="Execution" items={items.filter((item) => item.kind === "execution")} />
  </div>;
}

function EvidenceGroup({ title, items, codeContext }: { title: string; items: PrEvidenceReviewItem[]; codeContext?: CodeContext }) {
  return <section className={`pr-evidence-group${title === "Inspect first" ? " inspect-first" : ""}`}>
    <h4>{title}</h4>
    {items.length ? <ul>{items.map((item) => <li key={item.evidenceId}>
      <div><code>{item.label}</code>{item.line ? <span className="pr-evidence-line">Line {item.line}</span> : null}{item.relation !== "collected" ? <span className={`pr-evidence-relation relation-${item.relation}`}>{relationLabel(item.relation)}</span> : null}</div>
      {item.whyInspect ? <><span className="pr-evidence-why-label">Why this code</span><p>{item.whyInspect}</p></> : null}
      {item.uncertainty ? <p>{item.uncertainty}</p> : null}
      {item.candidateBasis ? <p>{item.candidateBasis}</p> : null}
      {item.executionMeaning ? <p>{item.executionMeaning}</p> : null}
      {item.url && item.kind !== "execution" && codeContext ? <ReportCodeViewer key={`${codeContext.reportId}:${item.evidenceId}:${item.line ?? 0}`} item={item} {...codeContext} /> : item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.kind === "execution" ? "Open check run" : item.line ? (item.relation === "candidate" || item.whyInspect ? "Open referenced lines" : "Open first changed line") : "Open at analyzed commit"}</a> : null}
      {item.reviewQuestion ? <details className="muted small"><summary>Reviewer question</summary><p>{item.reviewQuestion}</p></details> : null}
    </li>)}</ul> : <p className="muted small">No linked evidence (not proof of absence).</p>}
  </section>;
}

function NextInspection({ text, first }: { text: string; first?: PrEvidenceReviewItem }) {
  if (first && (text === `Inspect ${first.label}.` || text === `Inspect ${first.label}. ${first.whyInspect}`)) return null;
  return <p className="pr-evidence-next"><strong>Next to inspect:</strong> {text}</p>;
}

function relationLabel(relation: PrEvidenceRelation): string {
  if (relation === "verified") return "Verified relation";
  if (relation === "observed") return "Observed evidence";
  if (relation === "candidate") return "Candidate link";
  return "Collected change";
}

export function PurposeFacts({ review, leadInSummary = false }: { review: PrEvidenceReviewModel; leadInSummary?: boolean }) {
  const assessment = review.purposeFacts, facts = assessment?.facts;
  if (review.purposeReview) {
    if (leadInSummary) return null;
    return <ReportTopSummary report={{purposeReview:review.purposeReview}} review={review}/>;
  }
  if (!facts) return <section aria-label="Purpose evidence">
    <h3>Purpose evidence</h3>
    <p>Only the saved summary is available. Detailed observations and source quotations were not retained.</p>
  </section>;
  const refs = (ids: string[]) => <span>{ids.map(id => {
    const e = assessment.evidenceIndex.find(e => e.id === id);
    return <code key={id}> {e ? `${e.path}:${e.startLine}-${e.endLine} (${e.side}, ${e.revision})` : id}</code>;
  })}</span>;
  const observations = (items: typeof facts.clauses[number]['changeObservations']) => items.map((o, i) =>
    <p key={i}><strong>{o.basis === 'source_text' ? 'Source quotation' : 'Model interpretation'}: </strong>{o.text}{refs(o.evidenceRefs)}</p>);
  return <section aria-label="Purpose evidence">
    <h3>Purpose evidence</h3>
    <p>Judgments cover only the cited changed source. Source quotations and model interpretations are distinct; reading source does not verify behavior or test execution.</p>
    {facts.clauses.map(c => {
      const goal = assessment.goals.find(g => g.clauseResults.some(r => r.clauseId === c.clauseId));
      const result = goal?.clauseResults.find(r => r.clauseId === c.clauseId);
      return <section key={c.clauseId}>
        <h4>{c.purpose}</h4>
        <p>Purpose source: {goal?.authority === 'author_claim' ? 'author claim' : 'selected requirement source'}.</p>
        <p>{result?.implementation === 'supports' ? 'Changed material fits this purpose item.' : result?.implementation === 'contradicts' ? 'Changed material conflicts with this purpose item.' : 'Not confirmed from the selected changed source.'}</p>
        <h5>Changes</h5>
        {c.changeObservations.length ? observations(c.changeObservations) : <p>No change interpretation supplied.</p>}
        {c.testObservations.length ? <><h5>Test meaning</h5>{observations(c.testObservations)}</> : null}
        {result?.reasonCodes.includes('source_owned_execution_result') && result.criterionEvidenceRefs.length && (result.execution === 'checked_pass' || result.execution === 'checked_fail') ? <>
          <h5>Execution</h5><p>{result.execution.replaceAll('_', ' ')}.{refs(result.criterionEvidenceRefs)}</p>
        </> : null}
      </section>;
    })}
  </section>;
}
