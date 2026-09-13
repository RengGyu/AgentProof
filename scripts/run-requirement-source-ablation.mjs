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
  if (!["--input", "--output", "--model"].includes(arg) || options.has(arg) || !args[index + 1] || args[index + 1].startsWith("--")) throw new Error("Usage: --input corpus.json --output new-result.json --model MODEL [--live]");
  options.set(arg, args[++index]);
}
if (options.size !== 3) throw new Error("Usage: --input corpus.json --output new-result.json --model MODEL [--live]");
if (live && (process.env.REQUIREMENT_SOURCE_ABLATION_ACKNOWLEDGE_LIVE !== "1" || !process.env.OPENAI_API_KEY?.trim())) throw new Error("Live requires REQUIREMENT_SOURCE_ABLATION_ACKNOWLEDGE_LIVE=1 and a nonempty OPENAI_API_KEY");
const output = resolve(options.get("--output"));
if (existsSync(output)) throw new Error("Output already exists; refusing to clobber");
// Only this dedicated CLI bridge configures process state; the experiment core is pure with respect to env.
process.env.REQUIREMENT_SOURCE_ABLATION_INPUT = resolve(options.get("--input"));
process.env.REQUIREMENT_SOURCE_ABLATION_OUTPUT = output;
process.env.REQUIREMENT_SOURCE_ABLATION_MODEL = options.get("--model");
process.env.REQUIREMENT_SOURCE_ABLATION_LIVE = live ? "1" : "0";
const root = fileURLToPath(new URL("../", import.meta.url));
const ctx = await startVitest("test", [], { root, run: true, include: ["scripts/requirement-source-ablation-run.test.ts"] });
const success = Boolean(ctx) && ctx.state.getFiles().length === 1 && ctx.state.getFiles().every(file => file.result?.state === "pass") && ctx.state.getUnhandledErrors().length === 0;
await ctx?.close();
if (!success) process.exitCode = 2;
else {
  const result = JSON.parse(readFileSync(output, "utf8"));
  console.log(JSON.stringify({ output, schemaVersion: result.schemaVersion, caseCount: result.caseCount, actualRequestCount: result.actualRequestCount, liveRequested: result.liveRequested, corpusHash: result.corpusHash }));
}
