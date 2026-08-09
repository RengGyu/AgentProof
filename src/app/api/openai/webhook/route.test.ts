import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalysisJobsForTests,
  claimNextAnalysisJob,
  enqueueAnalysisJob,
  getAnalysisJobsForTests,
  parkAnalysisJobForProvider
} from "@/lib/analysis-jobs";
import { POST } from "./route";

const WEBHOOK_SECRET = "test-openai-webhook-secret";

describe("POST /api/openai/webhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearAnalysisJobsForTests();
  });

  it("fails closed when the signing secret is not configured", async () => {
    const response = await POST(signedRequest(responseEvent(), WEBHOOK_SECRET));

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      ok: false,
      code: "openai_webhook_not_configured",
      privacy: "openai-webhook-metadata-only"
    });
  });

  it("rejects tampered and stale signed bodies before queue lookup", async () => {
    stubWebhookEnv();
    const body = responseEvent();
    const tampered = signedRequest(body, WEBHOOK_SECRET, { body: body.replace("completed", "failed") });
    const stale = signedRequest(body, WEBHOOK_SECRET, {
      timestamp: Math.floor(Date.now() / 1000) - 301
    });

    const tamperedResponse = await POST(tampered);
    const staleResponse = await POST(stale);

    expect(tamperedResponse.status).toBe(401);
    expect(staleResponse.status).toBe(401);
    expect(JSON.stringify(await tamperedResponse.json())).not.toContain("resp_private_123");
    expect(JSON.stringify(await staleResponse.json())).not.toContain(WEBHOOK_SECRET);
  });

  it("rejects a correctly signed malformed JSON body", async () => {
    stubWebhookEnv();

    const response = await POST(signedRequest("{not-json", WEBHOOK_SECRET));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "openai_webhook_payload_malformed",
      privacy: "openai-webhook-metadata-only"
    });
  });

  it("rejects a malformed webhook id even when its signature is valid", async () => {
    stubWebhookEnv();

    const response = await POST(signedRequest(responseEvent(), WEBHOOK_SECRET, {
      webhookId: "invalid-delivery-id"
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "openai_webhook_payload_invalid",
      privacy: "openai-webhook-metadata-only"
    });
  });

  it("ignores unsupported verified events without exposing provider metadata", async () => {
    stubWebhookEnv();
    const body = JSON.stringify({
      object: "event",
      id: "evt_private_123",
      created_at: Math.floor(Date.now() / 1000),
      type: "batch.completed",
      data: { id: "batch_private_123" }
    });

    const response = await POST(signedRequest(body, WEBHOOK_SECRET));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      accepted: false,
      status: "ignored_event",
      privacy: "openai-webhook-metadata-only"
    });
    expect(JSON.stringify(payload)).not.toContain("private_123");
  });

  it("treats an unmatched completed response as an idempotent metadata-only no-op", async () => {
    stubWebhookEnv();

    const response = await POST(signedRequest(responseEvent(), WEBHOOK_SECRET));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      accepted: true,
      status: "no_matching_job",
      privacy: "openai-webhook-metadata-only"
    });
    expect(JSON.stringify(payload)).not.toContain("resp_private_123");
    expect(JSON.stringify(payload)).not.toContain("evt_private_123");
  });

  it("does not re-run the same signed delivery before retry backoff", async () => {
    stubWebhookEnv();
    const now = new Date();
    const { id } = await enqueueAnalysisJob({
      tenantId: "tenant_a",
      idempotencyKey: "openai-webhook-route-test",
      deliveryId: "123e4567-e89b-12d3-a456-426614174300",
      event: "pull_request",
      action: "opened",
      installationId: 321,
      repositoryId: 100,
      repositoryFullName: "RengGyu/AgentProof",
      pullRequestNumber: 7,
      pullRequestUrl: "https://github.com/RengGyu/AgentProof/pull/7",
      headSha: "abc123",
      saveReport: false,
      comment: false,
      now
    });
    const initialClaim = await claimNextAnalysisJob({ now });
    await parkAnalysisJobForProvider({
      id,
      claimGeneration: initialClaim.job!.claim_generation!,
      responseId: "resp_route_retry_123",
      providerStatus: "in_progress",
      submittedAt: now,
      expiresAt: new Date(now.getTime() + 8 * 60_000),
      runAfter: new Date(now.getTime() + 15_000),
      now
    });
    const body = responseEvent("resp_route_retry_123");

    const first = await POST(signedRequest(body, WEBHOOK_SECRET));
    const duplicate = await POST(signedRequest(body, WEBHOOK_SECRET));
    const stored = getAnalysisJobsForTests()[0];

    expect(first.status).toBe(503);
    expect(duplicate.status).toBe(503);
    expect(await duplicate.json()).toMatchObject({ status: "retry_required" });
    expect(stored).toMatchObject({
      status: "failed_retryable",
      attempts: 1,
      provider_response_id: "resp_route_retry_123",
      provider_webhook_id_hash: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(JSON.stringify(stored)).not.toContain("wh_private_123");
  });

  it("rejects an oversized body before signature processing", async () => {
    stubWebhookEnv();
    const body = "x".repeat(70_000);

    const response = await POST(signedRequest(body, WEBHOOK_SECRET));

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      ok: false,
      code: "openai_webhook_payload_too_large",
      privacy: "openai-webhook-metadata-only"
    });
  });
});

function stubWebhookEnv() {
  vi.stubEnv("OPENAI_WEBHOOK_SECRET", WEBHOOK_SECRET);
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
}

function responseEvent(responseId = "resp_private_123") {
  return JSON.stringify({
    object: "event",
    id: "evt_private_123",
    created_at: Math.floor(Date.now() / 1000),
    type: "response.completed",
    data: { id: responseId }
  });
}

function signedRequest(
  signedBody: string,
  secret: string,
  options: { body?: string; timestamp?: number; webhookId?: string } = {}
) {
  const webhookId = options.webhookId ?? "wh_private_123";
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret)
    .update(`${webhookId}.${timestamp}.${signedBody}`)
    .digest("base64");

  return new Request("http://localhost/api/openai/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": `v1,${signature}`
    },
    body: options.body ?? signedBody
  });
}
