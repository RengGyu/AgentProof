import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startVitest } from "vitest/node";

const args = process.argv.slice(2);
const options = new Map();
let live = false;
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (arg === "--live" && !live) { live = true; continue; }
  if (!["--input", "--output", "--model", "--key-file"].includes(arg) || options.has(arg) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Usage: --input corpus.json --output new-result.json --model MODEL [--live --key-file FILE]");
  options.set(arg, args[++index]);
}
if (!options.has("--input") || !options.has("--output") || !options.has("--model") || options.size !== (live ? 4 : 3) || live !== options.has("--key-file")) throw new Error("Usage: --input corpus.json --output new-result.json --model MODEL [--live --key-file FILE]");
if (live && process.env.REQUIREMENT_ROLE_EXPERIMENT_ACKNOWLEDGE_LIVE !== "1") throw new Error("Live requires REQUIREMENT_ROLE_EXPERIMENT_ACKNOWLEDGE_LIVE=1 and --key-file");
const output = resolve(options.get("--output"));
if (existsSync(output)) throw new Error("Output already exists; refusing to clobber");
const journal = `${output}.calls.jsonl`;
if (live && existsSync(journal)) throw new Error("Call journal already exists; refusing to clobber");
process.env.REQUIREMENT_ROLE_EXPERIMENT_INPUT = resolve(options.get("--input"));
process.env.REQUIREMENT_ROLE_EXPERIMENT_OUTPUT = output;
process.env.REQUIREMENT_ROLE_EXPERIMENT_MODEL = options.get("--model");
process.env.REQUIREMENT_ROLE_EXPERIMENT_LIVE = live ? "1" : "";
process.env.REQUIREMENT_ROLE_EXPERIMENT_KEY_FILE = live ? resolve(options.get("--key-file")) : "";
process.env.REQUIREMENT_ROLE_EXPERIMENT_JOURNAL = live ? journal : "";
const root = fileURLToPath(new URL("../", import.meta.url));
const ctx = await startVitest("test", [], { root, run: true, include: ["scripts/requirement-role-experiment-run.test.ts"] });
const success = Boolean(ctx) && ctx.state.getFiles().length === 1 && ctx.state.getFiles().every(file => file.result?.state === "pass") && ctx.state.getUnhandledErrors().length === 0;
await ctx?.close();
if (!success) process.exitCode = 2;
else {
  const result = JSON.parse(readFileSync(output, "utf8"));
  console.log(JSON.stringify({ output, schemaVersion: result.schemaVersion, caseCount: result.cases.length, actualCallCount: result.actualCallCount, offline: result.offline }));
}
