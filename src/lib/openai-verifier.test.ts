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

  it("trusts only the redacted deterministic baseline when source evidence contains secrets", async () => {
    const input = {
      ...demoScenarios.clean,
      taskText: "Use sk-input_secret_should_not_leak for this task."
    };
    const report = generateVerificationReport(input);
    report.source.title = "Fix token=source-secret-value";
    report.evidenceIndex[0].summary = "Authorization: Bearer evidence-secret-value";
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const requestBody = JSON.parse(String(init?.body)) as {
        input: Array<{ content: Array<{ text: string }> }>;
      };
      const userPayload = JSON.parse(requestBody.input[1].content[0].text) as {
        deterministicReport: unknown;
      };

      return new Response(JSON.stringify({ output_text: JSON.stringify(userPayload.deterministicReport) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });

    const result = await verifyReportWithOpenAI(input, report, {
      apiKey: "test-key",
      fetchFn: fetchMock as unknown as typeof fetch
    });
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("source-secret-value");
    expect(serialized).not.toContain("evidence-secret-value");
    expect(serialized).not.toContain("sk-input_secret_should_not_leak");
    expect(serialized).toContain("[redacted]");
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

  it("surfaces sanitized OpenAI error messages for smoke diagnostics", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "Invalid schema for response_format with key sk-test-secret."
          }
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      )
    );

    await expect(
      verifyReportWithOpenAI(input, report, {
        apiKey: "test-key",
        fetchFn: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow("Invalid schema for response_format with key [redacted]");
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

  it("rejects structured model output that upgrades weak test evidence to met", async () => {
    const input = demoScenarios["missing-tests"];
    const report = generateVerificationReport(input);
    const invalid = structuredClone(report);
    invalid.requirements[2].status = "met";
    invalid.requirements[2].gaps = [];
    invalid.summary.confidence = 1;
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
    ).rejects.toThrow("cannot be met without passing test, build, or CI execution evidence");
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

  it("rejects structured model output that changes deterministic metadata", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const invalid = structuredClone(report);
    invalid.analysisId = "ap_fabricated";
    invalid.source.title = "Different PR title";
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
    ).rejects.toThrow("analysisId changed");
  });

  it("rejects structured model output that rewrites extracted requirement or claim identity", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const invalid = structuredClone(report);
    invalid.requirements[0].requirementText = "Invent a different acceptance criterion.";
    if (invalid.claims[0]) {
      invalid.claims[0].text = "Invented agent claim.";
    }
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
    ).rejects.toThrow("requirement");
  });

  it("rejects structured model output that rewrites deterministic testing status", async () => {
    const input = demoScenarios["missing-tests"];
    const report = generateVerificationReport(input);
    const invalid = structuredClone(report);
    invalid.testing.missingTests = [];
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
    ).rejects.toThrow("testing changed");
  });

  it("allows deterministic testing fields when only JSON object key order changes", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const output = structuredClone(report);
    output.testing = {
      missingTests: report.testing.missingTests,
      typecheckStatus: report.testing.typecheckStatus,
      lintStatus: report.testing.lintStatus,
      ciStatus: report.testing.ciStatus
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: JSON.stringify(output) }), {
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
  });
});
