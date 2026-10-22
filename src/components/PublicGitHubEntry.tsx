"use client";

import Link from "next/link";
import { Github } from "lucide-react";
import { DiffEvidenceMark } from "./DiffEvidenceMark";
import { useEffect, useState, type ReactNode } from "react";

/** The public front door: product value and sign-in, one fictional sample report, and how to start. */
export function PublicGitHubEntry({ previewDemoAvailable = false }: { previewDemoAvailable?: boolean }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // A signed-in visitor belongs in the app home, not on the sign-in screen.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/dashboard/session", { cache: "no-store" })
      .then(response => response.ok ? response.json() : null)
      .then(body => { if (!cancelled && body?.signedIn === true) window.location.replace("/dashboard"); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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
      setMessage("GitHub sign-in is temporarily unavailable. Please try again.");
    } catch {
      setMessage("GitHub sign-in is temporarily unavailable. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const signIn = (className: string, label = "Continue with GitHub") => <button type="button" className={className} disabled={pending} aria-busy={pending} onClick={() => { void continueWithGitHub(); }}><Github size={18} aria-hidden="true" />{pending ? "Connecting GitHub…" : label}</button>;

  return <main className="github-entry github-front">
    <header className="github-entry-header">
      <Link href="/" className="dashboard-brand" aria-label="DiffEvidence home" title="DiffEvidence">
        <span className="dashboard-brand-mark" aria-hidden="true"><DiffEvidenceMark /></span>
      </Link>
      <nav className="front-header-actions" aria-label="Account">
        {previewDemoAvailable ? <Link className="github-entry-secondary-link github-entry-demo-link" href="/dashboard?demo=1">Preview dashboard</Link> : null}
        {signIn("front-header-signin", "Sign in")}
      </nav>
    </header>

    <section className="front-hero" aria-labelledby="front-title">
      <div className="front-hero-copy">
        <h1 id="front-title">Understand a pull request’s purpose and key changes.</h1>
        <p className="front-lede">Read a concise report with code references, related tests and GitHub CI results.</p>
        <div className="front-cta">
          {signIn("dashboard-primary-action front-primary")}
          {message ? <p className="front-cta-status" role="status">{message}</p> : null}
        </div>
      </div>
      <HomeSampleReport />
    </section>

    <section className="front-steps" aria-labelledby="front-steps-title">
      <h2 id="front-steps-title">Get started</h2>
      <ol>
        <li><span className="front-step-number" aria-hidden="true">1</span><p>Sign in with GitHub.</p></li>
        <li><span className="front-step-number" aria-hidden="true">2</span><div><p>Connect repositories.</p><p className="front-step-note">Install the GitHub App if needed.</p></div></li>
        <li><span className="front-step-number" aria-hidden="true">3</span><p>Choose a PR and generate its report.</p></li>
      </ol>
    </section>

    <footer className="front-footer">
      <span className="dashboard-brand-mark" aria-hidden="true"><DiffEvidenceMark size={22} /></span>
      <span>DiffEvidence</span>
      {signIn("front-footer-signin")}
    </footer>
  </main>;
}

/* Fictional sample: every name, line and status below is illustrative, not output from a repository. */
type SampleLine = { n: number; text: string; cited: boolean };
const lines = (start: number, from: number, to: number, source: string[]): SampleLine[] => source.map((text, index) => ({ n: start + index, text, cited: start + index >= from && start + index <= to }));
const SAMPLE_FILES = {
  change: { path: "upload.ts", range: "40–58", lines: lines(38, 40, 58, [
    "",
    "// Retry with a growing delay.",
    "export async function retry(file, n = 0) {",
    "  try {",
    "    return await send(file);",
    "  } catch (error) {",
    "    if (n >= MAX_RETRIES) throw error;",
    "    await wait(BASE_MS * 2 ** n);",
    "    return retry(file, n + 1);",
    "  }",
    "}",
    "",
    "const MAX_RETRIES = 3;",
    "const BASE_MS = 250;",
    "",
    "function wait(ms: number) {",
    "  return new Promise((done) =>",
    "    setTimeout(done, ms));",
    "}",
    "",
    "export { retry as uploadWithRetry };",
    "",
  ]) },
  test: { path: "upload.test.ts", range: "12–30", lines: lines(11, 12, 30, [
    "",
    "it(\"stops after 3 tries\", async () => {",
    "  mockSend.failTimes(4, \"offline\");",
    "  const result = uploadWithRetry(blob);",
    "  await runTimers();",
    "  await expect(result)",
    "    .rejects.toThrow(\"offline\");",
    "  expect(mockSend.calls).toBe(4);",
    "});",
    "",
    "it(\"waits longer each try\", async () => {",
    "  mockSend.failTimes(2, \"timeout\");",
    "  await uploadWithRetry(blob);",
    "  expect(mockSend.delays)",
    "    .toEqual([250, 500]);",
    "});",
    "",
    "afterEach(() => mockSend.reset());",
    "",
    "",
  ]) },
} as const;
type SampleKey = keyof typeof SAMPLE_FILES;

const TOKEN = /(\/\*\*.*\*\/|\/\/.*$)|("[^"]*")|\b(export|async|function|try|return|await|catch|if|throw|const|new|test)\b|\b(\d+)\b/g;
function highlight(text: string): ReactNode[] {
  const parts: ReactNode[] = []; let last = 0; let match: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((match = TOKEN.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const kind = match[1] ? "comment" : match[2] ? "string" : match[3] ? "keyword" : "number";
    parts.push(<span key={match.index} className={`tok-${kind}`}>{match[0]}</span>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** The report's shape: each explanation sits on its code reference; choosing a reference shows that sample excerpt. */
function HomeSampleReport() {
  const [selected, setSelected] = useState<SampleKey>("change");
  const [switched, setSwitched] = useState(false);
  const file = SAMPLE_FILES[selected];
  const ref = (key: SampleKey) => <button type="button" className="front-sample-ref" aria-pressed={selected === key} aria-label={`Show sample ${SAMPLE_FILES[key].path} lines ${SAMPLE_FILES[key].range}`} onClick={() => { setSelected(key); setSwitched(true); }}><code>{SAMPLE_FILES[key].path}:{SAMPLE_FILES[key].range}</code></button>;
  return <figure className="front-sample" aria-labelledby="front-sample-caption">
    <figcaption id="front-sample-caption" className="front-sample-bar"><span className="front-sample-dots" aria-hidden="true"><i /><i /><i /></span><span>Sample report · Fictional repository</span></figcaption>
    <div className="front-sample-panes">
      <div className="front-sample-report">
        <p className="front-sample-pr">PR #128</p>
        <p className="front-sample-title">Retry failed uploads</p>
        <div className={`front-sample-claim${selected === "change" ? " is-selected" : ""}`}>
          <p className="front-sample-label">Change</p>
          <p>Retry failed uploads up to 3 times, waiting longer between attempts.</p>
          {ref("change")}
        </div>
        <div className={`front-sample-claim${selected === "test" ? " is-selected" : ""}`}>
          <p className="front-sample-label">Test expectation</p>
          <p>Expects the original error when retries run out.</p>
          {ref("test")}
        </div>
        <dl className="front-sample-meta">
          <div><dt>Model interpretation</dt><dd>Fits</dd></div>
          <div><dt>GitHub CI</dt><dd><i className="front-ci-dot" aria-hidden="true" />Passed</dd></div>
        </dl>
      </div>
      <div className="front-sample-code" role="region" aria-label={`Sample code: ${file.path} lines ${file.range}`}>
        <p className="front-code-head"><code>{file.path}</code><span>lines {file.range}</span></p>
        <pre key={selected} tabIndex={0} className={`front-code-body${switched ? " is-switched" : ""}`}><code>{file.lines.map(line => <span key={line.n} className={`front-code-line${line.cited ? " is-cited" : ""}`}><span className="front-code-n" aria-hidden="true">{line.n}</span><span>{line.text ? highlight(line.text) : " "}</span>{"\n"}</span>)}</code></pre>
      </div>
    </div>
  </figure>;
}
