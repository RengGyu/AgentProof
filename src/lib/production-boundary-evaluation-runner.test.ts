import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/analyze/route";
import { buildGitHubPullRequestInput, mergePastedEvidenceForAnalysis } from "./github";
import { validateVerificationReport } from "./report-validation";
import { validateRuntimeReportBoundary } from "./report-runtime-validation";
import type { AnalyzeRequest, PullRequestInput, VerificationReport, VerificationReportV2 } from "./types";
import { generateVerificationReportV2, generateVerificationReportV2FromInput } from "./verifier";
import {
  MAX_PRODUCTION_BOUNDARY_CASE_BYTES,
  MAX_PRODUCTION_BOUNDARY_CORPUS_BYTES,
  parseProductionBoundaryCorpusV1,
  parseProductionBoundaryCorpusV2,
  runProductionBoundaryCorpusV1,
  runProductionBoundaryCorpusV2,
  writeProductionBoundaryResultV1,
  writeProductionBoundaryResultV2,
  type ProductionBoundaryCorpusV1
} from "./production-boundary-evaluation-runner";

vi.mock("./github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./github")>();
  return { ...actual, mergePastedEvidenceForAnalysis: vi.fn(actual.mergePastedEvidenceForAnalysis) };
});
vi.mock("./report-runtime-validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./report-runtime-validation")>();
  return { ...actual, validateRuntimeReportBoundary: vi.fn(actual.validateRuntimeReportBoundary) };
});
vi.mock("./verifier", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./verifier")>();
  return { ...actual, generateVerificationReportV2FromInput: vi.fn(actual.generateVerificationReportV2FromInput) };
});

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

const configuredInputPath = process.env.AGENTPROOF_PRODUCTION_BOUNDARY_CASES;
const configuredOutputPath = process.env.AGENTPROOF_PRODUCTION_BOUNDARY_OUTPUT;
if (configuredInputPath || configuredOutputPath) {
  if (!configuredInputPath || !configuredOutputPath) throw new Error("Both production boundary evaluation paths are required.");
  writeProductionBoundaryResultV1(configuredInputPath, configuredOutputPath);
}

