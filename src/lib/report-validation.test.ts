import { describe, expect, it } from "vitest";
import { validateVerificationReport } from "./report-validation";
import { decodeSharedReport, encodeReportForShare } from "./report-share";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";

describe("validateVerificationReport", () => {
  it("accepts a generated deterministic report", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);

    expect(validateVerificationReport(report)).toEqual({ valid: true, errors: [] });
  });

  it("accepts verified suite execution only with a GitHub-head-anchored changed test path", () => {
    const headSha = "c".repeat(40);
    const report = generateVerificationReport({
      title: "Add repository search empty state",
      description: "Adds repository search behavior.",
      taskText: "Search results must show an empty-state message when no repositories match.",
      changedFiles: [
        { path: "src/repositories/RepositorySearch.js", additions: 8, deletions: 0, status: "added", patch: "+ export function emptyStateMessage() {}" },
        { path: "test/repository-search.test.js", additions: 8, deletions: 0, status: "added", patch: "+ test('empty state', () => {})" }
      ],
      checks: [{ name: "unit-tests", status: "passed", summary: "Unit tests passed." }],
      logs: [{ source: "GitHub Actions job: unit-tests", status: "passed", text: "Steps: Run npm test: passed." }],
      executionSuites: [{
        headSha,
        status: "passed",
        executionSource: "GitHub Actions job: unit-tests",
        runner: "node_test",
        scope: "repository_discovery",
        testPaths: ["test/repository-search.test.js"]
      }],
      sourceProvenance: {
        version: 1,
        origin: "github_snapshot",
        headSha,
        baseSha: "b".repeat(40),
        changedFileInventory: { version: 1, completeness: "complete", headSha },
        evidenceCapturedAt: "2026-08-11T00:00:00.000Z",
        inputFingerprint: { version: 1, algorithm: "sha256", value: "a".repeat(64), coverage: "github_metadata" }
      }
    });

    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });

    report.source.provenance!.executionSuites![0]!.testPaths = ["test/unrelated.test.js"];
    const forged = validateVerificationReport(report, { mode: "full" });
    expect(forged.valid).toBe(false);
    expect(forged.errors.join("\n")).toContain("cites incompatible evidence or collection basis");
  });

  it("validates every no-secret demo report in full and summary modes", () => {
    for (const [scenarioId, input] of Object.entries(demoScenarios)) {
      const report = generateVerificationReport(input);
      const shared = decodeSharedReport(encodeReportForShare(report));

      expect(validateVerificationReport(report, { mode: "full" }), scenarioId).toEqual({ valid: true, errors: [] });
      expect(validateVerificationReport(shared, { mode: "summary" }), scenarioId).toEqual({ valid: true, errors: [] });
      expect(JSON.stringify(shared), scenarioId).not.toContain("provenance");
      expect(shared.evidenceIndex, scenarioId).toEqual([]);
      expect(shared.claims, scenarioId).toEqual([]);
    }
  });

  it("rejects missing evidence references and invalid confidence", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.requirements[0].evidenceRefs = ["ev_missing"];
    report.summary.confidence = 2;

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("ev_missing");
    expect(result.errors.join("\n")).toContain("summary.confidence");
  });

  it("rejects missing scope and review-priority evidence references", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.scope.evidenceRefs = ["ev_missing_scope"];
    report.reviewPriority[0].evidenceRefs = ["ev_missing_priority"];

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("scope.evidenceRefs cites missing evidence ev_missing_scope");
    expect(result.errors.join("\n")).toContain("reviewPriority[0].evidenceRefs cites missing evidence ev_missing_priority");
  });

  it("rejects malformed finding provenance", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.scope.provenance = [
      {
        evidenceRef: "ev_missing_provenance",
        sourceType: "diff",
        locator: "src/server/auth/sessionExpiry.ts",
        confidence: 0.7,
        evidenceText: "Missing provenance should fail."
      }
    ];

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("scope.provenance[0].evidenceRef cites missing evidence ev_missing_provenance");
  });

  it("keeps default validation backward-compatible for optional provenance", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;
    delete report.reviewPriority[0].evidenceRefs;

    expect(validateVerificationReport(report)).toEqual({ valid: true, errors: [] });
  });

  it("accepts auditable GitHub source provenance with exact head and base anchors", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.source.provenance = {
      version: 1,
      origin: "github_snapshot",
      evidenceCapturedAt: "2026-06-30T00:00:00.000Z",
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      baseSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      inputFingerprint: {
        version: 1,
        algorithm: "sha256",
        value: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        coverage: "github_metadata"
      }
    };

    expect(validateVerificationReport(report, {
      mode: "full",
      requireSourceProvenance: true
    })).toEqual({ valid: true, errors: [] });
  });

  it("rejects strict GitHub source provenance without a full base anchor", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.source.provenance = {
      version: 1,
      origin: "github_snapshot",
      evidenceCapturedAt: "2026-06-30T00:00:00.000Z",
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      inputFingerprint: {
        version: 1,
        algorithm: "sha256",
        value: "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        coverage: "github_metadata"
      }
    };

    const result = validateVerificationReport(report, {
      mode: "full",
      requireSourceProvenance: true
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain(
      "source.provenance.baseSha must be a full lowercase Git commit SHA for github_snapshot"
    );
  });

  it("requires full-report provenance when strict mode is enabled", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;
    delete report.reviewPriority[0].evidenceRefs;

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("scope.evidenceRefs is required");
    expect(result.errors.join("\n")).toContain("reviewPriority[0].evidenceRefs is required");
  });

  it("separates full-report validation from summary-only validation", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const shared = decodeSharedReport(encodeReportForShare(report));

    expect(shared.evidenceIndex).toHaveLength(0);
    expect(validateVerificationReport(shared, { mode: "summary" })).toEqual({ valid: true, errors: [] });

    const result = validateVerificationReport(shared, { mode: "full" });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("evidenceIndex must contain evidence items for full reports");
  });

  it("rejects finding provenance on summary-only reports", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const shared = decodeSharedReport(encodeReportForShare(report));
    shared.scope.provenance = [];
    shared.testing.missingTests[0].provenance = [];

    const result = validateVerificationReport(shared, { mode: "summary" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("summary-only reports must omit finding provenance");
    expect(result.errors.join("\n")).toContain("summary-only reports must omit testing.missingTests[0].provenance");
  });

  it("accepts nullable optional fields produced by strict structured-output schemas", () => {
    const report = generateVerificationReport(demoScenarios.clean) as unknown as Record<string, unknown>;
    const source = report.source as Record<string, unknown>;
    const evidenceIndex = report.evidenceIndex as Array<Record<string, unknown>>;
    const scope = report.scope as Record<string, unknown>;

    source.url = null;
    source.author = null;
    source.baseBranch = null;
    source.headBranch = null;
    evidenceIndex[0].locator = null;
    scope.provenance = [
      {
        evidenceRef: evidenceIndex[0].id,
        sourceType: evidenceIndex[0].kind,
        locator: null,
        confidence: 0.7,
        evidenceText: "Short structured-output provenance."
      }
    ];

    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("allows strict validation when missing provenance is explained at the item level", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;
    delete report.reviewPriority[0].evidenceRefs;
    report.scope.reasons = ["Scope evidence was unavailable from the imported report source."];
    report.reviewPriority[0].reason = "File-level priority evidence was unavailable from the imported report source.";

    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("does not let a global limitation bypass full-report provenance checks", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    delete report.scope.evidenceRefs;
    delete report.reviewPriority[0].evidenceRefs;
    report.limitations.push("File-level priority evidence was unavailable from the imported report source.");

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("scope.evidenceRefs is required");
    expect(result.errors.join("\n")).toContain("reviewPriority[0].evidenceRefs is required");
  });

  it("rejects semantically overconfident full reports", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.summary.confidence = 1;

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("summary.confidence must be capped");
  });

  it("rejects met test requirements without passing execution evidence", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    report.requirements[2].status = "met";
    report.requirements[2].gaps = [];

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("cannot be met without passing test, build, or CI execution evidence");
  });

  it("rejects met non-test requirements without passing execution evidence", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    report.requirements[0].status = "met";
    report.requirements[0].gaps = [];
    report.requirements[0].evidenceRefs = report.evidenceIndex.filter((item) => item.kind === "diff").map((item) => item.id).slice(0, 1);

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("cannot be met without passing test, build, or CI execution evidence");
  });

  it("validates full reports from proof axes while retaining conservative legacy behavior", () => {
    const report = generateVerificationReport({
      title: "Keep implementation unchanged",
      description: "Changes documentation only.",
      taskText: "Acceptance criteria: do not change implementation code.",
      changedFiles: [{ path: "docs/retry.md", status: "modified", patch: "+ Retry guide" }],
      checks: [],
      logs: [],
      sourceProvenance: githubInventoryProvenance()
    });

    expect(report.requirements[0]?.status).toBe("met");
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });

    const legacy = structuredClone(report);
    delete legacy.requirements[0].proofAxes;
    const legacyValidation = validateVerificationReport(legacy, { mode: "full" });
    expect(legacyValidation.valid).toBe(false);
    expect(legacyValidation.errors.join("\n")).toContain("cannot be met without passing test, build, or CI execution evidence");

    const legacyPassing = generateVerificationReport(demoScenarios.clean);
    for (const requirement of legacyPassing.requirements) delete requirement.proofAxes;
    expect(validateVerificationReport(legacyPassing, { mode: "full" })).toEqual({ valid: true, errors: [] });
  });

  it("rejects invented, incomplete, incompatible, or proof-node-divergent axes", () => {
    const invented = generateVerificationReport(demoScenarios["missing-tests"]);
    const target = invented.requirements[0]!;
    target.status = "met";
    target.gaps = [];
    target.proofAxes = [{
      subject: "documentation",
      polarity: "present",
      state: "satisfied",
      evidenceRefs: [],
      collectionBasis: "matching_artifact_evidence"
    }];
    invented.proofGraph.nodes.find((node) => node.requirementId === target.requirementId)!.status = "met";
    const inventedResult = validateVerificationReport(invented, { mode: "full" });
    expect(inventedResult.valid).toBe(false);
    expect(inventedResult.errors.join("\n")).toContain("required proof axis set");

    const incomplete = generateVerificationReport(demoScenarios.clean);
    const incompleteRequirement = incomplete.requirements.find((item) =>
      item.proofAxes?.some((axis) => axis.subject === "execution")
    )!;
    incompleteRequirement.proofAxes = incompleteRequirement.proofAxes!.filter((axis) => axis.subject !== "execution");
    const incompleteResult = validateVerificationReport(incomplete, { mode: "full" });
    expect(incompleteResult.valid).toBe(false);
    expect(incompleteResult.errors.join("\n")).toContain("required proof axis set");

    const unsupported = generateVerificationReport(demoScenarios.clean);
    const unsupportedAxis = unsupported.requirements[0]!.proofAxes!.find((axis) =>
      axis.subject === "implementation" && axis.polarity === "present"
    )!;
    unsupportedAxis.collectionBasis = "passing_execution";
    const unsupportedResult = validateVerificationReport(unsupported, { mode: "full" });
    expect(unsupportedResult.valid).toBe(false);
    expect(unsupportedResult.errors.join("\n")).toContain("incompatible evidence or collection basis");

    const empty = generateVerificationReport(demoScenarios.clean);
    const emptyAxis = empty.requirements[0]!.proofAxes!.find((axis) =>
      axis.subject === "implementation" && axis.polarity === "present"
    )!;
    emptyAxis.evidenceRefs = [];
    const emptyResult = validateVerificationReport(empty, { mode: "full" });
    expect(emptyResult.valid).toBe(false);
    expect(emptyResult.errors.join("\n")).toContain("satisfied present axis must cite evidence");

    const incompatible = generateVerificationReport(demoScenarios.clean);
    const requirement = incompatible.requirements[0]!;
    const implementationAxis = requirement.proofAxes!.find((axis) => axis.subject === "implementation" && axis.polarity === "present")!;
    implementationAxis.evidenceRefs = [incompatible.evidenceIndex.find((item) => item.kind === "test")!.id];
    const incompatibleResult = validateVerificationReport(incompatible, { mode: "full" });
    expect(incompatibleResult.valid).toBe(false);
    expect(incompatibleResult.errors.join("\n")).toContain("incompatible evidence");

    const nodeMismatch = generateVerificationReport(demoScenarios.clean);
    nodeMismatch.proofGraph.nodes[0]!.status = "partial";
    const mismatchResult = validateVerificationReport(nodeMismatch, { mode: "full" });
    expect(mismatchResult.valid).toBe(false);
    expect(mismatchResult.errors.join("\n")).toContain("must match proofGraph node status");

    const unrelatedExecution = generateVerificationReport(demoScenarios.clean);
    const executionRequirement = unrelatedExecution.requirements.find((item) =>
      item.proofAxes?.some((axis) => axis.subject === "execution")
    )!;
    const executionAxis = executionRequirement.proofAxes!.find((axis) => axis.subject === "execution")!;
    const executionNode = unrelatedExecution.proofGraph.nodes.find((node) =>
      node.requirementId === executionRequirement.requirementId
    )!;
    unrelatedExecution.evidenceIndex.push({
      id: "ev_unrelated_global_execution",
      kind: "check",
      label: "Payments service tests",
      summary: "Status: passed. Payments service tests completed successfully.",
      locator: "ci://payments",
      confidence: 0.99
    });
    executionAxis.evidenceRefs = ["ev_unrelated_global_execution"];
    executionNode.executionEvidenceRefs = ["ev_unrelated_global_execution"];
    const unrelatedResult = validateVerificationReport(unrelatedExecution, { mode: "full" });
    expect(unrelatedResult.valid).toBe(false);
    expect(unrelatedResult.errors.join("\n")).toContain("incompatible evidence");
  });

  it("rejects axes derived from proof-node text that diverges from the matched requirement", () => {
    const report = generateVerificationReport({
      title: "Implement retry queue behavior",
      description: "Implements retry queue behavior and adds documentation.",
      taskText: "Acceptance criteria: implement retry queue behavior.",
      changedFiles: [
        { path: "src/retry-queue.ts", status: "modified", patch: "+ export function retryQueue() {}" },
        { path: "docs/retry-queue.md", status: "modified", patch: "+ # Retry queue" }
      ],
      checks: [{ name: "Retry queue tests", status: "passed", summary: "Retry queue tests passed." }],
      logs: []
    });
    const requirement = report.requirements[0]!;
    const node = report.proofGraph.nodes[0]!;
    const documentationRef = report.evidenceIndex.find((item) =>
      item.kind === "diff" && item.locator === "docs/retry-queue.md"
    )!.id;

    requirement.status = "met";
    requirement.gaps = [];
    requirement.evidenceRefs = [documentationRef];
    requirement.proofAxes = [{
      subject: "documentation",
      polarity: "present",
      state: "satisfied",
      evidenceRefs: [documentationRef],
      collectionBasis: "matching_artifact_evidence"
    }];
    node.requirementText = "Document retry queue";
    node.status = "met";
    node.implementationEvidenceRefs = [documentationRef];
    node.targetedTestEvidenceRefs = [];
    node.executionEvidenceRefs = [];
    node.gapSignals = [];
    node.firstFiles = ["docs/retry-queue.md"];
    report.proofGraph.summary = {
      requirementCount: 1,
      requirementsWithImplementation: 1,
      requirementsWithTargetedTests: 0,
      requirementsWithExecution: 0,
      requirementsWithGaps: 0,
      gapCount: 0
    };

    const result = validateVerificationReport(report, { mode: "full" });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("requirementText must match requirements[0].requirementText");
  });

  it("rejects context-only evidence when a satisfied execution or visual axis is revalidated", () => {
    const report = generateVerificationReport({
      title: "Keep settings panel readable with regression coverage",
      description: "Adds settings-panel coverage.",
      taskText: "Acceptance criteria: keep the settings panel readable at 375px and add settings panel regression tests.",
      changedFiles: [
        { path: "src/settings/Panel.tsx", status: "modified", patch: "+ return <section>settings panel</section>" },
        { path: "src/settings/Panel.test.tsx", status: "modified", patch: "+ it('renders settings panel', () => {})" }
      ],
      checks: [
        { name: "Settings panel regression tests", status: "passed", summary: "Settings panel regression tests passed." },
        { name: "Browser QA settings panel", status: "passed", summary: "Status: passed. Settings panel visual viewport check passed." }
      ],
      logs: []
    });
    const requirement = report.requirements[0]!;
    const node = report.proofGraph.nodes[0]!;
    const execution = requirement.proofAxes!.find((axis) => axis.subject === "execution")!;
    const visual = requirement.proofAxes!.find((axis) => axis.subject === "visual")!;
    report.evidenceIndex.push(
      { id: "ev_context_only_execution", kind: "check", label: "Payments regression tests", summary: "Status: passed. Payments regression tests passed.", locator: "ci://payments", confidence: 0.9 },
      { id: "ev_context_only_visual", kind: "check", label: "Browser QA billing card", summary: "Status: passed. Billing card visual viewport check passed.", locator: "ci://billing", confidence: 0.9 }
    );
    execution.evidenceRefs = ["ev_context_only_execution"];
    visual.evidenceRefs = ["ev_context_only_visual"];
    node.executionEvidenceRefs = ["ev_context_only_execution"];

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("incompatible evidence");
  });

  it("rejects forged violated execution axes while accepting canonical and opaque failures", () => {
    const canonical = generateVerificationReport({
      title: "Add settings-panel tests",
      description: "Adds settings-panel coverage.",
      taskText: "Acceptance criteria: add settings panel tests.",
      changedFiles: [{ path: "src/settings/Panel.test.tsx", status: "modified", patch: "+ it('renders settings panel', () => {})" }],
      checks: [{ name: "Settings panel tests", status: "failed", summary: "Settings panel tests failed." }],
      logs: []
    });
    const executionAxis = canonical.requirements[0]!.proofAxes!.find((axis) => axis.subject === "execution")!;
    const executionNode = canonical.proofGraph.nodes[0]!;
    const failedRef = executionAxis.evidenceRefs[0]!;

    expect(executionAxis).toMatchObject({ state: "violated", collectionBasis: "failed_execution" });
    expect(validateVerificationReport(canonical, { mode: "full" })).toEqual({ valid: true, errors: [] });

    const wrongStatus = structuredClone(canonical);
    wrongStatus.evidenceIndex.find((item) => item.id === failedRef)!.summary = "Status: passed. Settings panel tests passed.";
    expect(validateVerificationReport(wrongStatus, { mode: "full" }).errors.join("\n")).toContain("violated execution has incompatible evidence");

    const wrongBasis = structuredClone(canonical);
    wrongBasis.requirements[0]!.proofAxes!.find((axis) => axis.subject === "execution")!.collectionBasis = "passing_execution";
    expect(validateVerificationReport(wrongBasis, { mode: "full" }).errors.join("\n")).toContain("violated execution has incompatible evidence");

    const missingNodeRef = structuredClone(canonical);
    missingNodeRef.proofGraph.nodes[0]!.executionEvidenceRefs = [];
    expect(validateVerificationReport(missingNodeRef, { mode: "full" }).errors.join("\n")).toContain("violated execution has incompatible evidence");

    const wrongRelevance = structuredClone(canonical);
    wrongRelevance.evidenceIndex.find((item) => item.id === failedRef)!.label = "Payments tests";
    wrongRelevance.evidenceIndex.find((item) => item.id === failedRef)!.summary = "Status: failed. Payments tests failed.";
    expect(validateVerificationReport(wrongRelevance, { mode: "full" }).errors.join("\n")).toContain("violated execution has incompatible evidence");

    const opaque = structuredClone(canonical);
    opaque.evidenceIndex.find((item) => item.id === failedRef)!.label = "PANDAS_FUTURE_INFER_STRING=0";
    opaque.evidenceIndex.find((item) => item.id === failedRef)!.summary = "Status: failed. Matrix job failed on the head commit.";
    opaque.evidenceIndex.find((item) => item.id === failedRef)!.locator = "https://github.com/example/project/actions/runs/100/job/201";
    expect(validateVerificationReport(opaque, { mode: "full" })).toEqual({ valid: true, errors: [] });
    expect(executionNode.executionEvidenceRefs).toEqual([failedRef]);
  });

  it("allows fully evidenced author-claim axes to remain partial when duplicate text and status match", () => {
    const report = generateVerificationReport({
      title: "Preserve URL params",
      description: "### Acceptance criteria\nThe widget should preserve search params.",
      taskText: "",
      changedFiles: [{
        path: "src/widget/url-params.ts",
        additions: 4,
        deletions: 1,
        status: "modified",
        patch: "+ preserveSearchParams(params)"
      }],
      checks: [{
        name: "Widget search params tests",
        status: "passed",
        summary: "Widget search params tests passed."
      }],
      logs: []
    });
    const requirement = report.requirements[0]!;
    const node = report.proofGraph.nodes[0]!;

    expect(node.sourceQuality).toBe("author_claim");
    expect(node.requirementText).toBe(requirement.requirementText);
    expect(node.status).toBe("partial");
    expect(requirement.status).toBe("partial");
    expect(requirement.proofAxes?.every((axis) => axis.state === "satisfied")).toBe(true);
    expect(validateVerificationReport(report, { mode: "full" })).toEqual({ valid: true, errors: [] });

    const statusMismatch = structuredClone(report);
    statusMismatch.proofGraph.nodes[0]!.status = "met";
    const statusResult = validateVerificationReport(statusMismatch, { mode: "full" });
    expect(statusResult.valid).toBe(false);
    expect(statusResult.errors.join("\n")).toContain("status must match proofGraph node status");

    const textMismatch = structuredClone(report);
    textMismatch.proofGraph.nodes[0]!.requirementText = "Preserve unrelated author claim";
    const textResult = validateVerificationReport(textMismatch, { mode: "full" });
    expect(textResult.valid).toBe(false);
    expect(textResult.errors.join("\n")).toContain("requirementText must match requirements[0].requirementText");
  });

  it("rejects a satisfied absence axis without matching authoritative GitHub inventory provenance", () => {
    const report = generateVerificationReport({
      title: "Keep implementation unchanged",
      description: "Changes documentation only.",
      taskText: "Acceptance criteria: do not change implementation code.",
      changedFiles: [{ path: "docs/retry.md", status: "modified", patch: "+ Retry guide" }],
      checks: [],
      logs: []
    });
    const requirement = report.requirements[0]!;
    const axis = requirement.proofAxes![0]!;
    requirement.status = "met";
    requirement.gaps = [];
    axis.state = "satisfied";
    axis.collectionBasis = "complete_changed_file_inventory";
    report.proofGraph.nodes[0]!.status = "met";

    const result = validateVerificationReport(report, { mode: "full" });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("head-anchored authoritative GitHub inventory");
  });

  it.each([
    {
      name: "pasted provenance",
      mutate: (report: ReturnType<typeof generateVerificationReport>) => {
        report.source.provenance = {
          ...githubInventoryProvenance(),
          origin: "pasted_evidence",
          headSha: undefined,
          baseSha: undefined,
          inputFingerprint: { ...githubInventoryProvenance().inputFingerprint, coverage: "pasted_metadata" }
        };
      }
    },
    {
      name: "wrong inventory head",
      mutate: (report: ReturnType<typeof generateVerificationReport>) => {
        report.source.provenance!.changedFileInventory!.headSha = "d".repeat(40);
      }
    },
    {
      name: "capped inventory",
      mutate: (report: ReturnType<typeof generateVerificationReport>) => {
        report.limitations.push("GitHub changed-file evidence was capped at 120 files.");
      }
    },
    {
      name: "unavailable inventory",
      mutate: (report: ReturnType<typeof generateVerificationReport>) => {
        report.limitations.push("GitHub changed-file evidence unavailable: request timed out or network failed.");
      }
    }
  ])("rejects a forged satisfied absence axis with $name", ({ mutate }) => {
    const report = generateVerificationReport({
      title: "Keep implementation unchanged",
      description: "Changes documentation only.",
      taskText: "Acceptance criteria: do not change implementation code.",
      changedFiles: [{ path: "docs/retry.md", status: "modified", patch: "+ Retry guide" }],
      checks: [],
      logs: [],
      sourceProvenance: githubInventoryProvenance()
    });
    mutate(report);

    const result = validateVerificationReport(report, { mode: "full" });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("head-anchored authoritative GitHub inventory");
  });

  it("rejects malformed axes and disagreement between axes and requirement status", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    const requirement = report.requirements[0];
    expect(requirement?.proofAxes?.length).toBeGreaterThan(0);
    requirement!.proofAxes![0].state = "incomplete";

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("status must agree with proofAxes");

    const satisfied = generateVerificationReport(demoScenarios.clean);
    satisfied.requirements[0]!.status = "partial";
    const reverseResult = validateVerificationReport(satisfied, { mode: "full" });
    expect(reverseResult.valid).toBe(false);
    expect(reverseResult.errors.join("\n")).toContain("every satisfied authoritative axis requires met");
  });

  it("rejects supported execution claims without passing check or log evidence", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    report.claims = [
      {
        id: "claim_1",
        text: "Tested password reset validation",
        evidenceRefs: report.evidenceIndex.filter((item) => item.kind === "test").map((item) => item.id),
        supported: true
      }
    ];

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("execution claim cannot be supported without passing test or CI execution evidence");
  });

  it("rejects passed CI status without passing execution evidence", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    report.testing.ciStatus = "passed";
    report.evidenceIndex.push({
      id: "ev_security_check",
      kind: "check",
      label: "Socket Security coverage tests report",
      summary: "Status: passed. Socket Security coverage tests report - policy checks passed",
      confidence: 0.9
    });

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("testing.ciStatus cannot be passed without passing test, build, or CI execution evidence");
  });

  it("rejects passed CI status when passed appears only in unstructured summary text", () => {
    const report = generateVerificationReport(demoScenarios["missing-tests"]);
    report.testing.ciStatus = "passed";
    report.evidenceIndex.push({
      id: "ev_unit_tests_unknown",
      kind: "check",
      label: "unit tests: passed",
      summary: "unit tests: passed on a previous branch, but current status is unknown",
      confidence: 0.45
    });

    const result = validateVerificationReport(report, { mode: "full" });

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("testing.ciStatus cannot be passed without passing test, build, or CI execution evidence");
  });

  it("rejects proofGraph summaries that do not match their nodes", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.proofGraph.summary.requirementCount += 1;
    report.proofGraph.summary.requirementsWithGaps += 1;
    report.proofGraph.summary.gapCount += 1;

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("proofGraph.summary.requirementCount must match proofGraph.nodes");
    expect(result.errors.join("\n")).toContain("proofGraph.summary.requirementsWithGaps must match proofGraph.nodes");
    expect(result.errors.join("\n")).toContain("proofGraph.summary.gapCount must match proofGraph.nodes");
  });

  it("rejects proofGraph nodes that do not map to report requirements", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.proofGraph.nodes[0].requirementId = "req_missing";

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("proofGraph.nodes[0].requirementId must match a report requirement");
  });

  it("rejects proofGraph nodes that omit or duplicate report requirements", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    const duplicatedRequirementId = report.proofGraph.nodes[0].requirementId;
    const omittedRequirementId = report.proofGraph.nodes[1]?.requirementId;

    expect(omittedRequirementId).toBeTruthy();
    report.proofGraph.nodes[1].requirementId = duplicatedRequirementId;

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain(`proofGraph.nodes[1].requirementId duplicates proofGraph node for ${duplicatedRequirementId}`);
    expect(result.errors.join("\n")).toContain(`proofGraph.nodes must include requirement ${omittedRequirementId}`);
  });

  it("rejects proofGraph evidence refs assigned to incompatible proof classes", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    const diffRef = report.evidenceIndex.find((item) => item.kind === "diff" || item.kind === "changed_file")?.id;
    const testRef = report.evidenceIndex.find((item) => item.kind === "test")?.id;
    const executionRef = report.evidenceIndex.find((item) => item.kind === "check" || item.kind === "log")?.id;

    expect(diffRef).toBeTruthy();
    expect(testRef).toBeTruthy();
    expect(executionRef).toBeTruthy();

    report.proofGraph.nodes[0].implementationEvidenceRefs = [testRef as string];
    report.proofGraph.nodes[0].targetedTestEvidenceRefs = [diffRef as string];
    report.proofGraph.nodes[0].executionEvidenceRefs = [diffRef as string];

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("proofGraph.nodes[0].implementationEvidenceRefs cites incompatible evidence");
    expect(result.errors.join("\n")).toContain("proofGraph.nodes[0].targetedTestEvidenceRefs cites incompatible evidence");
    expect(result.errors.join("\n")).toContain("proofGraph.nodes[0].executionEvidenceRefs cites incompatible evidence");
  });

  it("rejects missing nested fields and unknown report properties", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    delete (report.summary as Partial<typeof report.summary>).oneLine;
    (report as unknown as Record<string, unknown>).rawDiff = "hidden raw diff";

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("summary.oneLine is required");
    expect(result.errors.join("\n")).toContain("report.rawDiff is not allowed");
  });

  it("rejects non-object array items and invalid enum values", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.requirements = ["not a requirement"] as never;
    report.testing.ciStatus = "green" as never;

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("requirements[0] must be an object");
    expect(result.errors.join("\n")).toContain("testing.ciStatus is invalid");
  });

  it("rejects oversized strings and arrays", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.summary.topRisks = Array.from({ length: 21 }, (_, index) => `risk ${index}`);
    report.evidenceIndex[0].summary = "x".repeat(3001);

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("summary.topRisks must contain at most 20 items");
    expect(result.errors.join("\n")).toContain("evidenceIndex[0].summary must be at most 3000 characters");
  });

  it("rejects malformed nested objects without throwing", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    (report as unknown as Record<string, unknown>).testing = "failed";
    (report as unknown as Record<string, unknown>).reprompt = null;
    (report as unknown as Record<string, unknown>).evidenceIndex = [null];

    const result = validateVerificationReport(report);

    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("testing must be an object");
    expect(result.errors.join("\n")).toContain("reprompt must be an object");
    expect(result.errors.join("\n")).toContain("evidenceIndex[0] must be an object");
  });
});

function githubInventoryProvenance(): NonNullable<ReturnType<typeof generateVerificationReport>["source"]["provenance"]> {
  return {
    version: 1,
    origin: "github_snapshot",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    evidenceCapturedAt: "2026-08-11T00:00:00.000Z",
    changedFileInventory: { version: 1, completeness: "complete", headSha: "a".repeat(40) },
    inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
  };
}
