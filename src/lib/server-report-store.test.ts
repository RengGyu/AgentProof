import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeSharedReport, encodeReportForShare } from "./report-share";
import { demoScenarios } from "./sample-data";
import {
  clearSavedReportsForTests,
  cleanupExpiredReports,
  cleanupExpiredSavedReports,
  createSavedReport,
  createVerifiedSavedReport,
  deleteSavedReport,
  getSavedReport,
  getSavedReportStoreStatus,
  listTenantSavedReportDetails,
  listTenantSavedReports,
  MAX_SERVER_REPORTS,
  purgeTenantSavedReportsForDeletion,
  SavedReportStoreError
} from "./server-report-store";
import { createVerifiedAuthenticity } from "./report-authenticity";
import { projectTenantPersistedReport, validateTenantPersistedReport, validateTenantStoredReport } from "./tenant-report-validation";
import type { VerificationReport } from "./types";
import { generateVerificationReport } from "./verifier";

const TEST_SLACK_WEBHOOK = ["https://hooks.slack.com", "services", "T00000000", "B00000000", "XXXXXXXXXXXXXXXXXXXXXXXX"].join("/");

describe("server report store", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AGENTPROOF_REPORTS_SUPABASE_URL;
    delete process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.AGENTPROOF_REPORTS_TABLE;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    global.fetch = originalFetch;
  });

  afterEach(() => {
    clearSavedReportsForTests();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it("stores only the summary-safe report projection", async () => {
    const fullReport = generateVerificationReport(demoScenarios["scope-creep"]);
    fullReport.evidenceIndex.push({
      id: "ev_annotation_secret",
      kind: "check",
      label: "unit tests",
      summary: "Check annotations: failure at src/private/auth.test.ts:42. raw_details annotation message with ghp_secret_should_not_leak",
      confidence: 0.9
    });
    fullReport.claims.push({
      id: "claim_annotation_secret",
      text: "Annotation raw_details retained sk-secret_should_not_leak",
      evidenceRefs: ["ev_annotation_secret"],
      supported: false
    });
    fullReport.reprompt.prompt = "raw_details re-prompt with github_pat_secret_should_not_leak";
    fullReport.summary.oneLine = "Summary mentions sk-secret_should_not_leak";
    fullReport.requirements[0].requirementText = "Requirement mentions github_pat_secret_should_not_leak";
    fullReport.testing.missingTests.push({ path: "src/test.ts", why: "Needs test", evidenceRefs: [] });
    fullReport.reviewPriority.push({ path: "src/review.ts", reason: "Needs review", priority: "medium" });
    fullReport.testing.missingTests[0].why = "Missing test reason with token=secret_should_not_leak";
    fullReport.reviewPriority[0].reason = "Review reason with https://hooks.slack.com/services/T000/B000/secret";
    const saved = await createSavedReport(fullReport);
    const serialized = JSON.stringify(saved.report);

    expect(saved.report.evidenceIndex).toEqual([]);
    expect(saved.report.claims).toEqual([]);
    expect(saved.report.reprompt.prompt).toContain("Shared summary links omit re-prompt text");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("raw_details");
    expect(serialized).not.toContain("src/private/auth.test.ts:42");
    expect(serialized).not.toContain("ghp_secret_should_not_leak");
    expect(serialized).not.toContain("sk-secret_should_not_leak");
    expect(serialized).not.toContain("github_pat_secret_should_not_leak");
    expect(serialized).not.toContain("secret_should_not_leak");
    expect(serialized).not.toContain("hooks.slack.com/services");
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain(fullReport.reprompt.prompt);
    expect(saved.report.limitations).toContain(
      "Shared report omits raw evidence, patch/log excerpts, claims, proof-graph evidence refs, and re-prompt text."
    );
    expect(saved.report.authenticity?.trust).toBe("imported_unverified");
  });

  it("rejects a tampered server-verified summary instead of rendering it as verified", async () => {
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = "test-report-signing-secret-that-is-long-enough";
    const saved = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean));
    const store = globalThis as typeof globalThis & {
      __agentproofReportStore?: Map<string, { report: typeof saved.report }>;
    };
    const stored = store.__agentproofReportStore?.get(saved.id);
    if (!stored) throw new Error("Expected saved report in test store.");
    stored.report.summary.priority = "blocker";

    await expect(getSavedReport(saved.id)).resolves.toBeNull();
  });

  it("stores a server-generated deterministic summary with a canonical signature", async () => {
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = "test-report-signing-secret-that-is-long-enough";
    const saved = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean));

    expect(saved.report.authenticity).toMatchObject({
      trust: "verified_agentproof",
      canonicalDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      signature: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    await expect(getSavedReport(saved.id)).resolves.toMatchObject({
      id: saved.id,
      report: { authenticity: { trust: "verified_agentproof" } }
    });
  });

  it("retains only a validated semantic analysis in a signed tenant report", async () => {
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = "test-report-signing-secret-that-is-long-enough";
    const report = generateVerificationReport(demoScenarios.clean);
    const requirementId = report.requirements[0]!.requirementId;
    report.semantic = {
      requirement_evidence_relations: [],
      requirement_assessments: [{
        requirement_id: requirementId,
        requirement_summary: "Review the supplied evidence for this requirement.",
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

    const saved = await createVerifiedSavedReport(report, {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 8,
      headSha: "a".repeat(40)
    });

    expect(saved.report.semantic).toEqual(report.semantic);
    expect(validateTenantStoredReport(saved.report, process.env.AGENTPROOF_REPORT_SIGNING_SECRET!)).toEqual({ valid: true, errors: [] });
  });

  it("does not promote a semantic suggestion into a deterministic tenant gap or next action", async () => {
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = "test-report-signing-secret-that-is-long-enough";
    const report = generateVerificationReport(demoScenarios.clean);
    const requirement = report.requirements[0]!;
    const proofNode = report.proofGraph.nodes.find((node) => node.requirementId === requirement.requirementId)!;
    requirement.gaps = [];
    proofNode.gapSignals = [];
    report.semantic = {
      requirement_evidence_relations: [],
      requirement_assessments: [],
      evidence_gaps: [{
        requirement_id: requirement.requirementId,
        gap_type: "insufficient_context",
        priority: "medium",
        description: "The supplied evidence leaves additional context unclear.",
        review_impact: "The evidence reading remains limited.",
        needed_evidence: "A bounded additional reference.",
        evidence_ids: [],
        uncertainty: "medium"
      }],
      review_targets: [],
      remediation_requests: [{
        requirement_id: requirement.requirementId,
        request_type: "provide_or_link_evidence",
        priority: "medium",
        instruction: "Link a bounded additional reference.",
        rationale: "The evidence reading is limited.",
        expected_evidence: "A supplied evidence reference.",
        evidence_ids: [],
        uncertainty: "medium"
      }],
      uncertainties: []
    };

    const saved = await createVerifiedSavedReport(report, {
      tenantId: "tenant_a", installationId: 321, repositoryId: 100, pullRequestNumber: 8, headSha: "9".repeat(40)
    });

    expect(saved.report.semantic).toEqual(report.semantic);
    expect(saved.report.requirements[0]?.gaps).toEqual([]);
    expect(saved.report.proofGraph.nodes[0]?.gapSignals).toEqual([]);
    expect(saved.report.reprompt.prompt).toBe("Review the linked evidence.");
  });

  it("retains only bounded unavailable semantic runtime state in a signed tenant report", async () => {
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = "test-report-signing-secret-that-is-long-enough";
    const report = generateVerificationReport(demoScenarios.clean);
    report.semanticAnalysis = { status: "unavailable", attempts: 2 };

    const saved = await createVerifiedSavedReport(report, {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 8,
      headSha: "c".repeat(40)
    });

    expect(saved.report.semanticAnalysis).toEqual({ status: "unavailable", attempts: 2 });
    expect(validateTenantStoredReport(saved.report, process.env.AGENTPROOF_REPORT_SIGNING_SECRET!)).toEqual({ valid: true, errors: [] });
  });

  it("stores useful canonical gap and remediation text without source-derived prose", async () => {
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = "test-report-signing-secret-that-is-long-enough";
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    report.requirements[0]!.gaps.push("PRIVATE ISSUE WORDING SHOULD NOT SAVE");
    report.reprompt.prompt = "RAW AGENT REQUEST SHOULD NOT SAVE";

    const saved = await createVerifiedSavedReport(report, {
      tenantId: "tenant_a", installationId: 321, repositoryId: 100, pullRequestNumber: 8, headSha: "d".repeat(40)
    });
    const serialized = JSON.stringify(saved.report);

    expect(saved.report.requirements.flatMap((item) => item.gaps)).toContain(
      "Targeted test evidence is missing for this requirement."
    );
    expect(saved.report.reprompt.prompt).toBe(
      "Add or link a targeted test and its Check result for the requirement."
    );
    expect(serialized).not.toContain("PRIVATE ISSUE WORDING");
    expect(serialized).not.toContain("RAW AGENT REQUEST");
    expect(validateTenantStoredReport(saved.report, process.env.AGENTPROOF_REPORT_SIGNING_SECRET!)).toEqual({ valid: true, errors: [] });
  });

  it("persists only a safe one-line objective label and keeps legacy placeholder reports valid", async () => {
    const signingSecret = "test-report-signing-secret-that-is-long-enough";
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = signingSecret;
    const report = generateVerificationReport({
      title: "Normalize an invoice reference",
      taskText: "Normalize an invoice reference before display.",
      description: "Normalize an invoice reference before display.",
      changedFiles: [{ path: "src/billing/reference.ts", status: "modified", patch: "+ return value.trim().toUpperCase();" }],
      checks: [],
      logs: []
    });

    const saved = await createVerifiedSavedReport(report, {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 8,
      headSha: "e".repeat(40)
    });
    const projected = projectTenantPersistedReport(saved.report, signingSecret);

    expect(saved.report.requirements[0]?.requirementText).toBe("Normalize an invoice reference before display");
    expect(projected.requirements[0]).toMatchObject({
      objectiveLabel: "Normalize an invoice reference before display"
    });
    expect(validateTenantPersistedReport(projected, signingSecret)).toEqual({ valid: true, errors: [] });
    expect(validateTenantPersistedReport(JSON.parse(JSON.stringify(projected)), signingSecret)).toEqual({ valid: true, errors: [] });

    const legacyReport = saved.report;
    legacyReport.requirements[0]!.requirementText = `Requirement ${legacyReport.requirements[0]!.requirementId}`;
    const legacy = projectTenantPersistedReport(legacyReport, signingSecret);
    expect(legacy.requirements[0]).not.toHaveProperty("objectiveLabel");
    expect(validateTenantPersistedReport(legacy, signingSecret)).toEqual({ valid: true, errors: [] });

    const unsignedNestedField = structuredClone(projected) as unknown as {
      evidenceIndex: Array<Record<string, unknown>>;
      reviewPriority: Array<Record<string, unknown>>;
      integrity: Record<string, unknown>;
    };
    unsignedNestedField.evidenceIndex[0]!.rawLog = "must not survive";
    unsignedNestedField.integrity.rawLog = "must not survive";
    expect(validateTenantPersistedReport(unsignedNestedField, signingSecret)).toMatchObject({ valid: false });
    expect(validateTenantPersistedReport(unsignedNestedField, signingSecret).errors).toEqual(expect.arrayContaining([
      "tenant persisted evidence has disallowed fields.",
      "tenant persisted report signature is invalid."
    ]));

    unsignedNestedField.reviewPriority.push({
      path: "src/billing/reference.ts",
      priority: "medium",
      evidenceRefs: [],
      rawOutput: "must not survive"
    });
    expect(validateTenantPersistedReport(unsignedNestedField, signingSecret).errors).toContain(
      "tenant persisted priority file has disallowed fields."
    );
  });

  it("rejects unsafe objective-label source text instead of persisting raw source details", async () => {
    const signingSecret = "test-report-signing-secret-that-is-long-enough";
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = signingSecret;
    const report = generateVerificationReport(demoScenarios.clean);
    report.requirements[0]!.requirementText = "Issue body: inspect https://example.test/private and src/private/token.ts";

    const saved = await createVerifiedSavedReport(report, {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 8,
      headSha: "f".repeat(40)
    });
    const serialized = JSON.stringify(projectTenantPersistedReport(saved.report, signingSecret));

    expect(saved.report.requirements[0]?.requirementText).toBe(`Requirement ${report.requirements[0]!.requirementId}`);
    expect(serialized).not.toContain("example.test");
    expect(serialized).not.toContain("src/private/token.ts");
    expect(serialized).not.toContain("Issue body");
  });

  it("preserves no-objective PR context through tenant sanitization and persistence", async () => {
    const signingSecret = "test-report-signing-secret-that-is-long-enough";
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = signingSecret;
    const report = generateVerificationReport({
      title: "Improve background processing",
      taskText: "",
      description: "Improve background processing.",
      changedFiles: [{ path: "src/jobs/label.js", status: "modified", patch: "+ export const label = 'background';" }],
      checks: [],
      logs: []
    });

    const saved = await createVerifiedSavedReport(report, {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 8,
      headSha: "1".repeat(40)
    });
    const projected = projectTenantPersistedReport(saved.report, signingSecret);

    expect(report.requirements).toEqual([]);
    expect(saved.report.analysisContext).toBe("unlinked_pr");
    expect(projected.analysisContext).toBe("unlinked_pr");
  });

  it("updates the current report for the same head and marks it stale only after a different head", async () => {
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = "test-report-signing-secret-that-is-long-enough";
    const first = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_a", installationId: 321, repositoryId: 100, pullRequestNumber: 8, headSha: "a".repeat(40)
    });
    const sameHead = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_a", installationId: 321, repositoryId: 100, pullRequestNumber: 8, headSha: "a".repeat(40)
    });
    expect(sameHead.id).toBe(first.id);
    expect(await listTenantSavedReports({ tenantId: "tenant_a", limit: 25 })).toHaveLength(1);

    const nextHead = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_a", installationId: 321, repositoryId: 100, pullRequestNumber: 8, headSha: "b".repeat(40)
    });

    expect((await getSavedReport(first.id, { tenantId: "tenant_a" }))?.staleAt).toEqual(expect.any(String));
    expect((await getSavedReport(sameHead.id, { tenantId: "tenant_a" }))?.staleAt).toEqual(expect.any(String));
    expect((await getSavedReport(nextHead.id, { tenantId: "tenant_a" }))?.staleAt).toBeUndefined();
  });

  it("defines same-head Supabase replacement without weakening different-head STALE semantics", () => {
    const migration = readFileSync(
      new URL("../../supabase/migrations/202608090001_saved_reports_same_head_upsert.sql", import.meta.url),
      "utf8"
    );

    expect(migration).toContain("agentproof_saved_reports_pr_head_unique_idx");
    expect(migration).toContain("row_number() over");
    expect(migration).toContain("current_rank > 1");
    expect(migration).toContain("and stale_at is null");
    expect(migration).toContain("on conflict (tenant_id, repository_id, pull_request_number, head_sha)");
    expect(migration).toContain("do update set");
    expect(migration).toContain("head_sha is distinct from p_head_sha");
  });

  it("defines the Supabase STALE transition in the same transaction as the new head insert", () => {
    const migration = readFileSync(
      new URL("../../supabase/migrations/202608040001_saved_reports_stale_metadata.sql", import.meta.url),
      "utf8"
    );

    expect(migration).toContain("before insert on public.agentproof_saved_reports");
    expect(migration).toContain("head_sha is distinct from new.head_sha");
    expect(migration).toContain("and stale_at is null");
    expect(migration).toContain("agentproof_saved_reports_identity_metadata_check");
    expect(migration).toContain("repository_id is not null");
    expect(migration).toContain("pull_request_number is not null");
    expect(migration).toContain("head_sha is not null");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("agentproof_store_tenant_report");
  });

  it("stores a verified tenant report through the atomic Supabase STALE RPC", async () => {
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = "test-report-signing-secret-that-is-long-enough";
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      return Response.json([{
        id: body.p_id,
        created_at: body.p_created_at,
        expires_at: body.p_expires_at,
        report: body.p_report,
        tenant_id: body.p_tenant_id,
        installation_id: body.p_installation_id,
        repository_id: body.p_repository_id,
        pull_request_number: body.p_pull_request_number,
        head_sha: body.p_head_sha
      }]);
    });
    global.fetch = fetchMock as typeof fetch;

    const saved = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 8,
      headSha: "a".repeat(40)
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(url).toBe("https://agentproof-test.supabase.co/rest/v1/rpc/agentproof_store_tenant_report");
    expect(init.method).toBe("POST");
    expect(body).toMatchObject({
      p_tenant_id: "tenant_a",
      p_installation_id: 321,
      p_repository_id: 100,
      p_pull_request_number: 8,
      p_head_sha: "a".repeat(40)
    });
    expect(Object.keys(body.p_report).sort()).toEqual([
      "analysisContext",
      "evidenceIndex",
      "integrity",
      "priority",
      "reprompt",
      "requirements",
      "reviewPriority",
      "testing",
      "version"
    ]);
    expect(JSON.stringify(body.p_report)).not.toContain("proofGraph");
    expect(JSON.stringify(body.p_report)).not.toContain("source");
    expect(saved).toMatchObject({ tenantId: "tenant_a", repositoryId: 100, pullRequestNumber: 8 });
  });

  it("stores only the exact signed tenant report contract and rejects a re-signed privacy violation", async () => {
    const signingSecret = "test-report-signing-secret-that-is-long-enough";
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = signingSecret;
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.source.title = "RAW PR BODY SHOULD NOT SAVE";
    report.source.author = "RAW GITHUB RESPONSE SHOULD NOT SAVE";
    report.requirements[0].requirementText = "Issue body: PRIVATE ISSUE TEXT SHOULD NOT SAVE";
    report.evidenceIndex[0].summary = "raw diff with github_pat_secret_should_not_leak";
    report.reprompt.prompt = "raw log and token=secret_should_not_leak";

    const saved = await createVerifiedSavedReport(report, {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 8,
      headSha: "a".repeat(40)
    });
    const serialized = JSON.stringify(saved.report);

    expect(validateTenantStoredReport(saved.report, signingSecret)).toEqual({ valid: true, errors: [] });
    expect(serialized).not.toContain("RAW PR BODY");
    expect(serialized).not.toContain("RAW GITHUB RESPONSE");
    expect(serialized).not.toContain("PRIVATE ISSUE TEXT");
    expect(serialized).not.toContain("raw diff");
    expect(serialized).not.toContain("raw log");
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("secret_should_not_leak");

    const invalid = structuredClone(saved.report);
    invalid.source.title = "Leaked pull request body";
    invalid.authenticity = createVerifiedAuthenticity(invalid, signingSecret);

    expect(validateTenantStoredReport(invalid, signingSecret)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["source.title is outside the tenant report contract."])
    });

    const extraField = structuredClone(saved.report) as VerificationReport & { rawDiff?: string };
    extraField.rawDiff = "private patch";
    const invalidEnum = structuredClone(saved.report);
    (invalidEnum.summary as { priority: string }).priority = "urgent";
    const missingReference = structuredClone(saved.report);
    missingReference.requirements[0].evidenceRefs.push("ev_missing");
    const unsafeLocation = structuredClone(saved.report);
    unsafeLocation.reviewPriority[0].path = "../private/file.ts";
    const oversized = structuredClone(saved.report);
    oversized.evidenceIndex[0].locator = `src/${"a".repeat(1000)}`;

    for (const candidate of [extraField, invalidEnum, missingReference, unsafeLocation, oversized]) {
      candidate.authenticity = createVerifiedAuthenticity(candidate, signingSecret);
      expect(validateTenantStoredReport(candidate, signingSecret).valid).toBe(false);
    }

    const badSignature = structuredClone(saved.report);
    badSignature.summary.confidence = 0.1;
    expect(validateTenantStoredReport(badSignature, signingSecret).errors).toContain("authenticity signature is invalid.");
  });

  it("rejects a tampered or expanded persisted tenant report projection", async () => {
    const signingSecret = "test-report-signing-secret-that-is-long-enough";
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = signingSecret;
    const safe = await createVerifiedSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 8,
      headSha: "a".repeat(40)
    });
    const projected = projectTenantPersistedReport(safe.report, signingSecret);

    expect(validateTenantPersistedReport(projected, signingSecret)).toEqual({ valid: true, errors: [] });

    const tampered = structuredClone(projected);
    tampered.priority = projected.priority === "low" ? "high" : "low";
    expect(validateTenantPersistedReport(tampered, signingSecret)).toMatchObject({ valid: false });

    const expanded = { ...projected, rawDiff: "private patch" };
    expect(validateTenantPersistedReport(expanded, signingSecret)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(["tenant persisted report contains disallowed field: rawDiff."])
    });
  });

  it("does not store raw linked issue body evidence in saved reports", async () => {
    const rawIssueBody = "RAW_LINKED_ISSUE_BODY_SHOULD_NOT_SAVE";
    const fullReport = generateVerificationReport({
      ...demoScenarios.clean,
      taskSource: "issue",
      taskText: [
        "Linked issue acme/repo#42: Reject expired reset links",
        "Acceptance criteria:",
        "- Reject expired reset links.",
        "```text",
        rawIssueBody,
        "```"
      ].join("\n")
    });
    const saved = await createSavedReport(fullReport);
    const serialized = JSON.stringify(saved.report);

    expect(fullReport.evidenceIndex.some((item) => item.summary.includes(rawIssueBody))).toBe(true);
    expect(saved.report.evidenceIndex).toEqual([]);
    expect(serialized).not.toContain(rawIssueBody);
    expect(serialized).not.toContain("Linked issue acme/repo#42");
  });

  it("scopes tenant saved reports by tenant id or report access key", async () => {
    const report = decodeSharedReport(encodeReportForShare(generateVerificationReport(demoScenarios.clean)));
    const saved = await createSavedReport(report, { tenantId: "tenant_a" });

    expect(saved.accessToken).toBeTruthy();
    await expect(getSavedReport(saved.id)).resolves.toBeNull();
    await expect(getSavedReport(saved.id, { tenantId: "tenant_b" })).resolves.toBeNull();
    await expect(getSavedReport(saved.id, { accessToken: "wrong-key" })).resolves.toBeNull();
    await expect(getSavedReport(saved.id, { tenantId: "tenant_a" })).resolves.toMatchObject({
      id: saved.id,
      tenantId: "tenant_a"
    });
    await expect(getSavedReport(saved.id, { accessToken: saved.accessToken })).resolves.toMatchObject({
      id: saved.id,
      tenantId: "tenant_a"
    });
    await expect(deleteSavedReport(saved.id, { tenantId: "tenant_b" })).resolves.toBe(false);
    await expect(deleteSavedReport(saved.id, { accessToken: saved.accessToken })).resolves.toBe(true);
  });

  it("lists tenant saved reports as bounded summary-only metadata", async () => {
    const firstReport = generateVerificationReport(demoScenarios["scope-creep"]);
    firstReport.source.title = "Scope report with token=secret_should_not_leak";
    firstReport.source.url = "https://github.com/RengGyu/AgentProof/pull/27?key=secret_should_not_leak#discussion";
    const secondReport = generateVerificationReport(demoScenarios.clean);
    const first = await createSavedReport(firstReport, { tenantId: "tenant_a" });
    await createSavedReport(secondReport, { tenantId: "tenant_b" });

    const rows = await listTenantSavedReports({ tenantId: "tenant_a", limit: 25 });
    const serialized = JSON.stringify(rows);

    expect(rows).toEqual([
      expect.objectContaining({
        id: first.id,
        sourceTitle: "Scope report with [redacted]",
        sourceUrl: "https://github.com/RengGyu/AgentProof/pull/27",
        priority: first.report.summary.priority,
        evidenceCoverage: first.report.summary.evidenceCoverage,
        privacy: "summary-only"
      })
    ]);
    expect(rows[0].requirementCounts).toEqual(expect.objectContaining({
      met: expect.any(Number),
      partial: expect.any(Number),
      missing: expect.any(Number),
      unclear: expect.any(Number)
    }));
    expect(serialized).not.toContain(first.accessToken ?? "missing-access-token");
    expect(serialized).not.toContain("secret_should_not_leak");
    expect(serialized).not.toContain("?key=");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("Patch excerpt");
  });

  it("keeps no-auth demo saved reports readable without tenant scope", async () => {
    const report = decodeSharedReport(encodeReportForShare(generateVerificationReport(demoScenarios.clean)));
    const saved = await createSavedReport(report);

    expect(saved.tenantId).toBeUndefined();
    expect(saved.accessToken).toBeUndefined();
    await expect(getSavedReport(saved.id)).resolves.toMatchObject({
      id: saved.id
    });
  });

  it("sanitizes legacy in-memory report rows at read time", async () => {
    const legacyReport = generateVerificationReport(demoScenarios["scope-creep"]);
    legacyReport.evidenceIndex.push({
      id: "ev_legacy_secret",
      kind: "diff",
      label: "Patch excerpt",
      summary: "Patch excerpt with token=github_pat_abcdefghijklmnopqrstuvwxyz123456",
      confidence: 0.9
    });
    legacyReport.claims.push({
      id: "claim_legacy_secret",
      text: "Agent claim with AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      evidenceRefs: ["ev_legacy_secret"],
      supported: false
    });
    legacyReport.reprompt.prompt = `raw re-prompt with ${TEST_SLACK_WEBHOOK}`;
    const store = globalThis as typeof globalThis & {
      __agentproofReportStore?: Map<string, unknown>;
    };

    store.__agentproofReportStore = new Map([
      [
        "legacy_report",
        {
          id: "legacy_report",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          report: legacyReport
        }
      ]
    ]);

    const saved = await getSavedReport("legacy_report");
    const serialized = JSON.stringify(saved?.report);

    expect(saved?.report.evidenceIndex).toEqual([]);
    expect(saved?.report.claims).toEqual([]);
    expect(saved?.report.reprompt.prompt).toContain("Shared summary links omit re-prompt text");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("wJalrXUtnFEMI");
    expect(serialized).not.toContain("hooks.slack.com/services");
  });

  it("expires and deletes old reports", async () => {
    const fullReport = generateVerificationReport(demoScenarios.clean);
    const saved = await createSavedReport(fullReport, -1);

    expect(await getSavedReport(saved.id)).toBeNull();
    expect(cleanupExpiredReports()).toBe(0);
  });

  it("cleans expired in-memory reports with metadata-only output", async () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.evidenceIndex.push({
      id: "ev_cleanup_secret",
      kind: "log",
      label: "raw log",
      summary: "Patch excerpt with github_pat_secret_should_not_leak",
      confidence: 0.6
    });
    report.reprompt.prompt = "raw cleanup prompt with sk-secret_should_not_leak";
    const active = await createSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_a",
      ttlMs: 60_000
    });
    const expired = await createSavedReport(report, { tenantId: "tenant_a", ttlMs: -1 });

    const result = await cleanupExpiredSavedReports(Date.now());
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      privacy: "saved-report-cleanup-metadata-only",
      deletedCount: 1,
      countBasis: "exact-memory-delete-count",
      store: "memory",
      durable: false,
      configured: false
    });
    expect(expired.id).toMatch(/^tenant_/);
    await expect(getSavedReport(active.id, { tenantId: "tenant_a" })).resolves.toMatchObject({
      id: active.id
    });
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain(expired.id);
    expect(serialized).not.toContain(active.id);
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("sk-secret");
  });

  it("caps in-memory saved reports by removing oldest entries", async () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.evidenceIndex.push({
      id: "ev_legacy_supabase_secret",
      kind: "log",
      label: "Patch excerpt",
      summary: "Patch excerpt with token=github_pat_abcdefghijklmnopqrstuvwxyz123456",
      confidence: 0.9
    });
    report.claims.push({
      id: "claim_legacy_supabase_secret",
      text: "Agent claim with AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      evidenceRefs: ["ev_legacy_supabase_secret"],
      supported: false
    });
    report.reprompt.prompt = `raw re-prompt with ${TEST_SLACK_WEBHOOK}`;
    const saved = [];

    for (let index = 0; index < MAX_SERVER_REPORTS + 1; index += 1) {
      saved.push(await createSavedReport(report));
    }

    expect(await getSavedReport(saved[0].id)).toBeNull();
    expect(await getSavedReport(saved.at(-1)?.id ?? "")).not.toBeNull();
  });

  it("reports in-memory fallback when durable env is absent", () => {
    expect(getSavedReportStoreStatus()).toMatchObject({
      mode: "memory",
      configured: false,
      durable: false,
      durability: "short-lived-in-memory"
    });
  });

  it("uses Supabase REST when report store env is configured", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    process.env.AGENTPROOF_REPORTS_TABLE = "saved_reports_test";
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.evidenceIndex.push({
      id: "ev_secret",
      kind: "log",
      label: "raw log",
      summary: "Patch excerpt with ghp_secret_should_not_leak",
      confidence: 0.6
    });
    report.reprompt.prompt = "raw re-prompt with sk-secret_should_not_leak";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const row = JSON.parse(String(init?.body));

      return Response.json([row]);
    });
    global.fetch = fetchMock as typeof fetch;

    const saved = await createSavedReport(report);
    const [url, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    const serializedBody = JSON.stringify(body);

    expect(url).toBe("https://agentproof-test.supabase.co/rest/v1/saved_reports_test");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer service-role-secret");
    expect(saved.report.evidenceIndex).toEqual([]);
    expect(serializedBody).not.toContain("Patch excerpt");
    expect(serializedBody).not.toContain("ghp_secret_should_not_leak");
    expect(serializedBody).not.toContain("sk-secret_should_not_leak");
    expect(body.report.claims).toEqual([]);
    expect(body.report.reprompt.prompt).toContain("Shared summary links omit re-prompt text");
    expect(getSavedReportStoreStatus()).toMatchObject({
      mode: "supabase",
      configured: true,
      durable: true,
      durability: "summary-only-supabase",
      table: "saved_reports_test"
    });
  });

  it("reuses the onboarding service role when reports share the control-plane Supabase project", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "stale-reports-service-role";
    process.env.AGENTPROOF_CONTROL_PLANE_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_ONBOARDING_SUPABASE_SERVICE_ROLE_KEY = "shared-service-role";
    process.env.AGENTPROOF_REPORTS_TABLE = "saved_reports_test";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const row = JSON.parse(String(init?.body));
      return Response.json([row]);
    });
    global.fetch = fetchMock as typeof fetch;

    await createSavedReport(generateVerificationReport(demoScenarios.clean));

    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer shared-service-role");
  });

  it("stores tenant metadata and hashed access only in Supabase saved report rows", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    process.env.AGENTPROOF_REPORTS_TABLE = "saved_reports_test";
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.evidenceIndex.push({
      id: "ev_secret",
      kind: "log",
      label: "raw log",
      summary: "Patch excerpt with ghp_secret_should_not_leak",
      confidence: 0.6
    });
    report.reprompt.prompt = "raw re-prompt with sk-secret_should_not_leak";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const row = JSON.parse(String(init?.body));

      return Response.json([row]);
    });
    global.fetch = fetchMock as typeof fetch;

    const saved = await createSavedReport(report, { tenantId: "tenant_a" });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    const serializedBody = JSON.stringify(body);

    expect(saved.accessToken).toBeTruthy();
    expect(body.tenant_id).toBe("tenant_a");
    expect(body.access_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.access_token_hash).not.toBe(saved.accessToken);
    expect(serializedBody).not.toContain(saved.accessToken ?? "missing-token");
    expect(serializedBody).not.toContain("Patch excerpt");
    expect(serializedBody).not.toContain("ghp_secret_should_not_leak");
    expect(serializedBody).not.toContain("sk-secret_should_not_leak");
    expect(body.report.evidenceIndex).toEqual([]);
    expect(body.report.claims).toEqual([]);
  });

  it("keeps public Supabase reads backward-compatible while filtering tenant reads and deletes", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    const report = generateVerificationReport(demoScenarios.clean);
    const publicRow = {
      id: "public_report",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      report
    };
    const row = {
      id: "tenant_report",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      tenant_id: "tenant_a",
      access_token_hash: "a".repeat(64),
      installation_id: 321,
      repository_id: 100,
      pull_request_number: 28,
      head_sha: "a".repeat(40),
      stale_at: new Date().toISOString(),
      report
    };
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "GET" && url.includes("id=eq.public_report")) return Response.json([publicRow]);
      if (init?.method === "GET" && url.includes("tenant_id=eq.tenant_a")) return Response.json([row]);
      if (init?.method === "GET") return Response.json([]);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });

      return new Response(null, { status: 500 });
    });
    global.fetch = fetchMock as typeof fetch;

    const publicSaved = await getSavedReport("public_report");
    const serializedPublic = JSON.stringify(publicSaved?.report);

    expect(publicSaved).toMatchObject({ id: "public_report" });
    expect(publicSaved?.report.evidenceIndex).toEqual([]);
    expect(publicSaved?.report.claims).toEqual([]);
    expect(publicSaved?.report.reprompt.prompt).toContain("Shared summary links omit re-prompt text");
    expect(serializedPublic).not.toContain("Patch excerpt");
    expect(serializedPublic).not.toContain("github_pat_");
    expect(serializedPublic).not.toContain("wJalrXUtnFEMI");
    expect(serializedPublic).not.toContain("hooks.slack.com/services");
    await expect(getSavedReport("tenant_report", { tenantId: "tenant_b" })).resolves.toBeNull();
    await expect(getSavedReport("tenant_report", { tenantId: "tenant_a" })).resolves.toMatchObject({
      id: "tenant_report",
      tenantId: "tenant_a"
    });
    await expect(deleteSavedReport("tenant_report", { tenantId: "tenant_a" })).resolves.toBe(true);

    expect(String(fetchMock.mock.calls[0][0])).toContain("select=id,created_at,expires_at,report");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("tenant_id");
    expect(String(fetchMock.mock.calls[1][0])).toContain("tenant_id=eq.tenant_b");
    expect(String(fetchMock.mock.calls[2][0])).toContain("tenant_id=eq.tenant_a");
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("tenant_id=eq.tenant_a");
  });

  it("lists Supabase tenant saved reports without access tokens or storage internals", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    process.env.AGENTPROOF_REPORTS_TABLE = "saved_reports_test";
    const report = decodeSharedReport(encodeReportForShare(generateVerificationReport(demoScenarios.clean)));
    report.source.url = "https://github.com/RengGyu/AgentProof/pull/28?key=secret_should_not_leak";
    const row = {
      id: "tenant_report",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      tenant_id: "tenant_a",
      access_token_hash: "a".repeat(64),
      installation_id: 321,
      repository_id: 100,
      pull_request_number: 28,
      head_sha: "a".repeat(40),
      stale_at: new Date().toISOString(),
      report
    };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json([row]));
    global.fetch = fetchMock as typeof fetch;

    const rows = await listTenantSavedReports({ tenantId: "tenant_a", limit: 100 });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    const serialized = JSON.stringify(rows);

    expect(rows).toEqual([
      expect.objectContaining({
        id: "tenant_report",
        sourceUrl: "https://github.com/RengGyu/AgentProof/pull/28",
        repositoryId: 100,
        pullRequestNumber: 28,
        headSha: "a".repeat(40),
        staleAt: expect.any(String),
        privacy: "summary-only"
      })
    ]);
    expect(String(url)).toContain("https://agentproof-test.supabase.co/rest/v1/saved_reports_test?");
    expect(String(url)).toContain("tenant_id=eq.tenant_a");
    expect(String(url)).toContain("expires_at=gt.");
    expect(String(url)).toContain("limit=100");
    expect(String(url)).not.toContain("service-role-secret");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer service-role-secret");
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("access_token_hash");
    expect(serialized).not.toContain("secret_should_not_leak");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("filters a Supabase detail bundle by repository and current state at the query boundary", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    const report = decodeSharedReport(encodeReportForShare(generateVerificationReport(demoScenarios.clean)));
    const row = {
      id: "tenant_current_report",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      tenant_id: "tenant_a",
      repository_id: 100,
      pull_request_number: 28,
      head_sha: "a".repeat(40),
      report
    };
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => Response.json([row]));
    global.fetch = fetchMock as typeof fetch;

    const rows = await listTenantSavedReportDetails({ tenantId: "tenant_a", repositoryId: 100, currentOnly: true, limit: 100 });
    const [url] = fetchMock.mock.calls[0] ?? [];

    expect(rows).toEqual([expect.objectContaining({ id: "tenant_current_report", repositoryId: 100 })]);
    expect(String(url)).toContain("tenant_id=eq.tenant_a");
    expect(String(url)).toContain("repository_id=eq.100");
    expect(String(url)).toContain("stale_at=is.null");
    expect(String(url)).toContain("limit=100");
    expect(String(url)).not.toContain("service-role-secret");
  });

  it("lists a signed tenant persisted projection after privacy-safe hydration", async () => {
    const signingSecret = "test-report-signing-secret-that-is-long-enough";
    process.env.AGENTPROOF_REPORT_SIGNING_SECRET = signingSecret;
    const report = generateVerificationReport(demoScenarios.clean);
    report.semantic = {
      requirement_evidence_relations: [],
      requirement_assessments: [{
        requirement_id: report.requirements[0]!.requirementId,
        requirement_summary: "Review the supplied evidence for this requirement.",
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
    const saved = await createVerifiedSavedReport(report, {
      tenantId: "tenant_a",
      installationId: 321,
      repositoryId: 100,
      pullRequestNumber: 28,
      headSha: "a".repeat(40)
    });
    const row = {
      id: "tenant_projection",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      tenant_id: "tenant_a",
      installation_id: 321,
      repository_id: 100,
      pull_request_number: 28,
      head_sha: "a".repeat(40),
      report: projectTenantPersistedReport(saved.report, signingSecret)
    };
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    global.fetch = vi.fn(async () => Response.json([row])) as typeof fetch;

    await expect(listTenantSavedReports({ tenantId: "tenant_a", limit: 25 })).resolves.toEqual([
      expect.objectContaining({ id: "tenant_projection", repositoryId: 100, pullRequestNumber: 28 })
    ]);
    await expect(getSavedReport("tenant_projection", { tenantId: "tenant_a" })).resolves.toMatchObject({
      report: { semantic: report.semantic }
    });
  });

  it("returns null for expired Supabase reports and deletes them", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    const report = generateVerificationReport(demoScenarios.clean);
    const expiredRow = {
      id: "expired_report",
      created_at: new Date(Date.now() - 2000).toISOString(),
      expires_at: new Date(Date.now() - 1000).toISOString(),
      report
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json([expiredRow]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    global.fetch = fetchMock as typeof fetch;

    await expect(getSavedReport("expired_report")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).toContain("id=eq.expired_report");
    expect(fetchMock.mock.calls[1][1]?.method).toBe("DELETE");
  });

  it("cleans expired Supabase saved reports without reading report bodies or exposing storage internals", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    process.env.AGENTPROOF_REPORTS_TABLE = "saved_reports_test";
    const now = Date.parse("2026-06-30T00:00:00.000Z");
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-range": "0-0/4"
          }
        });
      }

      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return new Response("unexpected", { status: 500 });
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await cleanupExpiredSavedReports(now);
    const [countUrl, countInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      privacy: "saved-report-cleanup-metadata-only",
      deletedCount: 4,
      countBasis: "pre-delete-supabase-count",
      store: "supabase",
      durable: true,
      configured: true
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(countUrl).toBe("https://agentproof-test.supabase.co/rest/v1/saved_reports_test?expires_at=lte.2026-06-30T00%3A00%3A00.000Z&select=id");
    expect(countInit.method).toBe("HEAD");
    expect(countInit.body).toBeUndefined();
    expect(countInit.headers).toMatchObject({
      Prefer: "count=exact",
      Range: "0-0"
    });
    expect(deleteUrl).toBe("https://agentproof-test.supabase.co/rest/v1/saved_reports_test?expires_at=lte.2026-06-30T00%3A00%3A00.000Z");
    expect(deleteInit.method).toBe("DELETE");
    expect(deleteInit.body).toBeUndefined();
    expect(deleteInit.headers).toMatchObject({
      Prefer: "return=minimal"
    });
    expect(serialized).not.toContain("saved_reports_test");
    expect(serialized).not.toContain("agentproof-test.supabase.co");
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("reportBody");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("purges tenant memory saved reports without returning report bodies or raw evidence", async () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.reprompt.prompt = "raw tenant purge prompt with sk-secret_should_not_leak";
    report.evidenceIndex.push({
      id: "ev_tenant_purge_secret",
      kind: "diff",
      label: "Patch excerpt",
      summary: "Patch excerpt with github_pat_secret_should_not_leak",
      confidence: 0.9
    });
    const tenantAFirst = await createSavedReport(report, { tenantId: "tenant_a" });
    await createSavedReport(report, { tenantId: "tenant_a" });
    const tenantB = await createSavedReport(report, { tenantId: "tenant_b" });

    const result = await purgeTenantSavedReportsForDeletion({ tenantId: "tenant_a" });
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      privacy: "saved-report-tenant-purge-metadata-only",
      deletedCount: 2,
      countBasis: "exact-memory-delete-count"
    });
    await expect(getSavedReport(tenantAFirst.id, { tenantId: "tenant_a" })).resolves.toBeNull();
    await expect(getSavedReport(tenantB.id, { tenantId: "tenant_b" })).resolves.toMatchObject({
      tenantId: "tenant_b"
    });
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("tenant_b");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("github_pat_secret_should_not_leak");
    expect(serialized).not.toContain("sk-secret_should_not_leak");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("purges Supabase tenant saved reports through count-only DELETE without reading reports", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    process.env.AGENTPROOF_REPORTS_TABLE = "saved_reports_test";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-range": "0-0/3"
          }
        });
      }

      if (init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }

      return new Response("unexpected report body read", { status: 500 });
    });
    global.fetch = fetchMock as typeof fetch;

    const result = await purgeTenantSavedReportsForDeletion({ tenantId: "tenant_a" });
    const [countUrl, countInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [deleteUrl, deleteInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      privacy: "saved-report-tenant-purge-metadata-only",
      deletedCount: 3,
      countBasis: "pre-delete-supabase-count"
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(countUrl).toBe("https://agentproof-test.supabase.co/rest/v1/saved_reports_test?tenant_id=eq.tenant_a&select=id");
    expect(countInit.method).toBe("HEAD");
    expect(countInit.body).toBeUndefined();
    expect(countInit.headers).toMatchObject({
      Prefer: "count=exact",
      Range: "0-0"
    });
    expect(deleteUrl).toBe("https://agentproof-test.supabase.co/rest/v1/saved_reports_test?tenant_id=eq.tenant_a");
    expect(deleteInit.method).toBe("DELETE");
    expect(deleteInit.body).toBeUndefined();
    expect(deleteInit.headers).toMatchObject({
      Prefer: "return=minimal"
    });
    expect(String(countUrl)).not.toContain("select=report");
    expect(String(deleteUrl)).not.toContain("select=report");
    expect(serialized).not.toContain("saved_reports_test");
    expect(serialized).not.toContain("agentproof-test.supabase.co");
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("reportBody");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("does not call Supabase for unsafe saved report ids", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;

    await expect(getSavedReport("../secret")).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when configured Supabase storage is unavailable", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;

    await expect(createSavedReport(generateVerificationReport(demoScenarios.clean))).rejects.toThrow(SavedReportStoreError);
  });
});
