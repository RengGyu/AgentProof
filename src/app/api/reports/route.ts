import { noStoreJson, parseJsonSafely, utf8ByteLength } from "@/lib/http";
import { validateVerificationReport } from "@/lib/report-validation";
import { redactSecrets } from "@/lib/redact";
import { createSavedReport, getSavedReportStoreStatus, SavedReportStoreError } from "@/lib/server-report-store";
import type { VerificationReport } from "@/lib/types";

const MAX_REPORT_REQUEST_BYTES = 120_000;

interface SaveReportRequest {
  report?: VerificationReport;
}

export async function POST(request: Request) {
  const bodyText = await request.text();

  if (utf8ByteLength(bodyText) > MAX_REPORT_REQUEST_BYTES) {
    return noStoreJson({ error: "Report payload is too large." }, { status: 413 });
  }

  const body = parseJsonSafely<SaveReportRequest>(bodyText);
  if (!body) {
    return noStoreJson({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.report) {
    return noStoreJson({ error: "report is required." }, { status: 400 });
  }

  const validation = validateVerificationReport(body.report, { mode: reportValidationMode(body.report) });
  if (!validation.valid) {
    return noStoreJson({ error: "Report failed validation.", details: validation.errors.map(redactSecrets) }, { status: 422 });
  }

  const status = getSavedReportStoreStatus();
  let saved;

  try {
    saved = await createSavedReport(body.report);
  } catch (error) {
    if (error instanceof SavedReportStoreError) {
      return noStoreJson({ error: "Saved report storage failed.", detail: redactSecrets(error.message) }, { status: 503 });
    }

    throw error;
  }

  const savedUrl = new URL(`/reports/${saved.id}`, request.url);
  if (saved.accessToken) {
    savedUrl.searchParams.set("key", saved.accessToken);
  }

  return noStoreJson({
    id: saved.id,
    url: savedUrl.toString(),
    expiresAt: saved.expiresAt,
    privacy: "summary-only",
    durability: status.durability,
    durabilityWarning: status.durabilityWarning
  });
}

function reportValidationMode(report: unknown): "full" | "summary" {
  return isRecord(report) && Array.isArray(report.evidenceIndex) && report.evidenceIndex.length === 0 ? "summary" : "full";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
