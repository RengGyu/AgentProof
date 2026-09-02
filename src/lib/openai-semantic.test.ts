import { describe, expect, it, vi } from "vitest";
import {
  analyzeSemanticsWithOpenAI,
  retrieveHybridPlannerWithOpenAI,
  retrieveMissingSemanticsWithOpenAIBackground,
  retrieveSemanticsWithOpenAIBackground,
  submitGeneralPrSemanticObservationWithOpenAI,
  submitHybridPlannerWithOpenAI,
  submitMissingSemanticsWithOpenAIBackground,
  submitSemanticsWithOpenAIBackground
} from "./openai-semantic";
import { extractRequirementSpanSeed } from "./extractors";
import {
  type GeneralPrSemanticObserverPackageV4
} from "./general-pr-semantic-observer";
import {
  GENERAL_PR_SEMANTIC_CLAIM_SCHEMA_NAME,
  GENERAL_PR_SEMANTIC_EVIDENCE_SCHEMA_NAME
} from "./general-pr-semantic-proposal";
import { bindHybridPlannerSeedHash, buildHybridPlannerPackage, buildHybridPlannerPlan } from "./hybrid-planner";
import {
  buildLlmSemanticPackage,
  validateLlmSemanticPackageCandidate
} from "./llm-semantic-package";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";

describe("OpenAI semantic adapter", () => {
  it.each(stagedSemanticPackages())("sends the $stage package's strict schema without retention", async (semanticPackage) => {
    const fetchMock = vi.fn(async () => Response.json({ output_text: "{}" }));
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await expect(submitGeneralPrSemanticObservationWithOpenAI(semanticPackage, {
      apiKey: "test-key",
      fetchFn: fetchMock as unknown as typeof fetch
    })).resolves.toEqual({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledWith(semanticPackage.request.timeoutMs);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: semanticPackage.request.model,
      store: false,
      max_output_tokens: semanticPackage.request.maxOutputTokens,
      text: { format: { type: "json_schema", strict: true, name: semanticPackage.request.responseFormat.name } }
    });
    expect(body.text.format.schema).toEqual(semanticPackage.request.responseFormat.schema);
    timeoutSpy.mockRestore();
  });

  it("passes a package's remaining 20 second timeout to AbortSignal without retention", async () => {
    const semanticPackage = { ...stagedSemanticPackages()[1]!, request: { ...stagedSemanticPackages()[1]!.request, timeoutMs: 20_000 } };
    const fetchMock = vi.fn(async () => Response.json({ output_text: "{}" }));
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    await submitGeneralPrSemanticObservationWithOpenAI(semanticPackage, {
      apiKey: "test-key",
      fetchFn: fetchMock as unknown as typeof fetch
    });

    expect(timeoutSpy).toHaveBeenCalledWith(20_000);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).store).toBe(false);
    timeoutSpy.mockRestore();
  });

  it.each([
    ["rate limit", () => ({ ok: false, status: 429, text: vi.fn(async () => "PROVIDER_SECRET") }), { stage: "provider_request", timedOut: false }],
    ["timeout", () => { throw new DOMException("PROVIDER_SECRET", "TimeoutError"); }, { stage: "provider_request", timedOut: true }],
    ["invalid JSON", () => new Response("not JSON"), { stage: "provider_response", timedOut: false }],
    ["missing output", () => Response.json({}), { stage: "provider_response", timedOut: false }]
  ] as const)("makes one request and exposes only a closed failure for %s", async (_caseName, response, expected) => {
    let providerErrorText: ReturnType<typeof vi.fn> | undefined;
    const fetchMock = vi.fn(async () => {
      const next = response();
      if (next && typeof next === "object" && "text" in next && vi.isMockFunction(next.text)) {
        providerErrorText = next.text;
      }
      return next as Response;
    });

    const failure = await submitGeneralPrSemanticObservationWithOpenAI(stagedSemanticPackages()[0]!, {
      apiKey: "test-key",
      fetchFn: fetchMock as unknown as typeof fetch
    }).catch((error: unknown) => error);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(failure).toMatchObject(expected);
    expect(JSON.stringify(failure)).not.toContain("PROVIDER_SECRET");
    if (providerErrorText) {
      expect(providerErrorText).not.toHaveBeenCalled();
    }
  });

  it("submits one strict hybrid planner response with store false and no repair request", async () => {
    const { input, seed, plannerPackage, plan } = hybridFixture();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      id: "resp_hybrid_sync_123",
      status: "completed",
      output_text: JSON.stringify(plan),
      usage: { output_tokens: 88 }
    }));

    const result = await submitHybridPlannerWithOpenAI({ package: plannerPackage, seed, background: false }, {
      apiKey: "test-key",
      fetchFn: fetchMock as unknown as typeof fetch
    });

    expect(result).toMatchObject({ status: "completed", candidate: plan, outputTokens: 88 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.method).toBe("POST");
    expect(body).toMatchObject({ model: "gpt-5-mini", store: false, max_output_tokens: 3200 });
    expect(body).not.toHaveProperty("background");
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true, name: "agentproof_requirement_span_plan_v1" });
    expect(JSON.parse(body.input[1].content[0].text)).toEqual(plannerPackage.input);
    expect(JSON.stringify(result)).not.toContain(input.taskText);
  });

  it("uses one background POST followed only by same-ID GET retrieval", async () => {
    const { seed, plannerPackage, plan } = hybridFixture();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ id: "resp_hybrid_bg_123", status: "queued", output: [] }))
      .mockResolvedValueOnce(Response.json({
        id: "resp_hybrid_bg_123",
        status: "completed",
        output_text: JSON.stringify(plan),
        usage: { output_tokens: 91 }
      }));
    const options = { apiKey: "test-key", fetchFn: fetchMock as unknown as typeof fetch };

    const pending = await submitHybridPlannerWithOpenAI({ package: plannerPackage, seed, background: true }, options);
    const completed = await retrieveHybridPlannerWithOpenAI("resp_hybrid_bg_123", { package: plannerPackage, seed, background: true }, options);

    expect(pending).toEqual({
      status: "pending",
      responseId: "resp_hybrid_bg_123",
      providerStatus: "queued",
      outputBytes: 0,
      outputTokens: 0
    });
    expect(completed).toMatchObject({ status: "completed", responseId: "resp_hybrid_bg_123", candidate: plan, outputTokens: 91 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "GET"]);
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.openai.com/v1/responses/resp_hybrid_bg_123");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ background: true, store: false });
  });

  it("rejects oversized or mismatched hybrid retrieval output without another POST", async () => {
    const { seed, plannerPackage, plan } = hybridFixture();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      id: "resp_other_123",
      status: "completed",
      output_text: JSON.stringify({ ...plan, extra: "x".repeat(17_000) })
    }));

    await expect(retrieveHybridPlannerWithOpenAI(
      "resp_hybrid_bg_123",
      { package: plannerPackage, seed, background: true },
      { apiKey: "test-key", fetchFn: fetchMock as unknown as typeof fetch }
    )).rejects.toMatchObject({ code: "openai_response_invalid" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET");
  });

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
    const input = threeRequirementInput();
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
    const input = threeRequirementInput();
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
    const input = threeRequirementInput();
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
    const input = threeRequirementInput();
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
    const input = threeRequirementInput();
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

