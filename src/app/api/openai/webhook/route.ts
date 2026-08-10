import OpenAI from "openai";
import {
  AnalysisJobQueueError,
  claimAnalysisJobForProviderResponse
} from "@/lib/analysis-jobs";
import { runClaimedAnalysisJob } from "@/lib/analysis-worker";
import { noStoreJson, utf8ByteLength } from "@/lib/http";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_OPENAI_WEBHOOK_REQUEST_BYTES = 64_000;
const OPENAI_WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;
const OPENAI_WEBHOOK_CLAIM_LEASE_MS = 150_000;
const RESPONSE_EVENT_TYPES = new Set([
  "response.completed",
  "response.failed",
  "response.incomplete",
  "response.cancelled"
]);
const RESPONSE_ID_PATTERN = /^resp_[A-Za-z0-9_-]{1,180}$/;
const WEBHOOK_ID_PATTERN = /^wh_[A-Za-z0-9_-]{1,180}$/;
const PRIVACY = "openai-webhook-metadata-only" as const;

export async function POST(request: Request) {
  const webhookSecret = process.env.OPENAI_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    return noStoreJson({
      ok: false,
      code: "openai_webhook_not_configured",
      privacy: PRIVACY
    }, { status: 501 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_OPENAI_WEBHOOK_REQUEST_BYTES) {
    return payloadTooLarge();
  }

  const rawBody = await request.text();
  if (utf8ByteLength(rawBody) > MAX_OPENAI_WEBHOOK_REQUEST_BYTES) {
    return payloadTooLarge();
  }

  let event: Awaited<ReturnType<OpenAI["webhooks"]["unwrap"]>>;
  try {
    const client = new OpenAI({
      apiKey: "openai-webhook-verification-only",
      webhookSecret
    });
    event = await client.webhooks.unwrap(
      rawBody,
      request.headers,
      webhookSecret,
      OPENAI_WEBHOOK_SIGNATURE_TOLERANCE_SECONDS
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      return noStoreJson({
        ok: false,
        code: "openai_webhook_payload_malformed",
        privacy: PRIVACY
      }, { status: 400 });
    }

    return noStoreJson({
      ok: false,
      code: "openai_webhook_signature_invalid",
      privacy: PRIVACY
    }, { status: 401 });
  }

  if (!RESPONSE_EVENT_TYPES.has(event.type)) {
    return noStoreJson({
      ok: true,
      accepted: false,
      status: "ignored_event",
      privacy: PRIVACY
    });
  }

  const responseId = getResponseId(event);
  if (!responseId) {
    return noStoreJson({
      ok: false,
      code: "openai_webhook_payload_invalid",
      privacy: PRIVACY
    }, { status: 400 });
  }
  const webhookId = request.headers.get("webhook-id");
  if (!webhookId || !WEBHOOK_ID_PATTERN.test(webhookId)) {
    return noStoreJson({
      ok: false,
      code: "openai_webhook_payload_invalid",
      privacy: PRIVACY
    }, { status: 400 });
  }

  try {
    const claim = await claimAnalysisJobForProviderResponse(responseId, {
      webhookId,
      leaseMs: OPENAI_WEBHOOK_CLAIM_LEASE_MS
    });
    if (!claim.job) {
      if (claim.disposition === "backoff" || claim.disposition === "busy") {
        return noStoreJson({
          ok: false,
          accepted: true,
          status: "retry_required",
          privacy: PRIVACY
        }, { status: 503 });
      }
      return noStoreJson({
        ok: true,
        accepted: true,
        status: "no_matching_job",
        privacy: PRIVACY
      });
    }

    const result = await runClaimedAnalysisJob(claim.job, { requestUrl: request.url });
    if (result.status === "failed_retryable" || result.status === "waiting_provider") {
      return noStoreJson({
        ok: false,
        accepted: true,
        status: "retry_required",
        privacy: PRIVACY
      }, { status: 503 });
    }

    return noStoreJson({
      ok: true,
      accepted: true,
      status: result.status === "completed" ? "completed" : "terminal",
      privacy: PRIVACY
    });
  } catch (error) {
    if (error instanceof AnalysisJobQueueError) {
      return noStoreJson({
        ok: false,
        accepted: false,
        status: "queue_unavailable",
        privacy: PRIVACY
      }, { status: 503 });
    }

    return noStoreJson({
      ok: false,
      accepted: true,
      status: "retry_required",
      privacy: PRIVACY
    }, { status: 503 });
  }
}

function getResponseId(event: { data?: unknown }): string | null {
  if (!event.data || typeof event.data !== "object" || Array.isArray(event.data)) return null;
  const id = (event.data as { id?: unknown }).id;
  return typeof id === "string" && RESPONSE_ID_PATTERN.test(id) ? id : null;
}

function payloadTooLarge() {
  return noStoreJson({
    ok: false,
    code: "openai_webhook_payload_too_large",
    privacy: PRIVACY
  }, { status: 413 });
}
