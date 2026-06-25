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

  it("normalizes nullable optional fields returned for OpenAI strict schemas", async () => {
    const input = { ...demoScenarios.clean };
    delete input.url;
    delete input.author;
    delete input.baseBranch;
    delete input.headBranch;

    const report = generateVerificationReport(input);
    const output = structuredClone(report) as unknown as Record<string, unknown>;
    output.source = {
      ...(output.source as Record<string, unknown>),
      url: null,
      author: null,
      baseBranch: null,
      headBranch: null
    };
    output.evidenceIndex = (output.evidenceIndex as Record<string, unknown>[]).map((item) =>
      item.locator === undefined ? { ...item, locator: null } : item
    );

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: JSON.stringify(output) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const result = await verifyReportWithOpenAI(input, report, {
      apiKey: "test-key",
      fetchFn: fetchMock as unknown as typeof fetch
    });

    expect(result.source.url).toBeUndefined();
    expect(Object.hasOwn(result.source, "url")).toBe(false);
    expect(result.evidenceIndex.some((item) => item.locator === null)).toBe(false);
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

  it("rejects structured model output that omits full-report provenance", async () => {
    const input = demoScenarios["scope-creep"];
    const report = generateVerificationReport(input);
    const invalid = structuredClone(report);
    delete invalid.scope.evidenceRefs;
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
    ).rejects.toThrow("scope.evidenceRefs is required");
  });

  it("rejects structured model output that changes deterministic evidence", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const invalid = structuredClone(report);
    invalid.evidenceIndex[0].summary = "Fabricated task evidence.";
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
    ).rejects.toThrow("changed deterministic evidence");
  });
});
