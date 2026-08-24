import { createHash } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeReportForShare } from "./report-share";
import {
  resolveRuntimeReportValidation,
  validateRuntimeReportBoundary
} from "./report-runtime-validation";
import { generateVerificationReport, generateVerificationReportV2FromInput } from "./verifier";
import type { PullRequestInput } from "./types";

const input = {
  title: "Runtime validation fallback",
  description: "",
  taskText: "Add a retry status label.",
  taskSource: "issue" as const,
  changedFiles: [{
    path: "src/retry/status.ts",
    status: "modified" as const,
    patch: "+ export const retryStatus = () => 'ready';"
  }],
  checks: [{ name: "retry status tests", status: "passed" as const, summary: "retry status tests passed." }],
  logs: []
};

describe("resolveRuntimeReportValidation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to the deterministic report when enhanced planning output is invalid", () => {
    const deterministic = generateVerificationReport(input);
    const enhanced = structuredClone(deterministic);
    enhanced.planner = {
      version: 1,
      contractVersion: "hybrid_requirement_planner.v1",
      schemaVersion: "agentproof_requirement_span_plan_v1",
      promptVersion: "2026-08-12.v1",
      model: "gpt-5-mini"
      // Deliberately no input hash: malformed enhanced output must not fail the analysis.
    } as typeof enhanced.planner;

    const resolved = resolveRuntimeReportValidation({ input, report: enhanced });

    expect(resolved).toMatchObject({ valid: true, usedDeterministicFallback: true });
    if (resolved.valid) expect(resolved.report.planner).toBeUndefined();
  });

  it("does not hide an invalid deterministic report", () => {
    const deterministic = generateVerificationReport(input);
    deterministic.requirements[0]!.status = "met";
    deterministic.requirements[0]!.proofAxes![0]!.state = "incomplete";

    const resolved = resolveRuntimeReportValidation({ input, report: deterministic });

    expect(resolved.valid).toBe(false);
  });

  it("validates a generated private v2 report against server-built transient context", () => {
    vi.stubEnv("AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE", "receipt_v2");
    const receiptInput = exactHeadReceiptInput();
    const report = generateVerificationReportV2FromInput(receiptInput);

    expect(report.proofGraph.privateReceiptBundleV2?.testRelationReceipts).toHaveLength(1);
    expect(resolveRuntimeReportValidation({
      boundary: "generated_private_full",
      input: receiptInput,
      report,
      requireV2: true
    })).toMatchObject({ valid: true, usedDeterministicFallback: false });
  });

  it("rejects a generated positive draft when its transient context no longer closes the receipt", () => {
    vi.stubEnv("AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE", "receipt_v2");
    const receiptInput = exactHeadReceiptInput();
    const report = generateVerificationReportV2FromInput(receiptInput);
    receiptInput.resolvedHeadModules![0]!.source += "\nexport const unrelated = true;";

    const resolved = resolveRuntimeReportValidation({
      boundary: "generated_private_full",
      input: receiptInput,
      report,
      requireV2: true
    });

    expect(resolved.valid).toBe(false);
    if (!resolved.valid) expect(resolved.errors.join("\n")).toContain("transient validation context");
  });

  it("re-reads the publication kill switch and regenerates a downgraded report", () => {
    vi.stubEnv("AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE", "receipt_v2");
    const receiptInput = exactHeadReceiptInput();
    const report = generateVerificationReportV2FromInput(receiptInput);
    expect(receiptPositiveAxes(report)).toBeGreaterThan(0);

    vi.stubEnv("AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE", "off");
    const resolved = resolveRuntimeReportValidation({
      boundary: "generated_private_full",
      input: receiptInput,
      report,
      requireV2: true
    });

    expect(resolved).toMatchObject({ valid: true, usedDeterministicFallback: true });
    if (resolved.valid) {
      expect(receiptPositiveAxes(resolved.report)).toBe(0);
    }
  });

  it("rejects receipt-gated positives at the inbound untrusted full boundary", () => {
    vi.stubEnv("AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE", "receipt_v2");
    const receiptInput = exactHeadReceiptInput();
    const report = generateVerificationReportV2FromInput(receiptInput);

    const result = validateRuntimeReportBoundary({
      boundary: "inbound_untrusted_full",
      report
    });

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join("\n")).toContain("inbound untrusted full report cannot carry receipt-gated positive claims");
  });

  it("validates signed-summary reads without transient context and never restores receipts", () => {
    vi.stubEnv("AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE", "receipt_v2");
    const full = generateVerificationReportV2FromInput(exactHeadReceiptInput());
    const summary = sanitizeReportForShare(full);

    const result = validateRuntimeReportBoundary({
      boundary: "signed_summary_read",
      report: summary
    });

    expect(result).toEqual({ valid: true, report: summary, usedDeterministicFallback: false });
    if (result.valid) {
      const serialized = JSON.stringify(result.report);
      expect(serialized).not.toContain("privateReceiptBundleV2");
      expect(serialized).not.toContain("testRelationReceipts");
      expect(serialized).not.toContain("executionBindingReceipts");
    }
  });

  it("keeps raw validator calls out of runtime production callers", () => {
    const sourceRoot = resolve(process.cwd(), "src");
    const runtimeProductionFiles = productionTypeScriptFiles(sourceRoot);
    const lowLevelCallers = runtimeProductionFiles.filter((relativePath) => {
      const source = readFileSync(resolve(sourceRoot, relativePath), "utf8");
      return /\bvalidateVerificationReport\s*\(/.test(source) ||
        /import\s*\{[^}]*\bvalidateVerificationReport\b[^}]*\}\s*from\s*["'][^"']*report-validation["']/.test(source);
    });

    // Offline evaluation runners and reviewer sentinels are not request,
    // persistence, publication, or authenticated-read boundaries.
    expect(lowLevelCallers).toEqual([
      "lib/evaluation-pack.ts",
      "lib/production-boundary-evaluation-runner.ts",
      "lib/report-runtime-validation.ts",
      "lib/report-validation.ts",
      "lib/reviewer-signal-sentinels.ts"
    ]);
  });
});

function productionTypeScriptFiles(sourceRoot: string): string[] {
  const visit = (directory: string): string[] => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) return visit(absolute);
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [absolute.slice(sourceRoot.length + 1)];
  });
  return visit(sourceRoot).sort();
}

function receiptPositiveAxes(report: import("./types").VerificationReport): number {
  return report.requirements.flatMap((requirement) => requirement.proofAxes ?? [])
    .filter((axis) => (axis.subject === "targeted_test" || axis.subject === "execution") && axis.state === "satisfied")
    .length;
}

function exactHeadReceiptInput(): PullRequestInput {
  const headSha = "a".repeat(40);
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
      headSha,
      baseSha: "b".repeat(40),
      changedFileInventory: { version: 1, completeness: "complete", headSha },
      evidenceCapturedAt: "2026-08-19T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
    },
    executionSuites: [{
      headSha,
      status: "passed",
      executionSource: "GitHub Actions job: unit-tests",
      runner: "node_test",
      scope: "repository_discovery",
      testPaths: [testPath]
    }],
    resolvedHeadModules: [{
      version: 1,
      kind: "resolved_head_module",
      headSha,
      path: "src/repositories/name.js",
      blobSha: createHash("sha1").update(`blob ${Buffer.byteLength(source, "utf8")}\0`).update(source).digest("hex"),
      source
    }]
  };
}
