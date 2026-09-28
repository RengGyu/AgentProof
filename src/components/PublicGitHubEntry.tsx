"use client";

import Link from "next/link";
import { ArrowRight, Github, ShieldCheck } from "lucide-react";
import { useState } from "react";

export function PublicGitHubEntry({ previewDemoAvailable = false }: { previewDemoAvailable?: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function continueWithGitHub() {
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/github/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}"
      });
      const body = await response.json().catch(() => null);
      if (typeof body?.authorizationUrl === "string") {
        window.location.assign(body.authorizationUrl);
        return;
      }
      setMessage("GitHub sign-in is temporarily unavailable.");
    } catch {
      setMessage("GitHub sign-in is temporarily unavailable.");
    } finally {
      setPending(false);
    }
  }

  return <main className="github-entry">
    <header className="github-entry-header">
      <Link href="/" className="dashboard-brand" aria-label="AgentProof home">
        <span className="dashboard-brand-mark" aria-hidden="true"><ShieldCheck size={18} /></span>
        <span>AgentProof<small>Evidence workspace</small></span>
      </Link>
    </header>
    <section className="github-entry-main" aria-labelledby="github-sign-in-title">
      <div className="github-entry-copy">
        <h1 id="github-sign-in-title">Sign in to AgentProof</h1>
        <p>Open your repositories and review PR evidence.</p>
        <button
          type="button"
          className="dashboard-primary-action github-entry-action"
          onClick={() => { void continueWithGitHub(); }}
          disabled={pending}
          aria-busy={pending}
          aria-describedby="github-sign-in-access"
        >
          <Github size={19} aria-hidden="true" />
          {pending ? "Connecting GitHub…" : "Continue with GitHub"}
        </button>
        <p id="github-sign-in-access" className="github-entry-access">You’ll choose repository access next.</p>
        {message ? <p className="github-entry-error" role="status">{message} Please try again.</p> : null}
        <div className="github-entry-alternatives">
          <a className="github-entry-secondary-link" href="/analyze">Analyze a public PR <ArrowRight size={15} aria-hidden="true" /></a>
          {previewDemoAvailable ? <Link className="github-entry-secondary-link github-entry-demo-link" href="/dashboard?demo=1">Preview dashboard</Link> : null}
        </div>
      </div>
      <p className="dashboard-boundary github-entry-boundary">
        AgentProof organizes evidence. It does not establish correctness, safety, requirement satisfaction, or merge readiness.
      </p>
    </section>
  </main>;
}
