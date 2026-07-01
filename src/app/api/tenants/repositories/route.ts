import {
  getTenantControlPlaneSettings,
  listTenantRepositoryGrants,
  TenantControlPlaneStoreError,
  type TenantRepositoryGrant,
  updateTenantRepositoryGrantSettings
} from "@/lib/tenant-control-plane";
import { canUsePrivilegedTenantAccess, verifyTenantAccess } from "@/lib/tenant-admin-access";
import { noStoreJson, parseJsonSafely, utf8ByteLength } from "@/lib/http";
import { assertTenantDeletionNotActiveAsync, TenantDeletionStateError } from "@/lib/tenant-deletion-state";

const MAX_SETTINGS_REQUEST_BYTES = 20_000;
const PATCH_KEYS = new Set(["tenantId", "installationId", "repositoryId", "settings"]);
const SETTINGS_KEYS = new Set([
  "enabled",
  "analysisEnabled",
  "commentEnabled",
  "saveReportsEnabled",
  "slackNotificationsEnabled"
]);

interface RepositorySettingsPatchRequest {
  tenantId?: unknown;
  installationId?: unknown;
  repositoryId?: unknown;
  settings?: {
    enabled?: unknown;
    analysisEnabled?: unknown;
    commentEnabled?: unknown;
    saveReportsEnabled?: unknown;
    slackNotificationsEnabled?: unknown;
  };
}

export async function GET(request: Request) {
  if (!getTenantControlPlaneSettings().enabled) {
    return noStoreJson({
      error: "Tenant control plane must be enabled before repository settings can be read.",
      code: "tenant_repository_settings_control_required"
    }, { status: 409 });
  }

  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenantId");
  const inviteToken = request.headers.get("x-agentproof-beta-invite-token") ?? undefined;
  const access = await verifyTenantAccess({
    tenantId,
    inviteToken,
    cookieHeader: request.headers.get("cookie")
  });

  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant repository settings require valid tenant authorization.",
      code: "tenant_repository_settings_unauthorized"
    }, { status: 401 });
  }
  const authorizedTenantId = access.tenantId;

  try {
    const repositories = await listTenantRepositoryGrants({ tenantId: authorizedTenantId });

    return noStoreJson({
      ok: true,
      tenantId: authorizedTenantId,
      repositories: repositories.map(toPublicRepositorySettings),
      privacy: "grant-metadata-only",
      next: "configure_repository"
    });
  } catch (error) {
    if (error instanceof TenantControlPlaneStoreError) {
      return noStoreJson({
        error: "Tenant repository grant store is unavailable.",
        code: "tenant_repository_grant_store_unavailable"
      }, { status: 503 });
    }

    throw error;
  }
}

