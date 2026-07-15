import { NextResponse } from "next/server";
import { verifySameOriginMutationRequest } from "@/lib/csrf";
import { storeConciergeFeedback, validateConciergeFeedback } from "@/lib/concierge-feedback";
import { getTenantAccountStoreStatus } from "@/lib/tenant-accounts";
import { getTenantAuthSessionStoreStatus, verifyTenantAuthAccess } from "@/lib/tenant-auth";
import { conciergeRuntimeDefaults } from "@/lib/concierge-private-beta";

export async function POST(request: Request) {
  if (!verifySameOriginMutationRequest(request).ok) return json({ code: "csrf_rejected" }, 403);
  const runtime = conciergeRuntimeDefaults();
  if (!runtime.manualAnalysisEnabled || runtime.globalKillSwitch) return json({ code: runtime.globalKillSwitch ? "global_kill_switch" : "concierge_disabled" }, 503);
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > 5000) return json({ code: "feedback_too_large" }, 413);
  let body: unknown;
  try { body = JSON.parse(text); } catch { return json({ code: "feedback_shape_invalid" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "feedback,tenantId") return json({ code: "feedback_shape_invalid" }, 400);
  const { tenantId, feedback } = body as { tenantId?: unknown; feedback?: unknown };
  if (typeof tenantId !== "string") return json({ code: "feedback_shape_invalid" }, 400);
  if (!getTenantAuthSessionStoreStatus().durable || !getTenantAccountStoreStatus().durable) return json({ code: "durable_store_required" }, 503);
  const access = await verifyTenantAuthAccess({ tenantId, cookieHeader: request.headers.get("cookie") });
  if (!access.authorized) return json({ code: "session_invalid" }, 403);
  const validation = validateConciergeFeedback(feedback);
  if (!validation.valid) return json({ code: validation.code }, 400);
  const result = await storeConciergeFeedback(tenantId, validation.value);
  if (result === "unavailable") return json({ code: "feedback_store_unavailable" }, 503);
  if (result === "rejected") return json({ code: "feedback_not_eligible" }, 409);
  return json({ stored: result === "stored", duplicate: result === "duplicate", privacy: "bounded-metadata-only" });
}

function json(payload: unknown, status = 200) {
  return NextResponse.json(payload, { status, headers: { "Cache-Control": "private, no-store" } });
}
