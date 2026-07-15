import { afterEach, describe, expect, it, vi } from "vitest";
import { buildConciergeRequestKey, finishConciergeAnalysis, reserveConciergeAnalysis } from "./concierge-analysis-store";

const env = { ...process.env, AGENTPROOF_CONCIERGE_SUPABASE_URL: "https://example.supabase.co", AGENTPROOF_CONCIERGE_SUPABASE_SERVICE_ROLE_KEY: "placeholder", AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://example.supabase.co", AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "placeholder" };
const base = { tenantId: "tenant_alpha", installationId: 1, repositoryId: 2, pullRequestNumber: 3, headSha: "a".repeat(40) };

afterEach(() => vi.unstubAllGlobals());
describe("concierge durable analysis store", () => {
  it("keeps identical inputs stable and changes every snapshot/idempotency boundary", () => {
    const key = buildConciergeRequestKey(base);
    expect(buildConciergeRequestKey({ ...base })).toBe(key);
    for (const changed of [{ ...base, headSha: "b".repeat(40) }, { ...base, repositoryId: 9 }, { ...base, explicitTaskHash: "c".repeat(64) }]) expect(buildConciergeRequestKey(changed)).not.toBe(key);
  });
  it("accepts only the exact reserve RPC response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ outcome: "reserved", extra: true }]), { status: 200 })));
    expect((await reserveConciergeAnalysis({ requestKey: "a".repeat(64), tenantId: "tenant_alpha", installationId: 1, repositoryId: 2 }, env)).outcome).toBe("unavailable");
  });
  it("requires an exact true terminal transition response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("false", { status: 200 })));
    expect(await finishConciergeAnalysis({ requestKey: "a".repeat(64), outcome: "completed", reason: "manual_report_validated" }, env)).toBe(false);
  });
  it("fails closed when the run store and tenant stores resolve to different projects", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const mismatch = { ...env, AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://other-project.supabase.co" };
    expect((await reserveConciergeAnalysis({ requestKey: "a".repeat(64), tenantId: "tenant_alpha", installationId: 1, repositoryId: 2 }, mismatch)).outcome).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
