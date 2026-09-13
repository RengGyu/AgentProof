import { afterEach, describe, expect, it, vi } from "vitest";
import { runGeneralPrObservationNowV2 } from "./general-pr-observation-service";
import { resolveGeneralPrAssessmentRuntimePolicyV1 } from "./general-pr-runtime-policy";
import { generateVerificationReportV2FromInput } from "./verifier";
import { validateRuntimeReportBoundary } from "./report-runtime-validation";
import * as isolated from "./isolated-scalar-execution";
import type { PullRequestInput, VerificationReportV2 } from "./types";
const headSha = "a".repeat(40);
function source(taskText = 'Function `answer` in `src/answer.js` must return `42` when called.'): PullRequestInput {
  return { title: "Owned scalar", description: "Owned implementation", taskText, taskSource: "task", changedFiles: [], checks: [], logs: [], repositoryPrivate: false,
    sourceProvenance: { version: 1, origin: "github_snapshot", headSha, baseSha: "b".repeat(40), evidenceCapturedAt: "2026-09-08T00:00:00Z", inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" } } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe.skipIf(process.env.AGENTPROOF_SCALAR_OWNED_FIXTURE_TESTS !== "1")("owned scalar private authority", () => {
  async function run(input: PullRequestInput, collector: (paths: string[], head: string) => Promise<Array<{ path: string; headSha: string; content: string }>>) {
    vi.stubEnv("AGENTPROOF_ORDINARY_SCALAR_EXECUTION", "enabled");
    const result = await runGeneralPrObservationNowV2({ input, policy: resolveGeneralPrAssessmentRuntimePolicyV1("advisory"), generateReport: generateVerificationReportV2FromInput, validateDeterministicReport: () => true, collectScalarArtifacts: collector });
    return result.report as VerificationReportV2;
  }
  it("keeps signed artifact/criterion authority private and never reexecutes during validation", async () => {
    const invocation = vi.spyOn(isolated, "executeIsolatedScalar");
    const input = source();
    const report = await run(input, async paths => paths.map(path => ({ path, headSha, content: "function answer() { return 42; }" })));
    expect(report.requirements[0].status).toBe("met");
    expect(invocation).toHaveBeenCalledTimes(1);
    const validate = (currentInput: PullRequestInput, currentReport = report) => validateRuntimeReportBoundary({ boundary: "generated_private_full", input: currentInput, report: currentReport }).valid;
    expect(validate(input)).toBe(true);
    expect(validate(input)).toBe(true);
    expect(invocation).toHaveBeenCalledTimes(1);
    expect(validate({ ...input, taskText: input.taskText.replace("42", "43") })).toBe(false);
    expect(validate({ ...input, sourceProvenance: { ...input.sourceProvenance!, headSha: "d".repeat(40) } })).toBe(false);
    expect(validate(input, structuredClone(report))).toBe(false);
    const evidence = report.evidenceIndex.find(item => item.id === "ev_ordinary_req_1_c1")!;
    evidence.summary = evidence.summary.replace(/sha256:[a-f0-9]+/, "sha256:" + "f".repeat(64));
    expect(validate(input)).toBe(false);
  });
  it.each(["duplicate", "wrong_head", "missing"])("does not execute or infer violation from %s blobs", async mode => {
    const invocation = vi.spyOn(isolated, "executeIsolatedScalar");
    const report = await run(source(), async paths => mode === "missing" ? [] : paths.flatMap(path => {
      const blob = { path, headSha: mode === "wrong_head" ? "d".repeat(40) : headSha, content: "function answer() { return 0; }" };
      return mode === "duplicate" ? [blob, blob] : [blob];
    }));
    expect(report.requirements[0].status).toBe("unclear");
    expect(invocation).not.toHaveBeenCalled();
  });
  it("executes the source-declared one-scalar argument without publishing its value", async () => {
    const report = await run(source('Function `answer` in `src/answer.js` must return `"Ready"` when called with `true`.'), async paths => paths.map(path => ({ path, headSha, content: "function answer(value) { return value ? 'Ready' : 'Not ready'; }" })));
    expect(report.requirements[0].status).toBe("met");
    const evidence = report.evidenceIndex.find(item => item.id === "ev_ordinary_req_1_c1")!;
    expect(JSON.stringify(evidence)).not.toMatch(/Ready|true|actual|expected|input/);
  });
  it("caps reads and actual invocations at eight without expanding canonical extraction", async () => {
    const invocation = vi.spyOn(isolated, "executeIsolatedScalar");
    const input = source("## Requirements\n" + Array.from({ length: 9 }, (_, i) => `- Function \`answer\` in \`src/a${i}.js\` must return \`42\` when called.`).join("\n"));
    const reads: string[] = [];
    const report = await run(input, async (paths, head) => { expect(head).toBe(headSha); reads.push(...paths); return paths.map(path => ({ path, headSha, content: "function answer() { return 42; }" })); });
    expect(reads).toHaveLength(8);
    expect(invocation).toHaveBeenCalledTimes(8);
    expect(report.requirements.map(row => row.requirementId)).toEqual(generateVerificationReportV2FromInput(input).requirements.map(row => row.requirementId));
    expect(report.requirements.map(row => row.status)).toEqual(Array(8).fill("met"));
    expect(report.limitations.some(item => item.includes("bounded at 8 requirements"))).toBe(true);
  }, 30_000);
  it("preserves the author-claim cap and the original observed evidence status", async () => {
    const input = source("");
    input.description = 'Function `answer` in `src/answer.js` must return `42` when called.';
    const baseline = generateVerificationReportV2FromInput(input);
    const report = await run(input, async paths => paths.map(path => ({ path, headSha, content: "function answer() { return 42; }" })));
    expect(report.requirements[0].status).toBe("partial");
    expect(report.requirements[0].evidenceStatus).toBe(baseline.requirements[0].evidenceStatus);
  });
});
