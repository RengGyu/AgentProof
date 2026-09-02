import { generateKeyPairSync } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearAnalysisJobsForTests,
  claimAnalysisJobForProviderResponse,
  claimNextAnalysisJob,
  enqueueAnalysisJob,
  getAnalysisJobsForTests,
  sealAnalysisJobRevision
} from "./analysis-jobs";
import { clearAuditEventsForTests, getAuditEventsForTests } from "./audit-log";
import { clearSavedReportsForTests, countTenantSavedReports, getSavedReport, listTenantSavedReports } from "./server-report-store";
import { preflightNextAnalysisJob, runAnalysisJobBatch, runClaimedAnalysisJob, runNextAnalysisJob } from "./analysis-worker";
import {
  clearTenantRepositoryGrantsForTests,
  createTenantRepositoryGrant,
  updateTenantRepositoryGrantSettings
} from "./tenant-control-plane";
import {
  clearTenantDeletionStateForTests,
  markTenantDeletionStartedIfConfigured
} from "./tenant-deletion-state";
import { clearUsageQuotaForTests } from "./usage-quota";
import { clearBillingWebhookEventsForTests } from "./billing-beta";
import * as generalPrObservationService from "./general-pr-observation-service";

describe("analysis worker preflight", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearAnalysisJobsForTests();
    clearTenantRepositoryGrantsForTests();
    clearSavedReportsForTests();
    clearAuditEventsForTests();
    clearUsageQuotaForTests();
    clearBillingWebhookEventsForTests();
    clearTenantDeletionStateForTests();
  });

  it("returns idle when no queued job is due", async () => {
    stubQueueEnv();

    await expect(preflightNextAnalysisJob({ now: new Date("2026-06-30T00:00:00Z") })).resolves.toEqual({
      status: "idle"
    });
  });

  it("fails retryable before grant lookup when GitHub App credentials are not ready", async () => {
    stubQueueEnv();
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_PRIVATE_KEY", "sha256=not-a-private-key");
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret");
    await enqueueAnalysisJob(jobInput());

    const result = await preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });

    expect(result).toEqual({
      status: "failed_retryable",
      reason: "github_app_not_ready"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_retryable",
      error_code: "github_app_not_ready",
      locked_at: null
    });
  });

  it("fails terminal before token fetch when a grant is disabled after enqueue", async () => {
    stubQueueEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput());
    stubReadyWorkerEnv({ grant: { enabled: false } });

    const result = await preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    const serialized = JSON.stringify({ result, jobs: getAnalysisJobsForTests() });

    expect(result).toEqual({
      status: "failed_terminal",
      reason: "grant-disabled"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_terminal",
      error_code: "grant-disabled",
      locked_at: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("raw");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("fails terminal before token fetch when analysis is disabled after enqueue", async () => {
    stubQueueEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput());
    stubReadyWorkerEnv({ grant: { analysisEnabled: false } });

    const result = await preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });

    expect(result).toEqual({
      status: "failed_terminal",
      reason: "analysis-disabled"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_terminal",
      error_code: "analysis-disabled",
      locked_at: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails terminal before token fetch when the queued repository has no active tenant grant", async () => {
    stubQueueEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput());
    stubReadyWorkerEnv({ grant: { repositoryFullName: "RengGyu/OtherRepo", repositoryId: 101 } });

    const result = await preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });

    expect(result).toEqual({
      status: "failed_terminal",
      reason: "grant-missing"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_terminal",
      error_code: "grant-missing",
      locked_at: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails retryable before token fetch when the tenant grant store is unavailable", async () => {
    stubQueueEnv();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput());
    stubReadyWorkerEnv({ grant: null });
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_SUPABASE_URL", "https://agentproof-test.supabase.co");

    const result = await preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });

    expect(result).toEqual({
      status: "failed_retryable",
      reason: "github_app_tenant_grant_store_unavailable"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_retryable",
      error_code: "github_app_tenant_grant_store_unavailable",
      locked_at: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails terminal before token fetch when provider billing is inactive", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: true, commentEnabled: true } });
    vi.stubEnv("AGENTPROOF_BILLING_BETA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_BILLING_BETA_SUBSCRIPTIONS", billingSubscriptionsJson({
      subscriptionStatus: "past_due"
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true }));

    const result = await preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    const serialized = JSON.stringify({ result, jobs: getAnalysisJobsForTests() });

    expect(result).toEqual({
      status: "failed_terminal",
      reason: "github_app_billing_subscription_blocked"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_terminal",
      error_code: "github_app_billing_subscription_blocked",
      locked_at: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("cus_secret");
    expect(serialized).not.toContain("sub_secret");
    expect(serialized).not.toContain("price_secret");
    expect(serialized).not.toContain("installation-token");
  });

  it("returns ready and clamps queued side effects to the current tenant grant", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: true, commentEnabled: false } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true }));

    const result = await preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      status: "ready",
      job: {
        id,
        status: "processing",
        repository_full_name: "RengGyu/AgentProof",
        pull_request_number: 7
      },
      sideEffects: {
        saveReport: true,
        comment: false
      },
      llmAnalysisMode: "essential"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "processing",
      attempts: 1
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("service-role");
  });

  it("carries an enhanced repository choice from preflight into worker execution", async () => {
    stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced" } });
    await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    await expect(preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") })).resolves.toMatchObject({
      status: "ready",
      llmAnalysisMode: "enhanced"
    });
  });

  it("parks one missing-only retry, resumes from prior and active ids, and completes without a third POST", async () => {
    stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced", saveReportsEnabled: false, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-test");
    const githubFetch = mockSemanticRetryWorkerFetch();
    let firstCandidate: unknown;
    let retryCandidate: unknown;
    let requirementIds: string[] = [];
    const firstFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://api.openai.com/v1/responses") {
        const body = JSON.parse(String(init?.body));
        const semanticInput = JSON.parse(body.input[1].content[0].text);
        requirementIds = semanticInput.requirements.map((requirement: { id: string }) => requirement.id);
        firstCandidate = validSemanticCandidateForInput(semanticInput);
        return Response.json({ id: "resp_background_123", status: "queued", output: [] });
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", firstFetch);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    const submitted = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(submitted).toMatchObject({ status: "waiting_provider", job: { id } });
    expect(requirementIds.length).toBeGreaterThan(1);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "queued",
      provider_response_id: "resp_background_123",
      provider_status: "queued",
      provider_poll_attempts: 1
    });
    expect(JSON.stringify(submitted)).not.toContain("resp_background_123");
    expect(JSON.stringify(submitted)).not.toContain("test-openai-key");

    const secondGithubFetch = mockSemanticRetryWorkerFetch();
    const secondFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://api.openai.com/v1/responses/resp_background_123") {
        return Response.json({
          id: "resp_background_123",
          status: "completed",
          output_text: JSON.stringify(firstCandidate)
        });
      }
      if (String(url) === "https://api.openai.com/v1/responses" && init?.method === "POST") {
        const body = JSON.parse(String(init.body));
        const semanticInput = JSON.parse(body.input[1].content[0].text);
        expect(semanticInput.requirements.map((requirement: { id: string }) => requirement.id)).toEqual(requirementIds.slice(1));
        retryCandidate = validSemanticCandidateForInput(semanticInput);
        return Response.json({ id: "resp_background_retry_123", status: "queued", output: [] });
      }
      return secondGithubFetch(url, init);
    });
    vi.stubGlobal("fetch", secondFetch);

    const webhookClaim = await claimAnalysisJobForProviderResponse("resp_background_123", {
      now: new Date("2026-06-30T00:01:20Z"),
      webhookId: "wh_background_123"
    });
    const retrySubmitted = await runClaimedAnalysisJob(webhookClaim.job!, {
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:20Z")
    });

    expect(retrySubmitted).toMatchObject({ status: "waiting_provider", job: { id } });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "queued",
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_background_123",
      provider_response_id: "resp_background_retry_123",
      provider_status: "queued"
    });
    const thirdGithubFetch = mockSemanticRetryWorkerFetch();
    const thirdFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://api.openai.com/v1/responses/resp_background_123") {
        return Response.json({
          id: "resp_background_123",
          status: "completed",
          output_text: JSON.stringify(firstCandidate)
        });
      }
      if (String(url) === "https://api.openai.com/v1/responses/resp_background_retry_123") {
        return Response.json({
          id: "resp_background_retry_123",
          status: "completed",
          output_text: JSON.stringify(retryCandidate)
        });
      }
      return thirdGithubFetch(url, init);
    });
    vi.stubGlobal("fetch", thirdFetch);
    const retryWebhookClaim = await claimAnalysisJobForProviderResponse("resp_background_retry_123", {
      now: new Date("2026-06-30T00:01:40Z"),
      webhookId: "wh_background_retry_123"
    });
    const completed = await runClaimedAnalysisJob(retryWebhookClaim.job!, {
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:40Z")
    });

    expect(completed).toMatchObject({ status: "completed", job: { id } });
    expect(thirdFetch.mock.calls.some(([url, init]) =>
      String(url) === "https://api.openai.com/v1/responses" && init?.method === "POST"
    )).toBe(false);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "completed",
      semantic_retry_attempts: 0,
      prior_provider_response_id: null,
      prior_provider_submitted_at: null,
      prior_provider_expires_at: null,
      provider_response_id: null,
      provider_status: null,
      provider_poll_attempts: 0,
      provider_submitted_at: null,
      provider_expires_at: null,
      provider_webhook_id_hash: null,
      provider_webhook_received_at: null
    });
    expect(getAuditEventsForTests().at(-1)?.metadata).toMatchObject({
      semanticDiagnostics: {
        inputRequirementCount: requirementIds.length,
        assessedRequirementCount: 2,
        missingRequirementCount: requirementIds.length - 2,
        rawSectionCounts: {
          requirement_assessments: 2
        },
        acceptedSectionCounts: {
          requirement_assessments: 2
        },
        rejectedSectionCounts: {
          requirement_assessments: 0
        },
        rejectedReasonCodeCounts: {
          invalid_unit_shape: 0,
          unknown_requirement_reference: 0
        },
        discardReasonCodeCounts: {
          root_schema_invalid: 0,
          secret_detected: 0,
          raw_content_detected: 0
        },
        retryAttempted: true,
        retryOutcome: "incomplete"
      }
    });
  });

  it("finishes deterministic-unavailable when both semantic coverage candidates are fully filtered", async () => {
    stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced", saveReportsEnabled: true, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    const githubFetch = mockSemanticRetryWorkerFetch();
    let firstCandidate: unknown;
    let retryCandidate: unknown;
    let responsePostCount = 0;
    const filteredCandidate = (input: { requirements: Array<{ id: string; evidence_ids: string[] }> }) => {
      const candidate = validSemanticCandidateForInput(input) as ReturnType<typeof validSemanticCandidate>;
      candidate.requirement_evidence_relations[0]!.rationale = "The implementation is correct.";
      candidate.requirement_assessments[0]!.summary = "The implementation is correct.";
      return candidate;
    };
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://api.openai.com/v1/responses" && init?.method === "POST") {
        responsePostCount += 1;
        const body = JSON.parse(String(init.body));
        const semanticInput = JSON.parse(body.input[1].content[0].text);
        if (responsePostCount === 1) {
          firstCandidate = filteredCandidate(semanticInput);
          return Response.json({ id: "resp_filtered_first_123", status: "queued", output: [] });
        }
        retryCandidate = filteredCandidate(semanticInput);
        return Response.json({ id: "resp_filtered_retry_123", status: "queued", output: [] });
      }
      if (href === "https://api.openai.com/v1/responses/resp_filtered_first_123") {
        return Response.json({ id: "resp_filtered_first_123", status: "completed", output_text: JSON.stringify(firstCandidate) });
      }
      if (href === "https://api.openai.com/v1/responses/resp_filtered_retry_123") {
        return Response.json({ id: "resp_filtered_retry_123", status: "completed", output_text: JSON.stringify(retryCandidate) });
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: false }));

    await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:15Z")
    });
    const completed = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:30Z")
    });
    const savedSummary = (await listTenantSavedReports({ tenantId: "tenant_a", limit: 1 }))[0]!;
    const saved = await getSavedReport(savedSummary.id, { tenantId: "tenant_a" });

    expect(completed).toMatchObject({ status: "completed", job: { id } });
    expect(responsePostCount).toBe(2);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "completed",
      error_code: null,
      provider_response_id: null,
      prior_provider_response_id: null
    });
    expect(saved?.report).toMatchObject({ semanticAnalysis: { status: "unavailable", attempts: 2 } });
    expect(saved?.report.semantic).toBeUndefined();
  });

  it("recovers an expired processing continuation before lease and completes without another provider call", async () => {
    stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced", saveReportsEnabled: false, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const githubFetch = mockSemanticRetryWorkerFetch();
    let responsePostCount = 0;
    let responseRetrieveCount = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://api.openai.com/v1/responses" && init?.method === "POST") {
        responsePostCount += 1;
        return Response.json({ id: "resp_expired_processing_123", status: "queued", output: [] });
      }
      if (href === "https://api.openai.com/v1/responses/resp_expired_processing_123") {
        responseRetrieveCount += 1;
        return Response.json({ id: "resp_expired_processing_123", status: "queued", output: [] });
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    const submitted = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const stored = getAnalysisJobsForTests()[0];
    Object.assign(stored, {
      status: "processing",
      attempts: 1,
      desired_revision: 1,
      running_revision: 1,
      claim_generation: "123e4567-e89b-42d3-a456-426614174390",
      updated_at: "2026-06-30T00:02:00.000Z",
      locked_at: "2026-06-30T00:02:00.000Z",
      run_after: "2026-06-30T00:01:15.000Z"
    });

    const recovered = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:09:01Z"),
      leaseMs: 10 * 60 * 1000
    });

    expect(submitted).toMatchObject({ status: "waiting_provider", job: { id } });
    expect(recovered).toMatchObject({ status: "completed", job: { id } });
    expect(responsePostCount).toBe(1);
    expect(responseRetrieveCount).toBe(0);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "completed",
      semantic_retry_attempts: 0,
      prior_provider_response_id: null,
      prior_provider_submitted_at: null,
      prior_provider_expires_at: null,
      provider_response_id: null,
      provider_status: null,
      provider_poll_attempts: 0,
      provider_submitted_at: null,
      provider_expires_at: null,
      provider_webhook_id_hash: null,
      provider_webhook_received_at: null
    });
  });

  it("recovers the first validated response after a crash leaves retry submission uncertain", async () => {
    stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced", saveReportsEnabled: false, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const githubFetch = mockSemanticRetryWorkerFetch();
    let firstCandidate: unknown;
    let retryPostCount = 0;
    const firstFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://api.openai.com/v1/responses") {
        const body = JSON.parse(String(init?.body));
        const semanticInput = JSON.parse(body.input[1].content[0].text);
        firstCandidate = validSemanticCandidateForInput(semanticInput);
        return Response.json({ id: "resp_background_crash_first_123", status: "queued", output: [] });
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", firstFetch);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));
    await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const firstClaim = await claimAnalysisJobForProviderResponse("resp_background_crash_first_123", {
      now: new Date("2026-06-30T00:01:20Z"),
      webhookId: "wh_background_crash_first_123"
    });
    let releaseRetryPost!: (response: Response) => void;
    let signalRetryPostStarted!: () => void;
    const retryPostStarted = new Promise<void>((resolve) => {
      signalRetryPostStarted = resolve;
    });
    const abandonedGithubFetch = mockSemanticRetryWorkerFetch();
    const abandonedFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://api.openai.com/v1/responses/resp_background_crash_first_123") {
        return Response.json({
          id: "resp_background_crash_first_123",
          status: "completed",
          output_text: JSON.stringify(firstCandidate)
        });
      }
      if (String(url) === "https://api.openai.com/v1/responses" && init?.method === "POST") {
        retryPostCount += 1;
        signalRetryPostStarted();
        return new Promise<Response>((resolve) => {
          releaseRetryPost = resolve;
        });
      }
      return abandonedGithubFetch(url, init);
    });
    vi.stubGlobal("fetch", abandonedFetch);

    const abandonedRun = runClaimedAnalysisJob(firstClaim.job!, {
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:20Z")
    });
    await retryPostStarted;

    const tooEarly = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:49.999Z") });
    const reclaimed = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:50.001Z") });
    expect(tooEarly.job).toBeNull();
    expect(reclaimed.job).toMatchObject({
      id,
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_background_crash_first_123",
      provider_response_id: null,
      provider_status: "in_progress"
    });
    expect(reclaimed.job!.claim_generation).not.toBe(firstClaim.job!.claim_generation);
    const secondRecoveryClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:02:20.002Z") });
    expect(secondRecoveryClaim.job).toBeNull();

    const resumedGithubFetch = mockSemanticRetryWorkerFetch();
    const resumedFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://api.openai.com/v1/responses/resp_background_crash_first_123") {
        return Response.json({
          id: "resp_background_crash_first_123",
          status: "completed",
          output_text: JSON.stringify(firstCandidate)
        });
      }
      return resumedGithubFetch(url, init);
    });
    vi.stubGlobal("fetch", resumedFetch);

    const result = await runClaimedAnalysisJob(reclaimed.job!, {
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:50.001Z")
    });
    releaseRetryPost(Response.json({ id: "resp_orphaned_retry_123", status: "queued", output: [] }));
    const abandonedResult = await abandonedRun;

    expect(result).toMatchObject({ status: "completed", job: { id } });
    expect(abandonedResult).toMatchObject({ status: "failed_retryable", reason: "analysis_job_claim_lost" });
    expect(retryPostCount).toBe(1);
    expect(resumedFetch.mock.calls.some(([url, init]) =>
      String(url) === "https://api.openai.com/v1/responses" && init?.method === "POST"
    )).toBe(false);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "completed",
      semantic_retry_attempts: 0,
      prior_provider_response_id: null,
      provider_response_id: null
    });
    expect(getAuditEventsForTests().at(-1)?.metadata).toMatchObject({
      semanticDiagnostics: {
        retryAttempted: true,
        retryOutcome: "submission_uncertain"
      }
    });
  });

  it.each(["completed", "error"] as const)(
    "stops a reclaimed retry claimant before save, comment, or Slack when its POST returns %s",
    async (settledAs) => {
      stubReadyWorkerEnv({
        grant: {
          llmAnalysisMode: "enhanced",
          saveReportsEnabled: true,
          commentEnabled: true,
          slackNotificationsEnabled: true
        }
      });
      vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
      vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
      vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
      vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
      const githubFetch = mockSemanticRetryWorkerFetch();
      let firstCandidate: unknown;
      let retryCandidate: unknown;
      let responsePostCount = 0;
      let releaseRetryPost!: (response: Response) => void;
      let signalRetryPostStarted!: () => void;
      const retryPostStarted = new Promise<void>((resolve) => {
        signalRetryPostStarted = resolve;
      });
      const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href === "https://api.openai.com/v1/responses" && init?.method === "POST") {
          responsePostCount += 1;
          const body = JSON.parse(String(init.body));
          const semanticInput = JSON.parse(body.input[1].content[0].text);
          if (responsePostCount === 1) {
            firstCandidate = validSemanticCandidateForInput(semanticInput);
            return Response.json({ id: "resp_side_effect_first_123", status: "queued", output: [] });
          }
          retryCandidate = validSemanticCandidateForInput(semanticInput);
          signalRetryPostStarted();
          return new Promise<Response>((resolve) => {
            releaseRetryPost = resolve;
          });
        }
        if (href === "https://api.openai.com/v1/responses/resp_side_effect_first_123") {
          return Response.json({
            id: "resp_side_effect_first_123",
            status: "completed",
            output_text: JSON.stringify(firstCandidate)
          });
        }
        if (href === "https://hooks.slack.com/services/T/B/C") {
          return Response.json({ ok: true });
        }
        return githubFetch(url, init);
      });
      vi.stubGlobal("fetch", fetchMock);
      const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true, slackSummary: true }));

      await runNextAnalysisJob({
        requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
        now: new Date("2026-06-30T00:01:00Z")
      });
      const firstClaim = await claimAnalysisJobForProviderResponse("resp_side_effect_first_123", {
        now: new Date("2026-06-30T00:01:20Z"),
        webhookId: "wh_side_effect_first_123"
      });
      const abandonedRun = runClaimedAnalysisJob(firstClaim.job!, {
        requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
        now: new Date("2026-06-30T00:01:20Z")
      });
      await retryPostStarted;

      const replacement = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:50.001Z") });
      expect(replacement.job).toMatchObject({
        id,
        semantic_retry_attempts: 1,
        provider_status: "in_progress"
      });
      releaseRetryPost(settledAs === "completed"
        ? Response.json({
          id: "resp_side_effect_retry_123",
          status: "completed",
          output_text: JSON.stringify(retryCandidate)
        })
        : new Response("temporarily unavailable", { status: 500 }));
      const abandonedResult = await abandonedRun;
      const savedBeforeReplacement = await countTenantSavedReports({ tenantId: "tenant_a" });
      const commentPostsBeforeReplacement = fetchMock.mock.calls.filter(([url, init]) =>
        String(url) === "https://api.github.com/repos/RengGyu/AgentProof/issues/7/comments" && init?.method === "POST"
      );
      const slackBeforeReplacement = fetchMock.mock.calls.filter(([url]) =>
        String(url) === "https://hooks.slack.com/services/T/B/C"
      );

      expect(abandonedResult).toMatchObject({
        status: "failed_retryable",
        reason: "analysis_job_claim_lost"
      });
      expect(savedBeforeReplacement.count).toBe(0);
      expect(commentPostsBeforeReplacement).toHaveLength(0);
      expect(slackBeforeReplacement).toHaveLength(0);

      const replacementResult = await runClaimedAnalysisJob(replacement.job!, {
        requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
        now: new Date("2026-06-30T00:01:50.001Z")
      });
      const savedAfterReplacement = await countTenantSavedReports({ tenantId: "tenant_a" });
      const commentPosts = fetchMock.mock.calls.filter(([url, init]) =>
        String(url) === "https://api.github.com/repos/RengGyu/AgentProof/issues/7/comments" && init?.method === "POST"
      );
      const slackCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url) === "https://hooks.slack.com/services/T/B/C"
      );

      expect(replacementResult).toMatchObject({ status: "completed", job: { id } });
      expect(responsePostCount).toBe(2);
      expect(savedAfterReplacement.count).toBe(1);
      expect(commentPosts).toHaveLength(1);
      expect(slackCalls).toHaveLength(1);
    }
  );

  it("publishes save, comment, and Slack at most once when a retry completes on the live claim", async () => {
    stubReadyWorkerEnv({
      grant: {
        llmAnalysisMode: "enhanced",
        saveReportsEnabled: true,
        commentEnabled: true,
        slackNotificationsEnabled: true
      }
    });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    const githubFetch = mockSemanticRetryWorkerFetch();
    let firstCandidate: unknown;
    let responsePostCount = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://api.openai.com/v1/responses" && init?.method === "POST") {
        responsePostCount += 1;
        const body = JSON.parse(String(init.body));
        const semanticInput = JSON.parse(body.input[1].content[0].text);
        const candidate = validSemanticCandidateForInput(semanticInput);
        if (responsePostCount === 1) {
          firstCandidate = candidate;
          return Response.json({ id: "resp_live_side_effect_first_123", status: "queued", output: [] });
        }
        return Response.json({
          id: "resp_live_side_effect_retry_123",
          status: "completed",
          output_text: JSON.stringify(candidate)
        });
      }
      if (href === "https://api.openai.com/v1/responses/resp_live_side_effect_first_123") {
        return Response.json({
          id: "resp_live_side_effect_first_123",
          status: "completed",
          output_text: JSON.stringify(firstCandidate)
        });
      }
      if (href === "https://hooks.slack.com/services/T/B/C") return Response.json({ ok: true });
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true, slackSummary: true }));

    await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:15Z")
    });
    const saved = await countTenantSavedReports({ tenantId: "tenant_a" });
    const commentPosts = fetchMock.mock.calls.filter(([url, init]) =>
      String(url) === "https://api.github.com/repos/RengGyu/AgentProof/issues/7/comments" && init?.method === "POST"
    );
    const slackCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url) === "https://hooks.slack.com/services/T/B/C"
    );

    expect(result.status).toBe("completed");
    expect(responsePostCount).toBe(2);
    expect(saved.count).toBe(1);
    expect(commentPosts).toHaveLength(1);
    expect(slackCalls).toHaveLength(1);
  });

  it.each(["failed", "cancelled", "incomplete"] as const)(
    "keeps the first candidate when the only retry is %s and never submits a third response",
    async (terminalStatus) => {
      stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced", saveReportsEnabled: false, commentEnabled: false } });
      vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
      vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
      const githubFetch = mockSemanticRetryWorkerFetch();
      let firstCandidate: unknown;
      let requirementCount = 0;
      let responsePostCount = 0;
      const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href === "https://api.openai.com/v1/responses" && init?.method === "POST") {
          responsePostCount += 1;
          const body = JSON.parse(String(init.body));
          const semanticInput = JSON.parse(body.input[1].content[0].text);
          if (responsePostCount === 1) {
            requirementCount = semanticInput.requirements.length;
            firstCandidate = validSemanticCandidateForInput(semanticInput);
            return Response.json({ id: "resp_background_failed_first_123", status: "queued", output: [] });
          }
          return Response.json({ id: "resp_background_failed_retry_123", status: "queued", output: [] });
        }
        if (href === "https://api.openai.com/v1/responses/resp_background_failed_first_123") {
          return Response.json({
            id: "resp_background_failed_first_123",
            status: "completed",
            output_text: JSON.stringify(firstCandidate)
          });
        }
        if (href === "https://api.openai.com/v1/responses/resp_background_failed_retry_123") {
          return Response.json({ id: "resp_background_failed_retry_123", status: terminalStatus });
        }
        return githubFetch(url, init);
      });
      vi.stubGlobal("fetch", fetchMock);
      const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

      await runNextAnalysisJob({
        requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
        now: new Date("2026-06-30T00:01:00Z")
      });
      await runNextAnalysisJob({
        requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
        now: new Date("2026-06-30T00:01:15Z")
      });
      const result = await runNextAnalysisJob({
        requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
        now: new Date("2026-06-30T00:01:30Z")
      });

      expect(result).toMatchObject({ status: "completed", job: { id } });
      expect(responsePostCount).toBe(2);
      expect(getAnalysisJobsForTests()[0]).toMatchObject({
        status: "completed",
        semantic_retry_attempts: 0,
        prior_provider_response_id: null,
        provider_response_id: null
      });
      expect(getAuditEventsForTests().at(-1)?.metadata).toMatchObject({
        semanticDiagnostics: {
          inputRequirementCount: requirementCount,
          assessedRequirementCount: 1,
          missingRequirementCount: requirementCount - 1,
          retryAttempted: true,
          retryOutcome: "provider_failed"
        }
      });
    }
  );

  it("preserves prior and active references when retry polling is transiently unavailable", async () => {
    stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced", saveReportsEnabled: false, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const githubFetch = mockSemanticRetryWorkerFetch();
    let firstCandidate: unknown;
    let responsePostCount = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://api.openai.com/v1/responses" && init?.method === "POST") {
        responsePostCount += 1;
        const body = JSON.parse(String(init.body));
        const semanticInput = JSON.parse(body.input[1].content[0].text);
        if (responsePostCount === 1) {
          firstCandidate = validSemanticCandidateForInput(semanticInput);
          return Response.json({ id: "resp_background_backoff_first_123", status: "queued", output: [] });
        }
        return Response.json({ id: "resp_background_backoff_retry_123", status: "queued", output: [] });
      }
      if (href === "https://api.openai.com/v1/responses/resp_background_backoff_first_123") {
        return Response.json({
          id: "resp_background_backoff_first_123",
          status: "completed",
          output_text: JSON.stringify(firstCandidate)
        });
      }
      if (href === "https://api.openai.com/v1/responses/resp_background_backoff_retry_123") {
        return new Response("temporarily unavailable", { status: 429 });
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:15Z")
    });
    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:30Z")
    });

    expect(result).toMatchObject({ status: "failed_retryable", reason: "openai_rate_limited", job: { id } });
    expect(responsePostCount).toBe(2);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_retryable",
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_background_backoff_first_123",
      provider_response_id: "resp_background_backoff_retry_123"
    });
  });

  it("uses the retrieved first candidate when normal retry backoff would cross continuation expiry", async () => {
    stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced", saveReportsEnabled: false, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const githubFetch = mockSemanticRetryWorkerFetch();
    let firstCandidate: unknown;
    let responsePostCount = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://api.openai.com/v1/responses" && init?.method === "POST") {
        responsePostCount += 1;
        const body = JSON.parse(String(init.body));
        const semanticInput = JSON.parse(body.input[1].content[0].text);
        if (responsePostCount === 1) {
          firstCandidate = validSemanticCandidateForInput(semanticInput);
          return Response.json({ id: "resp_background_expiry_first_123", status: "queued", output: [] });
        }
        return Response.json({ id: "resp_background_expiry_retry_123", status: "queued", output: [] });
      }
      if (href === "https://api.openai.com/v1/responses/resp_background_expiry_first_123") {
        return Response.json({
          id: "resp_background_expiry_first_123",
          status: "completed",
          output_text: JSON.stringify(firstCandidate)
        });
      }
      if (href === "https://api.openai.com/v1/responses/resp_background_expiry_retry_123") {
        return new Response("temporarily unavailable", { status: 429 });
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:15Z")
    });
    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:08:00Z")
    });

    expect(result).toMatchObject({ status: "completed", job: { id } });
    expect(responsePostCount).toBe(2);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "completed",
      semantic_retry_attempts: 0,
      prior_provider_response_id: null,
      provider_response_id: null
    });
    expect(getAuditEventsForTests().at(-1)?.metadata).toMatchObject({
      semanticDiagnostics: {
        retryAttempted: true,
        retryOutcome: "provider_failed"
      }
    });
  });

  it("keeps the first candidate without submitting a pending retry too close to expiry", async () => {
    stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced", saveReportsEnabled: false, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const githubFetch = mockSemanticRetryWorkerFetch();
    let firstCandidate: unknown;
    let responsePostCount = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://api.openai.com/v1/responses" && init?.method === "POST") {
        responsePostCount += 1;
        const body = JSON.parse(String(init.body));
        const semanticInput = JSON.parse(body.input[1].content[0].text);
        if (responsePostCount === 1) {
          firstCandidate = validSemanticCandidateForInput(semanticInput);
          return Response.json({ id: "resp_near_expiry_first_123", status: "queued", output: [] });
        }
        return Response.json({ id: "resp_near_expiry_retry_123", status: "queued", output: [] });
      }
      if (href === "https://api.openai.com/v1/responses/resp_near_expiry_first_123") {
        return Response.json({
          id: "resp_near_expiry_first_123",
          status: "completed",
          output_text: JSON.stringify(firstCandidate)
        });
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const firstClaim = await claimAnalysisJobForProviderResponse("resp_near_expiry_first_123", {
      now: new Date("2026-06-30T00:08:59Z"),
      webhookId: "wh_near_expiry_first_123"
    });
    const result = await runClaimedAnalysisJob(firstClaim.job!, {
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:08:59Z")
    });

    expect(result).toMatchObject({ status: "completed", job: { id } });
    expect(responsePostCount).toBe(1);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "completed",
      semantic_retry_attempts: 0,
      prior_provider_response_id: null,
      provider_response_id: null
    });
    expect(getAuditEventsForTests().at(-1)?.metadata).toMatchObject({
      semanticDiagnostics: {
        retryAttempted: false,
        retryOutcome: "expired_before_retry"
      }
    });
  });

  it("checks retry eligibility with fresh time after a slow first-response retrieval", async () => {
    stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced", saveReportsEnabled: false, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const githubFetch = mockSemanticRetryWorkerFetch();
    let firstCandidate: unknown;
    let responsePostCount = 0;
    let currentTime = new Date("2026-06-30T00:08:24Z");
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://api.openai.com/v1/responses" && init?.method === "POST") {
        responsePostCount += 1;
        const body = JSON.parse(String(init.body));
        const semanticInput = JSON.parse(body.input[1].content[0].text);
        if (responsePostCount === 1) {
          firstCandidate = validSemanticCandidateForInput(semanticInput);
          return Response.json({ id: "resp_slow_retrieval_first_123", status: "queued", output: [] });
        }
        return Response.json({ id: "resp_slow_retrieval_retry_123", status: "queued", output: [] });
      }
      if (href === "https://api.openai.com/v1/responses/resp_slow_retrieval_first_123") {
        currentTime = new Date("2026-06-30T00:08:44Z");
        return Response.json({
          id: "resp_slow_retrieval_first_123",
          status: "completed",
          output_text: JSON.stringify(firstCandidate)
        });
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const firstClaim = await claimAnalysisJobForProviderResponse("resp_slow_retrieval_first_123", {
      now: currentTime,
      webhookId: "wh_slow_retrieval_first_123"
    });
    const result = await runClaimedAnalysisJob(firstClaim.job!, {
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: currentTime,
      clock: () => currentTime
    });

    expect(result).toMatchObject({ status: "completed", job: { id } });
    expect(responsePostCount).toBe(1);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "completed",
      semantic_retry_attempts: 0,
      prior_provider_response_id: null,
      provider_response_id: null
    });
    expect(getAuditEventsForTests().at(-1)?.metadata).toMatchObject({
      semanticDiagnostics: {
        retryAttempted: false,
        retryOutcome: "expired_before_retry"
      }
    });
  });

  it("starts retry submission uncertainty timing after first-response retrieval", async () => {
    stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced", saveReportsEnabled: false, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const githubFetch = mockSemanticRetryWorkerFetch();
    let firstCandidate: unknown;
    let responsePostCount = 0;
    let currentTime = new Date("2026-06-30T00:08:15Z");
    let releaseRetryPost!: (response: Response) => void;
    let signalRetryPostStarted!: () => void;
    const retryPostStarted = new Promise<void>((resolve) => {
      signalRetryPostStarted = resolve;
    });
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://api.openai.com/v1/responses" && init?.method === "POST") {
        responsePostCount += 1;
        const body = JSON.parse(String(init.body));
        const semanticInput = JSON.parse(body.input[1].content[0].text);
        if (responsePostCount === 1) {
          firstCandidate = validSemanticCandidateForInput(semanticInput);
          return Response.json({ id: "resp_fresh_retry_lease_first_123", status: "queued", output: [] });
        }
        signalRetryPostStarted();
        return new Promise<Response>((resolve) => {
          releaseRetryPost = resolve;
        });
      }
      if (href === "https://api.openai.com/v1/responses/resp_fresh_retry_lease_first_123") {
        currentTime = new Date("2026-06-30T00:08:20Z");
        return Response.json({
          id: "resp_fresh_retry_lease_first_123",
          status: "completed",
          output_text: JSON.stringify(firstCandidate)
        });
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const invocationNow = currentTime;
    const firstClaim = await claimAnalysisJobForProviderResponse("resp_fresh_retry_lease_first_123", {
      now: invocationNow,
      webhookId: "wh_fresh_retry_lease_first_123"
    });
    const run = runClaimedAnalysisJob(firstClaim.job!, {
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: invocationNow,
      clock: () => currentTime
    });
    await retryPostStarted;

    const earlyReclaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:08:45.001Z") });
    releaseRetryPost(Response.json({ id: "resp_fresh_retry_lease_pending_123", status: "queued", output: [] }));
    const result = await run;

    expect(earlyReclaim.job).toBeNull();
    expect(result).toMatchObject({ status: "waiting_provider", job: { id } });
    expect(responsePostCount).toBe(2);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "queued",
      semantic_retry_attempts: 1,
      prior_provider_response_id: "resp_fresh_retry_lease_first_123",
      provider_response_id: "resp_fresh_retry_lease_pending_123"
    });
  });

  it("checks pending retry park safety with fresh time after retry submission", async () => {
    stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced", saveReportsEnabled: false, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const githubFetch = mockSemanticRetryWorkerFetch();
    let firstCandidate: unknown;
    let responsePostCount = 0;
    let currentTime = new Date("2026-06-30T00:08:20Z");
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://api.openai.com/v1/responses" && init?.method === "POST") {
        responsePostCount += 1;
        const body = JSON.parse(String(init.body));
        const semanticInput = JSON.parse(body.input[1].content[0].text);
        if (responsePostCount === 1) {
          firstCandidate = validSemanticCandidateForInput(semanticInput);
          return Response.json({ id: "resp_slow_retry_first_123", status: "queued", output: [] });
        }
        currentTime = new Date("2026-06-30T00:08:46Z");
        return Response.json({ id: "resp_slow_retry_pending_123", status: "queued", output: [] });
      }
      if (href === "https://api.openai.com/v1/responses/resp_slow_retry_first_123") {
        return Response.json({
          id: "resp_slow_retry_first_123",
          status: "completed",
          output_text: JSON.stringify(firstCandidate)
        });
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const firstClaim = await claimAnalysisJobForProviderResponse("resp_slow_retry_first_123", {
      now: currentTime,
      webhookId: "wh_slow_retry_first_123"
    });
    const result = await runClaimedAnalysisJob(firstClaim.job!, {
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: currentTime,
      clock: () => currentTime
    });

    expect(result).toMatchObject({ status: "completed", job: { id } });
    expect(responsePostCount).toBe(2);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "completed",
      semantic_retry_attempts: 0,
      prior_provider_response_id: null,
      provider_response_id: null
    });
    expect(getAuditEventsForTests().at(-1)?.metadata).toMatchObject({
      semanticDiagnostics: {
        retryAttempted: true,
        retryOutcome: "provider_failed"
      }
    });
  });

  it("clears background continuation metadata when strict semantic output is rejected", async () => {
    stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced", saveReportsEnabled: false, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const githubFetch = mockWorkerFetch();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://api.openai.com/v1/responses") {
        return Response.json({ id: "resp_background_123", status: "queued", output: [] });
      }
      if (String(url) === "https://api.openai.com/v1/responses/resp_background_123") {
        return Response.json({
          id: "resp_background_123",
          status: "completed",
          output_text: JSON.stringify({ requirement_evidence_relations: [{ token: "must-not-persist" }] })
        });
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));
    await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:20Z")
    });

    expect(result).toMatchObject({ status: "failed_terminal", reason: "openai_output_rejected", job: { id } });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "failed_terminal",
      error_code: "openai_output_rejected",
      provider_response_id: null,
      provider_status: null
    });
    expect(JSON.stringify(getAnalysisJobsForTests()[0])).not.toContain("must-not-persist");
  });

  it("completes deterministic fallback without resubmitting when a background POST outcome is uncertain", async () => {
    stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced", saveReportsEnabled: false, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const githubFetch = mockWorkerFetch();
    let submitCount = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://api.openai.com/v1/responses") {
        submitCount += 1;
        throw new TypeError("network failed after request dispatch");
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    const first = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const second = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:05:00Z")
    });

    expect(first).toMatchObject({ status: "completed", job: { id } });
    expect(second).toEqual({ status: "idle" });
    expect(submitCount).toBe(1);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "completed",
      error_code: null,
      claim_generation: null,
      provider_response_id: null,
      provider_status: null
    });
  });

  it("binds an explicit hybrid intent before one uncertain POST and never converts a legacy row", async () => {
    stubReadyWorkerEnv({
      grant: {
        llmAnalysisMode: "enhanced",
        hybridPlannerConsentVersion: "2026-08-12.v1",
        repositoryPrivate: true,
        saveReportsEnabled: false,
        commentEnabled: false
      }
    });
    vi.stubEnv("AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_HYBRID_PROOF_PILOT_TENANT_ALLOWLIST", "tenant_a");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const githubFetch = mockWorkerFetch();
    let submitCount = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://api.github.com/repos/RengGyu/AgentProof") {
        return Response.json({ private: true });
      }
      if (href === "https://api.openai.com/v1/responses") {
        submitCount += 1;
        throw new TypeError("network failed after request dispatch");
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({
      saveReport: false,
      comment: false,
      hybridPlannerRequested: true
    }));

    const first = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const second = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:05:00Z")
    });

    expect(first).toMatchObject({ status: "completed", job: { id } });
    expect(second).toEqual({ status: "idle" });
    expect(submitCount).toBe(1);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      hybrid_planner_requested: true,
      planner_contract_version: "hybrid_requirement_planner.v1",
      planner_input_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      provider_response_id: null,
      provider_status: null
    });
  });

  it("uses one POST then GET-only retrieval and suppresses publication when the PR relinks to an identical-content Issue", async () => {
    stubReadyWorkerEnv({
      grant: {
        llmAnalysisMode: "enhanced",
        hybridPlannerConsentVersion: "2026-08-12.v1",
        repositoryPrivate: true,
        saveReportsEnabled: true,
        commentEnabled: true,
        slackNotificationsEnabled: true
      }
    });
    vi.stubEnv("AGENTPROOF_HYBRID_PROOF_PILOT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_HYBRID_PROOF_PILOT_TENANT_ALLOWLIST", "tenant_a");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("AGENTPROOF_SAVED_REPORTS_ALLOW_MEMORY", "true");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    const githubFetch = mockWorkerFetch();
    let relinked = false;
    let postCount = 0;
    let retrieveCount = 0;
    let plan: unknown;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (/\/repos\/RengGyu\/AgentProof\/pulls\/7$/.test(href)) {
        return mockWorkerFetch({ pullRequestBody: relinked ? "Fixes #2" : "Fixes #1" })(url, init);
      }
      if (/\/repos\/RengGyu\/AgentProof\/issues\/[12]$/.test(href)) {
        return Response.json({
          number: relinked ? 2 : 1,
          title: "Identical requirement authority",
          body: "Acceptance criteria:\n- Add retry handling.",
          html_url: `https://github.com/RengGyu/AgentProof/issues/${relinked ? 2 : 1}`,
          state: "open"
        });
      }
      if (href === "https://api.github.com/repos/RengGyu/AgentProof") {
        return Response.json({ private: true });
      }
      if (href === "https://api.openai.com/v1/responses") {
        postCount += 1;
        const requestBody = JSON.parse(String(init?.body)) as {
          text: { format: { schema: Record<string, unknown> } };
        };
        plan = exampleFromJsonSchema(
          requestBody.text.format.schema,
          requestBody.text.format.schema
        );
        return Response.json({
          id: "resp_hybrid_relink_123",
          status: "queued",
          output: []
        });
      }
      if (href === "https://api.openai.com/v1/responses/resp_hybrid_relink_123") {
        retrieveCount += 1;
        relinked = true;
        return Response.json({
          id: "resp_hybrid_relink_123",
          status: "completed",
          output_text: JSON.stringify(plan),
          usage: { output_tokens: 100 }
        });
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({
      saveReport: true,
      comment: true,
      slackSummary: true,
      hybridPlannerRequested: true
    }));

    const submitted = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const claimed = await claimAnalysisJobForProviderResponse("resp_hybrid_relink_123", {
      now: new Date("2026-06-30T00:01:20Z"),
      webhookId: "wh_hybrid_relink_123"
    });
    const result = await runClaimedAnalysisJob(claimed.job!, {
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:20Z")
    });

    expect(submitted).toMatchObject({ status: "waiting_provider", job: { id } });
    expect(result).toMatchObject({
      status: "completed",
      job: { id },
      sideEffects: { saveReport: false, comment: false }
    });
    expect(result.sideEffects).not.toHaveProperty("slackSummary");
    expect(postCount).toBe(1);
    expect(retrieveCount).toBe(1);
    expect(getAuditEventsForTests().find((event) => event.action === "hybrid_planner_analysis" &&
      (event.metadata as { plannerTelemetry?: { outcomeCode?: string } }).plannerTelemetry?.outcomeCode === "stale_source"
    )).toMatchObject({
      metadata: { plannerTelemetry: { outcomeCode: "stale_source", postCount: 0 } }
    });
    expect((await countTenantSavedReports({ tenantId: "tenant_a" })).count).toBe(0);
    expect(fetchMock.mock.calls.some(([url, init]) =>
      /\/issues\/7\/comments$/.test(String(url)) && init?.method === "POST"
    )).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "https://slack.com/api/chat.postMessage")).toBe(false);
  });

  it("completes deterministic fallback when a parked provider response expires", async () => {
    stubReadyWorkerEnv({ grant: { llmAnalysisMode: "enhanced", saveReportsEnabled: false, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    const githubFetch = mockWorkerFetch();
    let submitCount = 0;
    let retrieveCount = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://api.openai.com/v1/responses" && init?.method === "POST") {
        submitCount += 1;
        return Response.json({ id: "resp_expiring_123", status: "queued", output: [] });
      }
      if (href === "https://api.openai.com/v1/responses/resp_expiring_123") {
        retrieveCount += 1;
        return Response.json({ id: "resp_expiring_123", status: "queued", output: [] });
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const recovered = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:09:01Z")
    });

    expect(recovered).toMatchObject({ status: "completed", job: { id } });
    expect(submitCount).toBe(1);
    expect(retrieveCount).toBe(0);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "completed",
      provider_response_id: null,
      provider_status: null,
      provider_expires_at: null
    });
  });

  it("does not plan Slack delivery when the repository grant Slack opt-in is off", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false, slackNotificationsEnabled: false } });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false, slackSummary: true }));

    const result = await preflightNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });

    expect(result).toMatchObject({
      status: "ready",
      job: {
        id,
        status: "processing"
      },
      sideEffects: {
        saveReport: false,
        comment: false
      }
    });
    expect(result.sideEffects).not.toHaveProperty("slackSummary");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops a queued tenant job after deletion starts before token fetch or side effects", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: true, commentEnabled: true, slackNotificationsEnabled: true } });
    vi.stubEnv("AGENTPROOF_TENANT_DELETION_STATE_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true, slackSummary: true }));
    markTenantDeletionStartedIfConfigured({ tenantId: "tenant_a" });

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const savedReportCount = await countTenantSavedReports({ tenantId: "tenant_a" });
    const serialized = JSON.stringify({ result, jobs: getAnalysisJobsForTests(), savedReportCount });

    expect(result).toEqual({
      status: "failed_terminal",
      reason: "tenant-deletion-active"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "failed_terminal",
      error_code: "tenant-deletion-active",
      locked_at: null,
      result_summary: null
    });
    expect(savedReportCount).toMatchObject({
      count: 0
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("hooks.slack.com");
    expect(serialized).not.toContain("/reports/");
    expect(serialized).not.toContain("comment_body");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("rechecks deletion state after side-effect audit before token fetch", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: true, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_TENANT_DELETION_STATE_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS", "true");
    vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY", "audit-service-role-secret");
    vi.stubEnv("AGENTPROOF_AUDIT_EVENTS_TABLE", "audit_events_test");
    const auditBodies: unknown[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://agentproof-test.supabase.co/rest/v1/audit_events_test") {
        auditBodies.push(JSON.parse(String(init?.body)));
        markTenantDeletionStartedIfConfigured({ tenantId: "tenant_a" });
        return new Response(null, { status: 201 });
      }

      return new Response(JSON.stringify({ message: `Unexpected fetch ${String(url)}` }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: false }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const savedReportCount = await countTenantSavedReports({ tenantId: "tenant_a" });
    const serialized = JSON.stringify({ result, jobs: getAnalysisJobsForTests(), savedReportCount, auditBodies });

    expect(result).toMatchObject({
      status: "failed_terminal",
      job: expect.objectContaining({ id }),
      reason: "tenant-deletion-active",
      sideEffects: {
        saveReport: true,
        comment: false
      }
    });
    expect(savedReportCount).toMatchObject({ count: 0 });
    expect(fetchMock.mock.calls.some((call) =>
      String(call[0]) === "https://api.github.com/app/installations/321/access_tokens"
    )).toBe(false);
    expect(auditBodies[0]).toMatchObject({
      action: "github_app_side_effects_ready",
      metadata: {
        savedReport: {
          privacy: "summary-only"
        }
      }
    });
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("/reports/");
    expect(serialized).not.toContain("comment_body");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("rechecks deletion state immediately before saved-report side effects", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: true, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_SERVICE_ROLE_KEY", "deletion-service-role-secret");
    vi.stubEnv("AGENTPROOF_TENANT_DELETION_STATE_TABLE", "tenant_deletion_state_test");
    const githubFetch = mockWorkerFetch();
    let deletionStateChecks = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith("https://agentproof-test.supabase.co/rest/v1/tenant_deletion_state_test")) {
        deletionStateChecks += 1;
        return new Response(null, {
          status: 200,
          headers: {
            "content-range": deletionStateChecks >= 7 ? "0-0/1" : "0-0/0"
          }
        });
      }

      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: false }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const savedReportCount = await countTenantSavedReports({ tenantId: "tenant_a" });
    const serialized = JSON.stringify({ result, jobs: getAnalysisJobsForTests(), savedReportCount });

    expect(result).toMatchObject({
      status: "failed_terminal",
      job: expect.objectContaining({ id }),
      reason: "tenant-deletion-active",
      sideEffects: {
        saveReport: true,
        comment: false
      }
    });
    expect(fetchMock.mock.calls.some((call) =>
      String(call[0]) === "https://api.github.com/app/installations/321/access_tokens"
    )).toBe(true);
    expect(fetchMock.mock.calls.some((call) =>
      String(call[0]).includes("/issues/7/comments")
    )).toBe(false);
    expect(savedReportCount).toMatchObject({ count: 0 });
    expect(serialized).not.toContain("/reports/");
    expect(serialized).not.toContain("comment_body");
    expect(serialized).not.toContain("deletion-service-role-secret");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("stops queued analysis before token fetch when the tenant analysis plan is unavailable", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", JSON.stringify([
      {
        tenantId: "tenant_a",
        monthlyAnalysisLimit: 0,
        enabled: true,
        plan: "team"
      }
    ]));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const serialized = JSON.stringify({ result, jobs: getAnalysisJobsForTests() });

    expect(result).toEqual({
      status: "failed_retryable",
      reason: "github_app_plan_gate_unavailable"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "failed_retryable",
      error_code: "github_app_plan_gate_unavailable",
      locked_at: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("rawDiff");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("clamps queued worker side effects to the tenant plan before Slack config", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: true, commentEnabled: true, slackNotificationsEnabled: true } });
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", JSON.stringify([
      {
        tenantId: "tenant_a",
        monthlyAnalysisLimit: 5,
        enabled: true,
        plan: "team",
        savedSummaryLinksEnabled: false,
        markerCommentsEnabled: false,
        slackSummariesEnabled: false
      }
    ]));
    const fetchMock = mockWorkerFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true, slackSummary: true }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const job = getAnalysisJobsForTests()[0];
    const serialized = JSON.stringify({ result, job });

    expect(result).toMatchObject({
      status: "completed",
      job: expect.objectContaining({ id }),
      resultSummary: {
        status: "completed"
      },
      sideEffects: {
        saveReport: false,
        comment: false
      }
    });
    expect(result.sideEffects).not.toHaveProperty("slackSummary");
    expect(job.result_summary?.savedReport).toBeUndefined();
    expect(job.result_summary?.comment).toBeUndefined();
    expect(job.result_summary?.slack).toBeUndefined();
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("/issues/7/comments"))).toBe(false);
    expect(fetchMock.mock.calls.some((call) => String(call[0]).includes("hooks.slack.com"))).toBe(false);
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("hooks.slack.com");
    expect(serialized).not.toContain("/reports/");
    expect(serialized).not.toContain("comment_body");
  });

  it("executes a ready job, validates the report, and completes with summary-only result metadata", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false } });
    const fetchMock = mockWorkerFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const job = getAnalysisJobsForTests()[0];
    const serialized = JSON.stringify({ result, job });

    expect(result).toMatchObject({
      status: "completed",
      job: {
        id,
        status: "processing",
        attempts: 1
      },
      resultSummary: {
        status: "completed",
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 7,
        headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        priority: expect.any(String),
        evidenceCoverage: expect.any(Number)
      },
      sideEffects: {
        saveReport: false,
        comment: false
      }
    });
    expect(job).toMatchObject({
      id,
      status: "completed",
      locked_at: null,
      completed_at: "2026-06-30T00:01:00.000Z",
      result_summary: {
        status: "completed",
        repository: "RengGyu/AgentProof",
        pullRequestNumber: 7,
        headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      }
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.github.com/app/installations/321/access_tokens");
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("key=");
  });

  it("runs advisory observations without retaining private bundles in a worker result", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_GENERAL_PR_OBSERVATION_MODE", "advisory");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("OPENAI_MODEL", "gpt-test");
    const observationSpy = vi.spyOn(generalPrObservationService, "runGeneralPrObservationNowV2");
    const githubFetch = mockWorkerFetch({ repositoryPrivate: false, pullRequestBody: "Internal cleanup only." });
    const fetchMock = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://api.openai.com/v1/responses") {
        return Promise.resolve(Response.json({ output_text: JSON.stringify(validGeneralPrObserverCandidate(init)) }));
      }
      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    try {
      const result = await runNextAnalysisJob({
        requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
        now: new Date("2026-06-30T00:01:00Z")
      });
      const serialized = JSON.stringify({ result, job: getAnalysisJobsForTests()[0] });

      expect(result.status).toBe("completed");
      expect(observationSpy).toHaveBeenCalledWith(expect.objectContaining({
        policy: expect.objectContaining({
          semanticObservation: "eligible_public_pr",
          assessmentProjection: "advisory"
        }),
        input: expect.objectContaining({ taskText: "" }),
        semantic: expect.objectContaining({ providerAvailable: true, privateRepository: false })
      }));
      const observerCalls = fetchMock.mock.calls.filter(([url]) => String(url) === "https://api.openai.com/v1/responses");
      expect(observerCalls).toHaveLength(2);
      expect(observerCalls.map(([, init]) => {
        const body = JSON.parse(String(init?.body));
        return JSON.parse(body.input[1].content[0].text).contractVersion;
      })).toEqual(["general_pr_semantic_claim.v1", "general_pr_semantic_evidence.v1"]);
      expect(serialized).not.toContain("ledgerDigest");
      expect(serialized).not.toContain("generalPrObservation");
      const observationResult = await observationSpy.mock.results.at(-1)?.value;
      expect(observationResult?.bundle).toMatchObject({
        semanticState: "valid",
        semanticFailureStage: null,
        diagnostics: { semanticAdmission: "admitted" },
        semanticStageDiagnostics: { claimState: "valid", evidenceState: "valid", providerCallCount: 2 }
      });
      expect(observationResult?.bundle?.objectives).toEqual([expect.objectContaining({ state: "hypothesis" })]);
      expect(observationResult?.bundle?.relationLevelCounts.verified).toBe(0);
    } finally {
      observationSpy.mockRestore();
    }
  });

  it("fails closed when the PR base changes after collection and before publication", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false } });
    const githubFetch = mockWorkerFetch();
    let pullMetadataRequests = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (
        String(url) === "https://api.github.com/repos/RengGyu/AgentProof/pulls/7"
        && ++pullMetadataRequests === 3
      ) {
        return Response.json({
          title: "Fetched PR title",
          body: "Acceptance criteria: add signed webhook-triggered AgentProof analysis.",
          url: "https://api.github.com/repos/RengGyu/AgentProof/pulls/7",
          user: { login: "agent-author" },
          base: { ref: "main", sha: "cccccccccccccccccccccccccccccccccccccccc" },
          head: { ref: "feature/app-automation", sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
        });
      }

      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(result).toMatchObject({
      status: "failed_terminal",
      job: expect.objectContaining({ id }),
      reason: "github_app_pr_head_changed",
      sideEffects: {
        saveReport: false,
        comment: false
      }
    });
    expect(pullMetadataRequests).toBe(3);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "failed_terminal",
      error_code: "github_app_pr_head_changed"
    });
  });

  it("sends a summary-only Slack report only when the repository grant opts in", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false, slackNotificationsEnabled: true } });
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    const githubFetch = mockWorkerFetch({
      pullRequestBody: "Acceptance criteria: notify @channel with summary only. Do not leak github_pat_secret_should_not_leak_1234567890."
    });
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://hooks.slack.com/services/T/B/C") {
        return Response.json({ ok: true });
      }

      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false, slackSummary: true }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const slackCall = fetchMock.mock.calls.find((call) => String(call[0]) === "https://hooks.slack.com/services/T/B/C");
    const slackBody = String((slackCall?.[1] as RequestInit | undefined)?.body);
    const serialized = JSON.stringify({ result, job: getAnalysisJobsForTests()[0], slackBody });

    expect(result).toMatchObject({
      status: "completed",
      job: expect.objectContaining({ id }),
      resultSummary: {
        slack: {
          action: "sent",
          privacy: "summary-only"
        }
      },
      sideEffects: {
        saveReport: false,
        comment: false,
        slackSummary: true
      }
    });
    expect(slackCall).toBeDefined();
    expect(slackBody).toContain("Summary-only notification");
    expect(slackBody).not.toContain("Patch excerpt");
    expect(slackBody).not.toContain("evidenceIndex");
    expect(slackBody).not.toContain("Added raw claim");
    expect(slackBody).not.toContain("reprompt");
    expect(slackBody).not.toContain("github_pat_secret");
    expect(slackBody).not.toContain("hooks.slack.com/services");
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("SLACK_WEBHOOK_URL");
  });

  it("creates summary-only saved reports but stores no saved-report URL or key in the job result", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: true, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    const fetchMock = mockWorkerFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const job = getAnalysisJobsForTests()[0];
    const serialized = JSON.stringify({ result, job });

    expect(result).toMatchObject({
      status: "completed",
      resultSummary: {
        savedReport: {
          privacy: "summary-only",
          durability: "short-lived-in-memory"
        },
        comment: undefined
      },
      sideEffects: {
        saveReport: true,
        comment: false
      }
    });
    expect(job).toMatchObject({
      id,
      status: "completed",
      result_summary: {
        savedReport: {
          privacy: "summary-only",
          durability: "short-lived-in-memory"
        }
      }
    });
    expect(serialized).not.toContain("/reports/");
    expect(serialized).not.toContain("key=");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("comment_body");
  });

  it("requeues a stale revision before save, comment, or Slack publication", async () => {
    stubReadyWorkerEnv({
      grant: {
        saveReportsEnabled: true,
        commentEnabled: true,
        slackNotificationsEnabled: true
      }
    });
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    const baseFetch = mockWorkerFetch();
    let pullReads = 0;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://api.github.com/repos/RengGyu/AgentProof/pulls/7") {
        pullReads += 1;
        if (pullReads === 3) {
          await enqueueAnalysisJob(jobInput({
            idempotencyKey: "same-head-refresh-before-publish",
            deliveryId: "123e4567-e89b-12d3-a456-426614174304",
            saveReport: true,
            comment: true,
            slackSummary: true
          }));
        }
      }
      if (href === "https://hooks.slack.com/services/T/B/C") return Response.json({ ok: true });
      return baseFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true, slackSummary: true }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const saved = await countTenantSavedReports({ tenantId: "tenant_a" });
    const commentPosts = fetchMock.mock.calls.filter(([url, init]) =>
      String(url).endsWith("/issues/7/comments") && init?.method === "POST"
    );
    const slackPosts = fetchMock.mock.calls.filter(([url]) =>
      String(url) === "https://hooks.slack.com/services/T/B/C"
    );

    expect(result).toMatchObject({ status: "failed_retryable", reason: "analysis_job_claim_lost", job: { id } });
    expect(saved.count).toBe(0);
    expect(commentPosts).toHaveLength(0);
    expect(slackPosts).toHaveLength(0);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "queued",
      desired_revision: 2,
      running_revision: null,
      sealed_revision: null,
      claim_generation: null
    });
  });

  it("publishes a sealed revision when a refresh arrives after the seal and before its first side effect", async () => {
    stubReadyWorkerEnv({ grant: {
      saveReportsEnabled: true,
      commentEnabled: true,
      slackNotificationsEnabled: true
    } });
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    const baseFetch = mockWorkerFetch();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      String(url) === "https://hooks.slack.com/services/T/B/C"
        ? Response.json({ ok: true })
        : baseFetch(url, init)
    );
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true, slackSummary: true }));
    const claim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });

    await expect(sealAnalysisJobRevision({
      id,
      claimGeneration: claim.job!.claim_generation!,
      runningRevision: claim.job!.running_revision!,
      now: new Date("2026-06-30T00:01:00Z")
    })).resolves.toBe(true);
    await enqueueAnalysisJob(jobInput({
      idempotencyKey: "same-head-refresh-after-seal",
      deliveryId: "123e4567-e89b-12d3-a456-426614174305",
      saveReport: true,
      comment: true,
      slackSummary: true
    }));

    const result = await runClaimedAnalysisJob(claim.job!, {
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(result).toMatchObject({ status: "completed" });
    expect((await countTenantSavedReports({ tenantId: "tenant_a" })).count).toBe(1);
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      String(url).endsWith("/issues/7/comments") && init?.method === "POST"
    )).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) =>
      String(url) === "https://hooks.slack.com/services/T/B/C"
    )).toHaveLength(1);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "queued",
      desired_revision: 2,
      running_revision: null,
      sealed_revision: null,
      result_summary: null
    });
  });

  it.each([
    { direction: "disabled to enabled", revisionOne: false, revisionTwo: true },
    { direction: "enabled to disabled", revisionOne: true, revisionTwo: false }
  ])("recovers a sealed publication plan with opposite successor flags: $direction", async ({
    revisionOne,
    revisionTwo
  }) => {
    stubReadyWorkerEnv({ grant: {
      saveReportsEnabled: true,
      commentEnabled: true,
      slackNotificationsEnabled: true
    } });
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    const baseFetch = mockWorkerFetch();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
      String(url) === "https://hooks.slack.com/services/T/B/C"
        ? Response.json({ ok: true })
        : baseFetch(url, init)
    );
    vi.stubGlobal("fetch", fetchMock);
    const revisionOneDelivery = "123e4567-e89b-12d3-a456-426614174310";
    const revisionTwoDelivery = "123e4567-e89b-12d3-a456-426614174311";
    const { id } = await enqueueAnalysisJob({
      ...jobInput({
        deliveryId: revisionOneDelivery,
        saveReport: revisionOne,
        comment: revisionOne,
        slackSummary: revisionOne
      }),
      action: "opened"
    });
    const firstClaim = await claimNextAnalysisJob({ now: new Date("2026-06-30T00:01:00Z") });
    await sealAnalysisJobRevision({
      id,
      claimGeneration: firstClaim.job!.claim_generation!,
      runningRevision: firstClaim.job!.running_revision!,
      now: new Date("2026-06-30T00:01:00Z")
    });
    await enqueueAnalysisJob({
      ...jobInput({
        idempotencyKey: `sealed-plan-successor-${revisionTwo}`,
        deliveryId: revisionTwoDelivery,
        saveReport: revisionTwo,
        comment: revisionTwo,
        slackSummary: revisionTwo
      }),
      action: "completed",
      now: new Date("2026-06-30T00:01:01Z")
    });

    const recovered = await claimNextAnalysisJob({
      now: new Date("2026-06-30T00:03:00Z"),
      leaseMs: 60_000
    });
    expect(recovered.job).toMatchObject({
      delivery_id: revisionOneDelivery,
      action: "opened",
      save_report: revisionOne,
      comment: revisionOne,
      slack_summary: revisionOne,
      running_revision: 1,
      sealed_revision: 1
    });

    await expect(runClaimedAnalysisJob(recovered.job!, {
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:03:00Z")
    })).resolves.toMatchObject({ status: "completed" });

    const afterRecoveredSave = (await countTenantSavedReports({ tenantId: "tenant_a" })).count;
    const afterRecoveredComments = fetchMock.mock.calls.filter(([url, init]) =>
      String(url).endsWith("/issues/7/comments") && init?.method === "POST"
    ).length;
    const afterRecoveredSlack = fetchMock.mock.calls.filter(([url]) =>
      String(url) === "https://hooks.slack.com/services/T/B/C"
    ).length;
    expect([afterRecoveredSave, afterRecoveredComments, afterRecoveredSlack]).toEqual([
      Number(revisionOne),
      Number(revisionOne),
      Number(revisionOne)
    ]);
    expect(getAuditEventsForTests().find((event) =>
      event.action === "github_app_analysis_completed"
    )).toMatchObject({
      request_id: revisionOneDelivery,
      metadata: { webhookAction: "opened" }
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "queued",
      delivery_id: revisionTwoDelivery,
      action: "completed",
      save_report: revisionTwo,
      comment: revisionTwo,
      slack_summary: revisionTwo,
      sealed_revision: null,
      sealed_delivery_id: null,
      sealed_action: null,
      sealed_save_report: null,
      sealed_comment: null,
      sealed_slack_summary: null
    });

    await expect(runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:03:01Z")
    })).resolves.toMatchObject({ status: "completed" });
    expect((await countTenantSavedReports({ tenantId: "tenant_a" })).count).toBe(1);
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      String(url).endsWith("/issues/7/comments") && init?.method === "POST"
    )).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) =>
      String(url) === "https://hooks.slack.com/services/T/B/C"
    )).toHaveLength(1);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "completed",
      sealed_revision: null,
      publication_sealed_at: null,
      sealed_delivery_id: null,
      sealed_event: null,
      sealed_action: null,
      sealed_save_report: null,
      sealed_comment: null,
      sealed_slack_summary: null
    });
  });

  it("finishes the sealed save, comment, and Slack publication when a refresh arrives between effects", async () => {
    stubReadyWorkerEnv({ grant: {
      saveReportsEnabled: true,
      commentEnabled: true,
      slackNotificationsEnabled: true
    } });
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    const baseFetch = mockWorkerFetch();
    let refreshed = false;
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (!refreshed && href.endsWith("/issues/7/comments") && init?.method === "POST") {
        refreshed = true;
        await enqueueAnalysisJob(jobInput({
          idempotencyKey: "same-head-refresh-between-effects",
          deliveryId: "123e4567-e89b-12d3-a456-426614174306",
          saveReport: true,
          comment: true,
          slackSummary: true
        }));
      }
      if (href === "https://hooks.slack.com/services/T/B/C") return Response.json({ ok: true });
      return baseFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true, slackSummary: true }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(result).toMatchObject({ status: "completed" });
    expect((await countTenantSavedReports({ tenantId: "tenant_a" })).count).toBe(1);
    expect(fetchMock.mock.calls.filter(([url, init]) =>
      String(url).endsWith("/issues/7/comments") && init?.method === "POST"
    )).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) =>
      String(url) === "https://hooks.slack.com/services/T/B/C"
    )).toHaveLength(1);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "queued",
      desired_revision: 2,
      running_revision: null,
      sealed_revision: null
    });
  });

  it("rejects parking an old provider submission when a refresh arrives before the park CAS", async () => {
    stubReadyWorkerEnv({ grant: {
      llmAnalysisMode: "enhanced",
      saveReportsEnabled: true,
      commentEnabled: true,
      slackNotificationsEnabled: true
    } });
    vi.stubEnv("AGENTPROOF_LLM_SEMANTIC_ENABLED", "true");
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    const baseFetch = mockWorkerFetch();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href === "https://api.openai.com/v1/responses" && init?.method === "POST") {
        await enqueueAnalysisJob(jobInput({
          idempotencyKey: "same-head-refresh-during-provider-submit",
          deliveryId: "123e4567-e89b-12d3-a456-426614174307",
          saveReport: true,
          comment: true,
          slackSummary: true
        }));
        return Response.json({ id: "resp_stale_submission_123", status: "queued", output: [] });
      }
      if (href === "https://hooks.slack.com/services/T/B/C") return Response.json({ ok: true });
      return baseFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true, slackSummary: true }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(result).toMatchObject({ status: "failed_retryable", reason: "analysis_job_claim_lost" });
    expect((await countTenantSavedReports({ tenantId: "tenant_a" })).count).toBe(0);
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).endsWith("/issues/7/comments") && init?.method === "POST"
    )).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) =>
      String(url) === "https://hooks.slack.com/services/T/B/C"
    )).toBe(false);
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "queued",
      desired_revision: 2,
      running_revision: null,
      sealed_revision: null,
      provider_response_id: null,
      provider_status: null
    });
  });

  it("queues the next revision when a refresh arrives after the last effect and before completion", async () => {
    stubReadyWorkerEnv({ grant: {
      saveReportsEnabled: true,
      commentEnabled: true,
      slackNotificationsEnabled: true
    } });
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    const baseFetch = mockWorkerFetch();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://hooks.slack.com/services/T/B/C") {
        await enqueueAnalysisJob(jobInput({
          idempotencyKey: "same-head-refresh-before-complete",
          deliveryId: "123e4567-e89b-12d3-a456-426614174308",
          saveReport: true,
          comment: true,
          slackSummary: true
        }));
        return Response.json({ ok: true });
      }
      return baseFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true, slackSummary: true }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(result).toMatchObject({ status: "completed" });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "queued",
      desired_revision: 2,
      running_revision: null,
      sealed_revision: null,
      result_summary: null
    });
  });

  it("queues the next revision when a refresh arrives immediately before sealed publication failure", async () => {
    stubReadyWorkerEnv({ grant: {
      saveReportsEnabled: true,
      commentEnabled: true,
      slackNotificationsEnabled: true
    } });
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    const baseFetch = mockWorkerFetch();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://hooks.slack.com/services/T/B/C") {
        await enqueueAnalysisJob(jobInput({
          idempotencyKey: "same-head-refresh-before-failure",
          deliveryId: "123e4567-e89b-12d3-a456-426614174309",
          saveReport: true,
          comment: true,
          slackSummary: true
        }));
        return new Response("unavailable", { status: 503 });
      }
      return baseFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true, slackSummary: true }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(result).toMatchObject({ status: "failed_retryable" });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      status: "queued",
      desired_revision: 2,
      running_revision: null,
      sealed_revision: null,
      error_code: null,
      result_summary: null
    });
  });

  it("rechecks tenant grants before side effects and stops if deletion disables the grant mid-run", async () => {
    stubReadyWorkerEnv({ grant: null });
    vi.stubEnv("AGENTPROOF_TENANT_GRANTS_ALLOW_MEMORY", "true");
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    await createTenantRepositoryGrant(grantRecord({
      saveReportsEnabled: true,
      commentEnabled: true
    }));
    const baseFetchMock = mockWorkerFetch();
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      const response = await baseFetchMock(url, init);

      if (href === "https://api.github.com/repos/RengGyu/AgentProof/pulls/7/files?per_page=100&page=1") {
        await updateTenantRepositoryGrantSettings({
          tenantId: "tenant_a",
          installationId: 321,
          repositoryId: 100,
          enabled: false,
          analysisEnabled: false,
          saveReportsEnabled: false,
          commentEnabled: false
        });
      }

      return response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: true }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const savedReportCount = await countTenantSavedReports({ tenantId: "tenant_a" });
    const commentCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/issues/7/comments")
    );
    const serialized = JSON.stringify({ result, jobs: getAnalysisJobsForTests(), savedReportCount });

    expect(result).toEqual({
      status: "failed_terminal",
      job: expect.objectContaining({ id, status: "processing" }),
      reason: "grant-disabled",
      sideEffects: {
        saveReport: true,
        comment: true
      }
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "failed_terminal",
      error_code: "grant-disabled",
      locked_at: null,
      result_summary: null
    });
    expect(savedReportCount).toMatchObject({
      count: 0,
      store: "memory",
      durable: false,
      configured: true
    });
    expect(commentCalls).toHaveLength(0);
    expect(serialized).not.toContain("/reports/");
    expect(serialized).not.toContain("key=");
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("comment_body");
  });

  it("stops before token fetch when durable audit is required for side effects but unavailable", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: true, commentEnabled: false } });
    vi.stubEnv("AGENTPROOF_GITHUB_APP_SAVE_REPORTS", "true");
    vi.stubEnv("AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: true, comment: false }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(result).toEqual({
      status: "failed_retryable",
      job: expect.objectContaining({ id, status: "processing" }),
      reason: "github_app_durable_audit_required",
      sideEffects: {
        saveReport: true,
        comment: false
      }
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "failed_retryable",
      error_code: "github_app_durable_audit_required",
      locked_at: null
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops before token fetch when Slack delivery is opted in but the webhook is missing or invalid", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false, slackNotificationsEnabled: true } });
    const missingFetchMock = vi.fn();
    vi.stubGlobal("fetch", missingFetchMock);
    const missing = await enqueueAnalysisJob(jobInput({
      saveReport: false,
      comment: false,
      slackSummary: true,
      idempotencyKey: "missing-slack-webhook",
      deliveryId: "123e4567-e89b-12d3-a456-426614174310"
    }));

    const missingResult = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(missingResult).toEqual({
      status: "failed_retryable",
      job: expect.objectContaining({ id: missing.id, status: "processing" }),
      reason: "slack_summary_not_configured",
      sideEffects: {
        saveReport: false,
        comment: false,
        slackSummary: true
      }
    });
    expect(missingFetchMock).not.toHaveBeenCalled();

    vi.stubEnv("SLACK_WEBHOOK_URL", "https://example.com/not-slack");
    const invalidFetchMock = vi.fn();
    vi.stubGlobal("fetch", invalidFetchMock);
    const invalid = await enqueueAnalysisJob(jobInput({
      saveReport: false,
      comment: false,
      slackSummary: true,
      idempotencyKey: "invalid-slack-webhook",
      deliveryId: "123e4567-e89b-12d3-a456-426614174311"
    }));

    const invalidResult = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(invalidResult).toEqual({
      status: "failed_retryable",
      job: expect.objectContaining({ id: invalid.id, status: "processing" }),
      reason: "slack_summary_webhook_invalid",
      sideEffects: {
        saveReport: false,
        comment: false,
        slackSummary: true
      }
    });
    expect(invalidFetchMock).not.toHaveBeenCalled();
  });

  it("requires durable audit before Slack summary side effects when the gate is enabled", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false, slackNotificationsEnabled: true } });
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false, slackSummary: true }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(result).toEqual({
      status: "failed_retryable",
      job: expect.objectContaining({ id, status: "processing" }),
      reason: "github_app_durable_audit_required",
      sideEffects: {
        saveReport: false,
        comment: false,
        slackSummary: true
      }
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("records bounded durable audit metadata before Slack summary delivery", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false, slackNotificationsEnabled: true } });
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/C");
    vi.stubEnv("AGENTPROOF_REQUIRE_DURABLE_AUDIT_FOR_SIDE_EFFECTS", "true");
    vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_AUDIT_SUPABASE_SERVICE_ROLE_KEY", "audit-service-role-secret");
    vi.stubEnv("AGENTPROOF_AUDIT_EVENTS_TABLE", "audit_events_test");
    const githubFetch = mockWorkerFetch();
    const auditBodies: unknown[] = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://agentproof-test.supabase.co/rest/v1/audit_events_test") {
        auditBodies.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 201 });
      }

      if (String(url) === "https://hooks.slack.com/services/T/B/C") {
        return Response.json({ ok: true });
      }

      return githubFetch(url, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false, slackSummary: true }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const serializedAudit = JSON.stringify(auditBodies);

    expect(result.status).toBe("completed");
    expect(auditBodies[0]).toMatchObject({
      action: "github_app_side_effects_ready",
      result: "completed",
      metadata: {
        code: "github_app_slack_summary_ready",
        slack: {
          action: "planned",
          privacy: "summary-only"
        }
      }
    });
    expect(auditBodies[1]).toMatchObject({
      action: "github_app_analysis_completed",
      result: "completed",
      metadata: {
        slack: {
          action: "sent",
          privacy: "summary-only"
        }
      }
    });
    expect(serializedAudit).not.toContain("hooks.slack.com/services");
    expect(serializedAudit).not.toContain("audit-service-role-secret");
    expect(serializedAudit).not.toContain("Patch excerpt");
    expect(serializedAudit).not.toContain("evidenceIndex");
    expect(serializedAudit).not.toContain("claims");
    expect(serializedAudit).not.toContain("reprompt");
  });

  it("marks GitHub evidence fetch failures retryable with redacted bounded summaries", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false } });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href === "https://api.github.com/app/installations/321/access_tokens") {
        return Response.json({ token: "installation-token" });
      }
      return new Response("upstream token=github_pat_abcdefghijklmnopqrstuvwxyz1234567890 failed", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { id } = await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false }));

    const result = await runNextAnalysisJob({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run",
      now: new Date("2026-06-30T00:01:00Z")
    });
    const serialized = JSON.stringify(getAnalysisJobsForTests()[0]);

    expect(result).toMatchObject({
      status: "failed_retryable",
      reason: "github_fetch_failed"
    });
    expect(getAnalysisJobsForTests()[0]).toMatchObject({
      id,
      status: "failed_retryable",
      error_code: "github_fetch_failed",
      locked_at: null
    });
    expect(serialized).not.toContain("installation-token");
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("token=");
  });

  it("runs a bounded batch and stops when the requested limit is reached", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false } });
    const fetchMock = mockWorkerFetch();
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({
      saveReport: false,
      comment: false,
      idempotencyKey: "first-batch-job",
      pullRequestNumber: 7,
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }));
    await enqueueAnalysisJob(jobInput({
      saveReport: false,
      comment: false,
      idempotencyKey: "second-batch-job",
      deliveryId: "123e4567-e89b-12d3-a456-426614174301",
      pullRequestNumber: 8,
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }));
    await enqueueAnalysisJob(jobInput({
      saveReport: false,
      comment: false,
      idempotencyKey: "third-batch-job",
      deliveryId: "123e4567-e89b-12d3-a456-426614174302",
      pullRequestNumber: 9,
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }));

    const result = await runAnalysisJobBatch({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run-batch?limit=2",
      limit: 2,
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(result).toMatchObject({
      requestedLimit: 2,
      processed: 2,
      completed: 2,
      failedRetryable: 0,
      failedTerminal: 0,
      idle: false,
      stoppedReason: "limit_reached",
      items: [
        { status: "completed" },
        { status: "completed" }
      ]
    });
    expect(getAnalysisJobsForTests().map((job) => job.status)).toEqual([
      "completed",
      "completed",
      "queued"
    ]);
  });

  it("stops a batch after the first retryable failure to avoid draining due jobs during systemic outages", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false } });
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "https://api.github.com/app/installations/321/access_tokens") {
        return Response.json({ token: "installation-token" });
      }

      return new Response("GitHub unavailable", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await enqueueAnalysisJob(jobInput({
      saveReport: false,
      comment: false,
      idempotencyKey: "retryable-batch-job",
      pullRequestNumber: 7,
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }));
    await enqueueAnalysisJob(jobInput({
      saveReport: false,
      comment: false,
      idempotencyKey: "untouched-batch-job",
      deliveryId: "123e4567-e89b-12d3-a456-426614174301",
      pullRequestNumber: 8,
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    }));

    const result = await runAnalysisJobBatch({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run-batch?limit=5",
      limit: 5,
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(result).toMatchObject({
      requestedLimit: 5,
      processed: 1,
      completed: 0,
      failedRetryable: 1,
      failedTerminal: 0,
      idle: false,
      stoppedReason: "systemic_retryable_failure",
      items: [
        { status: "failed_retryable", reason: "github_fetch_failed" }
      ]
    });
    expect(getAnalysisJobsForTests().map((job) => job.status)).toEqual([
      "failed_retryable",
      "queued"
    ]);
  });

  it("continues a bounded batch after one job's optional Slack side effect is unavailable", async () => {
    stubReadyWorkerEnv({ grant: { saveReportsEnabled: false, commentEnabled: false, slackNotificationsEnabled: true } });
    vi.stubGlobal("fetch", mockWorkerFetch());
    await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false, slackSummary: true, idempotencyKey: "slack-retryable-job" }));
    await enqueueAnalysisJob(jobInput({ saveReport: false, comment: false, slackSummary: false, idempotencyKey: "later-completes-job", deliveryId: "123e4567-e89b-12d3-a456-426614174302", pullRequestNumber: 8 }));

    const result = await runAnalysisJobBatch({
      requestUrl: "https://agentproof.test/api/ops/analysis-jobs/run-batch?limit=2",
      limit: 2,
      now: new Date("2026-06-30T00:01:00Z")
    });

    expect(result).toMatchObject({ processed: 2, completed: 1, failedRetryable: 1, stoppedReason: "limit_reached" });
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "failed_retryable", reason: "slack_summary_not_configured" }),
      expect.objectContaining({ status: "completed" })
    ]));
  });
});

