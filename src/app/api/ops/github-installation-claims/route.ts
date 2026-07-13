import { decidePendingInstallationClaim, GitHubInstallationClaimStoreError } from "@/lib/github-installation-claims";
import { recordAuditEvent } from "@/lib/audit-log";
import { noStoreJson, parseJsonSafely } from "@/lib/http";

export async function POST(request: Request) {
  const body = parseJsonSafely<{ requestCode?: unknown; decision?: unknown }>(await request.text());
  if (!body || typeof body.requestCode !== "string" || (body.decision !== "approve" && body.decision !== "reject")) {
    return noStoreJson({ error: "Installation claim request is invalid.", code: "github_installation_claim_invalid" }, { status: 400 });
  }
  try {
    const result = await decidePendingInstallationClaim({
      operatorRequestCode: body.requestCode,
      operatorToken: request.headers.get("x-agentproof-installation-claim-operator-token") ?? undefined,
      decision: body.decision
    });
    if (!result.valid) return noStoreJson({ error: "Installation claim could not be approved.", code: "github_installation_claim_unavailable" }, { status: 401 });
    await recordAuditEvent({
      actor: "system",
      action: result.status === "approved" ? "github_installation_claim_approved" : "github_installation_claim_rejected",
      result: "completed",
      tenantId: result.tenantId,
      installationId: result.installationId,
      code: "operator"
    });
    return noStoreJson({ ok: true, status: result.status, privacy: "claim-transition-metadata-only" });
  } catch (error) {
    if (error instanceof GitHubInstallationClaimStoreError) return noStoreJson({ error: "Installation claim storage is unavailable.", code: "github_installation_claim_store_unavailable" }, { status: 503 });
    throw error;
  }
}
