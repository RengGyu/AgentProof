import { afterEach, describe, expect, it, vi } from "vitest";
import {
  readTenantAccountSeeds,
  readTenantAccountSummary
} from "./tenant-accounts";

describe("tenant account metadata boundary", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns session-derived fallback metadata when no account store is configured", async () => {
    const result = await readTenantAccountSummary({ tenantId: " tenant_a " });

    expect(result).toEqual({
      privacy: "tenant-account-summary-only",
      account: {
        tenantId: "tenant_a",
        name: "tenant_a",
        status: "invite-only",
        plan: "beta",
        configured: false,
        memberCount: 0
      },
      members: [],
      roleCounts: {
        owner: 0,
        admin: 0,
        member: 0
      }
    });
  });

  it("reads env-seeded account members without exposing extra contact or secret fields", async () => {
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
      {
        tenantId: "tenant_a",
        name: "AgentProof Team",
        status: "active",
        plan: "team",
        email: "owner@example.com",
        token: "github_pat_secret_should_not_leak_1234567890",
        members: [
          {
            memberId: "owner_1",
            role: "owner",
            status: "active",
            email: "owner@example.com",
            token: "sk-secret_should_not_leak"
          },
          {
            memberId: "admin_1",
            role: "admin",
            status: "invited"
          }
        ]
      }
    ]));

    const result = await readTenantAccountSummary({ tenantId: "tenant_a" });
    const serialized = JSON.stringify(result);

    expect(result.account).toEqual({
      tenantId: "tenant_a",
      name: "AgentProof Team",
      status: "active",
      plan: "team",
      configured: true,
      memberCount: 2
    });
    expect(result.members).toEqual([
      { memberId: "owner_1", role: "owner", status: "active" },
      { memberId: "admin_1", role: "admin", status: "invited" }
    ]);
    expect(result.roleCounts).toEqual({ owner: 1, admin: 1, member: 0 });
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("sk-secret");
  });

  it("rejects malformed account seed configuration", () => {
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS", JSON.stringify([
      { tenantId: "tenant_a", members: "owner@example.com" }
    ]));

    expect(readTenantAccountSeeds()).toBeNull();
  });

  it("uses narrow Supabase projections for tenants and members", async () => {
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS_SUPABASE_URL", "https://agentproof-test.supabase.co");
    vi.stubEnv("AGENTPROOF_TENANT_ACCOUNTS_SUPABASE_SERVICE_ROLE_KEY", "service-role-secret");
    vi.stubEnv("AGENTPROOF_TENANTS_TABLE", "private_tenants_table");
    vi.stubEnv("AGENTPROOF_TENANT_MEMBERS_TABLE", "private_members_table");
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("private_tenants_table")) {
        return Response.json([
          { tenant_id: "tenant_a", name: "AgentProof Team", status: "trialing", plan: "team" }
        ]);
      }

      return Response.json([
        { member_id: "owner_1", role: "owner", status: "active", email: "owner@example.com" },
        { member_id: "member_1", role: "member", status: "active", token: "github_pat_secret_should_not_leak" }
      ]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await readTenantAccountSummary({ tenantId: "tenant_a" });
    const [tenantUrl] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const [memberUrl] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    const serialized = JSON.stringify(result);

    expect(result.account).toMatchObject({
      tenantId: "tenant_a",
      name: "AgentProof Team",
      status: "trialing",
      plan: "team",
      configured: true,
      memberCount: 2
    });
    expect(tenantUrl).toContain("select=tenant_id%2Cname%2Cstatus%2Cplan");
    expect(memberUrl).toContain("select=member_id%2Crole%2Cstatus");
    expect(tenantUrl).not.toContain("email");
    expect(memberUrl).not.toContain("email");
    expect(memberUrl).not.toContain("token");
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("private_tenants_table");
    expect(serialized).not.toContain("private_members_table");
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("github_pat_secret");
  });
});
