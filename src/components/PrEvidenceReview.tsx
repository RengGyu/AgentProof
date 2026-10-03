import type { PrEvidenceReview as PrEvidenceReviewModel, PrEvidenceReviewItem, PrEvidenceRelation } from "@/lib/pr-evidence-review";
import { ReportCodeViewer } from "./ReportCodeViewer";
import type { WorkspaceClient } from "@/lib/workspace-client";

type CodeContext = { reportId: string; runtime?: WorkspaceClient };

export function PrEvidenceReview({ review, compact = false, codeContext }: { review: PrEvidenceReviewModel; compact?: boolean; codeContext?: CodeContext }) {
  const objectives = review.mode === "objectives" ? review.objectives : [];
  // Files already listed under an objective are not repeated as "other" changes.
  const shown = new Set(objectives.flatMap(objective => [objective.firstInspection, ...objective.code, ...objective.tests, ...(objective.moreContext ?? [])]).filter(Boolean).map(item => `${item!.label}:${item!.line ?? 0}`));
  const otherChanges = review.mode === "objectives" ? review.changes.filter(item => !shown.has(`${item.label}:${item.line ?? 0}`)) : review.changes;
  return <section className={`pr-evidence-review${compact ? " compact" : ""}`} aria-label="PR-to-Evidence Review">
    <div className="pr-evidence-review-heading">
      <h2 className="pr-evidence-accessible-heading">PR-to-Evidence Review</h2>
    </div>
    {review.mode === "change_summary" ? <>
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
    {review.retrievalNote || review.sourceLinks?.length ? <details className="pr-evidence-context"><summary>Sources &amp; search scope</summary>{review.retrievalNote ? <p>{review.retrievalNote}</p> : null}{review.sourceLinks?.map(link=><p key={link.url}><a href={link.url} target="_blank" rel="noreferrer">Open {link.label}</a></p>)}</details> : null}
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
