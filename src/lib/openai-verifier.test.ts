import { describe, expect, it, vi } from "vitest";
import { demoScenarios } from "./sample-data";
import { extractOpenAIResponseText, verifyReportWithOpenAI } from "./openai-verifier";
import { generateVerificationReport } from "./verifier";

describe("openai verifier adapter", () => {
  it("extracts text from Responses API shapes", () => {
    expect(extractOpenAIResponseText({ output_text: "{\"ok\":true}" })).toBe("{\"ok\":true}");
    expect(
      extractOpenAIResponseText({
        output: [{ content: [{ type: "output_text", text: "{\"ok\":true}" }] }]
      })
    ).toBe("{\"ok\":true}");
  });

  it("validates structured model output before trusting it", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: JSON.stringify(report) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(
      verifyReportWithOpenAI(input, report, {
        apiKey: "test-key",
        fetchFn: fetchMock as unknown as typeof fetch
      })
    ).resolves.toEqual(report);

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.text.format.type).toBe("json_schema");
    expect(requestBody.store).toBe(false);
  });

  it("rejects invalid structured model output", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const invalid = { ...report, requirements: [{ ...report.requirements[0], evidenceRefs: ["missing"] }] };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: JSON.stringify(invalid) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    await expect(
      verifyReportWithOpenAI(input, report, {
        apiKey: "test-key",
        fetchFn: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow("failed validation");
  });
});
