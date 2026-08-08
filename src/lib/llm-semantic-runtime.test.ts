import { describe, expect, it, vi } from "vitest";
import { enrichReportWithOpenAISemantics } from "./llm-semantic-runtime";
import { validateVerificationReport } from "./report-validation";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";
import type { LlmSemanticOutput } from "./llm-semantic-output";

function semanticOutput(): LlmSemanticOutput {
  return {
    requirement_evidence_relations: [],
    requirement_assessments: [{
      requirement_id: "req_1",
      requirement_summary: "Review the supplied evidence for the requested behavior.",
      evidence_support: "no_evidence_found",
      summary: "No supplied evidence directly supports this requirement.",
      evidence_ids: [],
      uncertainty: "high"
    }],
    evidence_gaps: [{
      requirement_id: "req_1",
      gap_type: "missing_implementation_evidence",
      priority: "high",
      description: "No implementation evidence is available for this requirement.",
      review_impact: "The available evidence cannot support a detailed assessment.",
      needed_evidence: "Provide implementation or focused test evidence.",
      evidence_ids: [],
      uncertainty: "high"
    }],
    review_targets: [],
    remediation_requests: [{
      requirement_id: "req_1",
      request_type: "provide_or_link_evidence",
      priority: "high",
      instruction: "Provide bounded evidence for the requested behavior.",
      rationale: "No implementation evidence is available.",
      expected_evidence: "A relevant implementation, test, or execution evidence reference.",
      evidence_ids: [],
      uncertainty: "high"
    }],
    uncertainties: []
  };
}

describe("LLM semantic runtime gate", () => {
  it("does not send an essential analysis package", async () => {
    const analyze = vi.fn();
    const deterministic = generateVerificationReport(demoScenarios.clean);

    const result = await enrichReportWithOpenAISemantics(demoScenarios.clean, deterministic, {
      env: { OPENAI_API_KEY: "test-key", AGENTPROOF_LLM_SEMANTIC_ENABLED: "true" },
      mode: "essential",
      analyze
    });

    expect(analyze).not.toHaveBeenCalled();
    expect(result.status).toBe("disabled");
    expect(result.report).toBe(deterministic);
  });

  it("adds only validator-approved semantic output for enhanced analysis without a ZDR flag", async () => {
    const deterministic = generateVerificationReport(demoScenarios.clean);
    const analyze = vi.fn().mockResolvedValue({
      output: semanticOutput(),
      validation: { disposition: "accepted", candidate: semanticOutput(), rejected_units: [], discard_reason_codes: [] }
    });

    const result = await enrichReportWithOpenAISemantics(demoScenarios.clean, deterministic, {
      env: {
        OPENAI_API_KEY: "test-key",
        AGENTPROOF_LLM_SEMANTIC_ENABLED: "true",
        OPENAI_MODEL: "test-model"
      },
      mode: "enhanced",
      analyze
    });

    expect(result.status).toBe("included");
    expect(result.report).not.toBe(deterministic);
    expect(result.report.semantic).toEqual(semanticOutput());
    expect(validateVerificationReport(result.report, { mode: "full" }).valid).toBe(true);
    expect(analyze).toHaveBeenCalledWith(demoScenarios.clean, deterministic, expect.objectContaining({
      apiKey: "test-key",
      model: "test-model"
    }));
  });

  it("keeps deterministic evidence and records a bounded unavailable state when the model call fails", async () => {
    const deterministic = generateVerificationReport(demoScenarios.clean);

    const result = await enrichReportWithOpenAISemantics(demoScenarios.clean, deterministic, {
      env: {
        OPENAI_API_KEY: "test-key",
        AGENTPROOF_LLM_SEMANTIC_ENABLED: "true"
      },
      mode: "enhanced",
      analyze: vi.fn().mockRejectedValue(new Error("provider unavailable"))
    });

    expect(result.status).toBe("unavailable");
    expect(result.attempts).toBe(2);
    expect(result.report.requirements).toEqual(deterministic.requirements);
    expect(result.report.semantic).toBeUndefined();
    expect(result.report.semanticAnalysis).toEqual({ status: "unavailable", attempts: 2 });
  });

  it("retries an enhanced analysis once and records the successful second attempt", async () => {
    const deterministic = generateVerificationReport(demoScenarios.clean);
    const analyze = vi.fn()
      .mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockResolvedValueOnce({
        output: semanticOutput(),
        validation: { disposition: "accepted", candidate: semanticOutput(), rejected_units: [], discard_reason_codes: [] }
      });

    const result = await enrichReportWithOpenAISemantics(demoScenarios.clean, deterministic, {
      env: { OPENAI_API_KEY: "test-key", AGENTPROOF_LLM_SEMANTIC_ENABLED: "true" },
      mode: "enhanced",
      analyze
    });

    expect(analyze).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("included");
    expect(result.attempts).toBe(2);
    expect(result.report.semanticAnalysis).toEqual({ status: "included", attempts: 2 });
  });

  it("records a privacy-safe unavailable status after the retry is exhausted", async () => {
    const deterministic = generateVerificationReport(demoScenarios.clean);
    const analyze = vi.fn().mockRejectedValue(new Error("provider response must not persist"));

    const result = await enrichReportWithOpenAISemantics(demoScenarios.clean, deterministic, {
      env: { OPENAI_API_KEY: "test-key", AGENTPROOF_LLM_SEMANTIC_ENABLED: "true" },
      mode: "enhanced",
      analyze
    });

    expect(analyze).toHaveBeenCalledTimes(2);
    expect(result.status).toBe("unavailable");
    expect(result.attempts).toBe(2);
    expect(result.report.semanticAnalysis).toEqual({ status: "unavailable", attempts: 2 });
    expect(JSON.stringify(result.report)).not.toContain("provider response must not persist");
  });

  it.runIf(process.env.AGENTPROOF_LLM_LIVE === "1")(
    "runs the gated runtime against the public demo fixture", async () => {
      const deterministic = generateVerificationReport(demoScenarios.clean);
      const result = await enrichReportWithOpenAISemantics(demoScenarios.clean, deterministic, {
        env: {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY,
          OPENAI_MODEL: process.env.OPENAI_MODEL,
          AGENTPROOF_LLM_SEMANTIC_ENABLED: "true"
        },
        mode: "enhanced"
      });

      expect(result.status).toBe("included");
      expect(result.report.semantic?.requirement_assessments.length).toBeGreaterThan(0);
    },
    45_000
  );
});
