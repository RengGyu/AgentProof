import { containsSecretPattern, redactSecrets } from "./redact";

export const OPS_DRILL_EVIDENCE_ENV = "AGENTPROOF_OPS_DRILL_EVIDENCE";
export const DEFAULT_OPS_DRILL_MAX_AGE_DAYS = 30;

export type OpsDrillCategoryKey =
  | "deletion_drill"
  | "restore_drill"
  | "incident_runbook_review"
  | "production_smoke";

export type OpsDrillCategoryStatus = "passed" | "failed" | "missing" | "stale" | "unclear";
export type OpsDrillGateStatus = "ready" | "blocked";

export interface OpsDrillCategorySummary {
  key: OpsDrillCategoryKey;
  label: string;
  status: OpsDrillCategoryStatus;
  completedAt?: string;
  evidenceRef?: string;
  maxAgeDays: number;
  ageDays?: number;
}

export interface OpsDrillGateSummary {
  privacy: "ops-drill-gate-summary-only";
  status: OpsDrillGateStatus;
  categories: OpsDrillCategorySummary[];
  counts: {
    required: number;
    passed: number;
    blocked: number;
    missing: number;
    stale: number;
    failed: number;
    unclear: number;
  };
  next: "ready_for_launch_review" | "run_missing_ops_drills" | "rerun_stale_ops_drills" | "review_failed_ops_drills";
}

interface OpsDrillEvidenceInput {
  key?: unknown;
  status?: unknown;
  completedAt?: unknown;
  evidenceRef?: unknown;
}

interface OpsDrillEvidenceRecord {
  key: OpsDrillCategoryKey;
  status: "passed" | "failed" | "unclear";
  completedAt?: string;
  evidenceRef?: string;
}

const REQUIRED_OPS_DRILLS: Array<{
  key: OpsDrillCategoryKey;
  label: string;
}> = [
  { key: "deletion_drill", label: "Deletion drill" },
  { key: "restore_drill", label: "Restore drill" },
  { key: "incident_runbook_review", label: "Incident runbook review" },
  { key: "production_smoke", label: "Production smoke evidence" }
];

export class OpsDrillGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpsDrillGateError";
  }
}

export function readOpsDrillGateSummary(
  env = process.env,
  now = new Date()
): OpsDrillGateSummary {
  const maxAgeDays = normalizeMaxAgeDays(env.AGENTPROOF_OPS_DRILL_MAX_AGE_DAYS);
  const records = readOpsDrillEvidenceRecords(env);
  if (!records) {
    throw new OpsDrillGateError("Ops drill evidence configuration is invalid.");
  }

  const byCategory = new Map(records.map((record) => [record.key, record]));
  const categories = REQUIRED_OPS_DRILLS.map(({ key, label }) =>
    toCategorySummary({
      key,
      label,
      record: byCategory.get(key),
      maxAgeDays,
      now
    })
  );
  const counts = {
    required: categories.length,
    passed: categories.filter((category) => category.status === "passed").length,
    blocked: categories.filter((category) => category.status !== "passed").length,
    missing: categories.filter((category) => category.status === "missing").length,
    stale: categories.filter((category) => category.status === "stale").length,
    failed: categories.filter((category) => category.status === "failed").length,
    unclear: categories.filter((category) => category.status === "unclear").length
  };

  return {
    privacy: "ops-drill-gate-summary-only",
    status: counts.blocked === 0 ? "ready" : "blocked",
    categories,
    counts,
    next: nextAction(counts)
  };
}

