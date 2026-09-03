import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeSharedReport, encodeReportForShare } from "@/lib/report-share";
import {
  clearSavedReportsForTests,
  createSavedReport,
  SAVED_REPORT_DURABILITY,
  SAVED_REPORT_DURABILITY_WARNING
} from "@/lib/server-report-store";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport, generateVerificationReportV2FromInput } from "@/lib/verifier";
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
    expect(json.authenticity).toBe("imported_unverified");
    expect(json.authenticityNotice).toContain("unverified");
    expect(json.durability).toBe(SAVED_REPORT_DURABILITY);
    expect(json.durabilityWarning).toBe(SAVED_REPORT_DURABILITY_WARNING);
  });

  it("saves a v2 strict-contract report through the matching validation mode", async () => {
    const response = await POST(
      new Request("http://localhost/api/reports", {
        method: "POST",
        body: JSON.stringify({ report: generateVerificationReportV2FromInput(demoScenarios.clean) })
      })
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.privacy).toBe("summary-only");
  });

  it("rejects inbound authoritative artifact reports before saving", async () => {
    const marker = "raw-report-save-authority-marker";
    process.env.AGENTPROOF_REPORTS_SUPABASE_URL = "https://agentproof-test.supabase.co";
    process.env.AGENTPROOF_REPORTS_SUPABASE_SERVICE_ROLE_KEY = "service-role-secret";
    const fetchMock = vi.fn(async () => new Response("[]", {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    global.fetch = fetchMock as typeof fetch;

    const response = await POST(
      new Request("http://localhost/api/reports", {
        method: "POST",
        body: JSON.stringify({ report: authoritativeArtifactReport(marker) })
      })
    );
    const serialized = await response.text();

    expect(response.status).toBe(422);
    expect(JSON.parse(serialized)).toEqual({
      error: "Report failed validation.",
      details: ["An inbound untrusted full report cannot carry active v2 contract authority."]
    });
    expect(serialized).not.toContain(marker);
    expect(fetchMock).not.toHaveBeenCalled();
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

  it("hides tenant-scoped saved reports unless the report access key is provided", async () => {
    const saved = await createSavedReport(generateVerificationReport(demoScenarios["scope-creep"]), {
      tenantId: "tenant_test"
    });

    const missingKeyResponse = await GET(new Request(`http://localhost/api/reports/${saved.id}`), {
      params: Promise.resolve({ id: saved.id })
    });
    const missingKeyJson = await missingKeyResponse.json();
    const wrongKeyResponse = await GET(new Request(`http://localhost/api/reports/${saved.id}?key=wrong-key`), {
      params: Promise.resolve({ id: saved.id })
    });
    const wrongKeyJson = await wrongKeyResponse.json();
    const validKeyResponse = await GET(new Request(`http://localhost/api/reports/${saved.id}?key=${saved.accessToken}`), {
      params: Promise.resolve({ id: saved.id })
    });
    const validKeyJson = await validKeyResponse.json();

    expect(missingKeyResponse.status).toBe(404);
    expect(wrongKeyResponse.status).toBe(404);
    expect(missingKeyJson).toEqual({
      error: "Saved report was not found or has expired."
    });
    expect(wrongKeyJson).not.toHaveProperty("report");
    expect(wrongKeyJson).not.toHaveProperty("createdAt");
    expect(wrongKeyJson).not.toHaveProperty("expiresAt");
    expect(wrongKeyJson).not.toHaveProperty("durability");
    expect(validKeyResponse.status).toBe(200);
    expect(validKeyJson.report.evidenceIndex).toEqual([]);
    expect(validKeyJson.privacy).toBe("summary-only");
    expect(JSON.stringify(validKeyJson)).not.toContain(saved.accessToken);
  });

  it("does not disclose tenant-scoped saved report existence on wrong-key delete", async () => {
    const saved = await createSavedReport(generateVerificationReport(demoScenarios.clean), {
      tenantId: "tenant_test"
    });

    const wrongKeyResponse = await DELETE(new Request(`http://localhost/api/reports/${saved.id}?key=wrong-key`), {
      params: Promise.resolve({ id: saved.id })
    });
    const wrongKeyJson = await wrongKeyResponse.json();
    const stillReadable = await GET(new Request(`http://localhost/api/reports/${saved.id}?key=${saved.accessToken}`), {
      params: Promise.resolve({ id: saved.id })
    });

    expect(wrongKeyResponse.status).toBe(200);
    expect(wrongKeyJson).toEqual({ deleted: false });
    expect(stillReadable.status).toBe(200);
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
        body: "x".repeat(1_000_001)
      })
    );
    const json = await response.json();

    expect(response.status).toBe(413);
    expect(json.error).toContain("too large");
  });

  it("projects a valid full report above the legacy request limit before summary-only storage", async () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const privateEvidenceMarker = "full-evidence-marker-that-must-not-be-saved";
    const evidence = report.evidenceIndex[0];
    report.evidenceIndex.push(...Array.from({ length: 45 }, (_, index) => ({
      ...evidence,
      id: `large_evidence_${index}`,
      summary: `${privateEvidenceMarker}-${"x".repeat(2_900)}`
    })));
    const body = JSON.stringify({ report });

    expect(new TextEncoder().encode(body).length).toBeGreaterThan(120_000);

    const response = await POST(
      new Request("http://localhost/api/reports", { method: "POST", body })
    );
    const saved = await response.json();

    expect(response.status).toBe(200);

    const readResponse = await GET(new Request(saved.url), {
      params: Promise.resolve({ id: saved.id })
    });
    const read = await readResponse.json();

    expect(readResponse.status).toBe(200);
    expect(read.report.evidenceIndex).toEqual([]);
    expect(JSON.stringify(read.report)).not.toContain(privateEvidenceMarker);
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

function authoritativeArtifactReport(marker: string) {
  const headSha = "a".repeat(40);
  const baseSha = "b".repeat(40);
  const contract = {
    version: 2 as const,
    scope: "complete_objective_set" as const,
    objectives: [{
      id: "reset_doc",
      objective: "Document the local reset command.",
      criteria: [{
        id: "reset_literal",
        type: "artifact" as const,
        label: "The reset document includes the exact test command.",
        paths: ["docs/reset.md"],
        artifact: { kind: "documentation_literal" as const, literal: "Run pnpm test." }
      }]
    }]
  };
  return generateVerificationReportV2FromInput({
    ...demoScenarios.clean,
    title: marker,
    changedFiles: [{ path: "docs/reset.md", status: "modified", patch: "+Run pnpm test." }],
    checks: [],
    logs: [],
    verificationContractSourceV2: { kind: "provided_requirement", contract },
    verificationContractBindingV2: {
      sourceKind: "provided_requirement",
      sourceIdentity: "synthetic:save-authority:1",
      sourceContent: JSON.stringify(contract),
      headSha,
      baseSha
    },
    verificationCriterionEvidenceV2: {
      artifactBlobs: [{ path: "docs/reset.md", content: "Stop the server.\nRun pnpm test." }]
    },
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha,
      baseSha,
      changedFileInventory: { version: 1, completeness: "complete", headSha },
      evidenceCapturedAt: "2026-08-22T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
    }
  });
}
