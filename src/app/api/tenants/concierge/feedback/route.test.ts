import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  csrf: vi.fn(), runtime: vi.fn(), authStatus: vi.fn(), accountStatus: vi.fn(), verifySession: vi.fn(), validate: vi.fn(), store: vi.fn()
}));

vi.mock("@/lib/csrf", () => ({ verifySameOriginMutationRequest: mocks.csrf }));
vi.mock("@/lib/concierge-private-beta", () => ({ conciergeRuntimeDefaults: mocks.runtime }));
vi.mock("@/lib/tenant-auth", () => ({ getTenantAuthSessionStoreStatus: mocks.authStatus, verifyTenantAuthAccess: mocks.verifySession }));
vi.mock("@/lib/tenant-accounts", () => ({ getTenantAccountStoreStatus: mocks.accountStatus }));
vi.mock("@/lib/concierge-feedback", () => ({ validateConciergeFeedback: mocks.validate, storeConciergeFeedback: mocks.store }));

import { POST } from "./route";

const feedback = { schemaVersion: "concierge-feedback.v2" };
const durable = { configured: true, durable: true };

describe("Concierge feedback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.csrf.mockReturnValue({ ok: true });
    mocks.runtime.mockReturnValue({ manualAnalysisEnabled: true, globalKillSwitch: false });
    mocks.authStatus.mockReturnValue(durable); mocks.accountStatus.mockReturnValue(durable);
    mocks.verifySession.mockResolvedValue({ authorized: true, method: "durable-session" });
    mocks.validate.mockReturnValue({ valid: true, value: feedback });
  });

  function request() {
    return new Request("https://beta.example.test/api/tenants/concierge/feedback", {
      method: "POST", body: JSON.stringify({ tenantId: "tenant_alpha", feedback })
    });
  }

  it("returns an explicit bounded duplicate result without a retry write", async () => {
    mocks.store.mockResolvedValue("duplicate");
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ stored: false, duplicate: true, privacy: "bounded-metadata-only" });
    expect(mocks.store).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["rejected", 409, "feedback_not_eligible"],
    ["unavailable", 503, "feedback_store_unavailable"]
  ])("maps bounded store %s without returning feedback data", async (result, status, code) => {
    mocks.store.mockResolvedValue(result);
    const response = await POST(request());
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual({ code });
  });

  it("rejects invalid sessions before feedback validation or storage", async () => {
    mocks.verifySession.mockResolvedValue({ authorized: false, method: "none" });
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.store).not.toHaveBeenCalled();
  });
});
