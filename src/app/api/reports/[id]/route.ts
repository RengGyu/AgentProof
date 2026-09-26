import { noStoreJson } from "@/lib/http";
import { redactSecrets } from "@/lib/redact";
import { deleteSavedReport, getSavedReport, getSavedReportStoreStatus, SavedReportStoreError } from "@/lib/server-report-store";
import { resolveTenantAuthAccess } from "@/lib/tenant-auth";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const status = getSavedReportStoreStatus();
  let saved;
  const tenantId = process.env.NODE_ENV === "production" ? await authorizedTenantId(request) : undefined;
  if (process.env.NODE_ENV === "production" && !tenantId) return unavailableReport();

  try {
    saved = await getSavedReport(id, tenantId ? { tenantId } : await savedReportAccessFromRequest(request));
  } catch (error) {
    if (error instanceof SavedReportStoreError) {
      return noStoreJson({ error: "Saved report lookup failed.", detail: redactSecrets(error.message) }, { status: 503 });
    }

    throw error;
  }

  if (!saved || (tenantId && saved.tenantId !== tenantId)) return unavailableReport();

  return noStoreJson({
    report: saved.report,
    createdAt: saved.createdAt,
    expiresAt: saved.expiresAt,
    privacy: "summary-only",
    authenticity: saved.report.authenticity?.trust ?? "legacy_unverified",
    durability: status.durability,
    durabilityWarning: status.durabilityWarning
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const { id } = await context.params;
  let deleted;
  const tenantId = process.env.NODE_ENV === "production" ? await authorizedTenantId(request) : undefined;
  if (process.env.NODE_ENV === "production" && !tenantId) return unavailableReport();

  try {
    const access = tenantId ? { tenantId } : await savedReportAccessFromRequest(request);
    if (tenantId) {
      const saved = await getSavedReport(id, access);
      if (!saved || saved.tenantId !== tenantId) return unavailableReport();
    }
    deleted = await deleteSavedReport(id, access);
  } catch (error) {
    if (error instanceof SavedReportStoreError) {
      return noStoreJson({ error: "Saved report delete failed.", detail: redactSecrets(error.message) }, { status: 503 });
    }

    throw error;
  }

  return noStoreJson({ deleted });
}

function unavailableReport() {
  return noStoreJson({ error: "Saved report was not found or has expired." }, { status: 404 });
}

async function authorizedTenantId(request: Request) {
  const access = await resolveTenantAuthAccess({ cookieHeader: request.headers.get("cookie") });
  return access.authorized ? access.tenantId : undefined;
}

async function savedReportAccessFromRequest(request: Request) {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? url.searchParams.get("reportKey") ?? undefined;
  if (key) return { accessToken: key.slice(0, 200) };
  const access = await resolveTenantAuthAccess({ cookieHeader: request.headers.get("cookie") });
  return access.authorized && access.tenantId ? { tenantId: access.tenantId } : {};
}
