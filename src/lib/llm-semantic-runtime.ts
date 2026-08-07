import { analyzeSemanticsWithOpenAI, type OpenAISemanticOptions, type OpenAISemanticResult } from "./openai-semantic";
import type { LlmAnalysisMode } from "./tenant-control-plane";
import type { PullRequestInput, VerificationReport } from "./types";

type SemanticRuntimeStatus = "disabled" | "included" | "unavailable";

export interface SemanticRuntimeResult {
  report: VerificationReport;
  status: SemanticRuntimeStatus;
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
    return { report: deterministicReport, status: "disabled" };
  }

  try {
    const result = await (options.analyze ?? analyzeSemanticsWithOpenAI)(input, deterministicReport, {
      apiKey,
      ...(env.OPENAI_MODEL ? { model: env.OPENAI_MODEL } : {})
    });
    return {
      report: { ...deterministicReport, semantic: result.output },
      status: "included"
    };
  } catch {
    return { report: deterministicReport, status: "unavailable" };
  }
}
