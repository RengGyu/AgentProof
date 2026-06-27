import { noStoreJson, parseJsonSafely, utf8ByteLength } from "@/lib/http";
import { validateVerificationReport } from "@/lib/report-validation";
import { verifyReportWithOpenAI } from "@/lib/openai-verifier";
import { redactSecrets } from "@/lib/redact";
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

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_LLM_REQUEST_BYTES) {
    return noStoreJson({ error: "LLM verifier payload is too large." }, { status: 413 });
  }

  const bodyText = await request.text();
  if (utf8ByteLength(bodyText) > MAX_LLM_REQUEST_BYTES) {
    return noStoreJson({ error: "LLM verifier payload is too large." }, { status: 413 });
  }

  const body = parseJsonSafely<LlmVerifyRequest>(bodyText);
  if (!body?.input || !body.report) {
    return noStoreJson({ error: "input and report are required." }, { status: 400 });
  }

  const validation = validateVerificationReport(body.report, { mode: "full" });
  if (!validation.valid) {
    return noStoreJson({ error: "Report failed validation.", details: validation.errors.map(redactSecrets) }, { status: 422 });
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
        report: redactReportStrings(body.report),
        source: "deterministic-fallback",
        warning: redactSecrets(error instanceof Error ? error.message : "LLM verifier failed."),
        fallback: "OpenAI output was not trusted; deterministic verifier report returned."
      }
    );
  }
}

function redactReportStrings<T>(value: T): T {
  if (typeof value === "string") {
    return redactSecrets(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactReportStrings(item)) as T;
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, redactReportStrings(nestedValue)])
    ) as T;
  }

  return value;
}
