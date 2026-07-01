import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AnalysisDeadLetterNextAction } from "./analysis-job-alerts";

const runbookSources = [
  ["deployment smoke", "../../docs/deployment-smoke.md"],
  ["live smoke runbook", "../../docs/github-app-live-smoke-runbook.md"],
  ["GitHub App webhook ops", "../../docs/github-app-webhook.md"],
  ["tenant data retention", "../../docs/tenant-data-retention.md"]
] as const;

describe("ops runbook boundary", () => {
  it("documents every dead-letter next action emitted by ops status", () => {
    const githubWebhookDoc = readFileSync(new URL("../../docs/github-app-webhook.md", import.meta.url), "utf8");
    const nextActions = [
      "continue_monitoring",
      "review_top_error_codes",
      "pause_batch_drains_and_check_provider_or_storage",
      "triage_or_record_follow_up",
      "increase_sample_or_check_durable_store"
    ] satisfies AnalysisDeadLetterNextAction[];

    for (const action of nextActions) {
      expect(githubWebhookDoc).toContain(action);
    }
  });

  it("keeps ops drill evidence bounded and explicit", () => {
    const deploymentSmoke = readFileSync(new URL("../../docs/deployment-smoke.md", import.meta.url), "utf8");

    for (const expected of [
      "/api/ops/drill-gate",
      "AGENTPROOF_OPS_DRILL_EVIDENCE",
      "deletion_drill",
      "restore_drill",
      "incident_runbook_review",
      "production_smoke",
      "docs/...#anchor",
      "github-actions:<run_id>",
      "manual-record:<id>",
      "The drill gate is an evidence gate only"
    ]) {
      expect(deploymentSmoke).toContain(expected);
    }
  });

  it("forbids raw evidence, secrets, and provider internals in ops drill/runbook artifacts", () => {
    const combined = runbookSources
      .map(([, path]) => readFileSync(new URL(path, import.meta.url), "utf8"))
      .join("\n");

    for (const expected of [
      "tokens",
      "raw webhook payloads",
      "diffs",
      "logs",
      "full reports",
      "report keys",
      "claims",
      "raw re-prompt text",
      "provider ids",
      "table names",
      "env names",
      "backup contents"
    ]) {
      expect(combined).toContain(expected);
    }
  });
});