function stubQueueEnv() {
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOB_QUEUE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_ANALYSIS_JOBS_ALLOW_MEMORY", "true");
}

type WorkerGrantRecord = {
  tenantId: string;
  installationId: number;
  repositoryId: number;
  repositoryFullName: string;
  enabled: boolean;
  analysisEnabled: boolean;
  commentEnabled: boolean;
  saveReportsEnabled: boolean;
  slackNotificationsEnabled: boolean;
  llmAnalysisMode: "essential" | "enhanced";
  hybridPlannerConsentVersion?: "2026-08-12.v1";
  repositoryPrivate?: boolean;
};

function stubReadyWorkerEnv(options: {
  grant?: Partial<WorkerGrantRecord> | null;
} = {}) {
  stubQueueEnv();
  vi.stubEnv("GITHUB_APP_ID", "123");
  vi.stubEnv("GITHUB_PRIVATE_KEY", testPrivateKey());
  vi.stubEnv("GITHUB_WEBHOOK_SECRET", "webhook-secret");
  vi.stubEnv("AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_GITHUB_APP_AUTOMATION_ENABLED", "true");
  vi.stubEnv("AGENTPROOF_REPORT_SIGNING_SECRET", "test-report-signing-secret-that-is-long-enough");

  if (options.grant !== null) {
    vi.stubEnv("AGENTPROOF_TENANT_REPOSITORY_GRANTS", JSON.stringify([
      grantRecord(options.grant)
    ]));
  }
}

