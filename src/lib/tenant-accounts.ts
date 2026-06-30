import { redactSecrets } from "./redact";

export const DEFAULT_TENANTS_TABLE = "agentproof_tenants";
export const DEFAULT_TENANT_MEMBERS_TABLE = "agentproof_tenant_members";
export const TENANT_ACCOUNTS_ENV = "AGENTPROOF_TENANT_ACCOUNTS";

export type TenantAccountStatus = "active" | "trialing" | "suspended" | "deleted" | "invite-only" | "unknown";
export type TenantAccountPlan = "free" | "beta" | "team" | "pro" | "enterprise" | "custom" | "unknown";
export type TenantMemberRole = "owner" | "admin" | "member";
export type TenantMemberStatus = "active" | "invited" | "disabled";

export interface TenantMemberSummary {
  memberId: string;
  role: TenantMemberRole;
  status: TenantMemberStatus;
}

export interface TenantAccountSummary {
  tenantId: string;
  name: string;
  status: TenantAccountStatus;
  plan: TenantAccountPlan;
  configured: boolean;
  memberCount: number;
}

export interface TenantAccountReadResult {
  privacy: "tenant-account-summary-only";
  account: TenantAccountSummary;
  members: TenantMemberSummary[];
  roleCounts: Record<TenantMemberRole, number>;
}

interface TenantAccountSeedInput {
  tenantId?: unknown;
  name?: unknown;
  status?: unknown;
  plan?: unknown;
  members?: unknown;
}

interface TenantMemberSeedInput {
  memberId?: unknown;
  role?: unknown;
  status?: unknown;
}

interface TenantAccountSeed {
  tenantId: string;
  name: string;
  status: TenantAccountStatus;
  plan: TenantAccountPlan;
  members: TenantMemberSummary[];
}

interface TenantAccountStoreConfig {
  url: string;
  serviceRoleKey: string;
  tenantsTable: string;
  membersTable: string;
}

interface SupabaseTenantRow {
  tenant_id?: unknown;
  name?: unknown;
  status?: unknown;
  plan?: unknown;
}

interface SupabaseTenantMemberRow {
  member_id?: unknown;
  role?: unknown;
  status?: unknown;
}

export class TenantAccountStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantAccountStoreError";
  }
}

export async function readTenantAccountSummary(
  input: { tenantId?: unknown },
  env = process.env
): Promise<TenantAccountReadResult> {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) {
    throw new TenantAccountStoreError("Tenant account id is invalid.");
  }

  const config = getTenantAccountStoreConfig(env);
  if (config) {
    return readSupabaseTenantAccountSummary(config, tenantId);
  }

  const seeds = readTenantAccountSeeds(env);
  if (seeds === null) {
    throw new TenantAccountStoreError("Tenant account seed configuration is invalid.");
  }

  const seed = seeds.find((item) => item.tenantId === tenantId);
  if (seed) {
    return toReadResult({
      tenantId,
      name: seed.name,
      status: seed.status,
      plan: seed.plan,
      configured: true,
      members: seed.members
    });
  }

  return toReadResult({
    tenantId,
    name: tenantId,
    status: "invite-only",
    plan: "beta",
    configured: false,
    members: []
  });
}

export function readTenantAccountSeeds(env = process.env): TenantAccountSeed[] | null {
  const raw = env[TENANT_ACCOUNTS_ENV];
  if (!raw?.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const accounts: TenantAccountSeed[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const account = normalizeTenantAccountSeed(item as TenantAccountSeedInput);
    if (!account) return null;
    accounts.push(account);
  }

  return accounts.slice(0, 100);
}

async function readSupabaseTenantAccountSummary(
  config: TenantAccountStoreConfig,
  tenantId: string
): Promise<TenantAccountReadResult> {
  const accountParams = new URLSearchParams({
    tenant_id: `eq.${tenantId}`,
    select: "tenant_id,name,status,plan",
    limit: "1"
  });
  const accountResponse = await tenantAccountFetch(config, config.tenantsTable, `?${accountParams.toString()}`, {
    method: "GET"
  });

  if (!accountResponse.ok) {
    throw new TenantAccountStoreError(`Tenant account lookup failed with HTTP ${accountResponse.status}.`);
  }

  const accountRows = (await accountResponse.json().catch(() => [])) as unknown;
  const account = Array.isArray(accountRows) ? normalizeSupabaseTenantRow(accountRows[0]) : null;
  if (!account) {
    return toReadResult({
      tenantId,
      name: tenantId,
      status: "unknown",
      plan: "unknown",
      configured: false,
      members: []
    });
  }

  const memberParams = new URLSearchParams({
    tenant_id: `eq.${tenantId}`,
    select: "member_id,role,status",
    limit: "100"
  });
  const memberResponse = await tenantAccountFetch(config, config.membersTable, `?${memberParams.toString()}`, {
    method: "GET"
  });

  if (!memberResponse.ok) {
    throw new TenantAccountStoreError(`Tenant account member lookup failed with HTTP ${memberResponse.status}.`);
  }

  const memberRows = (await memberResponse.json().catch(() => [])) as unknown;
  const members = Array.isArray(memberRows)
    ? memberRows.map(normalizeSupabaseTenantMemberRow).filter((item): item is TenantMemberSummary => Boolean(item))
    : [];

  return toReadResult({
    tenantId,
    name: account.name,
    status: account.status,
    plan: account.plan,
    configured: true,
    members
  });
}

function toReadResult(input: {
  tenantId: string;
  name: string;
  status: TenantAccountStatus;
  plan: TenantAccountPlan;
  configured: boolean;
  members: TenantMemberSummary[];
}): TenantAccountReadResult {
  const members = input.members.slice(0, 100);

  return {
    privacy: "tenant-account-summary-only",
    account: {
      tenantId: input.tenantId,
      name: input.name,
      status: input.status,
      plan: input.plan,
      configured: input.configured,
      memberCount: members.length
    },
    members,
    roleCounts: roleCounts(members)
  };
}

function roleCounts(members: TenantMemberSummary[]): Record<TenantMemberRole, number> {
  return members.reduce<Record<TenantMemberRole, number>>((counts, member) => {
    counts[member.role] += 1;
    return counts;
  }, {
    owner: 0,
    admin: 0,
    member: 0
  });
}

async function tenantAccountFetch(
  config: TenantAccountStoreConfig,
  table: string,
  query: string,
  init: RequestInit
) {
  return fetch(`${config.url}/rest/v1/${encodeURIComponent(table)}${query}`, {
    ...init,
    cache: "no-store",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      ...(init.headers ?? {})
    }
  });
}

