import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, [
  "--no-warnings",
  "--experimental-strip-types",
  "--experimental-loader", "./scripts/agentproof-typescript-loader.mjs",
  "./scripts/concierge-private-beta-nonprod-smoke.ts"
], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