function stagedSemanticPackages(): GeneralPrSemanticObserverPackageV4[] {
  return [
    {
      stage: "claim_discovery",
      system: "claim system",
      input: {
        contractVersion: "general_pr_semantic_claim.v2",
        schemaVersion: "agentproof_general_pr_claim_observer_v2",
        seedHash: "a".repeat(64),
        claimSelectionHash: "b".repeat(64),
        coverage: "complete",
        spans: []
      },
      request: stagedRequest("claim-model", 1_111, GENERAL_PR_SEMANTIC_CLAIM_SCHEMA_NAME)
    },
    {
      stage: "evidence_linking",
      system: "evidence system",
      input: {
        contractVersion: "general_pr_semantic_evidence.v1",
        schemaVersion: "agentproof_general_pr_evidence_observer_v1",
        seedHash: "a".repeat(64),
        claimSelectionHash: "b".repeat(64),
        evidenceSelectionHash: "c".repeat(64),
        coverage: "sampled",
        objectiveGroups: [],
        changeClusterDescriptors: [],
        evidenceDescriptors: []
      },
      request: stagedRequest("evidence-model", 2_222, GENERAL_PR_SEMANTIC_EVIDENCE_SCHEMA_NAME)
    }
  ];
}

function stagedRequest(
  model: string,
  timeoutMs: number,
  name: typeof GENERAL_PR_SEMANTIC_CLAIM_SCHEMA_NAME | typeof GENERAL_PR_SEMANTIC_EVIDENCE_SCHEMA_NAME
) {
  return {
    model,
    store: false as const,
    timeoutMs,
    maxOutputTokens: 3200 as const,
    responseFormat: { type: "json_schema" as const, name, strict: true as const, schema: { type: "object" } }
  };
}

function hybridFixture() {
  const input = {
    title: "Retry transient requests",
    description: "Implements retry handling.",
    taskText: "Acceptance criteria:\n- Add retry handling.",
    taskSource: "issue" as const,
    changedFiles: [],
    checks: [],
    logs: [],
    sourceProvenance: {
      version: 1 as const,
      origin: "github_snapshot" as const,
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      evidenceCapturedAt: "2026-08-12T00:00:00.000Z",
      inputFingerprint: { version: 1 as const, algorithm: "sha256" as const, value: "c".repeat(64), coverage: "github_metadata" as const }
    }
  };
  const extracted = extractRequirementSpanSeed(input.taskText, input.description, input.taskSource);
  if (!extracted.seed) throw new Error("expected hybrid seed");
  const seed = bindHybridPlannerSeedHash(extracted.seed, input.sourceProvenance);
  if (!seed) throw new Error("expected bound seed");
  const plannerPackage = buildHybridPlannerPackage(seed, input.sourceProvenance);
  if (!plannerPackage) throw new Error("expected planner package");
  const plan = buildHybridPlannerPlan(seed, input.sourceProvenance, seed.spans.map(() => ({
    disposition: "admit" as const,
    classification: "requirement" as const,
    expected_axes: []
  })))!;
  return { input, seed, plannerPackage, plan };
}

function threeRequirementInput() {
  const taskText = [
    "- Add password-reset validation before submission.",
    "- Add billing-invoice validation before submission.",
    "- Add workspace-invitation validation before submission."
  ].join("\n");
  return {
    ...demoScenarios.clean,
    taskText,
    description: taskText,
    taskSource: "task" as const,
    changedFiles: [
      { path: "src/auth/password-reset.ts", status: "modified" as const, patch: "+ validate password-reset validation before submission" },
      { path: "src/billing/invoice.ts", status: "modified" as const, patch: "+ validate billing-invoice validation before submission" },
      { path: "src/team/invitation.ts", status: "modified" as const, patch: "+ validate workspace-invitation validation before submission" }
    ]
  };
}

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
