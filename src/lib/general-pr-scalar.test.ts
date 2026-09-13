import { afterEach, describe, expect, it, vi } from "vitest";
import { compileOrdinaryScalarPlans, readOrdinaryScalarRuntime } from "./general-pr-scalar";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import type { PullRequestInput } from "./types";

export function scalarSource(taskText = '## Requirements\n- Function `answer` in `src/answer.js` must return `42` when called with no arguments.'): PullRequestInput {
  return { title: "Scalar update", description: "Implementation update", taskText, taskSource: "issue", changedFiles: [], checks: [], logs: [], repositoryPrivate: false,
    sourceProvenance: { version: 1, origin: "github_snapshot", headSha: "a".repeat(40), baseSha: "b".repeat(40), evidenceCapturedAt: "2026-09-08T00:00:00Z", inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" } } };
}
afterEach(() => vi.unstubAllEnvs());
describe("ordinary scalar whole-source interpretation", () => {
  it("maps only a complete explicit obligation to the canonical requirement ID", () => {
    const input = scalarSource('## Requirements\n- Improve deployment usability.\n- Function `answer` in `src/answer.js` must return `42` when called with no arguments.');
    expect(compileOrdinaryScalarPlans(input, buildGeneralPrObservationSeedV2(input))).toMatchObject([{ requirementId: "req_2", path: "src/answer.js", criterion: { id: "req_2_c1", cases: [{ id: "one", expected: 42 }] } }]);
  });
  it("preserves one scalar input and rejects extra obligations and non-scalar meaning", () => {
    const input = scalarSource('## Requirements\n- Function `answer` in `src/answer.js` must return `"Ready"` when called with `true`.\n- Function `other` in `src/other.js` must return `42` when called with no arguments and update the database.\n- Function `list` in `src/list.js` must return `[42]` when called with no arguments.');
    expect(compileOrdinaryScalarPlans(input, buildGeneralPrObservationSeedV2(input))).toMatchObject([{ requirementId: "req_1", criterion: { cases: [{ input: true, expected: "Ready" }] } }]);
  });
  it("accepts the same whole-clause zero-argument meaning with an article or implicit no-argument call", () => {
    const input = scalarSource('## Requirements\n- The function `compute` in `lib/compute.js` must return `-2` when called.\n- Function `flag` in `lib/flag.js` must return `false` when called.');
    expect(compileOrdinaryScalarPlans(input, buildGeneralPrObservationSeedV2(input))).toMatchObject([
      { requirementId: "req_1", criterion: { cases: [{ expected: -2 }] } }, { requirementId: "req_2", criterion: { cases: [{ expected: false }] } }
    ]);
  });
  it("requires public exact-head source provenance and does not infer a path", () => {
    for (const input of [scalarSource('Function `answer` must return `42` when called with no arguments.'), { ...scalarSource(), repositoryPrivate: true }, { ...scalarSource(), sourceProvenance: undefined }]) {
      expect(compileOrdinaryScalarPlans(input, buildGeneralPrObservationSeedV2(input))).toEqual([]);
    }
  });
  it("bounds compiled invocations to eight", () => {
    const input = scalarSource("## Requirements\n" + Array.from({ length: 10 }, (_, i) => `- Function \`answer\` in \`src/answer${i}.js\` must return \`42\` when called with no arguments.`).join("\n"));
    expect(compileOrdinaryScalarPlans(input, buildGeneralPrObservationSeedV2(input))).toHaveLength(8);
  });
  it("requires a separate exact server opt-in and pinned image", () => {
    vi.stubEnv("AGENTPROOF_ORDINARY_SCALAR_EXECUTION", "");
    vi.stubEnv("AGENTPROOF_SCALAR_IMAGE", "sha256:" + "a".repeat(64));
    expect(readOrdinaryScalarRuntime()).toBeUndefined();
    vi.stubEnv("AGENTPROOF_ORDINARY_SCALAR_EXECUTION", "true");
    expect(readOrdinaryScalarRuntime()).toBeUndefined();
    vi.stubEnv("AGENTPROOF_ORDINARY_SCALAR_EXECUTION", "enabled");
    expect(readOrdinaryScalarRuntime()).toMatchObject({ enabled: true });
    vi.stubEnv("AGENTPROOF_SCALAR_IMAGE", "node:latest");
    expect(readOrdinaryScalarRuntime()).toBeUndefined();
  });
});
