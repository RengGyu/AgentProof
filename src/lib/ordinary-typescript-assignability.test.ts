import { afterEach, describe, expect, it, vi } from "vitest";
import { runGeneralPrObservationNowV2 } from "./general-pr-observation-service";
import { generateVerificationReportV2FromInput } from "./verifier";
import { validateRuntimeReportBoundary } from "./report-runtime-validation";
import type { PullRequestInput, VerificationReportV2 } from "./types";
import { compileOrdinaryAssignabilityPlans, evaluateOrdinaryAssignabilityPlans } from "./typescript-assignability-verification";
import { buildGeneralPrObservationSeedV2 } from "./general-pr-observation-source";
import { prepareTenantDetailReportForStorage } from "./server-report-store";
import { projectTenantPersistedReport, validateTenantPersistedReport, decodeTenantPersistedReport } from "./tenant-report-validation";
import { sanitizeReportForShare } from "./report-share";
import { resolveGeneralPrAssessmentRuntimePolicyV1 } from "./general-pr-runtime-policy";

const headSha = "a".repeat(40);
const policy = { ...resolveGeneralPrAssessmentRuntimePolicyV1("advisory"), semanticObservation: "disabled" as const };
function source(clause = "The type `Mode` in `src/mode.ts` must support `undefined`."): PullRequestInput {
  return { title: "Type support", description: "Update types", taskText: `## Requirements\n- ${clause}`, taskSource: "issue", changedFiles: [], checks: [], logs: [], repositoryPrivate: false,
    sourceProvenance: { version: 1, origin: "github_snapshot", headSha, baseSha: "b".repeat(40), evidenceCapturedAt: "2026-09-09T00:00:00Z", inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" } } };
}
function snapshot(files: Record<string, string>) {
  return { headSha, treeSha: "d".repeat(40), inventory: { paths: Object.keys(files), complete: true }, blobs: Object.entries(files).map(([path, content]) => ({ path, content, headSha })) };
}
async function run(input: PullRequestInput, files: Record<string, string>, enabled = true) {
  vi.stubEnv("AGENTPROOF_ORDINARY_TYPESCRIPT_ASSIGNABILITY", enabled ? "enabled" : "disabled");
  return (await runGeneralPrObservationNowV2({ input, policy, generateReport: generateVerificationReportV2FromInput, validateDeterministicReport: () => true,
    collectTypeScriptProject: async () => snapshot(files) })).report as VerificationReportV2;
}
afterEach(() => vi.unstubAllEnvs());
describe("ordinary TypeScript assignability", () => {
  it("uses the target project's strictNullChecks rather than direct union syntax", async () => {
    const input = source();
    const loose = await run(input, { "tsconfig.json": '{"compilerOptions":{"strictNullChecks":false}}', "src/mode.ts": "export type Mode = string;" });
    expect(loose.requirements[0].status).toBe("met");
    expect(loose.ordinaryRequirementOutcomes?.requirements[0].criterion?.kind).toBe("typescript_assignability");
    expect(validateRuntimeReportBoundary({ boundary: "generated_private_full", input, report: loose }).valid).toBe(true);
    const strict = await run(input, { "tsconfig.json": '{"compilerOptions":{"strictNullChecks":true}}', "src/mode.ts": "export type Mode = string;" });
    expect(strict.requirements[0].status).toBe("missing");
  });
  it("resolves a unique path-free qualified type through local aliases and relative config inheritance", async () => {
    const report = await run(source("Type `Domain.Mode` must support `undefined`."), {
      "tsconfig.json": '{"extends":"./config/base.json","include":["src/**/*.ts"]}',
      "config/base.json": '{/* native JSONC */ "compilerOptions":{"strict":true},}',
      "src/value.ts": "export type Value = string | undefined;",
      "src/mode.ts": "import { Value } from './value'; export namespace Domain { export type Mode = Value; }",
    });
    expect(report.requirements[0].status).toBe("met");
    expect(report.evidenceIndex.find(item => item.id === "ev_ordinary_req_1_c1")?.locator).toBe("src/mode.ts");
  });
  it.each([
    ["no config", { "src/mode.ts": "type Mode = string;" }],
    ["excluded target", { "tsconfig.json": '{"files":["other.ts"]}', "other.ts": "export {};", "src/mode.ts": "type Mode = string;" }],
    ["missing dependency", { "tsconfig.json": "{}", "src/mode.ts": "import { Missing } from './missing'; type Mode = Missing;" }],
    ["noCheck recovery", { "tsconfig.json": '{"compilerOptions":{"noCheck":true}}', "src/mode.ts": "import { Missing } from './missing'; type Mode = Missing;" }],
    ["host dependency", { "tsconfig.json": "{}", "src/mode.ts": "import { Stats } from 'node:fs'; type Mode = Stats;" }],
    ["generic target", { "tsconfig.json": "{}", "src/mode.ts": "type Mode<T> = T | undefined;" }],
    ["syntax error", { "tsconfig.json": "{}", "src/mode.ts": "type Mode = ;" }],
    ["bad config", { "tsconfig.json": '{"compilerOptions":{"strictNullChecks":"no"}}', "src/mode.ts": "type Mode = string;" }],
    ["project reference", { "tsconfig.json": '{"references":[{"path":"./other"}]}', "src/mode.ts": "type Mode = string;" }],
    ["package config", { "tsconfig.json": '{"extends":"base"}', "node_modules/base/package.json": '{"tsconfig":"base.json"}', "node_modules/base/base.json": "{}", "src/mode.ts": "type Mode = string;" }],
    ["external package dependency", { "tsconfig.json": "{}", "node_modules/pkg/index.d.ts": "export type Value = string;", "src/mode.ts": "import {Value} from 'pkg'; type Mode = Value;" }],
    ["project library replacement", { "tsconfig.json": "{}", "node_modules/@typescript/lib-dom/index.d.ts": "interface CustomLibrary {}", "src/mode.ts": "type Mode = string;" }],
    ["unchecked JavaScript dependency", { "tsconfig.json": '{"compilerOptions":{"allowJs":true}}', "src/value.js": "import {missing} from './missing'; export const value = missing;", "src/mode.ts": "import {value} from './value'; type Mode = typeof value;" }],
    ["suppressed recovery any", { "tsconfig.json": "{}", "src/mode.ts": "// @ts-ignore\ntype Mode = Missing;" }],
    ["nested suppressed recovery any", { "tsconfig.json": "{}", "src/mode.ts": "// @ts-ignore\ntype Mode = { value: Missing } | undefined;" }],
  ] as const)("keeps %s unavailable", async (_name, files) => {
    expect((await run(source(), files)).requirements[0].status).toBe("unclear");
  });
  it("does not turn an ambiguous or missing path-free type into a decision", async () => {
    const files = { "tsconfig.json": "{}", "a.ts": "export type Mode = string;", "b.ts": "export type Mode = number;" };
    expect((await run(source("Type `Mode` must support `undefined`."), files)).requirements[0].status).toBe("unclear");
    expect((await run(source("Type `Absent` must support `undefined`."), files)).requirements[0].status).toBe("unclear");
    expect((await run(source("Type `Mode` in `a.ts` must support `undefined`."), files)).requirements[0].status).toBe("met");
  });
  it.each(["any", "unknown"])("uses genuine declared %s semantics", async type => {
    expect((await run(source(), { "tsconfig.json": '{"compilerOptions":{"strict":true}}', "src/mode.ts": `type Mode = ${type};` })).requirements[0].status).toBe("met");
  });
  it("does not inherit host NODE_OPTIONS into the trusted checker", async () => {
    vi.stubEnv("NODE_OPTIONS", "--agentproof-invalid-option");
    expect((await run(source(), { "tsconfig.json": "{}", "src/mode.ts": "type Mode = string;" })).requirements[0].status).toBe("met");
  });
  it("rejects stale/incomplete project data and forged plans without granting result authority", async () => {
    const input = source(), targets = compileOrdinaryAssignabilityPlans(input, buildGeneralPrObservationSeedV2(input));
    const project = snapshot({ "tsconfig.json": "{}", "src/mode.ts": "type Mode = string;" });
    for (const data of [{ ...project, headSha: "f".repeat(40) }, { ...project, inventory: { ...project.inventory, complete: false } }, { ...project, blobs: project.blobs.slice(1) }]) {
      expect((await evaluateOrdinaryAssignabilityPlans(targets, data))[0].state).toBe("unavailable");
    }
    await expect(evaluateOrdinaryAssignabilityPlans(targets, { ...project, blobs: [null] } as unknown as typeof project)).resolves.toMatchObject([{ state: "unavailable" }]);
    expect((await evaluateOrdinaryAssignabilityPlans(structuredClone(targets), project))[0].validate(input)).toBe(false);
  });
  it("does not collect when disabled, private, or when a clause contains another obligation", async () => {
    vi.stubEnv("AGENTPROOF_ORDINARY_TYPESCRIPT_ASSIGNABILITY", "disabled");
    const collect = vi.fn(async () => null);
    const options = { policy, generateReport: generateVerificationReportV2FromInput, validateDeterministicReport: () => true, collectTypeScriptProject: collect };
    expect(((await runGeneralPrObservationNowV2({ ...options, input: source() })).report as VerificationReportV2).requirements[0].status).toBe("unclear");
    vi.stubEnv("AGENTPROOF_ORDINARY_TYPESCRIPT_ASSIGNABILITY", "enabled");
    await runGeneralPrObservationNowV2({ ...options, input: { ...source(), repositoryPrivate: true } });
    await runGeneralPrObservationNowV2({ ...options, input: source("Type `Mode` must support `undefined` and document migration.") });
    expect(collect).not.toHaveBeenCalled();
  });
  it("binds source/head/evidence and retains canonical outcomes through signed and portable projections", async () => {
    const input = source();
    const report = await run(input, { "tsconfig.json": "{}", "src/mode.ts": "type Mode = string; // private fixture" });
    expect(report.requirements[0].requirementId).toBe("req_1");
    expect(validateRuntimeReportBoundary({ boundary: "generated_private_full", input: { ...input, taskText: input.taskText + " more" }, report }).valid).toBe(false);
    expect(validateRuntimeReportBoundary({ boundary: "generated_private_full", input: { ...input, sourceProvenance: { ...input.sourceProvenance!, headSha: "e".repeat(40) } }, report }).valid).toBe(false);
    expect(validateRuntimeReportBoundary({ boundary: "generated_private_full", input, report: structuredClone(report) }).valid).toBe(false);
    const stored = projectTenantPersistedReport(prepareTenantDetailReportForStorage(report, "verified_agentproof", "owned-secret"), "owned-secret");
    expect(validateTenantPersistedReport(stored, "owned-secret").valid).toBe(true);
    expect(decodeTenantPersistedReport(stored, { signingSecret: "owned-secret", createdAt: report.createdAt }).status).toBe("valid");
    expect((sanitizeReportForShare(report) as VerificationReportV2).ordinaryRequirementOutcomes?.requirements[0].criterion?.state).toBe("satisfied");
    expect(JSON.stringify(stored)).not.toContain("private fixture");
    report.evidenceIndex.find(item => item.id === "ev_ordinary_req_1_c1")!.summary = "forged";
    expect(validateRuntimeReportBoundary({ boundary: "generated_private_full", input, report }).valid).toBe(false);
    stored.requirements[0].status = "missing";
    expect(validateTenantPersistedReport(stored, "owned-secret").valid).toBe(false);
  });
});
