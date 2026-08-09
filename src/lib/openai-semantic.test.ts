import { describe, expect, it, vi } from "vitest";
import {
  analyzeSemanticsWithOpenAI,
  retrieveSemanticsWithOpenAIBackground,
  submitSemanticsWithOpenAIBackground
} from "./openai-semantic";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";

describe("OpenAI semantic adapter", () => {
  it("submits semantic analysis in background mode without storing provider output", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      id: "resp_background_123",
      status: "queued",
      output: []
    }));

    const result = await submitSemanticsWithOpenAIBackground(input, report, {
      apiKey: "test-key",
      model: "test-model",
      fetchFn: fetchMock as unknown as typeof fetch
    });

    expect(result).toEqual({
      status: "pending",
      responseId: "resp_background_123",
      providerStatus: "queued"
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.background).toBe(true);
    expect(requestBody.store).toBe(false);
    expect(JSON.stringify(result)).not.toContain("output");
  });

  it("retrieves and validates a completed background semantic response", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const requirementId = report.proofGraph.nodes[0]?.requirementId;
    const evidenceId = report.evidenceIndex.find((item) => ["diff", "changed_file", "test", "check"].includes(item.kind))?.id;
    expect(requirementId).toBeTruthy();
    expect(evidenceId).toBeTruthy();
    const output = semanticOutput(requirementId!, evidenceId!);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      id: "resp_background_123",
      status: "completed",
      output_text: JSON.stringify(output)
    }));

    const result = await retrieveSemanticsWithOpenAIBackground(
      "resp_background_123",
      input,
      report,
      { apiKey: "test-key", fetchFn: fetchMock as unknown as typeof fetch }
    );

    expect(result).toMatchObject({
      status: "completed",
      responseId: "resp_background_123",
      output
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses/resp_background_123",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("classifies provider throttling as retryable without retaining the provider error body", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      "token=github_pat_abcdefghijklmnopqrstuvwxyz1234567890 provider overloaded",
      { status: 429 }
    ));

    await expect(retrieveSemanticsWithOpenAIBackground(
      "resp_background_123",
      input,
      report,
      { apiKey: "test-key", fetchFn: fetchMock as unknown as typeof fetch }
    )).rejects.toMatchObject({
      code: "openai_rate_limited",
      retryable: true,
      httpStatus: 429
    });

    await retrieveSemanticsWithOpenAIBackground(
      "resp_background_123",
      input,
      report,
      { apiKey: "test-key", fetchFn: fetchMock as unknown as typeof fetch }
    ).catch((error) => {
      expect(String(error.message)).not.toContain("github_pat_");
      expect(String(error.message)).not.toContain("token=");
    });
  });

  it("sends a transient strict-schema request and returns only validator-approved semantic output", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const requirementId = report.proofGraph.nodes[0]?.requirementId;
    const evidenceId = report.evidenceIndex.find((item) => ["diff", "changed_file", "test", "check"].includes(item.kind))?.id;
    expect(requirementId).toBeTruthy();
    expect(evidenceId).toBeTruthy();
    const response = {
      requirement_evidence_relations: [{
        requirement_id: requirementId,
        evidence_id: evidenceId,
        relation: "partial_support",
        rationale: "The evidence covers part of the requested behavior.",
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
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ output_text: JSON.stringify(response) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const result = await analyzeSemanticsWithOpenAI(input, report, {
      apiKey: "test-key",
      model: "test-model",
      fetchFn: fetchMock as unknown as typeof fetch,
      outputLocale: "ko"
    });

    expect(result.validation.disposition).toBe("accepted");
    expect(result.output).toEqual(response);
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.model).toBe("test-model");
    expect(requestBody.store).toBe(false);
    expect(requestBody.text.format.name).toBe("agentproof_llm_semantic_output_v1");
    expect(requestBody.input[1].content[0].text).toContain('"output_locale":"ko"');
  });

  it("rejects model output with references outside the package catalog", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        output_text: JSON.stringify({
          requirement_evidence_relations: [],
          requirement_assessments: [{
            requirement_id: "unknown-requirement",
            requirement_summary: "Unknown requirement.",
            evidence_support: "no_evidence_found",
            summary: "No evidence was supplied.",
            evidence_ids: [],
            uncertainty: "high"
          }],
          evidence_gaps: [],
          review_targets: [],
          remediation_requests: [],
          uncertainties: []
        })
      }), { status: 200 })
    );

    await expect(
      analyzeSemanticsWithOpenAI(input, report, {
        apiKey: "test-key",
        fetchFn: fetchMock as unknown as typeof fetch
      })
    ).rejects.toThrow("semantic output failed validation");
  });

  it.runIf(process.env.AGENTPROOF_LLM_LIVE === "1")(
    "runs a store:false live smoke with the public demo fixture",
    async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      expect(apiKey).toBeTruthy();

      const input = demoScenarios.clean;
      const report = generateVerificationReport(input);
      const result = await analyzeSemanticsWithOpenAI(input, report, {
        apiKey: apiKey!,
        model: process.env.OPENAI_MODEL,
        outputLocale: "en"
      });

      expect(["accepted", "partial"]).toContain(result.validation.disposition);
      expect(result.output.requirement_assessments.length).toBeGreaterThan(0);
      process.stdout.write(`${JSON.stringify({
        LIVE_SEMANTIC_SMOKE: {
          disposition: result.validation.disposition,
          assessments: result.output.requirement_assessments.map((item) => ({
            evidence_support: item.evidence_support,
            summary: item.summary
          })),
          evidence_gaps: result.output.evidence_gaps.map((item) => item.description),
          review_targets: result.output.review_targets.map((item) => ({
            priority: item.priority,
            target_evidence_id: item.target_evidence_id,
            inspection_goal: item.inspection_goal
          }))
        }
      })}\n`);
    },
    45_000
  );
});

function semanticOutput(requirementId: string, evidenceId: string) {
  return {
    requirement_evidence_relations: [{
      requirement_id: requirementId,
      evidence_id: evidenceId,
      relation: "partial_support",
      rationale: "The evidence covers part of the requested behavior.",
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
