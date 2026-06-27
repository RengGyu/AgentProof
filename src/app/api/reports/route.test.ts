import { afterEach, describe, expect, it } from "vitest";
import { decodeSharedReport, encodeReportForShare } from "@/lib/report-share";
import { clearSavedReportsForTests, SAVED_REPORT_DURABILITY, SAVED_REPORT_DURABILITY_WARNING } from "@/lib/server-report-store";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport } from "@/lib/verifier";
import { GET } from "./[id]/route";
import { POST } from "./route";

describe("POST /api/reports", () => {
  afterEach(() => {
    clearSavedReportsForTests();
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
});
