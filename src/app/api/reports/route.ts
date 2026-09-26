import { noStoreJson, parseJsonSafely, utf8ByteLength } from "@/lib/http";
import { validateRuntimeReportBoundary } from "@/lib/report-runtime-validation";
import { isOrdinaryDocumentationSummary } from "@/lib/general-pr-documentation-presentation";
import { isOrdinaryStaticSummary } from "@/lib/general-pr-static-types-presentation";
import { redactSecrets } from "@/lib/redact";
import { createSavedReport, getSavedReportStoreStatus, SavedReportStoreError } from "@/lib/server-report-store";
import type { VerificationReport, VerificationReportV2 } from "@/lib/types";

const MAX_REPORT_REQUEST_BYTES = 1_000_000;

interface SaveReportRequest {
  report?: VerificationReport;
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return noStoreJson({ error: "Public report URL creation is unavailable." }, { status: 410 });
  }

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

  const summaryOnly = isSummaryOnlyReport(body.report);
  let validationReport = body.report;
  if (!summaryOnly) {
    const { ordinaryDocumentationSummary, ordinaryStaticSummary, ...fullReport } = body.report as VerificationReportV2;
    if (ordinaryDocumentationSummary !== undefined || ordinaryStaticSummary !== undefined) {
      if (fullReport.reportSchemaVersion !== "verification-report.v2" ||
        (ordinaryDocumentationSummary !== undefined && !isOrdinaryDocumentationSummary(ordinaryDocumentationSummary)) ||
        (ordinaryStaticSummary !== undefined && !isOrdinaryStaticSummary(ordinaryStaticSummary))) {
        return noStoreJson({ error: "Report failed validation.", details: ["Invalid scoped summary import."] }, { status: 422 });
      }
      // These are imported summary data, not caller-supplied verification authority.
      // Keep every other full-report field subject to the existing inbound gate.
      validationReport = fullReport;
    }
  }
  const validation = validateRuntimeReportBoundary({
    boundary: summaryOnly ? "signed_summary_read" : "inbound_untrusted_full",
    report: validationReport
  });
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
    authenticity: saved.report.authenticity?.trust ?? "imported_unverified",
    authenticityNotice: "Caller-supplied reports are saved as imported, unverified summaries. They are not server-verified AgentProof artifacts.",
    durability: status.durability,
    durabilityWarning: status.durabilityWarning
  });
}

function isSummaryOnlyReport(report: unknown): boolean {
  return isRecord(report) && Array.isArray(report.evidenceIndex) && report.evidenceIndex.length === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
