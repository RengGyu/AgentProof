import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startVitest } from "vitest/node";

const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (!["--input", "--output", "--model", "--review"].includes(arg) || options.has(arg) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Usage: --input corpus.json --output new-result.json --model MODEL [--review review.json]");
  options.set(arg, args[++index]);
}
if (!["--input", "--output", "--model"].every(option => options.has(option)) || options.size !== (options.has("--review") ? 4 : 3)) throw new Error("Usage: --input corpus.json --output new-result.json --model MODEL [--review review.json]");
const output = resolve(options.get("--output"));
if (existsSync(output)) throw new Error("Output already exists; refusing to clobber");
process.env.REQUIREMENT_ROLE_OBJECTIVE_INPUT = resolve(options.get("--input"));
process.env.REQUIREMENT_ROLE_OBJECTIVE_OUTPUT = output;
process.env.REQUIREMENT_ROLE_OBJECTIVE_MODEL = options.get("--model");
process.env.REQUIREMENT_ROLE_OBJECTIVE_REVIEW = options.has("--review") ? resolve(options.get("--review")) : "";
const root = fileURLToPath(new URL("../", import.meta.url));
const ctx = await startVitest("test", [], { root, run: true, include: ["scripts/requirement-role-experiment-objectives-run.test.ts"] });
const success = Boolean(ctx) && ctx.state.getFiles().length === 1 && ctx.state.getFiles().every(file => file.result?.state === "pass") && ctx.state.getUnhandledErrors().length === 0;
await ctx?.close();
if (!success) process.exitCode = 2;
else {
  const result = JSON.parse(readFileSync(output, "utf8"));
  console.log(JSON.stringify({ output, schemaVersion: result.schemaVersion, caseCount: result.cases.length, actualCallCount: result.actualCallCount, offline: result.offline, evaluationStatus: result.evaluation.status }));
}