function readOpsDrillEvidenceRecords(env = process.env): OpsDrillEvidenceRecord[] | null {
  const raw = env[OPS_DRILL_EVIDENCE_ENV];
  if (!raw?.trim()) return [];
  if (containsSecretPattern(raw)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const records: OpsDrillEvidenceRecord[] = [];
  for (const item of parsed.slice(0, 50)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const normalized = normalizeEvidenceRecord(item as OpsDrillEvidenceInput);
    if (!normalized) return null;
    records.push(normalized);
  }

  return records;
}

function normalizeEvidenceRecord(input: OpsDrillEvidenceInput): OpsDrillEvidenceRecord | null {
  const key = normalizeCategoryKey(input.key);
  const status = normalizeInputStatus(input.status);
  const completedAt = normalizeCompletedAt(input.completedAt);
  const evidenceRef = normalizeEvidenceRef(input.evidenceRef);
  if (!key || !status) return null;

  return {
    key,
    status,
    ...(completedAt ? { completedAt } : {}),
    ...(evidenceRef ? { evidenceRef } : {})
  };
}

function toCategorySummary(input: {
  key: OpsDrillCategoryKey;
  label: string;
  record?: OpsDrillEvidenceRecord;
  maxAgeDays: number;
  now: Date;
}): OpsDrillCategorySummary {
  if (!input.record) {
    return {
      key: input.key,
      label: input.label,
      status: "missing",
      maxAgeDays: input.maxAgeDays
    };
  }

  const ageDays = input.record.completedAt
    ? Math.floor((input.now.getTime() - new Date(input.record.completedAt).getTime()) / 86_400_000)
    : undefined;
  const status = categoryStatus(input.record, ageDays, input.maxAgeDays);

  return {
    key: input.key,
    label: input.label,
    status,
    ...(input.record.completedAt ? { completedAt: input.record.completedAt } : {}),
    ...(input.record.evidenceRef ? { evidenceRef: input.record.evidenceRef } : {}),
    maxAgeDays: input.maxAgeDays,
    ...(typeof ageDays === "number" ? { ageDays } : {})
  };
}

function categoryStatus(
  record: OpsDrillEvidenceRecord,
  ageDays: number | undefined,
  maxAgeDays: number
): OpsDrillCategoryStatus {
  if (record.status === "failed") return "failed";
  if (record.status === "unclear") return "unclear";
  if (!record.completedAt || !record.evidenceRef || typeof ageDays !== "number" || ageDays < 0) return "unclear";
  if (ageDays > maxAgeDays) return "stale";

  return "passed";
}

function nextAction(counts: OpsDrillGateSummary["counts"]): OpsDrillGateSummary["next"] {
  if (counts.failed > 0 || counts.unclear > 0) return "review_failed_ops_drills";
  if (counts.stale > 0) return "rerun_stale_ops_drills";
  if (counts.missing > 0) return "run_missing_ops_drills";

  return "ready_for_launch_review";
}

function normalizeCategoryKey(value: unknown): OpsDrillCategoryKey | null {
  if (
    value === "deletion_drill" ||
    value === "restore_drill" ||
    value === "incident_runbook_review" ||
    value === "production_smoke"
  ) {
    return value;
  }

  return null;
}

function normalizeInputStatus(value: unknown): OpsDrillEvidenceRecord["status"] | null {
  if (value === "passed" || value === "failed" || value === "unclear") return value;

  return null;
}

function normalizeCompletedAt(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = redactSecrets(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized)) return undefined;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return undefined;

  return date.toISOString();
}

function normalizeEvidenceRef(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = redactSecrets(value).trim().slice(0, 180);
  if (!normalized || normalized.includes("[redacted]")) return undefined;
  if (/[?&=]/.test(normalized)) return undefined;

  if (/^docs\/[a-z0-9][a-z0-9._/-]{0,120}(?:#[a-z0-9._-]{1,80})?$/i.test(normalized)) {
    return normalized;
  }

  if (/^github-actions:[0-9]{4,20}$/i.test(normalized)) return normalized;
  if (/^vercel-deploy:[a-z0-9_-]{6,80}$/i.test(normalized)) return normalized;
  if (/^manual-record:[a-z0-9][a-z0-9._:-]{0,80}$/i.test(normalized)) return normalized;

  return undefined;
}

function normalizeMaxAgeDays(value: string | undefined): number {
  if (!value) return DEFAULT_OPS_DRILL_MAX_AGE_DAYS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return DEFAULT_OPS_DRILL_MAX_AGE_DAYS;

  return Math.min(Math.max(parsed, 1), 90);
}
