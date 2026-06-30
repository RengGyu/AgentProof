import { noStoreJson } from "@/lib/http";
import { redactSecrets } from "@/lib/redact";
import { deleteSavedReport, getSavedReport, getSavedReportStoreStatus, SavedReportStoreError } from "@/lib/server-report-store";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const status = getSavedReportStoreStatus();
  let saved;

  try {
    saved = await getSavedReport(id, savedReportAccessFromRequest(request));
  } catch (error) {
    if (error instanceof SavedReportStoreError) {
      return noStoreJson({ error: "Saved report lookup failed.", detail: redactSecrets(error.message) }, { status: 503 });
    }

    throw error;
  }

  if (!saved) {
    return noStoreJson({ error: "Saved report was not found or has expired." }, { status: 404 });
  }

  return noStoreJson({
    report: saved.report,
    createdAt: saved.createdAt,
    expiresAt: saved.expiresAt,
    privacy: "summary-only",
    durability: status.durability,
    durabilityWarning: status.durabilityWarning
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let deleted;

  try {
    deleted = await deleteSavedReport(id, savedReportAccessFromRequest(request));
  } catch (error) {
    if (error instanceof SavedReportStoreError) {
      return noStoreJson({ error: "Saved report delete failed.", detail: redactSecrets(error.message) }, { status: 503 });
    }

    throw error;
  }

  return noStoreJson({ deleted });
}

function savedReportAccessFromRequest(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? url.searchParams.get("reportKey") ?? undefined;

  return key ? { accessToken: key.slice(0, 200) } : {};
}
