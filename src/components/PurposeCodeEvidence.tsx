"use client";
import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { purposeClauseReferences, purposeVisibleClauses } from "@/lib/purpose-summary";
import { purposeReferenceUrl, type PrEvidenceReview, type PrEvidenceReviewItem } from "@/lib/pr-evidence-review";
import { reviewCodeItems } from "@/lib/report-code-reference";
import { purposeReferenceLabel } from "@/lib/shared-report-copy";
import type { WorkspaceClient } from "@/lib/workspace-client";
import { ReportCodeViewer } from "./ReportCodeViewer";
import { reportCopy } from "./report-copy";

type PurposeReference = NonNullable<PrEvidenceReview["purposeReview"]>["references"][number];
/** Choosing a location inside the reader carries no description origin; the caller clears any previous one. */
export type CodeSelection = { id?: string; onSelect: (id: string) => void };

/** Cited references in claim order, each once. */
export function citedPurposeReferences(review: PrEvidenceReview): PurposeReference[] {
  const saved = review.purposeReview;
  if (!saved) return [];
  const ids = [...new Set(purposeVisibleClauses(saved).flatMap(purposeClauseReferences))];
  return ids.flatMap(id => saved.references.filter(ref => ref.id === id));
}

/**
 * The stored collected-change item for the same file at the same exact revision, which the
 * authenticated report-code API already resolves. No match (e.g. a base-side location) means
 * the code is not readable here; nothing is guessed from paths or lines.
 */
export function purposeCodeItem(review: PrEvidenceReview, ref: PurposeReference): PrEvidenceReviewItem | undefined {
  return reviewCodeItems(review).find(item => {
    if (item.label !== ref.path || !item.url) return false;
    try { return new URL(item.url).pathname.split("/")[4] === ref.revision; } catch { return false; }
  });
}

export function readablePurposeReferenceIds(review: PrEvidenceReview | undefined, available: boolean): Set<string> {
  if (!review || !available) return new Set();
  return new Set(citedPurposeReferences(review).filter(ref => purposeCodeItem(review, ref)).map(ref => ref.id));
}

/** One reader for the report's cited locations: pick a location, read its exact-revision excerpt with the cited lines marked.
 *  paneOwned: rendered inside the report code pane, which owns the single close control. */
export function PurposeCodeEvidence({ review, reportId, runtime, selection, paneOwned = false }: { review: PrEvidenceReview; reportId?: string; runtime?: WorkspaceClient; selection?: CodeSelection; paneOwned?: boolean }) {
  const saved = review.purposeReview!;
  const t = reportCopy(saved.locale);
  const refs = citedPurposeReferences(review);
  const [localId, setLocalId] = useState<string>();
  const selectedId = selection ? selection.id : localId, select = selection?.onSelect ?? setLocalId;
  const readable = (ref: PurposeReference) => reportId ? purposeCodeItem(review, ref) : undefined;
  const selected = refs.find(ref => ref.id === selectedId) ?? refs.find(ref => readable(ref)) ?? refs[0];
  const label = (ref: PurposeReference) => purposeReferenceLabel(ref, saved.references);
  const side = (ref: PurposeReference) => ref.side === "base" ? t.beforeChange : t.afterChange;
  const item = selected ? readable(selected) : undefined;
  const url = selected ? purposeReferenceUrl(review, selected) : undefined;
  return <section className="report-code-evidence" aria-label={t.citedCode} lang={saved.locale === "ko" ? "ko" : undefined}>
    <h3>{t.citedCode}</h3>
    {!refs.length ? <p className="muted small">{t.noCitedCode}</p> : <>
      <ul className="report-code-refs">{refs.map(ref => <li key={ref.id}>
        <button type="button" className="report-code-ref" data-reference-id={ref.id} aria-pressed={ref.id === selected?.id} aria-label={`${ref.path}, ${side(ref)}, ${t.lines} ${ref.startLine}-${ref.endLine}`} onClick={() => select(ref.id)}>
          <code translate="no">{label(ref)}</code><span>{side(ref)}</span>
        </button>
      </li>)}</ul>
      {selected ? <div className="report-code-selected" data-reference-id={selected.id}>
        <p className="report-code-meta">{item && reportId ? <span>{side(selected)}</span> : <><code translate="no">{selected.path}</code><span>{side(selected)} · {selected.revision.slice(0, 7)} · {t.lines} {selected.startLine}-{selected.endLine}</span></>}{url ? <a href={url} target="_blank" rel="noreferrer" aria-label={`${selected.path}, ${t.lines} ${selected.startLine}-${selected.endLine}, ${t.openOnGitHub}`}>GitHub <ExternalLink size={13} aria-hidden="true" /></a> : null}</p>
        {item && reportId ? <ReportCodeViewer key={`${reportId}:${selected.id}`} item={item} reportId={reportId} runtime={runtime} locale={saved.locale} initiallyOpen paneOwned={paneOwned} range={{ startLine: selected.startLine, endLine: selected.endLine }} /> : <p className="report-code-note">{t.codeOnGitHubOnly}</p>}
      </div> : null}
    </>}
  </section>;
}
