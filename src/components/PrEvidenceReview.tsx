import type { PrEvidenceReview as PrEvidenceReviewModel, PrEvidenceReviewItem, PrEvidenceRelation } from "@/lib/pr-evidence-review";

export function PrEvidenceReview({ review, compact = false }: { review: PrEvidenceReviewModel; compact?: boolean }) {
  const objectives = review.mode === "objectives" ? review.objectives : [];
  return <section className={`pr-evidence-review${compact ? " compact" : ""}`} aria-label="PR-to-Evidence Review">
    <div className="pr-evidence-review-heading">
      <div>
        <p className="eyebrow">Human review</p>
        <h2>PR-to-Evidence Review</h2>
      </div>
      {review.source ? <span className="pr-evidence-source">Source: {review.source.label}</span> : null}
    </div>
    {review.sourceLinks?.map(link=><p key={link.url}><a href={link.url} target="_blank" rel="noreferrer">Open {link.label}</a></p>)}
    {review.retrievalNote ? <p className="muted small">{review.retrievalNote}</p> : null}
    {review.mode === "change_summary" ? <>
      <h3>Collected changes</h3>
      <EvidenceGroups items={review.changes} />
      <NextInspection text={review.nextInspection} />
    </> : <>{objectives.map((objective) => <article className="pr-evidence-objective" key={objective.id}>
      <h3>{objective.text}</h3>
      {objective.goalContext?.map((text,index)=><p key={index}>{text}</p>)}
      {objective.firstInspection ? <EvidenceGroup title="Inspect first" items={[objective.firstInspection]} /> : null}
      {objective.sourceRefs ? <p className="muted small">Source offsets: {objective.sourceRefs.map(ref=>`${ref.sourceId ? ref.sourceId+" " : ""}${ref.start}–${ref.end}`).join(", ")} (redacted source)</p> : null}
      {objective.facets?.length ? <ul>{objective.facets.map((facet,index)=><li key={index}>{facet.kind.replace("_"," ")} · source {facet.sourceRef.start}–{facet.sourceRef.end}</li>)}</ul> : null}
      <div className="pr-evidence-groups">
        <EvidenceGroup title={objective.moreContext ? "Inspect first" : "Code"} items={objective.moreContext ? objective.code.slice(0,1) : objective.code} />
        {objective.moreContext ? <EvidenceGroup title="More context (possible links)" items={objective.moreContext} /> : null}
        <EvidenceGroup title="Tests" items={objective.tests} />
        <EvidenceGroup title="Execution" items={objective.execution} />
      </div>
      <NextInspection text={objective.nextInspection} />
    </article>)}{review.changes.length ? <article className="pr-evidence-objective"><h3>Other collected changes</h3><EvidenceGroups items={review.changes} /></article> : null}</>}
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
  return <section className="pr-evidence-group">
    <h4>{title}</h4>
    {items.length ? <ul>{items.map((item) => <li key={item.evidenceId}>
      <div><code>{item.label}</code><span className={`pr-evidence-relation relation-${item.relation}`}>{relationLabel(item.relation)}</span></div>
      {item.whyInspect ? <p>{item.whyInspect}</p> : null}
      {item.reviewQuestion ? <p>{item.reviewQuestion}</p> : null}
      {item.uncertainty ? <p>{item.uncertainty}</p> : null}
      {item.candidateBasis ? <p>{item.candidateBasis}</p> : null}
      {item.executionMeaning ? <p>{item.executionMeaning}</p> : null}
      {item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.kind === "execution" ? "Open check run" : item.line ? (item.relation === "candidate" || item.whyInspect ? "Open referenced lines" : "Open first changed line") : "Open at analyzed commit"}</a> : null}
    </li>)}</ul> : <p className="muted small">Unconnected — no linked evidence. Not found does not mean not implemented.</p>}
  </section>;
}

function NextInspection({ text }: { text: string }) {
  return <p className="pr-evidence-next"><strong>Next to inspect:</strong> {text}</p>;
}

function relationLabel(relation: PrEvidenceRelation): string {
  if (relation === "verified") return "Verified relation";
  if (relation === "observed") return "Observed evidence";
  if (relation === "candidate") return "Candidate link";
  return "Collected change";
}
