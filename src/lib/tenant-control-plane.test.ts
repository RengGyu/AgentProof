import { describe, expect, it } from "vitest";
import {
  authorizeTenantRepositoryGrant,
  readTenantRepositoryGrants,
  tenantGrantPublicReason
} from "./tenant-control-plane";

describe("tenant control plane helpers", () => {
  it("does not require repository grants when tenant control is disabled", () => {
    expect(
      authorizeTenantRepositoryGrant({
        installationId: 321,
        repositoryFullName: "RengGyu/AgentProof"
      }, {} as NodeJS.ProcessEnv)
    ).toEqual({
      enabled: false,
      required: false,
      reason: "control-plane-disabled"
    });
  });

  it("authorizes only matching active installation and repository grants", () => {
    const env = grantEnv();

    expect(
      authorizeTenantRepositoryGrant({
        installationId: 321,
        repositoryFullName: "renggyu/agentproof"
      }, env)
    ).toEqual({
      enabled: true,
      required: true,
      grant: {
        tenantId: "tenant_test",
        installationId: 321,
        repositoryFullName: "RengGyu/AgentProof",
        enabled: true,
        analysisEnabled: true,
        commentEnabled: false,
        saveReportsEnabled: true
      }
    });

    expect(
      authorizeTenantRepositoryGrant({
        installationId: 999,
        repositoryFullName: "RengGyu/AgentProof"
      }, env)
    ).toEqual({
      enabled: true,
      required: true,
      reason: "grant-missing"
    });
  });

  it("denies disabled grants and analysis-disabled grants with bounded reasons", () => {
    expect(
      authorizeTenantRepositoryGrant({
        installationId: 321,
        repositoryFullName: "RengGyu/AgentProof"
      }, grantEnv({ enabled: false }))
    ).toMatchObject({
      enabled: true,
      required: true,
      reason: "grant-disabled"
    });

    expect(
      authorizeTenantRepositoryGrant({
        installationId: 321,
        repositoryFullName: "RengGyu/AgentProof"
      }, grantEnv({ analysisEnabled: false }))
    ).toMatchObject({
      enabled: true,
      required: true,
      reason: "analysis-disabled"
    });
  });

  it("fails closed for malformed grant configuration", () => {
    const invalidEnv = {
      AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "true",
      AGENTPROOF_TENANT_REPOSITORY_GRANTS: "{not-json"
    } as unknown as NodeJS.ProcessEnv;

    expect(readTenantRepositoryGrants(invalidEnv)).toBeNull();
    expect(
      authorizeTenantRepositoryGrant({
        installationId: 321,
        repositoryFullName: "RengGyu/AgentProof"
      }, invalidEnv)
    ).toEqual({
      enabled: true,
      required: true,
      reason: "invalid-grants"
    });
    expect(tenantGrantPublicReason("invalid-grants")).not.toContain("{not-json");
  });

  it("rejects oversized or secret-shaped grant fields instead of normalizing them into access", () => {
    const env = {
      AGENTPROOF_TENANT_REPOSITORY_GRANTS: JSON.stringify([
        {
          tenantId: "sk-secret-should-not-be-a-tenant-id",
          installationId: 321,
          repositoryFullName: "RengGyu/AgentProof"
        }
      ])
    } as unknown as NodeJS.ProcessEnv;

    expect(readTenantRepositoryGrants(env)).toBeNull();
  });
});

function grantEnv(overrides: Record<string, unknown> = {}): NodeJS.ProcessEnv {
  return {
    AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED: "true",
    AGENTPROOF_TENANT_REPOSITORY_GRANTS: JSON.stringify([
      {
        tenantId: "tenant_test",
        installationId: 321,
        repositoryFullName: "RengGyu/AgentProof",
        enabled: true,
        analysisEnabled: true,
        commentEnabled: false,
        saveReportsEnabled: true,
        ...overrides
      }
    ])
  } as unknown as NodeJS.ProcessEnv;
}
