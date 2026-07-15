import { afterEach, describe, expect, it, vi } from "vitest";
import { storeConciergeFeedback, validateConciergeFeedback, type ConciergeFeedbackV2 } from "./concierge-feedback";

const valid: ConciergeFeedbackV2 = {
  schemaVersion: "concierge-feedback.v2", pseudonymousPartnerId: "partner_a1b2c3d4", sessionOrdinal: 1,
  caseIdOrHash: "a".repeat(64), taskSourceQuality: "linked_issue", prSizeBucket: "small",
  preReportGapCategory: "execution", foundTopGapWithin30s: true, timeToTopGapSeconds: 18,
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

describe("concierge feedback v2", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("accepts bounded metadata", () => expect(validateConciergeFeedback(valid).valid).toBe(true));
  it.each([
    ["unknown field", { ...valid, wouldUseAgain: true }],
    ["removed free-text field", { ...valid, optionalReasonMax200Chars: "raw task fragment" }],
    ["nested raw evidence field", { ...valid, rawEvidence: { diff: "diff --git a/a.ts b/a.ts" } }],
    ["non-opaque partner identifier", { ...valid, pseudonymousPartnerId: "alice123" }],
    ["serialized secret field", { ...valid, metadata: JSON.stringify({ token: "github_pat_abcdefghijklmnopqrstuvwxyz123456" }) }]
  ])("rejects %s", (_name, value) => expect(validateConciergeFeedback(value).valid).toBe(false));
  it("requires an exact bounded store response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("false", { status: 200 })));
    expect(await storeConciergeFeedback("tenant_alpha", valid, durableEnv)).toBe("unavailable");
  });
  it("returns duplicate without creating a mutable retry path", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('"duplicate"', { status: 200 })));
    expect(await storeConciergeFeedback("tenant_alpha", valid, durableEnv)).toBe("duplicate");
  });
});