describe("production boundary evaluation runner", () => {
  it("requires the sealed V2 boundary corpus shape and rejects private material before replay", () => {
    const cases = Array.from({ length: 8 }, (_, index) => ({
      ...pastedCase(`v2 boundary ${index}`),
      version: 2 as const,
      caseId: opaqueCaseId(`v2 boundary ${index}`)
    }));
    const corpus = { version: 2 as const, cases };
    expect(parseProductionBoundaryCorpusV2(corpus)).not.toBeNull();
    expect(parseProductionBoundaryCorpusV2({ ...corpus, unknown: true })).toBeNull();
    expect(parseProductionBoundaryCorpusV2({ ...corpus, cases: cases.slice(0, 7) })).toBeNull();
    expect(parseProductionBoundaryCorpusV2({ ...corpus, cases: [{ ...cases[0], expected: {} }, ...cases.slice(1)] })).toBeNull();
    expect(parseProductionBoundaryCorpusV2({ ...corpus, cases: [{ ...cases[0], pastedOverride: { taskText: "BEGIN PRIVATE SOURCE" } }, ...cases.slice(1)] })).toBeNull();
  });

  it("replays V2 pasted cases through the unchanged production boundary calls", () => {
    const cases = Array.from({ length: 8 }, (_, index) => ({
      ...pastedCase(`v2 replay ${index}`),
      version: 2 as const,
      caseId: opaqueCaseId(`v2 replay ${index}`),
      pastedOverride: index === 0 ? { changedFiles: "src/pasted.ts" } : {}
    }));
    const result = runProductionBoundaryCorpusV2({ version: 2, cases });
    expect(result.version).toBe(2);
    expect(result.cases).toHaveLength(8);
    expect(result.cases[0]).toMatchObject({ provenanceOrigin: "pasted_evidence", requirementLocalCiOwnership: "unknown" });
  });

  it("safely rejects the minimal sealed inbound V2 marker without requiring a full report", () => {
    const inbound = {
      version: 2 as const,
      kind: "inbound_untrusted_v2" as const,
      caseId: opaqueCaseId("minimal inbound marker"),
      report: { reportSchemaVersion: "verification-report.v2", verificationContract: { state: "authoritative" } }
    };
    const pasted = Array.from({ length: 7 }, (_, index) => ({
      ...pastedCase(`minimal inbound companion ${index}`),
      version: 2 as const,
      caseId: opaqueCaseId(`minimal inbound companion ${index}`)
    }));
    const corpus = { version: 2 as const, cases: [inbound, ...pasted] };
    expect(parseProductionBoundaryCorpusV2(corpus)).not.toBeNull();
    expect(runProductionBoundaryCorpusV2(corpus).cases[0]).toMatchObject({
      disposition: "rejected",
      provenanceOrigin: "none",
      requirementLocalCiOwnership: "unknown"
    });
  });

  it("accepts a sealed V2 rename previous path without widening V1", () => {
    const corpus = v2Corpus("rename", (item, index) => index === 0 ? {
      ...item,
      liveInput: {
        ...item.liveInput,
        changedFiles: [{ path: "src/current.ts", previousPath: "src/previous.ts", status: "renamed" }]
      }
    } : item);
    expect(parseProductionBoundaryCorpusV1({ version: 1, cases: [{ ...corpus.cases[0], version: 1 }] })).toBeNull();
    expect(parseProductionBoundaryCorpusV2(corpus)).not.toBeNull();
    expect(runProductionBoundaryCorpusV2(corpus).cases).toHaveLength(8);
  });

  it("clears a stale V2 result before parse or replay failure", () => {
    const root = mkdtempSync(join(tmpdir(), "agentproof-boundary-v2-failure-"));
    const inputPath = join(root, "input.json");
    const outputPath = join(root, "output.json");
    try {
      writeFileSync(outputPath, JSON.stringify({ version: 2, cases: [{ stale: true }] }));
      writeFileSync(inputPath, JSON.stringify({ version: 2, cases: [] }));
      expect(() => writeProductionBoundaryResultV2(inputPath, outputPath)).toThrow("Production boundary V2 corpus is invalid");
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual({ version: 2, cases: [] });

      writeFileSync(inputPath, JSON.stringify(v2Corpus("replay failure")));
      vi.mocked(mergePastedEvidenceForAnalysis).mockImplementationOnce(() => { throw new Error("synthetic merge failure"); });
      expect(() => writeProductionBoundaryResultV2(inputPath, outputPath)).toThrow("Production boundary replay failed");
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual({ version: 2, cases: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("accepts only lowercase sha256 case handles", () => {
    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [{ ...pastedCase("human-readable-case"), caseId: "human-readable-case" }]
    })).toBeNull();
    expect(parseProductionBoundaryCorpusV1({ version: 1, cases: [pastedCase(opaqueCaseId("synthetic case"))] })).not.toBeNull();
  });

  it("rejects open envelopes, duplicate IDs, and more than twelve cases", () => {
    expect(parseProductionBoundaryCorpusV1({ ...pastedCorpus(), unknown: true })).toBeNull();
    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [{ ...pastedCase("opaque-one"), unknown: true }]
    })).toBeNull();
    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [{ ...pastedCase("opaque-one"), pastedOverride: { changedFiles: "src/parser.ts", unknown: true } }]
    })).toBeNull();
    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [pastedCase("opaque-same"), pastedCase("opaque-same")]
    })).toBeNull();
    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: Array.from({ length: 13 }, (_, index) => pastedCase(`opaque-${index}`))
    })).toBeNull();
  });

  it("accepts the byte caps and rejects one byte over", () => {
    const exactCase = resizeCase(pastedCase("opaque-case-cap"), MAX_PRODUCTION_BOUNDARY_CASE_BYTES);
    const overCase = resizeCase(pastedCase("opaque-case-cap"), MAX_PRODUCTION_BOUNDARY_CASE_BYTES + 1);
    expect(bytes(exactCase)).toBe(MAX_PRODUCTION_BOUNDARY_CASE_BYTES);
    expect(parseProductionBoundaryCorpusV1({ version: 1, cases: [exactCase] })).not.toBeNull();
    expect(parseProductionBoundaryCorpusV1({ version: 1, cases: [overCase] })).toBeNull();

    const exactCorpus = resizeCorpus(MAX_PRODUCTION_BOUNDARY_CORPUS_BYTES);
    const overCorpus = resizeCorpus(MAX_PRODUCTION_BOUNDARY_CORPUS_BYTES + 1);
    expect(bytes(exactCorpus)).toBe(MAX_PRODUCTION_BOUNDARY_CORPUS_BYTES);
    expect(parseProductionBoundaryCorpusV1(exactCorpus)).not.toBeNull();
    expect(parseProductionBoundaryCorpusV1(overCorpus)).toBeNull();
  });

  it("applies the production request truncation before replay", () => {
    const candidate = pastedCase("shared request normalization");
    candidate.pastedOverride = { taskText: "x".repeat(8_001) };
    const parsed = parseProductionBoundaryCorpusV1({ version: 1, cases: [candidate] });

    expect(parsed?.cases[0]?.kind).toBe("pasted_merge");
    const normalized = parsed?.cases[0]?.kind === "pasted_merge" ? parsed.cases[0].pastedOverride : undefined;
    expect(normalized?.taskText).toHaveLength(8_000);
    expect(normalized?.inputLimitations).toContain("Task text was truncated to 8000 characters before analysis.");
  });

  it("rejects forbidden material in the raw case before request truncation", () => {
    const candidate = pastedCase("raw secret beyond truncation");
    candidate.pastedOverride = {
      taskText: `${"x".repeat(8_000)} github_pat_${"a".repeat(24)}`
    };

    expect(parseProductionBoundaryCorpusV1({ version: 1, cases: [candidate] })).toBeNull();
  });

  it.each([
    ["live URL", () => ({ ...pastedCase("relative live URL"), liveInput: { ...liveInput(), url: "github.com/example/agentproof/pull/7" } })],
    ["Check URL", () => ({ ...pastedCase("relative check URL"), liveInput: { ...liveInput(), checks: [{ name: "synthetic check", status: "passed", url: "/runs/7" }] } })],
    ["Log URL", () => ({ ...pastedCase("relative log URL"), liveInput: { ...liveInput(), logs: [{ source: "synthetic log", text: "passed", url: "//example.com/log/7" }] } })],
    ["override PR URL", () => ({ ...pastedCase("relative override URL"), pastedOverride: { prUrl: "github.com/example/agentproof/pull/7", checks: "synthetic check: passed" } })]
  ])("requires an approved synthetic HTTPS URL for every designated %s", (_name, build) => {
    expect(parseProductionBoundaryCorpusV1({ version: 1, cases: [build()] })).toBeNull();
  });

  it("caps nested provenance suites and rejects the unsupported demo route", () => {
    const suite = {
      headSha: HEAD_SHA,
      status: "passed" as const,
      executionSource: "Synthetic Actions job",
      runner: "node_test" as const,
      scope: "repository_discovery" as const,
      testPaths: ["test/parser.test.ts"]
    };
    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [{
        ...pastedCase("nested provenance suite cap"),
        liveInput: {
          ...liveInput(),
          sourceProvenance: { ...liveInput().sourceProvenance!, executionSuites: Array.from({ length: 13 }, () => suite) }
        }
      }]
    })).toBeNull();
    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [{ ...pastedCase("unsupported demo route"), pastedOverride: { demoScenario: "clean" } }]
    })).toBeNull();
  });

  it.each([
    ["token field", () => ({ ...pastedCase("opaque-token"), pastedOverride: { githubToken: "synthetic-token" } })],
    ["private URL", () => ({ ...pastedCase("opaque-url"), liveInput: { ...liveInput(), url: "https://github.com/private-payroll/secrets/pull/7" } })],
    ["raw private source", () => ({ ...pastedCase("opaque-source"), liveInput: { ...liveInput(), taskText: "BEGIN PRIVATE SOURCE\ncustomer payroll implementation" } })],
    ["raw private log", () => ({ ...pastedCase("opaque-log"), pastedOverride: { logs: "BEGIN PRIVATE LOG\ncustomer payroll output" } })]
  ])("rejects %s material", (_name, build) => {
    expect(parseProductionBoundaryCorpusV1({ version: 1, cases: [build()] })).toBeNull();
  });

  it("rejects nested report keys, overlong live fields, full secret patterns, and unapproved URLs", () => {
    const report = structuredClone(activeV2Report("synthetic nested report marker")) as VerificationReportV2 & {
      source: VerificationReportV2["source"] & { unknown?: boolean };
    };
    report.source.unknown = true;
    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [{ version: 1, kind: "inbound_untrusted_v2", caseId: opaqueCaseId("unknown report key"), report }]
    })).toBeNull();

    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [{ ...pastedCase("overlong title"), liveInput: { ...liveInput(), title: "x".repeat(501) } }]
    })).toBeNull();
    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [{
        ...pastedCase("unknown contract key"),
        liveInput: {
          ...liveInput(),
          verificationContractSourceV2: {
            kind: "provided_requirement",
            contract: { version: 2, scope: "complete_objective_set", objectives: [], unknown: true }
          }
        }
      }]
    })).toBeNull();
    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [{ ...pastedCase("project secret pattern"), liveInput: { ...liveInput(), taskText: "AWS_SECRET_ACCESS_KEY=abcdefghijklmnopqrstuvwxyz123456" } }]
    })).toBeNull();
    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [{ ...pastedCase("unapproved url"), liveInput: { ...liveInput(), url: "https://unapproved.example.net/org/repo/pull/7" } }]
    })).toBeNull();
  });

  it("rejects a schema-valid inbound report with a non-URL source value", () => {
    const report = activeV2Report("synthetic disallowed source URL marker");
    report.source.url = "internal.corp/opaque/repository/pull/7";

    expect(validateVerificationReport(report, { mode: "v2_full" })).toMatchObject({ valid: true });
    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [{
        version: 1,
        kind: "inbound_untrusted_v2",
        caseId: opaqueCaseId("disallowed report source URL"),
        report
      }]
    })).toBeNull();
  });

  it("admits an inbound report with an approved synthetic HTTPS source URL", () => {
    const report = activeV2Report("synthetic approved source URL marker");
    report.source.url = "https://example.com/opaque/repository/pull/7";

    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [{
        version: 1,
        kind: "inbound_untrusted_v2",
        caseId: opaqueCaseId("approved report source URL"),
        report
      }]
    })).not.toBeNull();
  });

  it("executes the real inbound adapter and emits only an opaque rejection", () => {
    const marker = "synthetic-inbound-private-source-marker";
    const caseId = opaqueCaseId("inbound rejection");
    const report = activeV2Report(marker);
    const result = runProductionBoundaryCorpusV1({
      version: 1,
      cases: [{ version: 1, kind: "inbound_untrusted_v2", caseId, report }]
    });

    expect(result).toEqual({
      version: 1,
      cases: [{
        caseId,
        disposition: "rejected",
        provenanceOrigin: "none",
        localAxisStates: { implementation: "incomplete", targeted_test: "incomplete", execution: "incomplete" },
        requirementLocalCiOwnership: "unknown",
        leakCount: 0
      }]
    });
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("admits a context-dependent receipt-bearing v2 report to the inbound runtime boundary", () => withReceiptV2(() => {
    const report = generateVerificationReportV2FromInput(receiptBearingInput());
    const receipts = report.proofGraph.privateReceiptBundleV2;
    expect(receipts?.testRelationReceipts.length).toBeGreaterThan(0);
    expect(receipts?.executionBindingReceipts.length).toBeGreaterThan(0);
    expect(report.requirements[0]?.proofAxes?.some((axis) => axis.state === "satisfied")).toBe(true);
    const contextless = validateVerificationReport(report, { mode: "v2_full" });
    expect(contextless.valid).toBe(false);
    if (!contextless.valid) expect(contextless.errors).toEqual([
      "v2 private receipt validation requires transient validation context."
    ]);

    const unknownNested = structuredClone(report) as VerificationReportV2 & {
      source: VerificationReportV2["source"] & { unknown?: boolean };
    };
    unknownNested.source.unknown = true;
    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [{
        version: 1,
        kind: "inbound_untrusted_v2",
        caseId: opaqueCaseId("malformed receipt report unknown key"),
        report: unknownNested
      }]
    })).toBeNull();

    const invalidSummary = structuredClone(report);
    invalidSummary.summary.confidence = "certain" as never;
    expect(parseProductionBoundaryCorpusV1({
      version: 1,
      cases: [{
        version: 1,
        kind: "inbound_untrusted_v2",
        caseId: opaqueCaseId("malformed receipt report summary"),
        report: invalidSummary
      }]
    })).toBeNull();

    vi.mocked(validateRuntimeReportBoundary).mockClear();
    const result = runProductionBoundaryCorpusV1({
      version: 1,
      cases: [{
        version: 1,
        kind: "inbound_untrusted_v2",
        caseId: opaqueCaseId("receipt bearing inbound report"),
        report
      }]
    });

    expect(vi.mocked(validateRuntimeReportBoundary)).toHaveBeenCalledWith({
      boundary: "inbound_untrusted_full",
      report
    });
    expect(result.cases[0]?.disposition).toBe("rejected");
  }));

  it("executes the real pasted merger and observes downgraded provenance and axes", () => withReceiptV2(() => {
    const marker = "synthetic-pasted-source-marker";
    const caseId = opaqueCaseId("pasted downgrade");
    const result = runProductionBoundaryCorpusV1({
      version: 1,
      cases: [{
        version: 1,
        kind: "pasted_merge",
        caseId,
        liveInput: liveInput(marker),
        pastedOverride: { changedFiles: "src/pasted-parser.ts", checks: "parser regression: passed" }
      }]
    });

    expect(result.cases[0]).toEqual({
      caseId,
      disposition: "accepted",
      provenanceOrigin: "pasted_evidence",
      localAxisStates: { implementation: "incomplete", targeted_test: "incomplete", execution: "incomplete" },
      requirementLocalCiOwnership: "unknown",
      leakCount: 0
    });
    const serialized = JSON.stringify(result).toLowerCase();
    for (const forbidden of [marker, "report", "path", "patch", "logs", "receipt", "validation", "errors", "private source"]) {
      expect(serialized).not.toContain(forbidden.toLowerCase());
    }
  }));

  it("keeps pasted absence-axis state and collection basis invariant-compatible", () => {
    const contract = {
      version: 2 as const,
      scope: "complete_objective_set" as const,
      objectives: [{
        id: "runtime_scope",
        objective: "Do not modify runtime code.",
        criteria: [{
          id: "runtime_absence",
          type: "absence" as const,
          label: "No runtime path changes.",
          prohibitedKind: "path_change" as const,
          scope: [{ kind: "prefix" as const, path: "src/runtime/" }]
        }]
      }]
    };
    const sourceContent = JSON.stringify(contract);
    const input: PullRequestInput = {
      ...liveInput(),
      taskText: "Acceptance criteria: do not change implementation code.",
      verificationContractSourceV2: { kind: "provided_requirement", contract },
      verificationContractBindingV2: {
        sourceKind: "provided_requirement",
        sourceIdentity: "synthetic:boundary:absence",
        sourceContent,
        headSha: HEAD_SHA,
        baseSha: BASE_SHA
      }
    };

    const result = runProductionBoundaryCorpusV1({
      version: 1,
      cases: [{
        version: 1,
        kind: "pasted_merge",
        caseId: opaqueCaseId("pasted absence invariant"),
        liveInput: input,
        pastedOverride: { changedFiles: "src/runtime/changed.ts" }
      }]
    });

    expect(result.cases[0]).toMatchObject({
      disposition: "accepted",
      provenanceOrigin: "pasted_evidence",
      localAxisStates: { implementation: "incomplete" }
    });
  });

  it.each([
    ["merge", () => vi.mocked(mergePastedEvidenceForAnalysis).mockImplementationOnce(() => { throw new Error("synthetic merge failure"); })],
    ["generation", () => vi.mocked(generateVerificationReportV2FromInput).mockImplementationOnce(() => { throw new Error("synthetic generation failure"); })],
    ["runtime validation", () => vi.mocked(validateRuntimeReportBoundary).mockImplementationOnce(() => { throw new Error("synthetic validation failure"); })]
  ])("invalidates the candidate run when %s throws", (_name, fail) => {
    fail();
    expect(() => runProductionBoundaryCorpusV1(pastedCorpus())).toThrow("Production boundary replay failed");
  });

  it("invalidates the candidate run when generated-private validation fails", () => {
    vi.mocked(validateRuntimeReportBoundary).mockImplementationOnce(() => ({
      valid: false,
      errors: ["synthetic validation detail must not escape"]
    }));
    expect(() => runProductionBoundaryCorpusV1(pastedCorpus())).toThrow("Production boundary replay failed");
  });

  it("replaces a stale output with a closed invalid corpus when replay throws", () => {
    const root = mkdtempSync(join(tmpdir(), "agentproof-boundary-failure-"));
    const inputPath = join(root, "input.json");
    const outputPath = join(root, "output.json");
    try {
      const serializedInput = JSON.stringify(pastedCorpus());
      expect(parseProductionBoundaryCorpusV1(JSON.parse(serializedInput))).not.toBeNull();
      writeFileSync(inputPath, serializedInput);
      writeFileSync(outputPath, JSON.stringify(runProductionBoundaryCorpusV1(pastedCorpus())));
      vi.mocked(mergePastedEvidenceForAnalysis).mockImplementationOnce(() => { throw new Error("synthetic merge failure"); });

      expect(() => writeProductionBoundaryResultV1(inputPath, outputPath)).toThrow("Production boundary replay failed");
      expect(JSON.parse(readFileSync(outputPath, "utf8"))).toEqual({ version: 1, cases: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("agrees with the live-plus-paste analyze API path", async () => withReceiptV2(async () => {
    const caseId = opaqueCaseId("api agreement");
    const fetchMock = vi.fn((value: string | URL | Request) => {
      const url = String(value);
      if (url.endsWith("/pulls/9")) return Promise.resolve(Response.json({
        title: "Synthetic live parser normalization",
        body: "Adds parser normalization with regression coverage.",
        url: "https://api.github.com/repos/opaque-owner/opaque-repo/pulls/9",
        base: { ref: "main", sha: BASE_SHA },
        head: { ref: "agent/parser", sha: HEAD_SHA }
      }));
      if (url.includes("/files?")) return Promise.resolve(Response.json([{
        filename: "src/parser.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "+export const normalize = (value) => value.trim();"
      }]));
      if (url.includes("/check-runs")) return Promise.resolve(Response.json({ total_count: 0, check_runs: [] }));
      if (url.endsWith("/status")) return Promise.resolve(Response.json({ statuses: [] }));
      return Promise.resolve(new Response("unexpected synthetic endpoint", { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const request: AnalyzeRequest = {
      prUrl: "https://github.com/opaque-owner/opaque-repo/pull/9",
      taskText: "Implement parser normalization and add a targeted regression test with execution proof.",
      checks: "synthetic pasted parser regression: passed"
    };
    const live = await buildGitHubPullRequestInput(request.prUrl!, undefined, request.taskText!);
    expect(live?.sourceProvenance?.origin).toBe("github_snapshot");
    const response = await POST(new Request("http://localhost/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request)
    }));
    const payload = await response.json() as { report: VerificationReport };
    expect(response.status).toBe(200);

    const runner = runProductionBoundaryCorpusV1({
      version: 1,
      cases: [{
        version: 1,
        kind: "pasted_merge",
        caseId,
        liveInput: live!,
        pastedOverride: request
      }]
    }).cases[0]!;

    expect(runner.provenanceOrigin).toBe(payload.report.source.provenance?.origin);
    expect(runner.provenanceOrigin).toBe("pasted_evidence");
    expect(runner.localAxisStates).toEqual(localAxisStates(payload.report));
    expect(runner.requirementLocalCiOwnership).toBe(localCiOwnership(payload.report));
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/pulls/9"))).toBe(true);
  }));
});

function pastedCorpus(): ProductionBoundaryCorpusV1 {
  return { version: 1, cases: [pastedCase("opaque-pasted")] };
}

function v2Corpus(
  label: string,
  transform: (item: Extract<ProductionBoundaryCorpusV1["cases"][number], { kind: "pasted_merge" }>, index: number) => Extract<ProductionBoundaryCorpusV1["cases"][number], { kind: "pasted_merge" }> = (item) => item
) {
  return {
    version: 2 as const,
    cases: Array.from({ length: 8 }, (_, index) => {
      const item = transform(pastedCase(`${label} ${index}`), index);
      return { ...item, version: 2 as const };
    })
  };
}

function pastedCase(caseId: string): Extract<ProductionBoundaryCorpusV1["cases"][number], { kind: "pasted_merge" }> {
  return {
    version: 1 as const,
    kind: "pasted_merge" as const,
    caseId: opaqueCaseId(caseId),
    liveInput: liveInput(),
    pastedOverride: { changedFiles: "src/parser.ts" }
  };
}

function liveInput(description = "Synthetic parser normalization change."): PullRequestInput {
  return {
    url: "https://github.com/example/agentproof/pull/7",
    title: "Synthetic parser normalization",
    description,
    taskSource: "issue",
    taskText: "Implement parser normalization and add a targeted regression test with execution proof.",
    changedFiles: [
      { path: "src/parser.ts", status: "modified", patch: "+export const normalize = (value) => value.trim();" },
      { path: "test/parser.test.ts", status: "modified", patch: "+test('normalizes parser input', () => expect(normalize(' x ')).toBe('x'));" }
    ],
    checks: [{ name: "parser regression", status: "passed", summary: "Synthetic parser tests passed." }],
    logs: [{ source: "parser regression", status: "passed", text: "Synthetic parser tests passed." }],
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
      changedFileInventory: { version: 1, completeness: "complete", headSha: HEAD_SHA },
      evidenceCapturedAt: "2026-08-22T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
    }
  };
}

function receiptBearingInput(): PullRequestInput {
  const source = "export function repositoryName(value) { return String(value).toLowerCase(); }";
  const testPath = "test/repository-name.test.js";
  return {
    title: "Add repository name regression coverage",
    description: "",
    taskText: "Acceptance criteria: add a regression test for repositoryName(value) formatting.",
    taskSource: "issue",
    changedFiles: [{
      path: testPath,
      status: "added",
      patch: [
        "+import { repositoryName } from '../src/repositories/name.js';",
        "+test('formats names', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });"
      ].join("\n")
    }],
    checks: [{ name: "unit-tests", status: "passed", summary: "Unit tests passed." }],
    logs: [{ source: "GitHub Actions job: unit-tests", status: "passed", text: "npm test passed." }],
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
      changedFileInventory: { version: 1, completeness: "complete", headSha: HEAD_SHA },
      evidenceCapturedAt: "2026-08-19T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
    },
    executionSuites: [{
      headSha: HEAD_SHA,
      status: "passed",
      executionSource: "GitHub Actions job: unit-tests",
      runner: "node_test",
      scope: "repository_discovery",
      testPaths: [testPath]
    }],
    resolvedHeadModules: [{
      version: 1,
      kind: "resolved_head_module",
      headSha: HEAD_SHA,
      path: "src/repositories/name.js",
      blobSha: gitBlobSha(source),
      source
    }]
  };
}

function gitBlobSha(source: string) {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(source, "utf8")}\0`)
    .update(source)
    .digest("hex");
}

function activeV2Report(marker: string): VerificationReportV2 {
  const contract = {
    version: 2 as const,
    scope: "complete_objective_set" as const,
    objectives: [{
      id: "parser_docs",
      objective: "Document the parser normalization command.",
      criteria: [{
        id: "parser_literal",
        type: "artifact" as const,
        label: "The parser documentation contains the synthetic command.",
        paths: ["docs/parser.md"],
        artifact: { kind: "documentation_literal" as const, literal: "Run pnpm test." }
      }]
    }]
  };
  return generateVerificationReportV2({
    input: {
      ...liveInput(marker),
      verificationCriterionEvidenceV2: {
        artifactBlobs: [{ path: "docs/parser.md", content: "Synthetic documentation. Run pnpm test." }]
      }
    },
    contractSource: { kind: "provided_requirement", contract },
    binding: {
      sourceKind: "provided_requirement",
      sourceIdentity: "synthetic:boundary:1",
      sourceContent: JSON.stringify(contract),
      headSha: HEAD_SHA,
      baseSha: BASE_SHA
    }
  });
}

function localAxisStates(report: VerificationReport) {
  const states = { implementation: "incomplete", targeted_test: "incomplete", execution: "incomplete" } as const;
  const mutable = { ...states } as Record<keyof typeof states, "satisfied" | "violated" | "incomplete">;
  for (const requirement of report.requirements) {
    for (const axis of requirement.proofAxes ?? []) {
      if (axis.subject in mutable && (axis.state === "satisfied" || (axis.state === "violated" && mutable[axis.subject as keyof typeof states] !== "satisfied"))) {
        mutable[axis.subject as keyof typeof states] = axis.state;
      }
    }
  }
  return mutable;
}

function localCiOwnership(report: VerificationReport) {
  const executionAxes = report.requirements.flatMap((requirement) =>
    (requirement.proofAxes ?? []).filter((axis) => axis.subject === "execution")
  );
  if (executionAxes.some((axis) => axis.state === "satisfied")) return "associated";
  if (executionAxes.some((axis) => axis.evidenceRefs.length > 0)) return "local";
  return "unknown";
}

function resizeCase(base: ReturnType<typeof pastedCase>, targetBytes: number) {
  const empty = { ...base, pastedOverride: { taskText: "" } };
  const padding = targetBytes - bytes(empty);
  if (padding < 0) throw new Error("case fixture is larger than its target");
  return { ...empty, pastedOverride: { taskText: "x".repeat(padding) } };
}

function resizeCorpus(targetBytes: number) {
  const cases = Array.from({ length: 5 }, (_, index) =>
    resizeCase(pastedCase(`opaque-corpus-${index}`), index < 4 ? MAX_PRODUCTION_BOUNDARY_CASE_BYTES : 3_000)
  );
  let corpus = { version: 1 as const, cases };
  const adjustment = targetBytes - bytes(corpus);
  corpus = {
    ...corpus,
    cases: cases.map((item, index) => index === cases.length - 1
      ? resizeCase(item, bytes(item) + adjustment)
      : item)
  };
  return corpus;
}

function bytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function opaqueCaseId(label: string) {
  return createHash("sha256").update(label).digest("hex");
}

function withReceiptV2<T>(run: () => T): T {
  const previous = process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE;
  process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE = "receipt_v2";
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE;
    else process.env.AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE = previous;
  }
}
