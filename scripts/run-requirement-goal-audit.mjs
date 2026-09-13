import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startVitest } from "vitest/node";

const output = process.argv[2];
if (!output) throw new Error("Usage: node scripts/run-requirement-goal-audit.mjs /absolute/output.json");
process.env.REQUIREMENT_GOAL_AUDIT_OUTPUT = resolve(output);
const root = fileURLToPath(new URL("../", import.meta.url));
const ctx = await startVitest("test", [], { root, run: true, include: ["scripts/requirement-goal-audit.test.ts"] });
const harnessSuccess = Boolean(ctx) && ctx.state.getFiles().length === 1 && ctx.state.getFiles().every(file => file.result?.state === "pass") && ctx.state.getUnhandledErrors().length === 0;
await ctx?.close();
if (!harnessSuccess) process.exitCode = 2;
else {
  const result = JSON.parse(readFileSync(process.env.REQUIREMENT_GOAL_AUDIT_OUTPUT, "utf8"));
  console.log(JSON.stringify({ output: process.env.REQUIREMENT_GOAL_AUDIT_OUTPUT, harnessSuccess, noUnsupportedPositiveOnKnownViolationOrUnavailable: result.noUnsupportedPositiveOnKnownViolationOrUnavailable, scopedPredicateSuccess: result.scopedPredicateSuccess, goalSuccess: result.goalSuccess }));
  process.exitCode = result.goalSuccess ? 0 : 1;
}
