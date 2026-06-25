import { afterEach, describe, expect, it } from "vitest";
import { decodeSharedReport, encodeReportForShare } from "@/lib/report-share";
import { clearSavedReportsForTests } from "@/lib/server-report-store";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReport } from "@/lib/verifier";
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
