import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeSharedReport, encodeReportForShare } from "@/lib/report-share";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport } from "@/lib/verifier";
import { POST } from "./route";

describe("POST /api/llm/verify", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is disabled without OpenAI key and internal verifier token", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/llm/verify", {
        method: "POST",
        body: JSON.stringify({
          input: demoScenarios.clean,
          report: generateVerificationReport(demoScenarios.clean)
        })
      })
    );

    expect(response.status).toBe(501);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires the internal verifier token before model calls", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AGENTPROOF_LLM_TOKEN", "secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/llm/verify", {
        method: "POST",
        body: JSON.stringify({
          input: demoScenarios.clean,
          report: generateVerificationReport(demoScenarios.clean)
        })
      })
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("requires tenant plan context before OpenAI calls when quota enforcement is enabled", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AGENTPROOF_LLM_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", JSON.stringify([
      {
        tenantId: "tenant_a",
        monthlyAnalysisLimit: 5,
        enabled: true,
        plan: "team",
        structuredLlmVerifierEnabled: true
      }
    ]));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/llm/verify", {
        method: "POST",
        headers: { "x-agentproof-llm-token": "secret" },
        body: JSON.stringify({
          input: demoScenarios.clean,
          report: generateVerificationReport(demoScenarios.clean),
          rawDiff: "Patch excerpt: token=github_pat_secret_should_not_leak_1234567890"
        })
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(403);
    expect(json).toEqual({
      error: "LLM verifier requires tenant plan context.",
      code: "llm_verifier_tenant_required",
      fallback: "Use the deterministic verifier report."
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("github_pat_secret");
  });

  it("fails closed before OpenAI calls when the tenant verifier plan is disabled or invalid", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AGENTPROOF_LLM_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", JSON.stringify([
      {
        tenantId: "tenant_a",
        monthlyAnalysisLimit: 5,
        enabled: true,
        plan: "team",
        structuredLlmVerifierEnabled: false
      }
    ]));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const disabled = await POST(
      new Request("http://localhost/api/llm/verify?tenantId=tenant_a", {
        method: "POST",
        headers: { "x-agentproof-llm-token": "secret" },
        body: JSON.stringify({
          input: demoScenarios.clean,
          report: generateVerificationReport(demoScenarios.clean)
        })
      })
    );
    const disabledJson = await disabled.json();

    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", "{not-json");
    const invalid = await POST(
      new Request("http://localhost/api/llm/verify?tenantId=tenant_a", {
        method: "POST",
        headers: { "x-agentproof-llm-token": "secret" },
        body: JSON.stringify({
          input: demoScenarios.clean,
          report: generateVerificationReport(demoScenarios.clean)
        })
      })
    );
    const invalidJson = await invalid.json();
    const serialized = JSON.stringify({ disabledJson, invalidJson });

    expect(disabled.status).toBe(403);
    expect(disabledJson).toEqual({
      error: "LLM verifier is not enabled for this tenant plan.",
      code: "llm_verifier_plan_disabled",
      fallback: "Use the deterministic verifier report."
    });
    expect(invalid.status).toBe(503);
    expect(invalidJson).toEqual({
      error: "LLM verifier tenant plan is unavailable.",
      code: "llm_verifier_plan_unavailable",
      fallback: "Use the deterministic verifier report."
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(serialized).not.toContain("{not-json");
    expect(serialized).not.toContain("tenant_a");
  });

  it("rejects oversized requests from content-length before model calls", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AGENTPROOF_LLM_TOKEN", "secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/llm/verify", {
        method: "POST",
        headers: {
          "content-length": "220001",
          "x-agentproof-llm-token": "secret"
        },
        body: "{}"
      })
    );

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects full reports with missing provenance before model calls", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AGENTPROOF_LLM_TOKEN", "secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;

    const response = await POST(
      new Request("http://localhost/api/llm/verify", {
        method: "POST",
        headers: { "x-agentproof-llm-token": "secret" },
        body: JSON.stringify({
          input: demoScenarios["scope-creep"],
          report
        })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.details.join("\n")).toContain("scope.evidenceRefs is required");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("redacts validation details before returning them", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AGENTPROOF_LLM_TOKEN", "secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const report = generateVerificationReport(demoScenarios.clean);
    report.requirements[0].evidenceRefs = ["sk-secret_should_not_leak"];

    const response = await POST(
      new Request("http://localhost/api/llm/verify", {
        method: "POST",
        headers: { "x-agentproof-llm-token": "secret" },
        body: JSON.stringify({
          input: demoScenarios.clean,
          report
        })
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(422);
    expect(serialized).not.toContain("sk-secret_should_not_leak");
    expect(serialized).toContain("[redacted]");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects summary-only reports before model calls", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AGENTPROOF_LLM_TOKEN", "secret");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const fullReport = generateVerificationReport(demoScenarios["scope-creep"]);
    const summaryOnlyReport = decodeSharedReport(encodeReportForShare(fullReport));

    const response = await POST(
      new Request("http://localhost/api/llm/verify", {
        method: "POST",
        headers: { "x-agentproof-llm-token": "secret" },
        body: JSON.stringify({
          input: demoScenarios["scope-creep"],
          report: summaryOnlyReport
        })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.details.join("\n")).toContain("evidenceIndex must contain evidence items for full reports");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns OpenAI output only after runtime validation succeeds", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AGENTPROOF_LLM_TOKEN", "secret");
    const report = generateVerificationReport(demoScenarios.clean);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: JSON.stringify(report) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/llm/verify", {
        method: "POST",
        headers: { "x-agentproof-llm-token": "secret" },
        body: JSON.stringify({
          input: demoScenarios.clean,
          report
        })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.source).toBe("openai");
    expect(json.report).toEqual(report);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows OpenAI calls when the tenant verifier plan is enabled", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AGENTPROOF_LLM_TOKEN", "secret");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_ENFORCEMENT_ENABLED", "true");
    vi.stubEnv("AGENTPROOF_USAGE_QUOTA_LIMITS", JSON.stringify([
      {
        tenantId: "tenant_a",
        monthlyAnalysisLimit: 5,
        enabled: true,
        plan: "team",
        structuredLlmVerifierEnabled: true
      }
    ]));
    const report = generateVerificationReport(demoScenarios.clean);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: JSON.stringify(report) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/llm/verify", {
        method: "POST",
        headers: {
          "x-agentproof-llm-token": "secret",
          "x-agentproof-tenant-id": "tenant_a"
        },
        body: JSON.stringify({
          input: demoScenarios.clean,
          report
        })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.source).toBe("openai");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns deterministic fallback when model output fails validation", async () => {
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("AGENTPROOF_LLM_TOKEN", "secret");
    const report = generateVerificationReport(demoScenarios.clean);
    report.source.title = "Fix token=body_secret_should_not_leak";
    const invalid = structuredClone(report);
    invalid.evidenceIndex[0].summary = "Fabricated evidence.";
    invalid.requirements[0].evidenceRefs = ["sk-model_secret_should_not_leak"];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: JSON.stringify(invalid) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(
      new Request("http://localhost/api/llm/verify", {
        method: "POST",
        headers: { "x-agentproof-llm-token": "secret" },
        body: JSON.stringify({
          input: demoScenarios.clean,
          report
        })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.source).toBe("deterministic-fallback");
    expect(json.report.analysisId).toBe(report.analysisId);
    expect(JSON.stringify(json.report)).not.toContain("body_secret_should_not_leak");
    expect(JSON.stringify(json.report)).toContain("[redacted]");
    expect(json.warning).toContain("failed validation");
    expect(json.warning).not.toContain("sk-model_secret_should_not_leak");
    expect(json.warning).toContain("[redacted]");
  });
});