export async function PATCH(request: Request) {
  if (!getTenantControlPlaneSettings().enabled) {
    return noStoreJson({
      error: "Tenant control plane must be enabled before repository settings can be changed.",
      code: "tenant_repository_settings_control_required"
    }, { status: 409 });
  }

  const bodyText = await request.text();

  if (utf8ByteLength(bodyText) > MAX_SETTINGS_REQUEST_BYTES) {
    return noStoreJson({
      error: "Tenant repository settings payload is too large.",
      code: "tenant_repository_settings_payload_too_large"
    }, { status: 413 });
  }

  const body = parseJsonSafely<RepositorySettingsPatchRequest>(bodyText);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return noStoreJson({
      error: "Tenant repository settings request must be a JSON object.",
      code: "tenant_repository_settings_payload_invalid"
    }, { status: 400 });
  }
  if (!hasOnlyKnownKeys(body, PATCH_KEYS)) {
    return noStoreJson({
      error: "Tenant repository settings request contains unsupported fields.",
      code: "tenant_repository_settings_payload_invalid"
    }, { status: 422 });
  }

  const inviteToken = request.headers.get("x-agentproof-beta-invite-token") ?? undefined;
  const access = await verifyTenantAccess({
    tenantId: body.tenantId,
    inviteToken,
    cookieHeader: request.headers.get("cookie")
  });
  if (!access.authorized || !access.tenantId) {
    return noStoreJson({
      error: "Tenant repository settings require valid tenant authorization.",
      code: "tenant_repository_settings_unauthorized"
    }, { status: 401 });
  }
  if (!canUsePrivilegedTenantAccess(access)) {
    return noStoreJson({
      error: "Tenant repository settings require an owner or admin role.",
      code: "tenant_repository_settings_role_required"
    }, { status: 403 });
  }
  const authorizedTenantId = access.tenantId;

  try {
    await assertTenantDeletionNotActiveAsync({ tenantId: authorizedTenantId });
  } catch (error) {
    if (error instanceof TenantDeletionStateError) {
      return tenantRepositorySettingsUnavailableResponse(error);
    }

    throw error;
  }

  if (!body.settings || typeof body.settings !== "object" || Array.isArray(body.settings)) {
    return noStoreJson({
      error: "Repository settings are required.",
      code: "tenant_repository_settings_required"
    }, { status: 422 });
  }

  const installationId = normalizePositiveInteger(body.installationId);
  const repositoryId = normalizePositiveInteger(body.repositoryId);
  if (!installationId || !repositoryId) {
    return noStoreJson({
      error: "A valid installation id and repository id are required.",
      code: "tenant_repository_settings_repository_required"
    }, { status: 422 });
  }

  const settingsValidation = validateSettingsPayload(body.settings);
  if (!settingsValidation.valid) {
    return noStoreJson({
      error: "Repository settings may only update known boolean verification settings.",
      code: "tenant_repository_settings_invalid"
    }, { status: 422 });
  }

  try {
    const updated = await updateTenantRepositoryGrantSettings({
      tenantId: authorizedTenantId,
      installationId,
      repositoryId,
      ...settingsValidation.settings
    });

    return noStoreJson({
      ok: true,
      tenantId: updated.tenantId,
      repository: toPublicRepositorySettings(updated),
      privacy: "grant-metadata-only",
      next: "repository_settings_saved"
    });
  } catch (error) {
    if (error instanceof TenantDeletionStateError) {
      return tenantRepositorySettingsUnavailableResponse(error);
    }

    if (error instanceof TenantControlPlaneStoreError) {
      if (error.message.includes("not found")) {
        return noStoreJson({
          error: "Tenant repository grant was not found.",
          code: "tenant_repository_grant_not_found"
        }, { status: 404 });
      }

      return noStoreJson({
        error: "Tenant repository grant store is unavailable.",
        code: "tenant_repository_grant_store_unavailable"
      }, { status: 503 });
    }

    throw error;
  }
}

function tenantRepositorySettingsUnavailableResponse(error: TenantDeletionStateError) {
  const status = error.message.includes("Supabase") || error.message.includes("HTTP") || error.message.includes("invalid")
    ? 503
    : 409;

  return noStoreJson({
    error: "Tenant repository settings are unavailable.",
    code: "tenant_repository_settings_unavailable"
  }, { status });
}

function toPublicRepositorySettings(grant: TenantRepositoryGrant) {
  return {
    installationId: grant.installationId,
    repositoryId: grant.repositoryId,
    repositoryFullName: grant.repositoryFullName,
    enabled: grant.enabled,
    analysisEnabled: grant.analysisEnabled,
    saveReportsEnabled: grant.saveReportsEnabled,
    commentEnabled: grant.commentEnabled,
    slackNotificationsEnabled: grant.slackNotificationsEnabled
  };
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const numberValue = typeof value === "string" ? Number(value) : value;

  return typeof numberValue === "number" && Number.isInteger(numberValue) && numberValue > 0
    ? numberValue
    : undefined;
}

function hasOnlyKnownKeys(value: object, knownKeys: Set<string>): boolean {
  return Object.keys(value).every((key) => knownKeys.has(key));
}

function validateSettingsPayload(value: Record<string, unknown>): {
  valid: boolean;
  settings?: {
    enabled?: boolean;
    analysisEnabled?: boolean;
    commentEnabled?: boolean;
    saveReportsEnabled?: boolean;
    slackNotificationsEnabled?: boolean;
  };
} {
  const entries = Object.entries(value);
  if (entries.length === 0) return { valid: false };

  const settings: {
    enabled?: boolean;
    analysisEnabled?: boolean;
    commentEnabled?: boolean;
    saveReportsEnabled?: boolean;
    slackNotificationsEnabled?: boolean;
  } = {};

  for (const [key, setting] of entries) {
    if (!SETTINGS_KEYS.has(key) || typeof setting !== "boolean") {
      return { valid: false };
    }

    settings[key as keyof typeof settings] = setting;
  }

  return { valid: true, settings };
}
