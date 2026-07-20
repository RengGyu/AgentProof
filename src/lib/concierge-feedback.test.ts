import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConciergeParticipantCohort, storeConciergeFeedback, validateConciergeFeedback, type ConciergeFeedbackV3 } from "./concierge-feedback";

const valid: ConciergeFeedbackV3 = {
  schemaVersion: "concierge-feedback.v3", participantCohort: "self_internal", privacyNoticeVersion: "human-beta-privacy.v1", pseudonymousPartnerId: "partner_a1b2c3d4", sessionOrdinal: 1,
  caseIdOrHash: "a".repeat(64), taskSourceQuality: "linked_issue", prSizeBucket: "small",
  preReportGapCategory: "execution", topGapOutcome: "found_within_30s", foundTopGapWithin30s: true, timeToTopGapSeconds: 18,
  topGapAgreement: "agree", firstInspectionAction: "check", repromptAction: "copied",
  falseBlocker: false, usefulness: 4, operatorAssisted: true, operatorMinutesBucket: "1_5",
  actualRepeatUseOrdinal: 1, boundedReasonCategory: "useful_gap"
};
const durableEnv = {
  ...process.env,
  AGENTPROOF_CONCIERGE_SUPABASE_URL: "https://example.supabase.co",
  AGENTPROOF_CONCIERGE_SUPABASE_SERVICE_ROLE_KEY: "placeholder",
  AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://example.supabase.co",
  AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "placeholder"
};

describe("concierge feedback v3", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("accepts bounded metadata", () => expect(validateConciergeFeedback(valid).valid).toBe(true));
  it.each([
    ["unknown field", { ...valid, wouldUseAgain: true }],
    ["removed free-text field", { ...valid, optionalReasonMax200Chars: "raw task fragment" }],
    ["nested raw evidence field", { ...valid, rawEvidence: { diff: "diff --git a/a.ts b/a.ts" } }],
    ["non-opaque partner identifier", { ...valid, pseudonymousPartnerId: "alice123" }],
    ["serialized secret field", { ...valid, metadata: JSON.stringify({ token: "github_pat_abcdefghijklmnopqrstuvwxyz123456" }) }]
  ])("rejects %s", (_name, value) => expect(validateConciergeFeedback(value).valid).toBe(false));
  it("distinguishes internal self-test from external reviewer metadata", () => {
    expect(validateConciergeFeedback({ ...valid, participantCohort: "external_reviewer" }).valid).toBe(true);
    expect(validateConciergeFeedback({ ...valid, participantCohort: "friend" }).valid).toBe(false);
  });
  it("represents a zero-gap observation without pretending a timed gap existed", () => {
    expect(validateConciergeFeedback({ ...valid, topGapOutcome: "not_applicable_zero_gap", foundTopGapWithin30s: false, timeToTopGapSeconds: null, repromptAction: "not_used" }).valid).toBe(true);
    expect(validateConciergeFeedback({ ...valid, topGapOutcome: "not_applicable_zero_gap", foundTopGapWithin30s: true, timeToTopGapSeconds: 4 }).valid).toBe(false);
    expect(validateConciergeFeedback({ ...valid, topGapOutcome: "not_applicable_zero_gap", foundTopGapWithin30s: false, timeToTopGapSeconds: null, repromptAction: "copied" }).valid).toBe(false);
    expect(validateConciergeFeedback({ ...valid, topGapOutcome: "found_after_30s", foundTopGapWithin30s: false, timeToTopGapSeconds: 31 }).valid).toBe(true);
  });
  it("derives the reviewer cohort from an operator-controlled tenant allowlist", () => {
    expect(resolveConciergeParticipantCohort("tenant_alpha", {})).toBe("self_internal");
    expect(resolveConciergeParticipantCohort("tenant_alpha", { AGENTPROOF_CONCIERGE_EXTERNAL_REVIEWER_TENANTS: '["tenant_alpha"]' })).toBe("external_reviewer");
    expect(resolveConciergeParticipantCohort("tenant_alpha", { AGENTPROOF_CONCIERGE_EXTERNAL_REVIEWER_TENANTS: "not-json" })).toBeNull();
    expect(resolveConciergeParticipantCohort("tenant_alpha", { AGENTPROOF_CONCIERGE_EXTERNAL_REVIEWER_TENANTS: '["tenant_alpha","tenant_alpha"]' })).toBeNull();
  });
  it("requires an exact bounded store response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("false", { status: 200 })));
    expect(await storeConciergeFeedback("tenant_alpha", valid, durableEnv)).toBe("unavailable");
  });
  it("returns duplicate without creating a mutable retry path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('"duplicate"', { status: 200 })));
    expect(await storeConciergeFeedback("tenant_alpha", valid, durableEnv)).toBe("duplicate");
  });
});
