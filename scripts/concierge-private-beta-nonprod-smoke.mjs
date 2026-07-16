import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export const VERCEL_BYPASS_ENV_NAME = "AGENTPROOF_CONCIERGE_SMOKE_VERCEL_PROTECTION_BYPASS";
export const ROOT_SMOKE_ENV_PATH = "/Users/jeonggyuju/Project_folder/AgentProof/.env.local";
const SMOKE_CHILD_ENV_NAMES = [
  "AGENTPROOF_CONCIERGE_SMOKE_EXECUTE",
  "AGENTPROOF_CONCIERGE_SMOKE_APPROVED_ORIGIN",
  "AGENTPROOF_CONCIERGE_SMOKE_BASE_URL",
  "AGENTPROOF_CONCIERGE_SMOKE_SESSION_COOKIE",
  "AGENTPROOF_CONCIERGE_SMOKE_CASES_PATH",
  "CI", "FORCE_COLOR", "HOME", "NO_COLOR", "NODE_ENV", "NODE_PATH", "PATH", "TEMP", "TMP", "TMPDIR"
];

/** Reads exactly one bypass entry without parsing or forwarding unrelated dotenv values. */
export async function readLocalVercelBypass(envPath = ROOT_SMOKE_ENV_PATH) {
  let value;
  let matched = false;
  try {
    const lines = createInterface({ input: createReadStream(envPath, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      const parsed = parseExactEnvironmentLine(line);
      if (parsed === undefined) continue;
      if (matched) return undefined;
      matched = true;
      value = parsed;
    }
  } catch {
    return undefined;
  }
  return value;
}

export function parseExactEnvironmentLine(line) {
  const match = /^\s*(?:export\s+)?AGENTPROOF_CONCIERGE_SMOKE_VERCEL_PROTECTION_BYPASS\s*=\s*(.*?)\s*$/.exec(line);
  if (!match) return undefined;
  const raw = match[1];
  if (!raw) return "";
  const quote = raw[0];
  if (quote === '"' || quote === "'") return raw.length >= 2 && raw.at(-1) === quote ? raw.slice(1, -1) : undefined;
  return raw;
}

export function buildSmokeChildEnvironment(env, bypass) {
  const childEnv = {};
  for (const name of SMOKE_CHILD_ENV_NAMES) {
    if (typeof env[name] === "string" && env[name]) childEnv[name] = env[name];
  }
  childEnv[VERCEL_BYPASS_ENV_NAME] = bypass;
  return childEnv;
}

export async function runSmokeWrapper({ env = process.env, envPath = ROOT_SMOKE_ENV_PATH, spawn = spawnSync } = {}) {
  const bypass = await readLocalVercelBypass(envPath);
  if (!bypass?.trim()) return 2;
  const result = spawn(process.execPath, [
    "--no-warnings",
    "--experimental-strip-types",
    "--experimental-loader", "./scripts/agentproof-typescript-loader.mjs",
    "./scripts/concierge-private-beta-nonprod-smoke.ts"
  ], { stdio: "inherit", env: buildSmokeChildEnvironment(env, bypass.trim()) });
  return result.status ?? 1;
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  process.exit(await runSmokeWrapper());
}
