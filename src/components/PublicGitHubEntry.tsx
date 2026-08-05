"use client";

import Link from "next/link";
import { ArrowRight, Github, ShieldCheck } from "lucide-react";
import { useState } from "react";

export function PublicGitHubEntry() {
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
    <header className="github-entry-header"><Link href="/" className="dashboard-brand"><span className="dashboard-brand-mark"><ShieldCheck size={18} /></span><span>AgentProof<small>Evidence workspace</small></span></Link><a className="github-entry-secondary-link" href="/analyze">Analyze a public PR <ArrowRight size={15} /></a></header>
    <section className="github-entry-main">
      <div className="github-entry-copy"><p className="dashboard-eyebrow">EVIDENCE-FIRST PULL REQUEST REVIEW</p><h1>Connect GitHub to start an evidence review.</h1><p>Choose a repository, then open the evidence behind each saved PR report.</p><button className="dashboard-primary-action github-entry-action" onClick={() => { void continueWithGitHub(); }} disabled={pending}><Github size={19} /> {pending ? "Connecting GitHub…" : "Continue with GitHub"}</button>{message ? <p className="github-entry-error" role="status">{message}</p> : null}<p className="dashboard-boundary"><ShieldCheck size={15} /> AgentProof does not establish correctness, safety, requirement satisfaction, or merge readiness.</p></div>
    </section>
  </main>;
}
