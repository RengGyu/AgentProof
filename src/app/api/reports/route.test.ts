import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeSharedReport, encodeReportForShare } from "@/lib/report-share";
import { clearSavedReportsForTests, SAVED_REPORT_DURABILITY, SAVED_REPORT_DURABILITY_WARNING } from "@/lib/server-report-store";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport } from "@/lib/verifier";
import { DELETE, GET } from "./[id]/route";
import { POST } from "./route";

describe("POST /api/reports", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AGENTPROOF_REPORTS_SUPABASE_URL;
    delete process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY;
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

  it("saves a summary-only report and returns a private no-store response", async () => {
    const response = await POST(
      new Request("http://localhost/api/reports", {
        method: "POST",
        body: JSON.stringify({ report: generateVerificationReport(demoScenarios["scope-creep"]) })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(json.url).toMatch(/^http:\/\/localhost\/reports\//);
    expect(json.privacy).toBe("summary-only");
    expect(json.durability).toBe(SAVED_REPORT_DURABILITY);
    expect(json.durabilityWarning).toBe(SAVED_REPORT_DURABILITY_WARNING);
  });

  it("returns durability metadata when reading a saved report", async () => {
    const saveResponse = await POST(
      new Request("http://localhost/api/reports", {
        method: "POST",
        body: JSON.stringify({ report: generateVerificationReport(demoScenarios["scope-creep"]) })
      })
    );
    const saved = await saveResponse.json();
    const getResponse = await GET(new Request(`http://localhost/api/reports/${saved.id}`), {
      params: Promise.resolve({ id: saved.id })
    });
    const json = await getResponse.json();

    expect(getResponse.status).toBe(200);
    expect(json.privacy).toBe("summary-only");
    expect(json.expiresAt).toBe(saved.expiresAt);
    expect(json.durability).toBe(SAVED_REPORT_DURABILITY);
    expect(json.durabilityWarning).toBe(SAVED_REPORT_DURABILITY_WARNING);
  });

  it("rejects invalid reports", async () => {
    const response = await POST(
      new Request("http://localhost/api/reports", {
        method: "POST",
        body: JSON.stringify({ report: { analysisId: "bad" } })
      })
    );

    expect(response.status).toBe(422);
  });

  it("rejects oversized saved-report payloads before validation or storage", async () => {
    const response = await POST(
      new Request("http://localhost/api/reports", {
        method: "POST",
        body: "x".repeat(121_000)
      })
    );
    const json = await response.json();

    expect(response.status).toBe(413);
    expect(json.error).toContain("too large");
  });

  it("rejects full reports that omit required provenance", async () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;

    const response = await POST(
      new Request("http://localhost/api/reports", {
        method: "POST",
        body: JSON.stringify({ report })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(422);
    expect(json.details.join("\n")).toContain("scope.evidenceRefs is required");
  });

  it("redacts validation details before returning them", async () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.requirements[0].evidenceRefs = ["github_pat_secret_should_not_leak_1234567890"];

    const response = await POST(
      new Request("http://localhost/api/reports", {
        method: "POST",
        body: JSON.stringify({ report })
      })
    );
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(422);
    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("github_pat_secret");
  });

  it("accepts already summary-only reports for summary storage", async () => {
    const fullReport = generateVerificationReport(demoScenarios["scope-creep"]);
    const summaryOnlyReport = decodeSharedReport(encodeReportForShare(fullReport));

    const response = await POST(
      new Request("http://localhost/api/reports", {
        method: "POST",
        body: JSON.stringify({ report: summaryOnlyReport })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.privacy).toBe("summary-only");
  });

  it("fails closed when configured durable storage cannot save", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;

    const response = await POST(
      new Request("http://localhost/api/reports", {
        method: "POST",
        body: JSON.stringify({ report: generateVerificationReport(demoScenarios.clean) })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.error).toBe("Saved report storage failed.");
  });

  it("fails closed when configured durable storage cannot read or delete", async () => {
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as typeof fetch;

    const getResponse = await GET(new Request("http://localhost/api/reports/saved_1"), {
      params: Promise.resolve({ id: "saved_1" })
    });
    const getJson = await getResponse.json();
    const deleteResponse = await DELETE(new Request("http://localhost/api/reports/saved_1"), {
      params: Promise.resolve({ id: "saved_1" })
    });
    const deleteJson = await deleteResponse.json();

    expect(getResponse.status).toBe(503);
    expect(getJson.error).toBe("Saved report lookup failed.");
    expect(deleteResponse.status).toBe(503);
    expect(deleteJson.error).toBe("Saved report delete failed.");
  });
});