function getTenantAccountStoreConfig(env = process.env): TenantAccountStoreConfig | null {
  const url = env.AGENTPROOF_TENANT_ACCOUNTS_SUPABASE_URL || env.AGENTPROOF_CONTROL_PLANE_SUPABASE_URL || env.SUPABASE_URL || "";
  const serviceRoleKey =
    env.AGENTPROOF_TENANT_ACCOUNTS_SUPABASE_SERVICE_ROLE_KEY ||
    env.AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    "";

  if (!url && !serviceRoleKey) return null;

  if (!url || !serviceRoleKey) {
    throw new TenantAccountStoreError("Tenant account Supabase env is incomplete.");
  }

  return {
    url: trimTrailingSlash(url),
    serviceRoleKey,
    tenantsTable: env.AGENTPROOF_TENANTS_TABLE || DEFAULT_TENANTS_TABLE,
    membersTable: env.AGENTPROOF_TENANT_MEMBERS_TABLE || DEFAULT_TENANT_MEMBERS_TABLE
  };
}

function normalizeTenantAccountSeed(input: TenantAccountSeedInput): TenantAccountSeed | null {
  const tenantId = normalizeTenantId(input.tenantId);
  if (!tenantId) return null;
  if (input.members !== undefined && !Array.isArray(input.members)) return null;

  const members = Array.isArray(input.members)
    ? input.members.map((item) => normalizeTenantMemberSeed(item)).filter((item): item is TenantMemberSummary => Boolean(item))
    : [];

  return {
    tenantId,
    name: normalizeName(input.name) ?? tenantId,
    status: normalizeAccountStatus(input.status),
    plan: normalizeAccountPlan(input.plan),
    members: members.slice(0, 100)
  };
}

function normalizeTenantMemberSeed(input: unknown): TenantMemberSummary | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as TenantMemberSeedInput;
  const memberId = normalizeMemberId(value.memberId);
  if (!memberId) return null;

  return {
    memberId,
    role: normalizeMemberRole(value.role),
    status: normalizeMemberStatus(value.status)
  };
}

function normalizeSupabaseTenantRow(row: unknown): {
  name: string;
  status: TenantAccountStatus;
  plan: TenantAccountPlan;
} | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const value = row as SupabaseTenantRow;
  const tenantId = normalizeTenantId(value.tenant_id);
  if (!tenantId) return null;

  return {
    name: normalizeName(value.name) ?? tenantId,
    status: normalizeAccountStatus(value.status),
    plan: normalizeAccountPlan(value.plan)
  };
}

function normalizeSupabaseTenantMemberRow(row: unknown): TenantMemberSummary | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const value = row as SupabaseTenantMemberRow;
  const memberId = normalizeMemberId(value.member_id);
  if (!memberId) return null;

  return {
    memberId,
    role: normalizeMemberRole(value.role),
    status: normalizeMemberStatus(value.status)
  };
}

function normalizeTenantId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = redactSecrets(value).trim();

  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$/.test(normalized) ? normalized : null;
}

function normalizeMemberId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = redactSecrets(value).trim();

  return /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{1,119}$/.test(normalized) ? normalized : null;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = redactSecrets(value).replace(/\s+/g, " ").trim();
  if (!normalized || normalized.includes("@")) return null;

  return normalized.slice(0, 100);
}

function normalizeAccountStatus(value: unknown): TenantAccountStatus {
  if (value === "active" || value === "trialing" || value === "suspended" || value === "deleted") return value;

  return "unknown";
}

function normalizeAccountPlan(value: unknown): TenantAccountPlan {
  if (value === "free" || value === "beta" || value === "team" || value === "pro" || value === "enterprise" || value === "custom") return value;

  return "unknown";
}

function normalizeMemberRole(value: unknown): TenantMemberRole {
  if (value === "owner" || value === "admin" || value === "member") return value;

  return "member";
}

function normalizeMemberStatus(value: unknown): TenantMemberStatus {
  if (value === "active" || value === "invited" || value === "disabled") return value;

  return "active";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