function grantRecord(overrides: Partial<WorkerGrantRecord> = {}): WorkerGrantRecord {
  return {
    tenantId: "tenant_a",
    installationId: 321,
    repositoryId: 100,
    repositoryFullName: "RengGyu/AgentProof",
    enabled: true,
    analysisEnabled: true,
    commentEnabled: true,
    saveReportsEnabled: true,
    slackNotificationsEnabled: false,
    llmAnalysisMode: "essential",
    ...overrides
  };
}

function jobInput(overrides: Partial<{
  saveReport: boolean;
  comment: boolean;
  slackSummary: boolean;
  idempotencyKey: string;
  deliveryId: string;
  pullRequestNumber: number;
  headSha: string;
  hybridPlannerRequested: boolean;
}> = {}) {
  const pullRequestNumber = overrides.pullRequestNumber ?? 7;

  return {
    tenantId: "tenant_a",
    idempotencyKey: overrides.idempotencyKey ?? "raw-idempotency-key-should-not-store",
    deliveryId: overrides.deliveryId ?? "123e4567-e89b-12d3-a456-426614174300",
    event: "pull_request",
    action: "synchronize",
    installationId: 321,
    repositoryId: 100,
    repositoryFullName: "RengGyu/AgentProof",
    pullRequestNumber,
    pullRequestUrl: `https://github.com/RengGyu/AgentProof/pull/${pullRequestNumber}`,
    headSha: overrides.headSha ?? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    saveReport: overrides.saveReport ?? true,
    comment: overrides.comment ?? true,
    slackSummary: overrides.slackSummary ?? false,
    hybridPlannerRequested: overrides.hybridPlannerRequested ?? false,
    now: new Date("2026-06-30T00:00:00Z")
  };
}

