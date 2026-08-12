import { analyzeSemanticsWithOpenAI, type OpenAISemanticOptions, type OpenAISemanticResult } from "./openai-semantic";
import {
  runHybridPlannerAnalysis,
  type HybridPlannerTelemetry,
  type RunHybridPlannerAnalysisOptions
} from "./hybrid-orchestrator";
import type { LlmAnalysisMode } from "./tenant-control-plane";
import type { PullRequestInput, VerificationReport } from "./types";

type SemanticRuntimeStatus = "disabled" | "included" | "unavailable";

export interface SemanticRuntimeResult {
  report: VerificationReport;
  status: SemanticRuntimeStatus;
  attempts: 0 | 1 | 2;
}

export interface EnrichReportWithOpenAISemanticsOptions {
  env?: Partial<NodeJS.ProcessEnv>;
  mode?: LlmAnalysisMode;
  analyze?: (
    input: PullRequestInput,
    report: VerificationReport,
    options: OpenAISemanticOptions
  ) => Promise<OpenAISemanticResult>;
}

export interface HybridPlanningRuntimeResult {
  report: VerificationReport;
  status: "included" | "fallback";
  telemetry: HybridPlannerTelemetry;
  publicationSuppressed: boolean;
}

/** Synchronous entry point for the shared hybrid state machine. */
export async function enrichReportWithHybridPlanning(
  input: PullRequestInput,
  options: Omit<RunHybridPlannerAnalysisOptions, "phase" | "input" | "responseId" | "bindBeforeSubmit" | "checkBinding">
): Promise<HybridPlanningRuntimeResult> {
  const result = await runHybridPlannerAnalysis({
    ...options,
    phase: "sync",
    input
  });
  if (result.status !== "ready") {
    throw new Error("Synchronous hybrid planning returned a background continuation.");
  }
  return {
    report: result.report,
    status: result.report.planner ? "included" : "fallback",
    telemetry: result.telemetry,
    publicationSuppressed: result.publicationSuppressed === true
  };
}

/**
 * Essential reports stay deterministic. Enhanced reports may receive a
 * validator-approved semantic reading when the operator has enabled the LLM.
 * A provider failure never replaces or weakens deterministic evidence.
 */
export async function enrichReportWithOpenAISemantics(
  input: PullRequestInput,
  deterministicReport: VerificationReport,
  options: EnrichReportWithOpenAISemanticsOptions = {}
): Promise<SemanticRuntimeResult> {
  const env = options.env ?? process.env;
  const apiKey = env.OPENAI_API_KEY;

  if (
    !apiKey ||
    env.AGENTPROOF_LLM_SEMANTIC_ENABLED !== "true" ||
    options.mode !== "enhanced"
  ) {
    return { report: deterministicReport, status: "disabled", attempts: 0 };
  }

  const analyze = options.analyze ?? analyzeSemanticsWithOpenAI;
  const providerOptions = {
    apiKey,
    ...(env.OPENAI_MODEL ? { model: env.OPENAI_MODEL } : {})
  };

  for (const attempts of [1, 2] as const) {
    try {
      const result = await analyze(input, deterministicReport, providerOptions);
      return {
        report: {
          ...deterministicReport,
          semantic: result.output,
          semanticAnalysis: { status: "included", attempts }
        },
        status: "included",
        attempts
      };
    } catch {
      // One bounded retry handles transient provider or strict-output failures.
    }
  }

  return {
    report: {
      ...deterministicReport,
      semanticAnalysis: { status: "unavailable", attempts: 2 }
    },
    status: "unavailable",
    attempts: 2
  };
}
