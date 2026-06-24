import { noStoreJson } from "@/lib/http";
import { deleteSavedReport, getSavedReport } from "@/lib/server-report-store";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const saved = getSavedReport(id);

  if (!saved) {
    return noStoreJson({ error: "Saved report was not found or has expired." }, { status: 404 });
  }

  return noStoreJson({
    report: saved.report,
    createdAt: saved.createdAt,
    expiresAt: saved.expiresAt,
    privacy: "summary-only"
  });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const deleted = deleteSavedReport(id);

  return noStoreJson({ deleted });
}