function billingSubscriptionsJson(overrides: Record<string, unknown> = {}) {
  return JSON.stringify([
    {
      tenantId: "tenant_a",
      provider: "stripe",
      providerCustomerId: "cus_secret_should_not_leak",
      providerSubscriptionId: "sub_secret_should_not_leak",
      providerPriceId: "price_secret_should_not_leak",
      subscriptionStatus: "active",
      plan: "team",
      ...overrides
    }
  ]);
}

function testPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

function exampleFromJsonSchema(schema: Record<string, unknown>, root: Record<string, unknown>): unknown {
  if (typeof schema.$ref === "string") {
    const path = schema.$ref.replace(/^#\//, "").split("/");
    let current: unknown = root;
    for (const segment of path) {
      current = current && typeof current === "object" && !Array.isArray(current)
        ? (current as Record<string, unknown>)[segment]
        : undefined;
    }
    return exampleFromJsonSchema(current as Record<string, unknown>, root);
  }
  if (Array.isArray(schema.enum)) return schema.enum[0];
  if (Array.isArray(schema.anyOf)) {
    return exampleFromJsonSchema(schema.anyOf[0] as Record<string, unknown>, root);
  }
  if (schema.type === "object") {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    const required = Array.isArray(schema.required) ? schema.required : Object.keys(properties ?? {});
    return Object.fromEntries(required.map((key) => [key, exampleFromJsonSchema(properties[key]!, root)]));
  }
  if (schema.type === "array") return [];
  if (schema.type === "null") return null;
  throw new Error("Test schema did not provide a deterministic example value.");
}

function validGeneralPrObserverCandidate(init?: RequestInit) {
  const request = JSON.parse(String(init?.body)) as { input: Array<{ content: Array<{ text: string }> }> };
  const observerInput = JSON.parse(request.input[1]!.content[0]!.text) as { contractVersion: string; spans?: Array<{ id: string }> };
  if (observerInput.contractVersion === "general_pr_semantic_evidence.v1") {
    return { testApplicabilityProposals: [], scopeMappingProposals: [], evidenceRelationProposals: [] };
  }
  const objective = observerInput.spans?.[0];
  if (!objective) throw new Error("claim package must include a span");
  return {
    spanRoles: observerInput.spans!.map((span) => ({
      spanId: span.id,
      role: span.id === objective.id ? "objective_candidate" : "supporting_context",
      abstained: false
    })),
    objectiveGroups: [{ spanIds: [objective.id], disposition: "candidate" }]
  };
}

function mockWorkerFetch(options: { pullRequestBody?: string; repositoryPrivate?: boolean } = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? "GET";

    if (href === "https://api.github.com/app/installations/321/access_tokens") {
      return Response.json({ token: "installation-token" });
    }

    const pullMatch = href.match(/^https:\/\/api\.github\.com\/repos\/RengGyu\/AgentProof\/pulls\/(\d+)$/);
    if (pullMatch) {
      const pullNumber = Number(pullMatch[1]);
      return Response.json({
        title: "Fetched PR title",
        body: options.pullRequestBody
          ?? "Acceptance criteria: add signed webhook-triggered AgentProof analysis. Save only summary reports. Keep automated comments opt-in.",
        url: `https://api.github.com/repos/RengGyu/AgentProof/pulls/${pullNumber}`,
        user: { login: "agent-author" },
        base: { ref: "main", sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", repo: { private: options.repositoryPrivate } },
        head: { ref: "feature/app-automation", sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
      });
    }

    if (/^https:\/\/api\.github\.com\/repos\/RengGyu\/AgentProof\/pulls\/\d+\/files\?per_page=100&page=1$/.test(href)) {
      return Response.json([
        {
          filename: "src/app/api/github/webhook/route.ts",
          additions: 30,
          deletions: 2,
          status: "modified",
          patch: "@@ -1 +1 @@\n+ signed webhook-triggered AgentProof analysis"
        }
      ]);
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/issues/42") {
      return Response.json({
        number: 42,
        title: "Background semantic coverage",
        body: [
          "Acceptance criteria:",
          "- Add signed webhook-triggered AgentProof analysis.",
          "- Save only summary reports.",
          "- Keep automated comments opt-in."
        ].join("\n"),
        html_url: "https://github.com/RengGyu/AgentProof/issues/42",
        state: "open",
        pull_request: undefined
      });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/check-runs?per_page=100&page=1") {
      return Response.json({
        total_count: 1,
        check_runs: [
          {
            id: 999,
            name: "CI test/build evidence verification",
            status: "completed",
            conclusion: "success",
            html_url: "https://github.com/RengGyu/AgentProof/actions/runs/1",
            details_url: "https://github.com/RengGyu/AgentProof/actions/runs/1",
            output: { summary: "pnpm test, typecheck, and build passed" }
          }
        ]
      });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/commits/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/status") {
      return Response.json({ statuses: [] });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/actions/runs/1/jobs?per_page=100") {
      return Response.json({
        jobs: [
          {
            name: "CI test/build evidence verification",
            status: "completed",
            conclusion: "success",
            html_url: "https://github.com/RengGyu/AgentProof/actions/runs/1/job/2",
            steps: [
              { name: "Test", status: "completed", conclusion: "success" },
              { name: "Build", status: "completed", conclusion: "success" }
            ]
          }
        ]
      });
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/issues/7/comments?per_page=100&page=1") {
      return Response.json([]);
    }

    if (href === "https://api.github.com/repos/RengGyu/AgentProof/issues/7/comments" && method === "POST") {
      return Response.json({ html_url: "https://github.com/RengGyu/AgentProof/pull/7#issuecomment-777" });
    }

    return new Response(`unexpected url: ${href}`, { status: 500 });
  });
}

function mockSemanticRetryWorkerFetch() {
  return mockWorkerFetch({
    pullRequestBody: "Closes #42\n\nImplements the linked background semantic coverage requirements."
  });
}

function validSemanticCandidate(requirementId: string, evidenceId: string) {
  return {
    requirement_evidence_relations: [{
      requirement_id: requirementId,
      evidence_id: evidenceId,
      relation: "partial_support",
      rationale: "The supplied evidence supports part of the requested behavior.",
      uncertainty: "medium"
    }],
    requirement_assessments: [{
      requirement_id: requirementId,
      requirement_summary: "Review the requested behavior against the supplied evidence.",
      evidence_support: "partial_evidence_present",
      summary: "The supplied evidence supports only part of the requested behavior.",
      evidence_ids: [evidenceId],
      uncertainty: "medium"
    }],
    evidence_gaps: [],
    review_targets: [],
    remediation_requests: [],
    uncertainties: []
  };
}

function validSemanticCandidateForInput(input: {
  requirements: Array<{ id: string; evidence_ids: string[] }>;
}) {
  const requirement = input.requirements[0]!;
  const evidenceId = requirement.evidence_ids[0];
  if (evidenceId) return validSemanticCandidate(requirement.id, evidenceId);
  return {
    requirement_evidence_relations: [],
    requirement_assessments: [{
      requirement_id: requirement.id,
      requirement_summary: "Review the requested behavior against the supplied evidence.",
      evidence_support: "no_evidence_found",
      summary: "No supplied evidence directly supports this requirement.",
      evidence_ids: [],
      uncertainty: "high"
    }],
    evidence_gaps: [],
    review_targets: [],
    remediation_requests: [],
    uncertainties: []
  };
}
