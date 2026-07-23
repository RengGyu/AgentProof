import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error The executable wrapper is deliberately plain ESM.
import { VERCEL_BYPASS_ENV_NAME, defaultSmokeEnvPath, readLocalVercelBypass, runSmokeWrapper } from "./concierge-private-beta-nonprod-smoke.mjs";

async function writeBypassEnv(contents: string) {
  const directory = await mkdtemp(join(tmpdir(), "agentproof-smoke-wrapper-"));
  const envPath = join(directory, ".env.local");
  await writeFile(envPath, contents);
  return envPath;
}

describe("non-production Concierge Vercel protection wrapper", () => {
  it("derives the default bypass path from the active clean worktree", () => {
    expect(defaultSmokeEnvPath("/private/tmp/clean-agentproof")).toBe("/private/tmp/clean-agentproof/.env.local");
    expect(defaultSmokeEnvPath("/Users/other/AgentProof")).not.toContain("jeonggyuju/Project_folder");
  });

  it("forwards only approved smoke inputs and the exact local bypass", async () => {
    const bypass = "synthetic-bypass-value";
    const envPath = await writeBypassEnv([
      "DATABASE_URL=must-not-be-forwarded",
      "OPENAI_API_KEY=must-not-be-forwarded",
      `${VERCEL_BYPASS_ENV_NAME}=${bypass}`
    ].join("\n"));
    let childEnv: Record<string, string> | undefined;
    const status = await runSmokeWrapper({
      env: {
        AGENTPROOF_CONCIERGE_SMOKE_EXECUTE: "1",
        AGENTPROOF_CONCIERGE_SMOKE_BASE_URL: "https://preview.example.test",
        AGENTPROOF_CONCIERGE_SMOKE_SESSION_COOKIE: "bounded-session",
        AGENTPROOF_CONCIERGE_SMOKE_CASES_PATH: "/private/tmp/cases.json",
        DATABASE_URL: "must-not-be-forwarded",
        OPENAI_API_KEY: "must-not-be-forwarded",
        AGENTPROOF_CONCIERGE_SMOKE_VERCEL_PROTECTION_BYPASS: "parent-bypass-must-not-win",
        SAFE_PARENT_VALUE: "must-not-be-forwarded"
      },
      envPath,
      spawn: (_command: string, _arguments: string[], options: { env: Record<string, string> }) => {
        childEnv = options.env;
        return { status: 0 } as never;
      }
    });

    expect(status).toBe(0);
    expect(childEnv?.[VERCEL_BYPASS_ENV_NAME]).toBe(bypass);
    expect(childEnv?.AGENTPROOF_CONCIERGE_SMOKE_BASE_URL).toBe("https://preview.example.test");
    expect(childEnv).not.toHaveProperty("DATABASE_URL");
    expect(childEnv).not.toHaveProperty("OPENAI_API_KEY");
    expect(childEnv).not.toHaveProperty("SAFE_PARENT_VALUE");
  });

  it.each([
    ["missing", ""],
    ["empty", `${VERCEL_BYPASS_ENV_NAME}=`],
    ["duplicate", `${VERCEL_BYPASS_ENV_NAME}=first\n${VERCEL_BYPASS_ENV_NAME}=second\n`],
    ["malformed", `${VERCEL_BYPASS_ENV_NAME}='unterminated\n`]
  ])("fails closed without spawning for %s bypass input", async (_label, contents) => {
    const envPath = await writeBypassEnv(contents);
    let spawnCalls = 0;
    const status = await runSmokeWrapper({
      env: { AGENTPROOF_CONCIERGE_SMOKE_VERCEL_PROTECTION_BYPASS: "parent-value-must-not-pass" },
      envPath,
      spawn: () => {
        spawnCalls += 1;
        return { status: 0 } as never;
      }
    });
    expect(status).toBe(2);
    expect(spawnCalls).toBe(0);
  });

  it("rejects duplicate and malformed exact entries", async () => {
    const duplicatePath = await writeBypassEnv(`${VERCEL_BYPASS_ENV_NAME}=first\n${VERCEL_BYPASS_ENV_NAME}=second\n`);
    const malformedPath = await writeBypassEnv(`${VERCEL_BYPASS_ENV_NAME}='unterminated\n`);
    expect(await readLocalVercelBypass(duplicatePath)).toBeUndefined();
    expect(await readLocalVercelBypass(malformedPath)).toBeUndefined();
  });
});
