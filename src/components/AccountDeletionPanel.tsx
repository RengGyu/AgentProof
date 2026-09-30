"use client";

import React, { useEffect, useState } from "react";
import "./AccountDeletionPanel.css";

export type DeletionStatus = "ready" | "pending" | "completed" | "unauthorized" | "shared_workspace" | "unavailable";
export type DeletionResult = { status: DeletionStatus };
export function parseDeletionResult(value: unknown): DeletionResult {
  const status = (value as { status?: unknown } | null)?.status;
  return { status: ["ready", "pending", "completed", "unauthorized", "shared_workspace", "unavailable"].includes(String(status)) ? status as DeletionStatus : "unavailable" };
}

export default function AccountDeletionPanel({ request, signIn, onCompleted }: {
  request: (remove: boolean) => Promise<DeletionResult>;
  signIn: () => Promise<void>;
  onCompleted?: () => void;
}) {
  const [status, setStatus] = useState<DeletionStatus>();
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void request(false).then(result => {
      if (cancelled) return;
      setStatus(result.status);
      if (result.status === "completed") onCompleted?.();
    }).catch(() => { if (!cancelled) setStatus("unavailable"); });
    return () => { cancelled = true; };
  }, [request, onCompleted]);
  async function run(remove: boolean) {
    setBusy(true); setError("");
    try {
      const result = await request(remove);
      setStatus(result.status);
      if (result.status === "completed") onCompleted?.();
    } catch { setError("We could not confirm the result. Check the status or retry; deletion has not been reported as complete."); }
    finally { setBusy(false); }
  }
  return <section className="account-deletion-panel">
    <h1>Delete your AgentProof account</h1>
    <p>This removes your personal AgentProof account, saved reports, repository connections, jobs, sessions, and associated identifiable service records from live storage. This cannot be undone.</p>
    <p>Your GitHub account and repositories remain. The shared GitHub App is not uninstalled. Signing in after deletion creates a new, empty AgentProof account.</p>
    <p>Cost records no longer linked to your account expire after 90 days. Deletion confirmation records expire after 24 hours. Both are removed by daily cleanup. Backups expire under the provider’s retention settings; they are not immediately erased. Restoring an older backup is not automatically reconciled with deletions.</p>
    <div role="status" aria-live="polite">
      {!status && <p>Checking account…</p>}
      {status === "completed" && <p>Your AgentProof account and its associated live data have been deleted.</p>}
      {status === "pending" && <p>Deletion is in progress. Normal account access is blocked. We will retry automatically after active work has stopped; you can also retry below.</p>}
      {status === "unauthorized" && <p>Sign in with the GitHub account you used for AgentProof to request deletion or check a pending request.</p>}
      {status === "shared_workspace" && <p>This workspace has other members. Personal account deletion is unavailable because it would remove their data.</p>}
      {status === "unavailable" && <p>Account deletion is currently unavailable. Completion has not been confirmed. Please try again later.</p>}
      {error && <p role="alert">{error}</p>}
    </div>
    {status === "ready" && <form onSubmit={event => { event.preventDefault(); if (confirmation === "DELETE") void run(true); }}>
      <label>Type DELETE to confirm<input aria-label="Type DELETE to confirm" value={confirmation} autoComplete="off" onChange={event => setConfirmation(event.target.value)} /></label>
      <button type="submit" disabled={busy || confirmation !== "DELETE"}>{busy ? "Deleting…" : "Permanently delete my account"}</button>
    </form>}
    {status === "pending" && <button disabled={busy} onClick={() => void run(true)}>{busy ? "Retrying…" : "Retry deletion"}</button>}
    {status === "unavailable" && <button disabled={busy} onClick={() => void run(false)}>Check status again</button>}
    {status === "unauthorized" && <button disabled={busy} onClick={() => { setBusy(true); void signIn().catch(() => setError("GitHub sign-in could not be started.")).finally(() => setBusy(false)); }}>Continue with GitHub</button>}
  </section>;
}
