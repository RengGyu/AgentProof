import { describe, expect, it, vi } from "vitest";
import {
  analyzeSemanticsWithOpenAI,
  retrieveMissingSemanticsWithOpenAIBackground,
  retrieveSemanticsWithOpenAIBackground,
  submitMissingSemanticsWithOpenAIBackground,
  submitSemanticsWithOpenAIBackground
} from "./openai-semantic";
import {
  buildLlmSemanticPackage,
  validateLlmSemanticPackageCandidate
} from "./llm-semantic-package";
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
    const llmPackage = buildLlmSemanticPackage(input, report);
    const requirementId = llmPackage.input.requirements[0]?.id;
    const evidenceId = llmPackage.input.requirements[0]?.evidence_ids[0];
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

  it("submits one background retry containing only the first response's missing requirements", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const llmPackage = buildLlmSemanticPackage(input, report);
    const requirementIds = llmPackage.input.requirements.map((requirement) => requirement.id);
    const firstEvidenceId = llmPackage.input.requirements[0]?.evidence_ids[0];
    expect(requirementIds.length).toBeGreaterThan(2);
    expect(firstEvidenceId).toBeTruthy();
    const firstValidation = validateLlmSemanticPackageCandidate(
      semanticOutput(requirementIds[0]!, firstEvidenceId!),
      llmPackage
    );
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      id: "resp_background_retry_123",
      status: "queued",
      output: []
    }));

    const result = await submitMissingSemanticsWithOpenAIBackground(
      input,
      report,
      firstValidation,
      { apiKey: "test-key", fetchFn: fetchMock as unknown as typeof fetch }
    );

    expect(result).toEqual({
      status: "pending",
      responseId: "resp_background_retry_123",
      providerStatus: "queued"
    });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const retryInput = JSON.parse(requestBody.input[1].content[0].text);
    expect(retryInput.requirements.map((requirement: { id: string }) => requirement.id)).toEqual(requirementIds.slice(1));
    expect(requestBody.background).toBe(true);
    expect(requestBody.store).toBe(false);
  });

  it("retrieves a background missing-only response and preserves first-valid semantic units", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const llmPackage = buildLlmSemanticPackage(input, report);
    const requirementIds = llmPackage.input.requirements.map((requirement) => requirement.id);
    const firstEvidenceId = llmPackage.input.requirements[0]?.evidence_ids[0];
    const retryEvidenceId = llmPackage.input.requirements[1]?.evidence_ids[0];
    expect(requirementIds.length).toBeGreaterThan(2);
    expect(firstEvidenceId).toBeTruthy();
    expect(retryEvidenceId).toBeTruthy();
    const firstOutput = semanticOutput(requirementIds[0]!, firstEvidenceId!);
    const retryOutput = semanticOutput(requirementIds[1]!, retryEvidenceId!);
    const firstValidation = validateLlmSemanticPackageCandidate(firstOutput, llmPackage);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      id: "resp_background_retry_123",
      status: "completed",
      output_text: JSON.stringify(retryOutput)
    }));

    const result = await retrieveMissingSemanticsWithOpenAIBackground(
      "resp_background_retry_123",
      input,
      report,
      firstValidation,
      { apiKey: "test-key", fetchFn: fetchMock as unknown as typeof fetch }
    );

    expect(result).toMatchObject({
      status: "completed",
      responseId: "resp_background_retry_123",
      output: {
        requirement_assessments: expect.arrayContaining([
          firstOutput.requirement_assessments[0],
          retryOutput.requirement_assessments[0]
        ])
      },
      validation: {
        missing_requirement_ids: requirementIds.slice(2),
        diagnostics: {
          retryAttempted: true
        }
      }
    });
  });

  it("preserves partial background retry raw and rejected diagnostics through merge", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const llmPackage = buildLlmSemanticPackage(input, report);
    const requirementIds = llmPackage.input.requirements.map((requirement) => requirement.id);
    const firstEvidenceId = llmPackage.input.requirements[0]?.evidence_ids[0];
    const retryEvidenceId = llmPackage.input.requirements[1]?.evidence_ids[0];
    expect(requirementIds.length).toBeGreaterThan(2);
    expect(firstEvidenceId).toBeTruthy();
    expect(retryEvidenceId).toBeTruthy();
    const firstOutput = semanticOutput(requirementIds[0]!, firstEvidenceId!);
    const retryOutput = semanticOutput(requirementIds[1]!, retryEvidenceId!);
    retryOutput.requirement_assessments.push({
      ...retryOutput.requirement_assessments[0]!,
      requirement_id: "req_unknown_retry_123"
    });
    const firstValidation = validateLlmSemanticPackageCandidate(firstOutput, llmPackage);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      id: "resp_background_partial_retry_123",
      status: "completed",
      output_text: JSON.stringify(retryOutput)
    }));

    const result = await retrieveMissingSemanticsWithOpenAIBackground(
      "resp_background_partial_retry_123",
      input,
      report,
      firstValidation,
      { apiKey: "test-key", fetchFn: fetchMock as unknown as typeof fetch }
    );

    expect(result).toMatchObject({
      status: "completed",
      validation: {
        diagnostics: {
          raw_section_counts: { requirement_assessments: 3 },
          accepted_section_counts: { requirement_assessments: 2 },
          rejected_section_counts: { requirement_assessments: 1 },
          rejected_reason_code_counts: { unknown_requirement_reference: 1 },
          discard_reason_codes: []
        }
      }
    });
  });

  it("preserves discarded background retry diagnostics while falling back to the first candidate", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const llmPackage = buildLlmSemanticPackage(input, report);
    const requirementIds = llmPackage.input.requirements.map((requirement) => requirement.id);
    const firstEvidenceId = llmPackage.input.requirements[0]?.evidence_ids[0];
    const retryEvidenceId = llmPackage.input.requirements[1]?.evidence_ids[0];
    expect(requirementIds.length).toBeGreaterThan(2);
    expect(firstEvidenceId).toBeTruthy();
    expect(retryEvidenceId).toBeTruthy();
    const firstOutput = semanticOutput(requirementIds[0]!, firstEvidenceId!);
    const invalidAssessment = semanticOutput(requirementIds[1]!, retryEvidenceId!).requirement_assessments[0]!;
    const discardedRetry = {
      requirement_evidence_relations: [],
      requirement_assessments: [{
        ...invalidAssessment,
        requirement_id: "req_unknown_retry_123"
      }],
      evidence_gaps: [],
      review_targets: [],
      remediation_requests: [],
      uncertainties: []
    };
    const firstValidation = validateLlmSemanticPackageCandidate(firstOutput, llmPackage);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      id: "resp_background_discarded_retry_123",
      status: "completed",
      output_text: JSON.stringify(discardedRetry)
    }));

    const result = await retrieveMissingSemanticsWithOpenAIBackground(
      "resp_background_discarded_retry_123",
      input,
      report,
      firstValidation,
      { apiKey: "test-key", fetchFn: fetchMock as unknown as typeof fetch }
    );

    expect(result).toMatchObject({
      status: "completed",
      output: firstOutput,
      validation: {
        diagnostics: {
          raw_section_counts: { requirement_assessments: 2 },
          accepted_section_counts: { requirement_assessments: 1 },
          rejected_section_counts: { requirement_assessments: 1 },
          rejected_reason_code_counts: { unknown_requirement_reference: 1 },
          discard_reason_codes: ["empty_usable_analysis"]
        }
      }
    });
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

  it.each([
    ["failed", "openai_background_failed"],
    ["cancelled", "openai_background_cancelled"],
    ["incomplete", "openai_background_incomplete"]
  ] as const)("classifies terminal background status %s without retrying", async (status, code) => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      id: "resp_background_terminal_123",
      status
    }));

    await expect(retrieveSemanticsWithOpenAIBackground(
      "resp_background_terminal_123",
      input,
      report,
      { apiKey: "test-key", fetchFn: fetchMock as unknown as typeof fetch }
    )).rejects.toMatchObject({ code, retryable: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends a transient strict-schema request and returns only validator-approved semantic output", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const llmPackage = buildLlmSemanticPackage(input, report);
    const requirementId = llmPackage.input.requirements[0]?.id;
    const evidenceId = llmPackage.input.requirements[0]?.evidence_ids[0];
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
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ output_text: JSON.stringify(response) }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    ));

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

  it("retries once with only missing requirements and merges the first valid assessments", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const llmPackage = buildLlmSemanticPackage(input, report);
    const requirementIds = llmPackage.input.requirements.map((requirement) => requirement.id);
    const firstEvidenceId = llmPackage.input.requirements[0]?.evidence_ids[0];
    const retryEvidenceId = llmPackage.input.requirements[1]?.evidence_ids[0];
    expect(requirementIds.length).toBeGreaterThan(1);
    expect(firstEvidenceId).toBeTruthy();
    expect(retryEvidenceId).toBeTruthy();
    const firstOutput = semanticOutput(requirementIds[0]!, firstEvidenceId!);
    const retryOutput = semanticOutput(requirementIds[1]!, retryEvidenceId!);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ output_text: JSON.stringify(firstOutput) }))
      .mockResolvedValueOnce(Response.json({ output_text: JSON.stringify(retryOutput) }));

    const result = await analyzeSemanticsWithOpenAI(input, report, {
      apiKey: "test-key",
      fetchFn: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequestInput = JSON.parse(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).input[1].content[0].text);
    const retryRequestInput = JSON.parse(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).input[1].content[0].text);
    expect(retryRequestInput.requirements.map((requirement: { id: string }) => requirement.id)).toEqual(requirementIds.slice(1));
    expect(retryRequestInput.evidence.map((evidence: { id: string }) => evidence.id)).toEqual(
      firstRequestInput.evidence
        .filter((evidence: { id: string }) => retryRequestInput.requirements.some(
          (requirement: { evidence_ids: string[] }) => requirement.evidence_ids.includes(evidence.id)
        ))
        .map((evidence: { id: string }) => evidence.id)
    );
    expect(retryRequestInput.privacy).toEqual(firstRequestInput.privacy);
    expect(result.output.requirement_assessments).toEqual(expect.arrayContaining([
      firstOutput.requirement_assessments[0],
      retryOutput.requirement_assessments[0]
    ]));
    expect(result.validation.diagnostics.retryAttempted).toBe(true);
  });

  it("retries when a fresh-only assurance filter removes the only assessment", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const llmPackage = buildLlmSemanticPackage(input, report);
    const requirementId = llmPackage.input.requirements[0]?.id;
    const evidenceId = llmPackage.input.requirements[0]?.evidence_ids[0];
    expect(requirementId).toBeTruthy();
    expect(evidenceId).toBeTruthy();
    const rejectedAssessmentOutput = {
      requirement_evidence_relations: [],
      requirement_assessments: [{
        ...semanticOutput(requirementId!, evidenceId!).requirement_assessments[0]!,
        summary: "The implementation works correctly and is ready for merge."
      }],
      evidence_gaps: [],
      review_targets: [],
      remediation_requests: [],
      uncertainties: []
    };
    const retryOutput = semanticOutput(requirementId!, evidenceId!);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ output_text: JSON.stringify(rejectedAssessmentOutput) }))
      .mockResolvedValueOnce(Response.json({ output_text: JSON.stringify(retryOutput) }));

    const result = await analyzeSemanticsWithOpenAI(input, report, {
      apiKey: "test-key",
      fetchFn: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInput = JSON.parse(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).input[1].content[0].text);
    expect(retryInput.requirements.map((requirement: { id: string }) => requirement.id)).toContain(requirementId);
    expect(result.output.requirement_assessments).toEqual(expect.arrayContaining([retryOutput.requirement_assessments[0]]));
  });

  it("returns valid merged units after one incomplete coverage retry without a third request", async () => {
    const input = demoScenarios.clean;
    const report = generateVerificationReport(input);
    const llmPackage = buildLlmSemanticPackage(input, report);
    const requirementIds = llmPackage.input.requirements.map((requirement) => requirement.id);
    const firstEvidenceId = llmPackage.input.requirements[0]?.evidence_ids[0];
    const retryEvidenceId = llmPackage.input.requirements[1]?.evidence_ids[0];
    expect(requirementIds.length).toBeGreaterThan(2);
    expect(firstEvidenceId).toBeTruthy();
    expect(retryEvidenceId).toBeTruthy();
    const firstOutput = semanticOutput(requirementIds[0]!, firstEvidenceId!);
    const retryOutput = semanticOutput(requirementIds[1]!, retryEvidenceId!);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ output_text: JSON.stringify(firstOutput) }))
      .mockResolvedValueOnce(Response.json({ output_text: JSON.stringify(retryOutput) }));

    const result = await analyzeSemanticsWithOpenAI(input, report, {
      apiKey: "test-key",
      fetchFn: fetchMock as unknown as typeof fetch
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.validation.missing_requirement_ids).toEqual(requirementIds.slice(2));
    expect(result.validation.diagnostics).toMatchObject({
      input_requirement_count: requirementIds.length,
      assessed_requirement_count: 2,
      missing_requirement_count: requirementIds.length - 2,
      retryAttempted: true
    });
    expect(JSON.stringify(result.validation.diagnostics)).not.toContain(requirementIds[2]);
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
