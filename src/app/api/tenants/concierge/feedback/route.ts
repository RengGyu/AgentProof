import { NextResponse } from "next/server";
import { verifySameOriginMutationRequest } from "@/lib/csrf";
import { resolveConciergeParticipantCohort, storeConciergeFeedback, validateConciergeFeedback } from "@/lib/concierge-feedback";
import { getTenantAccountStoreStatus } from "@/lib/tenant-accounts";
import { getTenantAuthSessionStoreStatus } from "@/lib/tenant-auth";
import { conciergeRuntimeDefaults } from "@/lib/concierge-private-beta";
import { pseudonymousConciergePartnerId, readConciergeGitHubSession } from "@/lib/concierge-github-auth";

export async function POST(request: Request) {
  if (!verifySameOriginMutationRequest(request).ok) return json({ code: "csrf_rejected" }, 403);
  const runtime = conciergeRuntimeDefaults();
  if (!runtime.manualAnalysisEnabled || runtime.globalKillSwitch) return json({ code: runtime.globalKillSwitch ? "global_kill_switch" : "concierge_disabled" }, 503);
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 5000) return json({ code: "feedback_too_large" }, 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ code: "feedback_shape_invalid" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "feedback") return json({ code: "feedback_shape_invalid" }, 400);
  const { feedback } = body as { feedback?: unknown };
  if (!getTenantAuthSessionStoreStatus().durable || !getTenantAccountStoreStatus().durable) return json({ code: "durable_store_required" }, 503);
  let session;
  try {
    session = await readConciergeGitHubSession(request.headers.get("cookie"));
  } catch {
    // A failed durable re-authorization must never become a feedback write.
    return json({ code: "authorization_unavailable" }, 503);
  }
  if (!session) return json({ code: "session_invalid" }, 403);
  if (!feedback || typeof feedback !== "object" || Array.isArray(feedback) || "participantCohort" in feedback || "pseudonymousPartnerId" in feedback) return json({ code: "feedback_fields_invalid" }, 400);
  const participantCohort = resolveConciergeParticipantCohort(session.tenantId);
  if (!participantCohort) return json({ code: "feedback_cohort_configuration_invalid" }, 503);
  const pseudonymousPartnerId = pseudonymousConciergePartnerId(session);
  if (!pseudonymousPartnerId) return json({ code: "feedback_pseudonym_unavailable" }, 503);
  const validation = validateConciergeFeedback({ ...(feedback as Record<string, unknown>), pseudonymousPartnerId, participantCohort });
  if (!validation.valid) return json({ code: validation.code }, 400);
  const result = await storeConciergeFeedback(session.tenantId, validation.value);
  if (result === "unavailable") return json({ code: "feedback_store_unavailable" }, 503);
  if (result === "rejected") return json({ code: "feedback_not_eligible" }, 409);
  return json({ stored: result === "stored", duplicate: result === "duplicate", privacy: "bounded-metadata-only" });
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}
