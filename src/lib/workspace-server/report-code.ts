import { resolveWorkspaceAccess, type WorkspaceSource } from "./access";
import { getSavedReport } from "@/lib/server-report-store";
import { listTenantRepositoryGrants, PRIVATE_ANALYSIS_CONSENT_VERSION } from "@/lib/tenant-control-plane";
import { listTenantGitHubInstallationStatuses } from "@/lib/github-installations";
import { createGitHubInstallationAccessToken } from "@/lib/github-app";
import { buildPrEvidenceReview } from "@/lib/pr-evidence-review";
import { reportCodeReference, reviewCodeItems, type ReportCodeExcerpt } from "@/lib/report-code-reference";
import { redactSecretsPreservingLines } from "@/lib/redact";
import { noStoreJson } from "@/lib/http";

const MAX_FILE_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
class CodeReadError extends Error { constructor(readonly status: number) { super("Referenced code unavailable"); } }

export async function GET(request: Request, source: WorkspaceSource = "web") {
  try {
    const access = await resolveWorkspaceAccess(request, source);
    if (!access.authorized || !access.tenantId || !access.memberId) return failure(401);
    const query = new URL(request.url).searchParams;
    const id = query.get("reportId"), reference = query.get("reference");
    if (!id || id.length > 200 || !reference || reference.length > 300 ||
        [...query.keys()].some(key => key !== "reportId" && key !== "reference") ||
        query.getAll("reportId").length !== 1 || query.getAll("reference").length !== 1) return failure(400);
    const saved = await getSavedReport(id, { tenantId: access.tenantId });
    if (!saved || saved.tenantId !== access.tenantId || saved.availability === "unavailable" ||
        saved.report.authenticity?.trust !== "verified_agentproof" || !saved.repositoryId || !saved.installationId ||
        !saved.headSha || !/^[a-f0-9]{40}$/i.test(saved.headSha)) return failure(404);
    const readGrant = async () => {
      const grants = await listTenantRepositoryGrants({ tenantId: access.tenantId });
      const matches = grants.filter(grant => grant.tenantId === access.tenantId && grant.repositoryId === saved.repositoryId && grant.installationId === saved.installationId);
      const grant = matches.length === 1 ? matches[0] : undefined;
      if (!grant?.enabled || !grant.analysisEnabled || typeof grant.repositoryPrivate !== "boolean" ||
          !/^[\w.-]+\/[\w.-]+$/.test(grant.repositoryFullName) ||
          (grant.repositoryPrivate && grant.privateAnalysisConsentVersion !== PRIVATE_ANALYSIS_CONSENT_VERSION)) throw new CodeReadError(403);
      const statuses = await listTenantGitHubInstallationStatuses({ tenantId: access.tenantId!, installationIds: [saved.installationId!] });
      if (!statuses.some(item => item.installationId === saved.installationId && item.status === "active")) throw new CodeReadError(403);
      return grant;
    };
    const grant = await readGrant();
    // Resolve the reference from the verified stored projection, never from a
    // caller-supplied path, URL, line or branch. Base locations stay at the base.
    const review = buildPrEvidenceReview(saved.report, { repositoryFullName: grant.repositoryFullName, headSha: saved.headSha });
    const items = reviewCodeItems(review).filter(item => reportCodeReference(item) === reference);
    const locations = [...new Set(items.map(item => item.url))];
    if (locations.length !== 1 || !locations[0]) return failure(404);
    const location = new URL(locations[0]);
    const parts = location.pathname.split("/").slice(1).map(decodeURIComponent);
    if (location.origin !== "https://github.com" || location.username || location.password || location.search ||
        `${parts[0]}/${parts[1]}`.toLowerCase() !== grant.repositoryFullName.toLowerCase() || parts[2] !== "blob" ||
        !/^[a-f0-9]{40}$/i.test(parts[3] ?? "")) return failure(404);
    const revision = parts[3], path = parts.slice(4).join("/");
    if (!path || path.length > 240 || path.split("/").some(part => !part || part === "." || part === "..") || /[\\\u0000-\u001f]/.test(path)) return failure(404);
    const focusLine = items[0].line;
    const token = await createGitHubInstallationAccessToken(grant.installationId);
    const repository = await githubJson(`/repositories/${saved.repositoryId}`, token);
    if (repository.id !== saved.repositoryId || typeof repository.full_name !== "string" ||
        repository.full_name.toLowerCase() !== grant.repositoryFullName.toLowerCase() || repository.private !== grant.repositoryPrivate) return failure(403);
    const content = await githubJson(`/repos/${grant.repositoryFullName.split("/").map(encodeURIComponent).join("/")}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${revision}`, token);
    if (content.type !== "file" || content.path !== path || content.submodule_git_url || content.target || content.encoding !== "base64" ||
        !Number.isSafeInteger(content.size) || content.size < 0 || content.size > MAX_FILE_BYTES || typeof content.content !== "string") return failure(422);
    const encoded = content.content.replace(/\s/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) return failure(422);
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length > MAX_FILE_BYTES || bytes.length !== content.size) return failure(422);
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return failure(422); }
    if (text.includes("\0")) return failure(422);
    const sourceLines = text ? redactSecretsPreservingLines(text.replace(/\r\n/g, "\n")).split("\n") : [];
    const start = focusLine ? Math.max(0, focusLine - 21) : 0;
    if (sourceLines.length && start >= sourceLines.length) return failure(422);
    const selected = sourceLines.slice(start, start + 60);
    let remaining = 12_000, shortened = false;
    const lines = selected.flatMap((line, index) => {
      if (remaining <= 0) { shortened = true; return []; }
      const budget = Math.min(2000, remaining);
      const shown = line.length > budget ? `${line.slice(0, budget)}…` : line;
      shortened ||= line.length > budget;
      remaining -= shown.length;
      return [{ number: start + index + 1, text: shown }];
    });
    // Revocation during a network read must not release private code.
    const currentAccess = await resolveWorkspaceAccess(request, source);
    if (!currentAccess.authorized || currentAccess.tenantId !== access.tenantId || currentAccess.memberId !== access.memberId) return failure(401);
    const currentGrant = await readGrant();
    if (currentGrant.repositoryFullName !== grant.repositoryFullName || currentGrant.repositoryPrivate !== grant.repositoryPrivate) return failure(403);
    const excerpt: ReportCodeExcerpt = { reference, path, revision, ...(focusLine ? { focusLine } : {}), totalLines: sourceLines.length, lines,
      truncated: shortened || start > 0 || start + lines.length < sourceLines.length };
    return noStoreJson(excerpt);
  } catch (error) { return failure(error instanceof CodeReadError ? error.status : 503); }
}

async function githubJson(path: string, token: string): Promise<Record<string, any>> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new CodeReadError(response.status === 401 || response.status === 403 ? 403 : response.status === 404 ? 404 : 503);
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES || !response.body) throw new CodeReadError(422);
  const reader = response.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new CodeReadError(422);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new CodeReadError(422);
  return body as Record<string, any>;
}
function failure(status: number) {
  return noStoreJson({ error: status === 401 ? "Sign in again to read referenced code." : status === 403 ? "Repository access or code-reading consent is unavailable. Check repository settings." : status === 422 ? "This referenced file cannot be shown as a bounded text excerpt." : "Referenced code is unavailable. It may be missing or inaccessible at this recorded revision; this is not evidence of missing implementation." }, { status });
}
