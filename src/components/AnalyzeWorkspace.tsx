"use client";

import {
  AlertTriangle,
  ClipboardCheck,
  CreditCard,
  Database,
  GitPullRequest,
  History,
  KeyRound,
  LifeBuoy,
  Plug,
  Play,
  RotateCcw,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { readAnalyzeResponse } from "@/lib/analyze-response";
import { ReportView } from "@/components/ReportView";
import { clearReportHistory, readReportHistory, saveReportToHistory, type StoredReport } from "@/lib/report-history";
import type { AnalyzeRequest, DemoScenarioId, VerificationReport } from "@/lib/types";

const scenarioOptions: { id: DemoScenarioId; label: string; summary: string; expected: string }[] = [
  {
    id: "clean",
    label: "Clean PR",
    summary: "Password reset validation with matching tests and passing checks.",
    expected: "Low risk; most requirements met."
  },
  {
    id: "scope-creep",
    label: "Scope creep",
    summary: "Password reset work that also touches shared auth session and permissions files.",
    expected: "Out-of-scope risk plus priority files."
  },
  {
    id: "missing-tests",
    label: "Missing tests",
    summary: "Invoice CSV export changes with lint/typecheck only.",
    expected: "Missing targeted test evidence."
  },
  {
    id: "failed-ci",
    label: "Failed CI",
    summary: "Workspace invite validation with a failing unit-test log.",
    expected: "Blocker from failed execution evidence."
  },
  {
    id: "vague-task",
    label: "Vague task",
    summary: "Dashboard polish request without concrete acceptance criteria.",
    expected: "No verified requirement result."
  }
];

export function AnalyzeWorkspace({ initialReport = null }: { initialReport?: VerificationReport | null }) {
  const [mode, setMode] = useState<"demo" | "manual">("manual");
  const [demoScenario, setDemoScenario] = useState<DemoScenarioId>("scope-creep");
  const [form, setForm] = useState<AnalyzeRequest>({
    prUrl: "",
    taskText: "",
    prDescription: "",
    changedFiles: "",
    checks: "",
    logs: ""
  });
  const [report, setReport] = useState<VerificationReport | null>(initialReport);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [isHistoryReport, setIsHistoryReport] = useState(false);
  const [history, setHistory] = useState<StoredReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string; guidance?: string[]; loginRequired?: boolean; installRequired?: boolean; connectionRequired?: boolean } | null>(null);
  const [focusReportAfterLoad, setFocusReportAfterLoad] = useState(false);
  const reportRegionRef = useRef<HTMLDivElement | null>(null);

  const statusLabel = useMemo(() => {
    if (!report) return "No report";
    return `${report.summary.priority.toUpperCase()} - ${report.summary.evidenceCoverage}% evidence`;
  }, [report]);
  const selectedScenario = useMemo(
    () => scenarioOptions.find((scenario) => scenario.id === demoScenario) ?? scenarioOptions[0],
    [demoScenario]
  );

  useEffect(() => {
    try {
      setHistory(readReportHistory(window.localStorage));
    } catch {
      setHistoryWarning("Browser history is unavailable. You can still generate and download a report.");
    }
  }, []);

  useEffect(() => {
    if (!report || !focusReportAfterLoad) return;

    reportRegionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    reportRegionRef.current?.focus({ preventScroll: true });
    setFocusReportAfterLoad(false);
  }, [focusReportAfterLoad, report]);

  async function signInForAnalysis() {
    setLoading(true);
    try {
      const response = await fetch("/api/auth/github/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agentproof-csrf": "same-origin" },
        body: JSON.stringify({ returnTo: "/analyze" })
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || typeof body?.authorizationUrl !== "string") throw new Error("Sign-in unavailable");
      window.location.assign(body.authorizationUrl);
    } catch {
      setError({ message: "GitHub sign-in is temporarily unavailable.", hint: "Try again from the configured AgentProof address. Demos and pasted evidence remain available.", loginRequired: true });
    } finally {
      setLoading(false);
    }
  }

  async function installForAnalysis() {
    setLoading(true);
    try {
      const response = await fetch("/api/github/onboarding/start", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agentproof-csrf": "same-origin" },
        body: "{}"
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || typeof body?.installUrl !== "string") throw new Error("Installation unavailable");
      window.location.assign(body.installUrl);
    } catch {
      setError({ message: "GitHub App installation is temporarily unavailable.", hint: "Open the dashboard to connect your repository." });
    } finally {
      setLoading(false);
    }
  }

  async function runAnalysis() {
    setLoading(true);
    setError(null);

    try {
      const payload: AnalyzeRequest = mode === "demo" ? { demoScenario } : form;
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agentproof-csrf": "same-origin", "x-agentproof-analysis-key": crypto.randomUUID() },
        body: JSON.stringify(payload)
      });
      const json = await readAnalyzeResponse(response);
      if (json.error) {
        setError({ message: json.error, hint: json.hint, guidance: json.guidance, loginRequired: json.loginRequired, installRequired: json.installRequired, connectionRequired: json.connectionRequired });
        return;
      }

      if (!json.report) {
        throw new Error("Analysis response did not include a report.");
      }

      const nextReport = json.report;
      setReport(nextReport);
      setIsHistoryReport(false);
      try {
        setHistory(saveReportToHistory(window.localStorage, nextReport));
        setHistoryWarning(null);
      } catch {
        setHistoryWarning("Report generated, but browser history could not be saved. Keep this page open or download the report.");
      }
      setFocusReportAfterLoad(true);
    } catch {
      setError({ message: "Could not reach the analysis service.", hint: "Check your connection, then retry. Your PR URL and pasted context remain in the form." });
    } finally {
      setLoading(false);
    }
  }

  function updateForm<K extends keyof AnalyzeRequest>(key: K, value: AnalyzeRequest[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function clearHistory() {
    try {
      setHistory(clearReportHistory(window.localStorage));
      setHistoryWarning(null);
    } catch {
      setHistoryWarning("Browser history could not be cleared. Check this browser’s storage permissions.");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <ShieldCheck size={18} />
          </div>
          <div className="brand-copy">
            <span>AgentProof</span>
            <small>Evidence verifier</small>
          </div>
        </div>
        <div className="topbar-actions">
          <a className="icon-link" href="/billing" aria-label="Billing beta boundary">
            <CreditCard size={15} />
          </a>
          <a className="icon-link" href="/status" aria-label="Status and support">
            <LifeBuoy size={15} />
          </a>
          <a className="icon-link" href="/integrations" aria-label="Integration readiness">
            <Plug size={15} />
          </a>
          <span className="status-chip">
            <ClipboardCheck size={14} />
            {statusLabel}
          </span>
        </div>
      </header>

      <div className={report ? "layout has-report" : "layout"}>
        <aside className="panel intake">
          <div className="intake-head">
            <div>
              <p className="eyebrow">Workspace</p>
              <h2 className="section-title">Evidence intake</h2>
            </div>
            <Database size={18} aria-hidden="true" />
          </div>

          <div className="automation-note beta-note">
            <KeyRound size={16} aria-hidden="true" />
            <span>
              <strong>Start with a GitHub PR URL</strong>
              Sign in to analyze a GitHub PR URL. Connect repositories you own or administer with the GitHub App;
              Private PRs require a connected repository with Analysis on and consent in Settings.
              Public PRs from other accounts use your GitHub sign-in. Demo is optional.
            </span>
          </div>

          <ol className="first-run-steps" aria-label="Guided beta steps">
            <li>Paste a public or connected private PR URL.</li>
            <li>Read the 30-second card after generation.</li>
            <li>Send only short feedback, never raw code, logs, or tokens.</li>
          </ol>

          <div className="mode-tabs" role="group" aria-label="Analysis source">
            <button
              type="button"
              className={mode === "demo" ? "mode-tab active" : "mode-tab"}
              onClick={() => setMode("demo")}
              aria-pressed={mode === "demo"}
            >
              Demo
            </button>
            <button
              type="button"
              className={mode === "manual" ? "mode-tab active" : "mode-tab"}
              onClick={() => setMode("manual")}
              aria-pressed={mode === "manual"}
            >
              PR URL
            </button>
          </div>

          {mode === "demo" ? (
            <section className="input-section" aria-labelledby="demo-source-title">
              <h3 id="demo-source-title">Scenario</h3>
              <div className="field">
                <label htmlFor="scenario">Demo case</label>
                <select
                  id="scenario"
                  className="select"
                  value={demoScenario}
                  onChange={(event) => setDemoScenario(event.target.value as DemoScenarioId)}
                >
                  {scenarioOptions.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>
                      {scenario.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="scenario-note" aria-live="polite">
                <strong>{selectedScenario.summary}</strong>
                <span>{selectedScenario.expected}</span>
              </div>
            </section>
          ) : (
            <>
              <section className="input-section" aria-labelledby="pull-request-title">
                <h3 id="pull-request-title">Pull request</h3>
                <div className="field">
                  <label htmlFor="prUrl">PR URL</label>
                  <input
                    id="prUrl"
                    className="input"
                    value={form.prUrl}
                    onChange={(event) => updateForm("prUrl", event.target.value)}
                    placeholder="https://github.com/org/repo/pull/123"
                  />
                </div>
              </section>

              <section className="input-section" aria-labelledby="request-evidence-title">
                <h3 id="request-evidence-title">Request evidence</h3>
                <p className="muted small input-privacy-note">
                  Optional context only. Use issue/task summaries, not private code, secrets, tokens, or full logs.
                </p>
                <div className="field">
                  <label htmlFor="taskText">Issue or task text</label>
                  <textarea
                    id="taskText"
                    className="textarea"
                    value={form.taskText}
                    onChange={(event) => updateForm("taskText", event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="prDescription">PR description</label>
                  <textarea
                    id="prDescription"
                    className="textarea"
                    value={form.prDescription}
                    onChange={(event) => updateForm("prDescription", event.target.value)}
                  />
                </div>
              </section>

              <section className="input-section" aria-labelledby="execution-evidence-title">
                <h3 id="execution-evidence-title">Execution evidence</h3>
                <p className="muted small input-privacy-note">
                  Prefer file paths and check summaries. Do not paste raw diffs, full logs, or secret-bearing output.
                </p>
                <div className="field">
                  <label htmlFor="changedFiles">Changed files</label>
                  <textarea
                    id="changedFiles"
                    className="textarea"
                    value={form.changedFiles}
                    onChange={(event) => updateForm("changedFiles", event.target.value)}
                    placeholder="One file path per line"
                  />
                </div>
                <div className="field">
                  <label htmlFor="checks">Checks</label>
                  <textarea
                    id="checks"
                    className="textarea compact-textarea"
                    value={form.checks}
                    onChange={(event) => updateForm("checks", event.target.value)}
                    placeholder="test: passed"
                  />
                </div>
                <div className="field">
                  <label htmlFor="logs">Logs</label>
                  <textarea
                    id="logs"
                    className="textarea compact-textarea"
                    value={form.logs}
                    onChange={(event) => updateForm("logs", event.target.value)}
                    placeholder="Short result summary only; no full logs"
                  />
                </div>
              </section>
            </>
          )}

          <div className="button-row">
            <button className="button primary" onClick={runAnalysis} disabled={loading}>
              <Play size={16} />
              {loading ? "Generating" : "Generate report"}
            </button>
            <button className="button" onClick={() => setReport(null)} disabled={loading}>
              <RotateCcw size={16} />
              Clear
            </button>
          </div>

          {error ? (
            <div className="intake-error" role="alert">
              <AlertTriangle size={14} />
              <div className="intake-error-body">
                <strong>{error.message}</strong>
                {report ? <span>The report below is from an earlier analysis.</span> : null}
                {error.hint ? <span>{error.hint}</span> : null}
                {error.loginRequired ? <button className="button primary" disabled={loading} onClick={signInForAnalysis}>Sign in with GitHub</button> : null}
                {error.installRequired ? <button className="button primary" disabled={loading} onClick={installForAnalysis}>Install GitHub App</button> : null}
                {error.connectionRequired ? <a className="button primary" href="/dashboard">Open repository settings</a> : null}
                <button className="button" disabled={loading} onClick={() => {
                  setMode("manual");
                  setForm((current) => ({ ...current, prUrl: "" }));
                  setError(null);
                }}>Use pasted evidence instead</button>
                {error.guidance && error.guidance.length > 0 ? (
                  <ul className="intake-error-actions">
                    {error.guidance.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="history-block">
            <div className="history-head">
              <h3>
                <History size={14} />
                Recent
              </h3>
              <button className="icon-button" onClick={clearHistory} aria-label="Clear recent reports">
                <Trash2 size={14} />
              </button>
            </div>
            <p className="muted small">Local summary-only history. Raw evidence is not saved here.</p>
            {historyWarning ? <p role="status" className="muted small">{historyWarning}</p> : null}
            {history.length > 0 ? (
              <ul className="history-list">
                {history.map((item) => (
                  <li key={item.id}>
                    <button onClick={() => {
                      setReport(item.report);
                      setIsHistoryReport(true);
                      setError(null);
                      setFocusReportAfterLoad(true);
                    }}>
                      <span>{item.title}</span>
                      <small>{item.priority.toUpperCase()} - {item.evidenceCoverage}%</small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">No saved reports.</p>
            )}
          </div>
        </aside>

        {report ? (
          <div ref={reportRegionRef} tabIndex={-1} className="report-focus-target">
            <>
              {isHistoryReport ? <p className="notice" role="status">Reopened local summary. Original code evidence and recommendations are not retained here; generate a new report to inspect them.</p> : null}
              <ReportView key={report.analysisId} report={report} mode={isHistoryReport ? "summary" : "full"} />
            </>
          </div>
        ) : (
          <section className="panel empty-state">
            <div>
              <GitPullRequest size={36} />
              <h1>Paste a GitHub PR URL</h1>
              <p>
                AgentProof will show the top risk, missing proof, first files, test/build status, and next agent ask in one 30-second card. Demo is optional if you do not have a PR ready.
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
