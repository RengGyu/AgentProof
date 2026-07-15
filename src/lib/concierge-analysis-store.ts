import { createHash } from "crypto";
import { getConciergeStoreConfigurationStatus } from "./concierge-store-configuration";

const RESERVE_RPC = "agentproof_reserve_concierge_analysis";
const FINISH_RPC = "agentproof_finish_concierge_analysis";
const TIMEOUT_MS = 5000;

export type ConciergeReservation =
  | { outcome: "reserved"; requestKey: string }
  | { outcome: "duplicate"; requestKey: string }
  | { outcome: "unavailable"; requestKey: string };

interface StoreConfig { url: string; serviceRoleKey: string }

export function getConciergeAnalysisStoreStatus(env = process.env) {
  const configuration = getConciergeStoreConfigurationStatus(env);
  const configured = configuration.configured && configuration.consistent && readConfig(env) !== null;
  return { configured, durable: configured } as const;
}

export function buildConciergeRequestKey(input: {
  tenantId: string;
  installationId: number;
  repositoryId: number;
  pullRequestNumber: number;
  headSha: string;
  explicitTaskHash?: string;
}): string {
  const canonical = JSON.stringify({
    version: 1,
    tenantId: input.tenantId,
    installationId: input.installationId,
    repositoryId: input.repositoryId,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    explicitTaskHash: input.explicitTaskHash ?? null
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export async function reserveConciergeAnalysis(input: {
  requestKey: string;
  tenantId: string;
  installationId: number;
  repositoryId: number;
}, env = process.env): Promise<ConciergeReservation> {
  const config = readConfig(env);
  if (!config || !isConciergeStoreConfigurationUsable(env)) return { outcome: "unavailable", requestKey: input.requestKey };
  try {
    const response = await rpc(config, RESERVE_RPC, {
      p_key: input.requestKey,
      p_tenant_id: input.tenantId,
      p_installation_id: input.installationId,
      p_repository_id: input.repositoryId
    });
    if (!response.ok) return { outcome: "unavailable", requestKey: input.requestKey };
    const json = await response.json();
    if (!Array.isArray(json) || json.length !== 1 || !json[0] || Object.keys(json[0]).length !== 1 || (json[0].outcome !== "reserved" && json[0].outcome !== "duplicate")) {
      return { outcome: "unavailable", requestKey: input.requestKey };
    }
    return { outcome: json[0].outcome, requestKey: input.requestKey };
  } catch {
    return { outcome: "unavailable", requestKey: input.requestKey };
  }
}

export async function finishConciergeAnalysis(input: {
  requestKey: string;
  outcome: "completed" | "failed";
  reason: string;
}, env = process.env): Promise<boolean> {
  const config = readConfig(env);
  if (!config || !isConciergeStoreConfigurationUsable(env) || !/^[a-z0-9_]{1,64}$/.test(input.reason)) return false;
  try {
    const response = await rpc(config, FINISH_RPC, {
      p_key: input.requestKey,
      p_outcome: input.outcome,
      p_reason: input.reason
    });
    if (!response.ok) return false;
    return (await response.json().catch(() => null)) === true;
  } catch {
    return false;
  }
}

function isConciergeStoreConfigurationUsable(env: NodeJS.ProcessEnv): boolean {
  const status = getConciergeStoreConfigurationStatus(env);
  return status.configured && status.consistent;
}

function readConfig(env: NodeJS.ProcessEnv): StoreConfig | null {
  const url = env.AGENTPROOF_CONCIERGE_SUPABASE_URL?.trim() ?? "";
  const serviceRoleKey = env.AGENTPROOF_CONCIERGE_SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!url || !serviceRoleKey) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return { url: parsed.toString().replace(/\/$/, ""), serviceRoleKey };
  } catch { return null; }
}

function rpc(config: StoreConfig, name: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${config.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
}
