import { afterEach, describe, expect, it, vi } from "vitest";
import { runGeneralPrObservationNowV2, boundedOrdinaryArtifactCollector } from "./general-pr-observation-service";
import { resolveGeneralPrAssessmentRuntimePolicyV1 } from "./general-pr-runtime-policy";
import { generateVerificationReportV2FromInput } from "./verifier";
import { validateRuntimeReportBoundary } from "./report-runtime-validation";
import { deriveRequirementPresentationV2 } from "./requirement-presentation-v2";
import { projectTenantPersistedReport, validateTenantPersistedReport, decodeTenantPersistedReport } from "./tenant-report-validation";
import { prepareTenantDetailReportForStorage } from "./server-report-store";
import { sanitizeReportForShare } from "./report-share";
import { validateVerificationReport } from "./report-validation";
import { reportToMarkdown } from "./markdown";
import type { PullRequestInput, VerificationReportV2 } from "./types";

const headSha = "a".repeat(40);
function source(taskText = "## Requirements\n- `README.md` must contain `ready now`.\n- Improve deployment usability."): PullRequestInput {
  return { title: "Documentation", description: "Documentation update", taskText, taskSource: "issue", changedFiles: [], checks: [], logs: [], repositoryPrivate: false,
    sourceProvenance: { version: 1, origin: "github_snapshot", headSha, baseSha: "b".repeat(40), evidenceCapturedAt: "2026-09-08T00:00:00Z", inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" } } };
}
async function run(input: PullRequestInput, content: string | null) {
  vi.stubEnv("AGENTPROOF_VERIFICATION_CAPABILITIES_V2", "documentation_literal,typescript_union_member");
  const result = await runGeneralPrObservationNowV2({ input, policy: resolveGeneralPrAssessmentRuntimePolicyV1("advisory"), generateReport: generateVerificationReportV2FromInput, validateDeterministicReport: () => true,
    collectDocumentationArtifacts: async paths => content === null ? [] : paths.map(path => ({ path, headSha, content })),
    collectStaticArtifacts: async paths => content === null ? [] : paths.map(path => ({ path, headSha, content })) });
  return result.report as VerificationReportV2;
}
afterEach(() => vi.unstubAllEnvs());

describe("source-bound ordinary requirement outcomes", () => {
  it("shares a per-head eight-path read budget across overlapping collection batches", async () => {
    const reads: string[] = [];
    const collector = boundedOrdinaryArtifactCollector(async paths => { reads.push(...paths); return paths.map(path => ({ path, headSha, content: "collected" })); })!;
    await collector(["a.md", "b.md"], headSha);
    const reused = await collector(["a.md", "c.md", "d.md", "e.md", "f.md", "g.md", "h.md", "i.md"], headSha);
    expect(reads).toEqual(["a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md", "h.md"]);
    expect(reused.map(blob => blob.path)).toEqual(["a.md", "c.md", "d.md", "e.md", "f.md", "g.md", "h.md"]);
    expect(await collector(["i.md"], headSha)).toEqual([]);
  });
  it.each([["ready now", "met", "Fulfilled"], ["different", "missing", "Violated"], [null, "unclear", "Source requirement not verified"]] as const)("uses exact-head artifact %s for the canonical result, retaining unsupported obligations", async (content, status, label) => {
    const input = source();
    const report = await run(input, content);
    expect(report.requirements.map(row => row.status)).toEqual([status, "unclear"]);
    expect(deriveRequirementPresentationV2(report, "req_1").outcomeLabel).toContain(label);
    expect(deriveRequirementPresentationV2(report, "req_2").reasonCode).toBe("source_interpretation_unavailable");
    expect(validateRuntimeReportBoundary({ boundary: "generated_private_full", input, report })).toMatchObject({ valid: true });
    const baseline = generateVerificationReportV2FromInput(input);
    expect(report.requirements.map(row => row.evidenceStatus)).toEqual(baseline.requirements.map(row => row.evidenceStatus));
    expect(report.proofGraph.nodes.map(row => row.status)).toEqual(baseline.proofGraph.nodes.map(row => row.status));
  });
  it("rejects changed source/head, forged positives and inbound imported authority", async () => {
    const input = source();
    const report = await run(input, "ready now");
    expect(report.requirements[0].status).toBe("met");
    expect(validateVerificationReport(report, { mode: "v2_full" }).valid).toBe(false);
    for (const changed of [{ ...input, taskText: input.taskText + " Extra obligation." }, { ...input, sourceProvenance: { ...input.sourceProvenance!, headSha: "d".repeat(40) } }]) {
      expect(validateRuntimeReportBoundary({ boundary: "generated_private_full", input: changed, report }).valid).toBe(false);
    }
    expect(validateRuntimeReportBoundary({ boundary: "generated_private_full", input, report: structuredClone(report) }).valid).toBe(false);
    expect(validateRuntimeReportBoundary({ boundary: "inbound_untrusted_full", report }).valid).toBe(false);
    const forged = await run(input, "different");
    forged.requirements[0].status = "met";
    expect(validateRuntimeReportBoundary({ boundary: "generated_private_full", input, report: forged }).valid).toBe(false);
    const changedReportHead = await run(input, "ready now");
    changedReportHead.source.provenance!.headSha = "d".repeat(40);
    expect(validateRuntimeReportBoundary({ boundary: "generated_private_full", input, report: changedReportHead }).valid).toBe(false);
  });
  it("retains author-claim cap and rejects a predicate that only covers part of the source obligation", async () => {
    const claim = source("");
    claim.description = "## Requirements\n- `README.md` must contain `ready now`.";
    expect((await run(claim, "ready now")).requirements[0].status).toBe("partial");
    const qualified = await run(source("## Requirements\n- `README.md` must contain `ready now` and explain deployment."), "ready now");
    expect(qualified.requirements[0].status).toBe("unclear");
  });
  it("proves only an independently closed union assertion at its explicit target", async () => {
    const input = source("## Requirements\n- Type `Mode` in `src/mode.ts` must include `undefined` as a union member.");
    input.changedFiles = [{ path: "src/mode.ts", status: "modified" }];
    expect((await run(input, "type Mode = string | undefined;")).requirements[0].status).toBe("met");
    expect((await run(input, "type Mode = string | number;")).requirements[0].status).toBe("missing");
    expect((await run(input, "type Mode = Imported;")).requirements[0].status).toBe("unclear");
    expect((await run(source("## Requirements\n- Extend Mode with undefined where needed."), "type Mode = string | undefined;")).requirements[0].status).toBe("unclear");
  });
  it("preserves canonical outcomes through signed persistence and rejects tampered results", async () => {
    const report = await run(source(), "ready now");
    const safe = prepareTenantDetailReportForStorage(report, "verified_agentproof", "test signing secret");
    const persisted = projectTenantPersistedReport(safe, "test signing secret");
    expect(validateTenantPersistedReport(persisted, "test signing secret").errors).toEqual([]);
    expect(persisted.requirements.map(row => row.status)).toEqual(["met", "unclear"]);
    const decoded = decodeTenantPersistedReport(persisted, { signingSecret: "test signing secret", createdAt: report.createdAt });
    expect(decoded).toMatchObject({ status: "valid" });
    if (decoded.status === "valid") expect(deriveRequirementPresentationV2(decoded.report as VerificationReportV2, "req_1").outcomeLabel).toContain("Fulfilled");
    const portable = sanitizeReportForShare(report) as VerificationReportV2;
    expect(portable.requirements[0].status).toBe("met");
    expect(portable.authenticity?.trust).toBe("portable_unverified");
    const markdown = reportToMarkdown(portable);
    expect(markdown).toContain("### PR-to-Evidence Review");
    expect(markdown).toContain("#### `README.md` must contain `ready now`");
    expect(markdown).not.toContain("Fulfilled — explicit source requirement");
    expect(markdown).not.toContain("No approved verification contract;");
    expect(validateRuntimeReportBoundary({ boundary: "inbound_untrusted_full", report: portable }).valid).toBe(false);
    persisted.requirements[0].status = "missing";
    expect(validateTenantPersistedReport(persisted, "test signing secret").valid).toBe(false);
  });
});
