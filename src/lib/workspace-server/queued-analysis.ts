import { resolveWorkspaceAccess, validWorkspaceMutation, type WorkspaceSource } from './access';
import { resolveGitHubAnalysisCredential } from '@/lib/github-analysis-access';
import { fetchGitHubPullRequestAnchor, parseGitHubPullUrl } from '@/lib/github';
import { authorizeTenantRepositoryGrantAsync } from '@/lib/tenant-control-plane';
import { listTenantGitHubInstallationStatuses } from '@/lib/github-installations';
import { enqueueAnalysisJob, getAnalysisJobQueueStatus, readTenantRepositoryAnalysisJobs, type AnalysisJobRow } from '@/lib/analysis-jobs';
import { scheduleAnalysisJobWake } from '@/lib/analysis-job-wake';
import { getSavedReport, getSavedReportStoreStatus } from '@/lib/server-report-store';
import { noStoreJson, utf8ByteLength } from '@/lib/http';
import { csrfFailureResponse } from '@/lib/csrf';
import { PRIVATE_ANALYSIS_CONSENT_VERSION } from '@/lib/tenant-control-plane';
import { assertTenantPlanAllowsGitHubAppAnalysis, readUsageQuotaPlanCapabilities } from '@/lib/usage-quota';
import { evaluateBillingBetaGate } from '@/lib/billing-beta';
import type { DashboardAnalysisJob } from '@/lib/github-dashboard-view-model';
const unavailable = () => noStoreJson({ error: 'Saved analysis is temporarily unavailable. Existing reports remain available.', code: 'workspace_queue_unavailable' }, { status: 503 });
const unauthorized = () => noStoreJson({ error: 'Sign in again to use this workspace.', code: 'workspace_session_changed' }, { status: 401 });
const denied = () => noStoreJson({ error: 'Open repository settings to continue.', code: 'github_connection_required' }, { status: 403 });
const uuid = (x: string | null) => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
/** Retained workspace only. Temporary /analyze keeps its existing synchronous contract. */
export async function POST(request: Request, source: WorkspaceSource = 'web') {
    try {
        const access = await resolveWorkspaceAccess(request, source);
        if (!access.authorized || !access.tenantId || !access.memberId)
            return unauthorized();
        if (!validWorkspaceMutation(request, source))
            return csrfFailureResponse();
        const text = await request.text();
        if (utf8ByteLength(text) > 80000)
            return noStoreJson({ error: 'Request is too large.' }, { status: 413 });
        let body: unknown;
        try {
            body = JSON.parse(text);
        }
        catch {
            return noStoreJson({ error: 'A GitHub PR URL is required.' }, { status: 400 });
        }
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => k !== 'prUrl') || typeof (body as {
            prUrl?: unknown;
        }).prUrl !== 'string')
            return noStoreJson({ error: 'A GitHub PR URL is required.' }, { status: 400 });
        const prUrl = (body as {
            prUrl: string;
        }).prUrl.trim(), pr = parseGitHubPullUrl(prUrl);
        const key = request.headers.get('x-agentproof-analysis-key');
        if (!pr || !uuid(key))
            return noStoreJson({ error: 'A valid PR URL and request identifier are required.' }, { status: 400 });
        const credential = await resolveGitHubAnalysisCredential({ prUrl, tenantId: access.tenantId, memberId: access.memberId, cookieHeader: request.headers.get('cookie'), requireSave: true });
        if (!credential.ok)
            return noStoreJson({ error: credential.error, code: credential.code }, { status: credential.status });
        if (credential.kind !== 'installation' || !credential.installationId || !credential.repositoryId)
            return denied();
        if (!getAnalysisJobQueueStatus().durable || !getSavedReportStoreStatus().durable)
            return unavailable();
        const plan = readUsageQuotaPlanCapabilities({ tenantId: access.tenantId }).plan;
        if (!evaluateBillingBetaGate({ tenantId: access.tenantId, quotaPlan: plan }).allowed)
            return denied();
        assertTenantPlanAllowsGitHubAppAnalysis({ tenantId: access.tenantId });
        const anchor = await fetchGitHubPullRequestAnchor(prUrl, credential.token);
        if (!anchor)
            return unavailable();
        const receipt = await enqueueAnalysisJob({ tenantId: access.tenantId, idempotencyKey: [access.tenantId, credential.repositoryId, pr.number, anchor.headSha, key].join(':'), deliveryId: key!, event: 'workspace_manual', action: credential.reportLanguage ?? 'en', installationId: credential.installationId, repositoryId: credential.repositoryId, repositoryFullName: `${pr.owner}/${pr.repo}`, pullRequestNumber: pr.number, pullRequestUrl: prUrl, headSha: anchor.headSha, saveReport: true, comment: false, manualRequest: true });
        if (!receipt.durable || !receipt.revision || !receipt.updatedAt)
            return unavailable();
        const job: DashboardAnalysisJob = { id: receipt.id, revision: receipt.revision, updatedAt: receipt.updatedAt, repositoryId: credential.repositoryId, pullRequestNumber: pr.number, headSha: anchor.headSha, status: receipt.status === 'processing' ? 'running' : receipt.status === 'failed_terminal' ? 'failed' : 'queued' };
        // No request signal enters the worker. Cron can recover even if this wake is unavailable.
        if (receipt.status === 'queued' || receipt.status === 'processing' || receipt.status === 'failed_retryable')
            scheduleAnalysisJobWake(receipt.id, request.url);
        return noStoreJson({ ok: true, accepted: true, job }, { status: 202 });
    }
    catch {
        return unavailable();
    }
}
/** Server-only binding check shared by status and history discovery. No token is issued for polling. */
export async function canReadWorkspaceJob(row: AnalysisJobRow, tenantId: string) {
    if (row.tenant_id !== tenantId || !row.repository_id)
        return false;
    const decision = await authorizeTenantRepositoryGrantAsync({ installationId: row.installation_id, repositoryId: row.repository_id, repositoryFullName: row.repository_full_name });
    const g = decision.grant;
    if (decision.reason || !g || g.tenantId !== tenantId || !g.saveReportsEnabled || g.repositoryPrivate === true && g.privateAnalysisConsentVersion !== PRIVATE_ANALYSIS_CONSENT_VERSION)
        return false;
    const installs = await listTenantGitHubInstallationStatuses({ tenantId, installationIds: [row.installation_id] });
    return installs.some(i => i.installationId === row.installation_id && i.status === 'active');
}
export function workspaceJobReceipt(row: AnalysisJobRow): DashboardAnalysisJob {
    return { id: row.id, revision: row.desired_revision ?? 1, updatedAt: row.updated_at, repositoryId: row.repository_id!, pullRequestNumber: row.pull_request_number, headSha: row.head_sha, status: row.status === 'processing' ? 'running' : row.status === 'failed_terminal' ? 'failed' : row.status === 'completed' ? 'unknown' : 'queued' };
}
export async function GET(request: Request, source: WorkspaceSource = 'web') {
    try {
        const access = await resolveWorkspaceAccess(request, source);
        if (!access.authorized || !access.tenantId)
            return unauthorized();
        const q = new URL(request.url).searchParams, id = q.get('jobId'), repositoryId = Number(q.get('repositoryId')), revision = Number(q.get('revision'));
        if (!uuid(id) || !Number.isSafeInteger(repositoryId) || repositoryId < 1 || !Number.isSafeInteger(revision) || revision < 1)
            return noStoreJson({ error: 'Invalid analysis selector.' }, { status: 400 });
        const row = (await readTenantRepositoryAnalysisJobs({ tenantId: access.tenantId, repositoryId, id: id! }))[0];
        if (!row)
            return noStoreJson({ error: 'Analysis was not found.' }, { status: 404 });
        if (!await canReadWorkspaceJob(row, access.tenantId))
            return denied();
        const job = workspaceJobReceipt(row);
        if (job.revision !== revision)
            job.status = 'superseded';
        else if (row.status === 'completed') {
            const id = row.result_summary?.savedReport?.id;
            const saved = id ? await getSavedReport(id, { tenantId: access.tenantId }) : null;
            if (saved && saved.tenantId === access.tenantId && saved.repositoryId === repositoryId && saved.pullRequestNumber === row.pull_request_number && saved.headSha === row.head_sha && saved.availability !== 'unavailable' && saved.report.authenticity?.trust === 'verified_agentproof') {
                job.status = 'saved';
                job.reportId = saved.id;
            }
            // completed without a verified saved report is deliberately not a successful result.
        }
        return noStoreJson({ ok: true, job });
    }
    catch {
        return unavailable();
    }
}
