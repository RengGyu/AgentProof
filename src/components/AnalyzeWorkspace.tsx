"use client";

import { AlertTriangle, ClipboardCheck, GitPullRequest, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { ReportView } from "@/components/ReportView";
import type { AnalyzeRequest, DemoScenarioId, VerificationReport } from "@/lib/types";

const scenarioLabels: { id: DemoScenarioId; label: string }[] = [
  { id: "clean", label: "Clean PR" },
  { id: "scope-creep", label: "Scope creep" },
  { id: "missing-tests", label: "Missing tests" },
  { id: "failed-ci", label: "Failed CI" },
  { id: "vague-task", label: "Vague task" }
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const statusLabel = useMemo(() => {
    if (!report) return "No report";
    return `${report.summary.priority.toUpperCase()} - ${report.summary.evidenceCoverage}% evidence`;
  }, [report]);

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
      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error ?? "Analysis failed");
      }

      setReport(json.report);
    } catch (analysisError) {
      setError(analysisError instanceof Error ? analysisError.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }

  function updateForm<K extends keyof AnalyzeRequest>(key: K, value: AnalyzeRequest[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <ShieldCheck size={18} />
          </div>
          <span>AgentProof</span>
        </div>
        <div className="topbar-actions">
          <span className="status-chip">
            <ClipboardCheck size={14} />
            {statusLabel}
          </span>
        </div>
      </header>

      <div className="layout">
        <aside className="panel intake">
          <h2 className="section-title">Analysis Intake</h2>

          <div className="field">
            <label htmlFor="mode">Source</label>
            <select
              id="mode"
              className="select"
              value={mode}
              onChange={(event) => setMode(event.target.value as "demo" | "manual")}
            >
              <option value="demo">Demo scenario</option>
              <option value="manual">PR URL or pasted evidence</option>
            </select>
          </div>

          {mode === "demo" ? (
            <div className="field">
              <label htmlFor="scenario">Scenario</label>
              <select
                id="scenario"
                className="select"
                value={demoScenario}
                onChange={(event) => setDemoScenario(event.target.value as DemoScenarioId)}
              >
                {scenarioLabels.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <>
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
                <label htmlFor="githubToken">GitHub token</label>
                <input
                  id="githubToken"
                  className="input"
                  value={form.githubToken}
                  onChange={(event) => updateForm("githubToken", event.target.value)}
                  type="password"
                  placeholder="Optional fine-grained token"
                />
              </div>
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
                  className="textarea"
                  value={form.checks}
                  onChange={(event) => updateForm("checks", event.target.value)}
                  placeholder="lint: passed"
                />
              </div>
              <div className="field">
                <label htmlFor="logs">Logs</label>
                <textarea
                  id="logs"
                  className="textarea"
                  value={form.logs}
                  onChange={(event) => updateForm("logs", event.target.value)}
                />
              </div>
            </>
          )}

          <div className="button-row">
            <button className="button primary" onClick={runAnalysis} disabled={loading}>
              <Play size={16} />
              {loading ? "Analyzing" : "Analyze"}
            </button>
            <button className="button" onClick={() => setReport(null)} disabled={loading}>
              <RotateCcw size={16} />
              Clear
            </button>
          </div>

          {error ? (
            <div className="error">
              <AlertTriangle size={14} /> {error}
            </div>
          ) : null}
        </aside>

        {report ? (
          <ReportView report={report} />
        ) : (
          <section className="panel empty-state">
            <div>
              <GitPullRequest size={36} />
              <h1>Evidence report workspace</h1>
              <p>
                Select a scenario or submit PR evidence to generate requirement coverage, weak proof,
                scope creep, and a re-prompt.
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
