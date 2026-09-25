import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import * as github from '@/lib/github';
import * as observation from '@/lib/general-pr-observation-service';
import { resolveGitHubAnalysisCredential } from '@/lib/github-analysis-access';
import { demoScenarios } from '@/lib/sample-data';
import { clearTenantAuthSessionsForTests, createTenantAuthSessionForMember, revokeTenantAuthSession } from '@/lib/tenant-auth';
vi.mock('@/lib/github-analysis-access', () => ({ resolveGitHubAnalysisCredential: vi.fn(async () => ({ ok: true, token: 'server-selected-test-token', kind: 'user' })), isPrivateAnalysisGrantCurrent: vi.fn(async () => true) }));

const account = { tenantId: 'gh_123', name: 'Test', status: 'active', plan: 'beta', members: [{ memberId: 'github:123', role: 'owner', status: 'active' }] };
const payload = { prUrl: 'https://github.com/acme/repo/pull/1' };
function request(body = payload, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/analyze', { method: 'POST', headers: { origin: 'http://localhost', ...headers }, body: JSON.stringify(body) });
}
async function session(now = Date.now()) {
  return createTenantAuthSessionForMember({ tenantId: account.tenantId, memberId: 'github:123' }, process.env, now);
}

beforeEach(() => {
  for (const key of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'AGENTPROOF_CONTROL_PLANE_SUPABASE_URL', 'AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY', 'AGENTPROOF_TENANT_AUTH_SUPABASE_URL', 'AGENTPROOF_TENANT_AUTH_SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'AI_GATEWAY_API_KEY']) vi.stubEnv(key, '');
  vi.stubEnv('GEMINI_API_KEY', 'test-key');
  vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE', 'advisory');
  vi.stubEnv('AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY', 'true');
  vi.stubEnv('AGENTPROOF_TENANT_ACCOUNTS', JSON.stringify([account]));
  vi.spyOn(github, 'buildPullRequestInput').mockResolvedValue(Object.values(demoScenarios)[0]);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected external call'); }));
});
afterEach(() => { clearTenantAuthSessionsForTests(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('paid public analysis authentication boundary', () => {
  it('rejects a private PR when the selected credential has no approved private grant', async () => {
    vi.spyOn(github, 'buildPullRequestInput').mockResolvedValue({ ...demoScenarios.clean, repositoryPrivate: true, sourceProvenance: { version: 1, origin: 'github_snapshot', headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), evidenceCapturedAt: '2026-09-24T00:00:00Z', inputFingerprint: { version: 1, algorithm: 'sha256', value: 'c'.repeat(64), coverage: 'github_metadata' } } });
    const response = await POST(request(payload, { cookie: (await session()).sessionCookie }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'github_private_consent_required' });
  });
  it('wires approved private GitHub snapshots into the public navigation contract', async () => {
    vi.mocked(resolveGitHubAnalysisCredential).mockResolvedValueOnce({ ok: true, token: 'installation-test-token', kind: 'installation', privateAnalysisApproved: true, installationId: 42, repositoryId: 9 });
    vi.spyOn(github, 'buildPullRequestInput').mockResolvedValue({ ...demoScenarios.clean, url: payload.prUrl, repositoryPrivate: true, taskText: '', sourceProvenance: { version: 1, origin: 'github_snapshot', headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), evidenceCapturedAt: '2026-09-24T00:00:00Z', inputFingerprint: { version: 1, algorithm: 'sha256', value: 'c'.repeat(64), coverage: 'github_metadata' } } });
    const run = vi.spyOn(observation, 'runGeneralPrObservationNowV2').mockImplementation(async options => ({ report: options.generateReport(options.input), bundle: null, ordinaryDocumentationDiagnostic: { state: 'assessment_hidden' } as never }));
    const response = await POST(request(payload, { cookie: (await session()).sessionCookie }));
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(200);
    expect(run.mock.calls[0][0].navigation?.provider).toBeTypeOf('function');
    expect(await run.mock.calls[0][0].navigation?.authorizePrivate?.()).toBe(true);
  });
  it.each(['missing', 'forged', 'expired', 'revoked', 'disabled'])('blocks %s session before evidence or provider calls', async state => {
    let cookie = '';
    if (state === 'forged') cookie = 'agentproof_tenant_auth_session=forged';
    if (['expired', 'revoked', 'disabled'].includes(state)) {
      cookie = (await session(state === 'expired' ? Date.now() - 31 * 24 * 3600_000 : Date.now())).sessionCookie;
      if (state === 'revoked') await revokeTenantAuthSession({ cookieHeader: cookie });
      if (state === 'disabled') vi.stubEnv('AGENTPROOF_TENANT_ACCOUNTS', JSON.stringify([{ ...account, status: 'suspended' }]));
    }
    const response = await POST(request(payload, { cookie }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'github_login_required' });
    expect(github.buildPullRequestInput).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('ignores caller-supplied tenant, GitHub token, and operator identity as session substitutes', async () => {
    vi.stubEnv('AGENTPROOF_OPS_TOKEN', 'operator-token');
    const response = await POST(request({ ...payload, tenantId: account.tenantId, githubToken: 'fake-token' } as typeof payload, { 'x-agentproof-ops-token': 'operator-token', 'x-agentproof-observation-diagnostics': 'semantic-boundary-v1', 'x-agentproof-tenant-id': account.tenantId }));
    expect(response.status).toBe(401);
    expect(github.buildPullRequestInput).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: 'https://attacker.example' }, { 'sec-fetch-site': 'cross-site' }, { origin: '' }])('blocks unsafe mutation %j with a valid cookie', async headers => {
    const response = await POST(request(payload, { cookie: (await session()).sessionCookie, ...headers }));
    expect(response.status).toBe(403);
    expect(github.buildPullRequestInput).not.toHaveBeenCalled();
  });
  it('fails closed when the session store is unavailable', async () => {
    vi.stubEnv('AGENTPROOF_TENANT_AUTH_ALLOW_MEMORY', 'false');
    vi.stubEnv('AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_URL', 'https://test.invalid');
    vi.stubEnv('AGENTPROOF_TENANT_AUTH_SESSIONS_SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    const response = await POST(request(payload, { cookie: 'agentproof_tenant_auth_session=unknown' }));
    expect(response.status).toBe(503);
    expect(github.buildPullRequestInput).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain('unknown');
  });
  it('allows a valid durable session and same-origin request', async () => {
    const response = await POST(request(payload, { cookie: (await session()).sessionCookie }));
    expect(response.status).toBe(200);
    expect(github.buildPullRequestInput).toHaveBeenCalledOnce();
  });
  it('also guards the OpenAI fallback', async () => {
    vi.stubEnv('GEMINI_API_KEY', ''); vi.stubEnv('OPENAI_API_KEY', 'test'); vi.stubEnv('OPENAI_MODEL', 'test');
    expect((await POST(request())).status).toBe(401);
    expect(github.buildPullRequestInput).not.toHaveBeenCalled();
  });
  it.each(['disabled', 'unconfigured'])('requires login for %s deterministic PR collection', async mode => {
    if (mode === 'disabled') vi.stubEnv('AGENTPROOF_GENERAL_PR_OBSERVATION_MODE', 'disabled');
    else vi.stubEnv('GEMINI_API_KEY', '');
    expect((await POST(request())).status).toBe(401);
    expect(github.buildPullRequestInput).not.toHaveBeenCalled();
  });
  it('keeps demos public even with a mixed-in PR URL', async () => {
    const run = vi.spyOn(observation, 'runGeneralPrObservationNowV2');
    vi.spyOn(observation, 'isGeneralPrSemanticObserverEligibleV2').mockReturnValue(true);
    const response = await POST(request({ ...payload, demoScenario: Object.keys(demoScenarios)[0] } as typeof payload));
    expect(response.status).toBe(200);
    expect(github.buildPullRequestInput).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(run.mock.calls[0][0].navigation?.provider).toBeUndefined();
    expect(run.mock.calls[0][0].semantic).toBeUndefined();
  });
});
