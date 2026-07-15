export const CONCIERGE_FEEDBACK_VERSION = "concierge-feedback.v2" as const;
import { getConciergeStoreConfigurationStatus } from "./concierge-store-configuration";

export interface ConciergeFeedbackV2 {
  schemaVersion: typeof CONCIERGE_FEEDBACK_VERSION;
  pseudonymousPartnerId: string;
  sessionOrdinal: number;
  caseIdOrHash: string;
  taskSourceQuality: "explicit_task" | "linked_issue" | "unavailable" | "ambiguous";
  prSizeBucket: "small" | "medium" | "large";
  preReportGapCategory: "implementation" | "targeted_test" | "execution" | "requirement" | "evidence_unavailable" | "none";
  foundTopGapWithin30s: boolean;
  timeToTopGapSeconds: number | null;
  topGapAgreement: "agree" | "partly" | "disagree" | "unclear";
  firstInspectionAction: "file" | "check" | "requirement" | "none";
  repromptAction: "copied" | "edited" | "sent" | "not_used";
  falseBlocker: boolean | null;
  usefulness: 1 | 2 | 3 | 4 | 5;
  operatorAssisted: boolean;
  operatorMinutesBucket: "0" | "1_5" | "6_15" | "16_plus";
  actualRepeatUseOrdinal: number;
  boundedReasonCategory: "useful_gap" | "wrong_gap" | "missing_context" | "navigation" | "reprompt" | "other";
}

const EXACT_KEYS = [
  "actualRepeatUseOrdinal", "boundedReasonCategory", "caseIdOrHash", "falseBlocker",
  "firstInspectionAction", "foundTopGapWithin30s", "operatorAssisted", "operatorMinutesBucket",
  "preReportGapCategory", "prSizeBucket", "pseudonymousPartnerId",
  "repromptAction", "schemaVersion", "sessionOrdinal", "taskSourceQuality", "timeToTopGapSeconds",
  "topGapAgreement", "usefulness"
];
const RAW_PATTERN = /(?:^|\n)diff --git |(?:^|\n)@@ -\d|(?:^|\n)(?:stdout|stderr|prompt|system|assistant|user):|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{12,}|glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:token|secret|password|authorization)\s*[:=]\s*["']?[A-Za-z0-9_./+:-]{12,}/i;
const MULTILINE_LOG_PATTERN = /(?:^|\n)(?:\d{4}-\d{2}-\d{2}[T ][^\n]{1,80}|\[[^\n]{1,40}\]\s*(?:error|warn|info|debug))[^\n]*(?:\n)(?:\d{4}-\d{2}-\d{2}[T ][^\n]{1,80}|\[[^\n]{1,40}\]\s*(?:error|warn|info|debug))/i;

export function validateConciergeFeedback(value: unknown): { valid: true; value: ConciergeFeedbackV2 } | { valid: false; code: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, code: "feedback_shape_invalid" };
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = EXACT_KEYS.slice().sort();
  if (keys.join("\0") !== expected.join("\0")) return { valid: false, code: "feedback_fields_invalid" };
  if (containsUnsafeString(record, 0)) return { valid: false, code: "feedback_privacy_rejected" };
  if (record.schemaVersion !== CONCIERGE_FEEDBACK_VERSION) return { valid: false, code: "feedback_version_invalid" };
  if (!isOpaquePartnerId(record.pseudonymousPartnerId) || !isHashOrId(record.caseIdOrHash)) return { valid: false, code: "feedback_identity_invalid" };
  if (!integer(record.sessionOrdinal, 1, 10000) || !integer(record.actualRepeatUseOrdinal, 1, 10000)) return { valid: false, code: "feedback_ordinal_invalid" };
  if (!oneOf(record.taskSourceQuality, ["explicit_task", "linked_issue", "unavailable", "ambiguous"])) return { valid: false, code: "feedback_task_source_invalid" };
  if (!oneOf(record.prSizeBucket, ["small", "medium", "large"]) || !oneOf(record.preReportGapCategory, ["implementation", "targeted_test", "execution", "requirement", "evidence_unavailable", "none"])) return { valid: false, code: "feedback_bucket_invalid" };
  if (typeof record.foundTopGapWithin30s !== "boolean" || (record.timeToTopGapSeconds !== null && !integer(record.timeToTopGapSeconds, 0, 3600))) return { valid: false, code: "feedback_timing_invalid" };
  if (!oneOf(record.topGapAgreement, ["agree", "partly", "disagree", "unclear"]) || !oneOf(record.firstInspectionAction, ["file", "check", "requirement", "none"])) return { valid: false, code: "feedback_action_invalid" };
  if (!oneOf(record.repromptAction, ["copied", "edited", "sent", "not_used"]) || (record.falseBlocker !== null && typeof record.falseBlocker !== "boolean")) return { valid: false, code: "feedback_action_invalid" };
  if (!integer(record.usefulness, 1, 5) || typeof record.operatorAssisted !== "boolean" || !oneOf(record.operatorMinutesBucket, ["0", "1_5", "6_15", "16_plus"])) return { valid: false, code: "feedback_rating_invalid" };
  if (!oneOf(record.boundedReasonCategory, ["useful_gap", "wrong_gap", "missing_context", "navigation", "reprompt", "other"])) return { valid: false, code: "feedback_reason_invalid" };
  return { valid: true, value: record as unknown as ConciergeFeedbackV2 };
}

