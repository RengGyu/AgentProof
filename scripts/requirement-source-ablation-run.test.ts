import { closeSync, openSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { runSourceAblation, validateAblationCorpus } from "./requirement-source-ablation";

const inputPath = process.env.REQUIREMENT_SOURCE_ABLATION_INPUT;
it.skipIf(!inputPath)("runs only explicitly supplied frozen corpus and exclusively writes sanitized results", async () => {
  const corpus: unknown = JSON.parse(readFileSync(inputPath!, "utf8"));
  validateAblationCorpus(corpus);
  const live = process.env.REQUIREMENT_SOURCE_ABLATION_LIVE === "1";
  const acknowledgement = process.env.REQUIREMENT_SOURCE_ABLATION_ACKNOWLEDGE_LIVE === "1";
  const apiKey = live ? process.env.OPENAI_API_KEY : undefined;
  if (live && (!acknowledgement || !apiKey?.trim())) throw new Error("live acknowledgement and key required");
  if (live && corpus.cases.length * 2 > 30) throw new Error("request budget exceeds 30");
  const fd = openSync(process.env.REQUIREMENT_SOURCE_ABLATION_OUTPUT!, "wx", 0o600);
  try {
    const result = await runSourceAblation(corpus, {
      modelProfile: { model: process.env.REQUIREMENT_SOURCE_ABLATION_MODEL!, promptVersion: "requirement-source-ablation.v1", inputFieldPolicyVersion: "existing-stage-a-plus-context.v1" },
      live, acknowledgement, apiKey
    });
    writeFileSync(fd, `${JSON.stringify(result, null, 2)}\n`);
    expect(result.caseCount).toBe(corpus.cases.length);
  } finally { closeSync(fd); }
}, 1_900_000);

it.skipIf(Boolean(inputPath))("CLI defaults offline, refuses clobber and blocks unacknowledged live before calls", () => {
  const dir = mkdtempSync(join(tmpdir(), "source-ablation-cli-"));
  const input = join(dir, "input.json"); const output = join(dir, "result.json");
  writeFileSync(input, JSON.stringify({ schemaVersion: "requirement_source_ablation.v1", labelProvenance: "manual-frozen-test", cases: [{ id: "cli", cohort: "controlled", input: { title: "Query behavior", description: "The server must preserve query parameters.", taskText: "", repositoryPrivate: false, changedFiles: [], checks: [], logs: [] }, labels: [] }] }));
  const args = [resolve("scripts/run-requirement-source-ablation.mjs"), "--input", input, "--output", output, "--model", "test-model"];
  const env = { ...process.env, REQUIREMENT_SOURCE_ABLATION_ACKNOWLEDGE_LIVE: "", OPENAI_API_KEY: "" };
  const offline = spawnSync(process.execPath, args, { env, encoding: "utf8" });
  expect(offline.status, offline.stdout + offline.stderr).toBe(0);
  const result = JSON.parse(readFileSync(output, "utf8"));
  expect(result.actualRequestCount).toBe(0);
  expect(result.cases[0].arms.C.state).toBe("not_run");
  const original = readFileSync(output, "utf8");
  expect(spawnSync(process.execPath, args, { env, encoding: "utf8" }).status).not.toBe(0);
  expect(readFileSync(output, "utf8")).toBe(original);
  expect(spawnSync(process.execPath, [...args, "--live"], { env, encoding: "utf8" }).status).not.toBe(0);
}, 30_000);
