"use client";
import { useEffect, useState } from "react";
import type { PrEvidenceReviewItem } from "@/lib/pr-evidence-review";
import { reportCodeReference, type ReportCodeExcerpt } from "@/lib/report-code-reference";
import { webWorkspaceClient, type WorkspaceClient } from "@/lib/workspace-client";

// Validated excerpts already read on this page, in memory only (never stored).
// Bounded, and cleared on sign-out, so reopening code needs no new request.
const codeCache = new Map<string, ReportCodeExcerpt>();
const CODE_CACHE_LIMIT = 40;
export function clearReportCodeCache() { codeCache.clear(); }

export function ReportCodeViewer({ item, reportId, runtime = webWorkspaceClient }: { item: PrEvidenceReviewItem; reportId: string; runtime?: WorkspaceClient }) {
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; code?: ReportCodeExcerpt; error?: string } | null>(null);
  const reference = reportCodeReference(item);
  const cacheKey = `${reportId}:${reference}`;
  const key = `${cacheKey}:${retry}`;
  useEffect(() => {
    if (!open || codeCache.has(cacheKey)) return;
    const controller = new AbortController();
    setResult(null);
    void (async () => {
      try {
        const query = new URLSearchParams({ reportId, reference });
        const response = await runtime.request(`/api/dashboard/report-code?${query}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error.slice(0, 400) : "Referenced code could not be loaded. Try again.");
        if (!validExcerpt(body, item)) throw new Error("Code could not be matched to this report reference. Try again.");
        if (controller.signal.aborted) return;
        codeCache.delete(cacheKey);
        codeCache.set(cacheKey, body);
        if (codeCache.size > CODE_CACHE_LIMIT) codeCache.delete(codeCache.keys().next().value!);
        setResult({ key, code: body });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : "Referenced code could not be loaded. Try again." });
      }
    })();
    return () => controller.abort();
  }, [open, key, reportId, reference, item.url, runtime]);
  const cachedCode = codeCache.get(cacheKey);
  const current = cachedCode ? { key, code: cachedCode, error: undefined } : result?.key === key ? result : null;
  return <div className="report-code-viewer">
    <button className="report-code-action" aria-label={`${open ? "Close" : "Read"} code for ${item.label}`} aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? "Close code" : "Read code"}</button>
    {open ? <section className="report-code-panel" aria-label={`Referenced code in ${item.label}`}>
      {!current ? <p role="status">Loading referenced code…</p> : current.error ? <div role="alert"><p>{current.error}</p><button className="report-code-action" aria-label="Retry referenced code" onClick={() => setRetry(value => value + 1)}>Retry</button></div> : current.code ? <>
        <header><code>{current.code.path}</code><span>Revision {current.code.revision.slice(0, 12)}{current.code.focusLine ? ` · line ${current.code.focusLine}` : ""} · excerpt only, secrets redacted</span></header>
        {current.code.lines.length ? <div className="report-code-scroll" tabIndex={0} role="region" aria-label={`Code lines from ${current.code.path}`}><pre><code>{current.code.lines.map(line => <span className={`report-code-line${line.number === current.code!.focusLine ? " is-reference" : ""}`} key={line.number}><span className="report-code-number" aria-label={`Line ${line.number}`}>{line.number}</span><span>{line.text || " "}</span>{"\n"}</span>)}</code></pre></div> : <p>This file is empty at the recorded revision.</p>}
        {current.code.truncated ? <p className="report-code-note">{current.code.totalLines} lines in the file.</p> : null}
      </> : null}
    </section> : null}
  </div>;
}

function validExcerpt(body: any, item: PrEvidenceReviewItem): body is ReportCodeExcerpt {
  let revision: string | undefined;
  try { revision = new URL(item.url!).pathname.split("/")[4]; } catch { return false; }
  if (!body || body.reference !== reportCodeReference(item) || body.path !== item.label || body.revision !== revision ||
      body.focusLine !== item.line || !Number.isSafeInteger(body.totalLines) || body.totalLines < 0 || typeof body.truncated !== "boolean" ||
      !Array.isArray(body.lines) || body.lines.length > 80) return false;
  let size = 0;
  return body.lines.every((line: any, index: number) => {
    if (!line || !Number.isSafeInteger(line.number) || line.number < 1 || line.number > body.totalLines ||
        typeof line.text !== "string" || (index > 0 && line.number !== body.lines[index - 1].number + 1)) return false;
    size += line.text.length;
    return size <= 16_000;
  });
}
