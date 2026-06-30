import { redactSecrets } from "./redact";

export const TENANT_CONTROL_PLANE_GRANTS_ENV = "AGENTPROOF_TENANT_REPOSITORY_GRANTS";

export interface TenantControlPlaneSettings {
  enabled: boolean;
}

export interface TenantRepositoryGrant {
  tenantId: string;
  installationId: number;
  repositoryFullName: string;
  enabled: boolean;
  analysisEnabled: boolean;
  commentEnabled: boolean;
  saveReportsEnabled: boolean;
}

export interface TenantRepositoryGrantDecision {
  enabled: boolean;
  required: boolean;
  grant?: TenantRepositoryGrant;
  reason?: "control-plane-disabled" | "grant-missing" | "grant-disabled" | "analysis-disabled" | "invalid-grants";
}

interface TenantRepositoryGrantInput {
  tenantId?: unknown;
  installationId?: unknown;
  repositoryFullName?: unknown;
  enabled?: unknown;
  analysisEnabled?: unknown;
  commentEnabled?: unknown;
  saveReportsEnabled?: unknown;
}

export function getTenantControlPlaneSettings(env = process.env): TenantControlPlaneSettings {
  return {
    enabled: truthy(env.AGENTPROOF_TENANT_CONTROL_PLANE_ENABLED)
  };
}

export function authorizeTenantRepositoryGrant(
  input: { installationId: number; repositoryFullName: string },
  env = process.env
): TenantRepositoryGrantDecision {
  const settings = getTenantControlPlaneSettings(env);

  if (!settings.enabled) {
    return {
      enabled: false,
      required: false,
      reason: "control-plane-disabled"
    };
  }

  const grants = readTenantRepositoryGrants(env);
  if (!grants) {
    return {
      enabled: true,
      required: true,
      reason: "invalid-grants"
    };
  }

  const grant = grants.find((item) =>
    item.installationId === input.installationId &&
    sameRepository(item.repositoryFullName, input.repositoryFullName)
  );

  if (!grant) {
    return {
      enabled: true,
      required: true,
      reason: "grant-missing"
    };
  }

  if (!grant.enabled) {
    return {
      enabled: true,
      required: true,
      grant,
      reason: "grant-disabled"
    };
  }

  if (!grant.analysisEnabled) {
    return {
      enabled: true,
      required: true,
      grant,
      reason: "analysis-disabled"
    };
  }

  return {
    enabled: true,
    required: true,
    grant
  };
}

export function readTenantRepositoryGrants(env = process.env): TenantRepositoryGrant[] | null {
  const raw = env[TENANT_CONTROL_PLANE_GRANTS_ENV];

  if (!raw?.trim()) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  const grants: TenantRepositoryGrant[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }

    const grant = normalizeGrant(item as TenantRepositoryGrantInput);
    if (!grant) {
      return null;
    }

    grants.push(grant);
  }

  return grants.slice(0, 500);
}

export function tenantGrantPublicReason(reason: TenantRepositoryGrantDecision["reason"]): string {
  if (reason === "grant-disabled") {
    return "Repository grant is disabled for this GitHub App installation.";
  }

  if (reason === "analysis-disabled") {
    return "Repository grant exists, but AgentProof analysis is disabled for this repository.";
  }

  if (reason === "invalid-grants") {
    return "Tenant repository grants are misconfigured.";
  }

  return "No active tenant repository grant matches this GitHub App installation and repository.";
}

function normalizeGrant(input: TenantRepositoryGrantInput): TenantRepositoryGrant | null {
  const tenantId = normalizeId(input.tenantId);
  const installationId = normalizeInstallationId(input.installationId);
  const repositoryFullName = normalizeRepositoryFullName(input.repositoryFullName);

  if (!tenantId || !installationId || !repositoryFullName) {
    return null;
  }

  return {
    tenantId,
    installationId,
    repositoryFullName,
    enabled: input.enabled !== false,
    analysisEnabled: input.analysisEnabled !== false,
    commentEnabled: input.commentEnabled === true,
    saveReportsEnabled: input.saveReportsEnabled === true
  };
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = redactSecrets(value).trim();

  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(normalized) ? normalized : null;
}

function normalizeInstallationId(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return null;
  }

  return value;
}

function normalizeRepositoryFullName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = redactSecrets(value).trim();

  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized) ? normalized : null;
}

function sameRepository(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}