export type ConciergeFeedbackStoreResult = "stored" | "duplicate" | "rejected" | "unavailable";

export async function storeConciergeFeedback(tenantId: string, feedback: ConciergeFeedbackV2, env = process.env): Promise<ConciergeFeedbackStoreResult> {
  const configuration = getConciergeStoreConfigurationStatus(env);
  if (!configuration.configured || !configuration.consistent) return "unavailable";
  const url = env.AGENTPROOF_CONCIERGE_SUPABASE_URL?.trim();
  const key = env.AGENTPROOF_CONCIERGE_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || !/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(tenantId)) return "unavailable";
  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/agentproof_record_concierge_feedback`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ p_tenant_id: tenantId, p_feedback: {
        schema_version: feedback.schemaVersion,
        partner_id: feedback.pseudonymousPartnerId,
        session_ordinal: feedback.sessionOrdinal,
        case_id_or_hash: feedback.caseIdOrHash,
        task_source_quality: feedback.taskSourceQuality,
        pr_size_bucket: feedback.prSizeBucket,
        pre_report_gap_category: feedback.preReportGapCategory,
        found_top_gap_within_30s: feedback.foundTopGapWithin30s,
        time_to_top_gap_seconds: feedback.timeToTopGapSeconds,
        top_gap_agreement: feedback.topGapAgreement,
        first_inspection_action: feedback.firstInspectionAction,
        reprompt_action: feedback.repromptAction,
        false_blocker: feedback.falseBlocker,
        usefulness: feedback.usefulness,
        operator_assisted: feedback.operatorAssisted,
        operator_minutes_bucket: feedback.operatorMinutesBucket,
        actual_repeat_use_ordinal: feedback.actualRepeatUseOrdinal,
        bounded_reason_category: feedback.boundedReasonCategory
      } }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return "unavailable";
    const result = await response.json().catch(() => null);
    return result === "stored" || result === "duplicate" || result === "rejected" ? result : "unavailable";
  } catch { return "unavailable"; }
}

function containsUnsafeString(value: unknown, depth: number): boolean {
  if (depth > 3) return true;
  if (typeof value === "string") {
    const normalized = value.normalize("NFKC").replace(/\r\n?/g, "\n");
    if (RAW_PATTERN.test(normalized) || MULTILINE_LOG_PATTERN.test(normalized)) return true;
    const trimmed = normalized.trim();
    if ((trimmed.startsWith("{") || trimmed.startsWith("[") || trimmed.startsWith('"')) && trimmed.length <= 2000) {
      try { return containsUnsafeString(JSON.parse(trimmed), depth + 1); } catch { return false; }
    }
    return false;
  }
  if (Array.isArray(value)) return value.some((item) => containsUnsafeString(item, depth + 1));
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some((item) => containsUnsafeString(item, depth + 1));
  return false;
}

function isOpaquePartnerId(value: unknown) { return typeof value === "string" && /^partner_[a-f0-9]{8,55}$/i.test(value); }
function isHashOrId(value: unknown) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function integer(value: unknown, min: number, max: number) { return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max; }
function oneOf(value: unknown, allowed: readonly unknown[]) { return allowed.includes(value); }
