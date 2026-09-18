import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("runs offline, refuses clobber, and gates explicit key-file live mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "role-experiment-cli-"));
  const input = join(dir, "input.json");
  const output = join(dir, "output.json");
  writeFileSync(input, JSON.stringify({
    schemaVersion: "requirement_source_ablation.v1",
    labelProvenance: "unlabeled research input",
    cases: [{ id: "cli", cohort: "controlled", input: { title: "Preserve query parameters", description: "", taskText: "", repositoryPrivate: false, changedFiles: [], checks: [], logs: [] }, labels: [] }],
  }));
  const cli = resolve("scripts/run-requirement-role-experiment.mjs");
  const args = [cli, "--input", input, "--output", output, "--model", "test-model"];
  const first = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, OPENAI_API_KEY: "MUST_NOT_READ" } });
  expect(first.status, first.stdout + first.stderr).toBe(0);
  const result = JSON.parse(readFileSync(output, "utf8"));
  expect(result).toMatchObject({ shadowOnly: true, offline: true, actualCallCount: 0 });
  expect(JSON.stringify(result)).not.toContain("Preserve query parameters");
  const original = readFileSync(output, "utf8");
  expect(spawnSync(process.execPath, args, { encoding: "utf8" }).status).not.toBe(0);
  expect(readFileSync(output, "utf8")).toBe(original);
  const keyFile = join(dir, ".env.local");
  const liveOutput = join(dir, "live.json");
  writeFileSync(keyFile, "OPENAI_API_KEY=synthetic-key\n");
  const live = spawnSync(process.execPath, [cli, "--input", input, "--output", liveOutput, "--model", "test-model", "--live", "--key-file", keyFile], {
    encoding: "utf8",
    env: { ...process.env, REQUIREMENT_ROLE_EXPERIMENT_ACKNOWLEDGE_LIVE: "" },
  });
  expect(live.status).not.toBe(0);
  expect(live.stderr).toContain("Live requires REQUIREMENT_ROLE_EXPERIMENT_ACKNOWLEDGE_LIVE=1 and --key-file");
  expect(existsSync(liveOutput)).toBe(false);
});
