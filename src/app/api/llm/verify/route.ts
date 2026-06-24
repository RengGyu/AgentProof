import { noStoreJson, parseJsonSafely } from "@/lib/http";
import { validateVerificationReport } from "@/lib/report-validation";
import { verifyReportWithOpenAI } from "@/lib/openai-verifier";
import type { PullRequestInput, VerificationReport } from "@/lib/types";

const MAX_LLM_REQUEST_BYTES = 220_000;

interface LlmVerifyRequest {
  input?: PullRequestInput;
  report?: VerificationReport;
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const llmToken = process.env.AGENTPROOF_LLM_TOKEN;

  if (!apiKey || !llmToken) {
    return noStoreJson(
      {
        error: "LLM verifier is not configured.",
        requiredEnv: ["OPENAI_API_KEY", "AGENTPROOF_LLM_TOKEN"],
        fallback: "Use the deterministic verifier report."
      },
      { status: 501 }
    );
  }

  if (request.headers.get("x-agentproof-llm-token") !== llmToken) {
    return noStoreJson({ error: "Invalid LLM verifier token." }, { status: 401 });
  }

  const bodyText = await request.text();
  if (bodyText.length > MAX_LLM_REQUEST_BYTES) {
    return noStoreJson({ error: "LLM verifier payload is too large." }, { status: 413 });
  }

  const body = parseJsonSafely<LlmVerifyRequest>(bodyText);
  if (!body?.input || !body.report) {
    return noStoreJson({ error: "input and report are required." }, { status: 400 });
  }

  const validation = validateVerificationReport(body.report);
  if (!validation.valid) {
    return noStoreJson({ error: "Report failed validation.", details: validation.errors }, { status: 422 });
  }

  try {
    const report = await verifyReportWithOpenAI(body.input, body.report, {
      apiKey,
      model: process.env.OPENAI_MODEL
    });

    return noStoreJson({ report, source: "openai" });
  } catch (error) {
    return noStoreJson(
      {
        error: error instanceof Error ? error.message : "LLM verifier failed.",
        fallback: "Use the deterministic verifier report."
      },
      { status: 502 }
    );
  }
}
