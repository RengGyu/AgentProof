"use client";

import {
  AlertTriangle,
  ClipboardCheck,
  CreditCard,
  Database,
  GitBranch,
  GitPullRequest,
  History,
  LifeBuoy,
  Plug,
  Play,
  RotateCcw,
  ShieldCheck,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
    expected: "Unclear requirement coverage."
  }
];

export function AnalyzeWorkspace({ initialReport }: { initialReport: VerificationReport }) {
  const [mode, setMode] = useState<"demo" | "manual">("demo");
  const [demoScenario, setDemoScenario] = useState<DemoScenarioId>("scope-creep");
  const [form, setForm] = useState<AnalyzeRequest>({
    prUrl: "",
    githubToken: "",
    taskText: "",
    prDescription: "",
    changedFiles: "",
    checks: "",
    logs: ""
  });
  const [report, setReport] = useState<VerificationReport | null>(initialReport);
  const [history, setHistory] = useState<StoredReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string; guidance?: string[] } | null>(null);

  const statusLabel = useMemo(() => {
    if (!report) return "No report";
    return `${report.summary.priority.toUpperCase()} - ${report.summary.evidenceCoverage}% evidence`;
  }, [report]);
  const selectedScenario = useMemo(
    () => scenarioOptions.find((scenario) => scenario.id === demoScenario) ?? scenarioOptions[0],
    [demoScenario]
  );

  useEffect(() => {
    setHistory(readReportHistory(window.localStorage));
  }, []);

  async function runAnalysis() {
    setLoading(true);
    setError(null);

    try {
      const payload: AnalyzeRequest = mode === "demo" ? { demoScenario } : form;
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const json = await response.json() as {
        report?: VerificationReport;
        error?: string;
        hint?: string;
        guidance?: string[];
      };

      if (!response.ok) {
        const hint = typeof json.hint === "string" ? json.hint : undefined;
        const guidance = Array.isArray(json.guidance)
          ? json.guidance
            .filter((item): item is string => typeof item === "string")
            .filter((item) => item !== hint)
            .slice(0, 3)
          : undefined;

        setError({
          message: typeof json.error === "string" ? json.error : "Analysis failed",
          hint,
          guidance
        });
        return;
      }

      if (!json.report) {
        throw new Error("Analysis response did not include a report.");
      }

      const nextReport = json.report;
      setReport(nextReport);
      setHistory(saveReportToHistory(window.localStorage, nextReport));
      setForm((current) => ({ ...current, githubToken: "" }));
    } catch (analysisError) {
      setError({ message: analysisError instanceof Error ? analysisError.message : "Analysis failed" });
    } finally {
      setLoading(false);
    }
  }

  function updateForm<K extends keyof AnalyzeRequest>(key: K, value: AnalyzeRequest[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function clearHistory() {
    setHistory(clearReportHistory(window.localStorage));
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

          <a className="automation-note" href="/integrations">
            <GitBranch size={16} aria-hidden="true" />
            <span>
              <strong>GitHub App event mode</strong>
              Signed PR events can generate reports for allowlisted repos; saved links and marker comments stay opt-in.
            </span>
          </a>

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
              PR evidence
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
                <div className="field">
                  <label htmlFor="githubToken">Read token</label>
                  <input
                    id="githubToken"
                    className="input"
                    value={form.githubToken}
                    onChange={(event) => updateForm("githubToken", event.target.value)}
                    type="password"
                    placeholder="Optional fine-grained token"
                  />
                  <p className="muted small credential-note">
                    Used only for this analysis request and cleared after the report is generated.
                  </p>
                </div>
              </section>

              <section className="input-section" aria-labelledby="request-evidence-title">
                <h3 id="request-evidence-title">Request evidence</h3>
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
            <div className="intake-error">
              <AlertTriangle size={14} />
              <div className="intake-error-body">
                <strong>{error.message}</strong>
                {error.hint ? <span>{error.hint}</span> : null}
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
            {history.length > 0 ? (
              <ul className="history-list">
                {history.map((item) => (
                  <li key={item.id}>
                    <button onClick={() => setReport(item.report)}>
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
          <ReportView report={report} />
        ) : (
          <section className="panel empty-state">
            <div>
              <GitPullRequest size={36} />
              <h1>Evidence report workspace</h1>
              <p>
                Submit PR evidence to map the original request against proof, gaps, tests, and review priority.
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
