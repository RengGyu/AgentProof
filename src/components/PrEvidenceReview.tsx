import type { PrEvidenceReview as PrEvidenceReviewModel, PrEvidenceReviewItem, PrEvidenceRelation } from "@/lib/pr-evidence-review";

export function PrEvidenceReview({ review, compact = false }: { review: PrEvidenceReviewModel; compact?: boolean }) {
  const objectives = review.mode === "objectives" ? review.objectives : [];
  return <section className={`pr-evidence-review${compact ? " compact" : ""}`} aria-label="PR-to-Evidence Review">
    <div className="pr-evidence-review-heading">
      <h2 className="pr-evidence-accessible-heading">PR-to-Evidence Review</h2>
      {review.source ? <span className="pr-evidence-source">Source: {review.source.label}</span> : null}
    </div>
    {review.mode === "change_summary" ? <>
      <h3>Collected changes</h3>
      <EvidenceGroups items={review.changes} />
      <NextInspection text={review.nextInspection} />
    </> : <>{objectives.map((objective) => <article className="pr-evidence-objective" key={objective.id}>
      <p className="pr-objective-label">PR objective</p>
      <h3>{objective.text}</h3>
      {objective.firstInspection ? <EvidenceGroup title="Inspect first" items={[objective.firstInspection]} /> : null}
      {objective.goalContext?.length || objective.sourceRefs?.length || objective.facets?.length ? <details className="pr-evidence-context"><summary>Goal details</summary>
        {objective.goalContext?.map((text,index)=><p key={index}>{text}</p>)}
      {objective.sourceRefs ? <p className="muted small">Source offsets: {objective.sourceRefs.map(ref=>`${ref.sourceId ? ref.sourceId+" " : ""}${ref.start}–${ref.end}`).join(", ")} (redacted source)</p> : null}
      {objective.facets?.length ? <ul>{objective.facets.map((facet,index)=><li key={index}>{facet.kind.replace("_"," ")} · source {facet.sourceRef.start}–{facet.sourceRef.end}</li>)}</ul> : null}
      </details> : null}
      <div className="pr-evidence-groups">
        {(objective.moreContext ? objective.code.slice(0,1) : objective.code).length ? <EvidenceGroup title={objective.moreContext ? "Inspect first" : "Code"} items={objective.moreContext ? objective.code.slice(0,1) : objective.code} /> : null}
        {objective.moreContext?.length ? <EvidenceGroup title="More context (possible links)" items={objective.moreContext} /> : null}
        {objective.tests.length ? <EvidenceGroup title="Tests" items={objective.tests} /> : null}
        {objective.execution.length ? <EvidenceGroup title="Execution" items={objective.execution} /> : null}
      </div>
      <NextInspection text={objective.nextInspection} first={objective.firstInspection ?? objective.code[0] ?? objective.tests[0] ?? objective.execution[0]} />
    </article>)}{review.changes.length ? <details className="pr-evidence-context"><summary>Other collected changes</summary><EvidenceGroups items={review.changes} /></details> : null}</>}
    {review.retrievalNote || review.sourceLinks?.length ? <details className="pr-evidence-context"><summary>Sources &amp; search scope</summary>{review.retrievalNote ? <p>{review.retrievalNote}</p> : null}{review.sourceLinks?.map(link=><p key={link.url}><a href={link.url} target="_blank" rel="noreferrer">Open {link.label}</a></p>)}</details> : null}
  </section>;
}

function EvidenceGroups({ items }: { items: PrEvidenceReviewItem[] }) {
  return <div className="pr-evidence-groups">
    <EvidenceGroup title="Code" items={items.filter((item) => item.kind === "code")} />
    <EvidenceGroup title="Tests" items={items.filter((item) => item.kind === "test")} />
    <EvidenceGroup title="Execution" items={items.filter((item) => item.kind === "execution")} />
  </div>;
}

function EvidenceGroup({ title, items }: { title: string; items: PrEvidenceReviewItem[] }) {
  return <section className={`pr-evidence-group${title === "Inspect first" ? " inspect-first" : ""}`}>
    <h4>{title}</h4>
    {items.length ? <ul>{items.map((item) => <li key={item.evidenceId}>
      <div><code>{item.label}</code>{item.line ? <span className="pr-evidence-line">Line {item.line}</span> : null}<span className={`pr-evidence-relation relation-${item.relation}`}>{relationLabel(item.relation)}</span></div>
      {item.whyInspect ? <><span className="pr-evidence-why-label">Why this code</span><p>{item.whyInspect}</p></> : null}
      {item.uncertainty ? <p>{item.uncertainty}</p> : null}
      {item.candidateBasis ? <p>{item.candidateBasis}</p> : null}
      {item.executionMeaning ? <p>{item.executionMeaning}</p> : null}
      {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.kind === "execution" ? "Open check run" : item.line ? (item.relation === "candidate" || item.whyInspect ? "Open referenced lines" : "Open first changed line") : "Open at analyzed commit"}</a> : null}
      {item.reviewQuestion ? <details className="muted small"><summary>Reviewer question</summary><p>{item.reviewQuestion}</p></details> : null}
    </li>)}</ul> : <p className="muted small">Unconnected — no linked evidence. Not found does not mean not implemented.</p>}
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
