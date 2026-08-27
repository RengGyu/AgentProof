import { createHash } from "crypto";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sanitizeReportForShare } from "./report-share";
import {
  resolveRuntimeReportValidation,
  validateRuntimeReportBoundary
} from "./report-runtime-validation";
import { generateVerificationReport, generateVerificationReportV2, generateVerificationReportV2FromInput } from "./verifier";
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

  it("rejects a typed criterion whose report-safe label no longer matches the server-built plan", () => {
    vi.stubEnv("AGENTPROOF_VERIFICATION_CAPABILITIES_V2", "");
    const typedInput = typedDocumentationInput();
    const report = generateVerificationReportV2FromInput(typedInput);
    const forged = structuredClone(report);
    forged.verificationContract.objectives[0]!.criteria[0]!.label = "A different criterion";

    const result = validateRuntimeReportBoundary({
      boundary: "generated_private_full",
      input: typedInput,
      report: forged,
      requireV2: true
    });

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join("\n")).toContain("does not match the transient criterion plan");
  });

  it("rejects a forged changed-file reference in place of exact-head artifact evidence", () => {
    vi.stubEnv("AGENTPROOF_VERIFICATION_CAPABILITIES_V2", "documentation_literal");
    const typedInput = typedDocumentationInput();
    const report = generateVerificationReportV2FromInput(typedInput);
    const forged = structuredClone(report);
    forged.verificationContract.objectives[0]!.criterionResults[0]!.evidenceRefs = ["ev_2"];

    const result = validateRuntimeReportBoundary({
      boundary: "generated_private_full",
      input: typedInput,
      report: forged,
      requireV2: true
    });

    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join("\n")).toContain("independent transient evaluation");
  });

  it("accepts an independently recomputed documentation literal positive", () => {
    vi.stubEnv("AGENTPROOF_VERIFICATION_CAPABILITIES_V2", "documentation_literal");
    const typedInput = typedDocumentationInput();
    const report = generateVerificationReportV2FromInput(typedInput);

    expect(report.verificationContract.objectives[0]?.criterionResults[0]).toMatchObject({ state: "satisfied" });
    expect(validateRuntimeReportBoundary({
      boundary: "generated_private_full",
      input: typedInput,
      report,
      requireV2: true
    })).toMatchObject({ valid: true, usedDeterministicFallback: false });
  });

  it("accepts an independently recomputed complete changed-path absence positive", () => {
    vi.stubEnv("AGENTPROOF_VERIFICATION_CAPABILITIES_V2", "path_change_absence");
    const typedInput = typedAbsenceInput();
    const report = generateVerificationReportV2FromInput(typedInput);

    expect(report.verificationContract.objectives[0]?.criterionResults[0]).toMatchObject({ state: "satisfied" });
    expect(validateRuntimeReportBoundary({
      boundary: "generated_private_full",
      input: typedInput,
      report,
      requireV2: true
    })).toMatchObject({ valid: true, usedDeterministicFallback: false });
  });

  it("accepts a server-generated typed report when validation receives the same source separately", () => {
    vi.stubEnv("AGENTPROOF_VERIFICATION_CAPABILITIES_V2", "");
    const validationInput = typedDocumentationInput();
    const reportInput = { ...validationInput };
    delete reportInput.verificationContractSourceV2;
    delete reportInput.verificationContractBindingV2;
    const report = generateVerificationReportV2({
      input: reportInput,
      contractSource: validationInput.verificationContractSourceV2!,
      binding: validationInput.verificationContractBindingV2!
    });

    const result = validateRuntimeReportBoundary({
      boundary: "generated_private_full",
      input: validationInput,
      report,
      requireV2: true
    });
    if (!result.valid) throw new Error(result.errors.join("\n"));
    expect(result).toMatchObject({ valid: true, usedDeterministicFallback: false });
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

function typedDocumentationInput(): PullRequestInput {
  const headSha = "d".repeat(40);
  const baseSha = "e".repeat(40);
  const contract = {
    version: 2,
    scope: "complete_objective_set" as const,
    objectives: [{
      id: "reset_docs",
      objective: "Document the local reset command.",
      criteria: [{
        id: "reset_literal",
        type: "artifact" as const,
        label: "The reset command is documented.",
        paths: ["docs/reset.md"],
        artifact: { kind: "documentation_literal" as const, literal: "Run npm test." }
      }]
    }]
  };
  const sourceContent = JSON.stringify(contract);
  return {
    title: "Document reset",
    description: "",
    taskText: "Document the local reset command.",
    taskSource: "issue",
    changedFiles: [{ path: "docs/reset.md", status: "modified", patch: "+Run npm test." }],
    checks: [],
    logs: [],
    verificationContractSourceV2: { kind: "provided_requirement", contract },
    verificationContractBindingV2: {
      sourceKind: "provided_requirement",
      sourceIdentity: "manual:verification-contract:runtime",
      sourceContent,
      headSha,
      baseSha
    },
    verificationCriterionEvidenceV2: {
      artifactBlobs: [{ path: "docs/reset.md", headSha, content: "Run npm test." }]
    },
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha,
      baseSha,
      changedFileInventory: { version: 1, completeness: "complete", headSha },
      evidenceCapturedAt: "2026-08-25T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "f".repeat(64), coverage: "github_metadata" }
    }
  };
}

function typedAbsenceInput(): PullRequestInput {
  const headSha = "1".repeat(40);
  const baseSha = "2".repeat(40);
  const contract = {
    version: 2,
    scope: "complete_objective_set" as const,
    objectives: [{
      id: "runtime_scope",
      objective: "Do not modify runtime code.",
      criteria: [{
        id: "no_runtime_change",
        type: "absence" as const,
        label: "No runtime path changes.",
        prohibitedKind: "path_change" as const,
        scope: [{ kind: "prefix" as const, path: "src/runtime/" }]
      }]
    }]
  };
  const sourceContent = JSON.stringify(contract);
  return {
    title: "Document reset without runtime changes",
    description: "",
    taskText: "Do not modify runtime code.",
    taskSource: "issue",
    changedFiles: [{ path: "docs/reset.md", status: "modified", patch: "+Run npm test." }],
    checks: [],
    logs: [],
    verificationContractSourceV2: { kind: "provided_requirement", contract },
    verificationContractBindingV2: {
      sourceKind: "provided_requirement",
      sourceIdentity: "manual:verification-contract:absence-runtime",
      sourceContent,
      headSha,
      baseSha
    },
    sourceProvenance: {
      version: 1,
      origin: "github_snapshot",
      headSha,
      baseSha,
      changedFileInventory: { version: 1, completeness: "complete", headSha },
      evidenceCapturedAt: "2026-08-26T00:00:00.000Z",
      inputFingerprint: { version: 1, algorithm: "sha256", value: "3".repeat(64), coverage: "github_metadata" }
    }
  };
}
