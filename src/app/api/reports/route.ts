import { noStoreJson, parseJsonSafely } from "@/lib/http";
import { validateVerificationReport } from "@/lib/report-validation";
import { createSavedReport } from "@/lib/server-report-store";
import type { VerificationReport } from "@/lib/types";

const MAX_REPORT_REQUEST_BYTES = 120_000;

interface SaveReportRequest {
  report?: VerificationReport;
}

export async function POST(request: Request) {
  const bodyText = await request.text();

  if (bodyText.length > MAX_REPORT_REQUEST_BYTES) {
    return noStoreJson({ error: "Report payload is too large." }, { status: 413 });
  }

  const body = parseJsonSafely<SaveReportRequest>(bodyText);
  if (!body) {
    return noStoreJson({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.report) {
    return noStoreJson({ error: "report is required." }, { status: 400 });
  }

  const validation = validateVerificationReport(body.report);
  if (!validation.valid) {
    return noStoreJson({ error: "Report failed validation.", details: validation.errors }, { status: 422 });
  }

  const saved = createSavedReport(body.report);
  const url = new URL(`/reports/${saved.id}`, request.url).toString();

  return noStoreJson({
    id: saved.id,
    url,
    expiresAt: saved.expiresAt,
    privacy: "summary-only"
  });
}
