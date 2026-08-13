import { describe, expect, it } from "vitest";
import { reportToMarkdown } from "./markdown";
import { buildShareUrl, decodeSharedReport, encodeReportForShare, sanitizeReportForShare, SUMMARY_ONLY_LIMITATION } from "./report-share";
import { validateVerificationReport } from "./report-validation";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport, generateVerificationReportV2FromInput } from "./verifier";

const PLANNER_INPUT_HASH = "0123456789abcdef".repeat(4);

describe("report share", () => {
  it("round-trips a v2 no-contract report without leaking a private integrity digest", () => {
    const report = generateVerificationReportV2FromInput(demoScenarios.clean);
    const sanitized = sanitizeReportForShare(report);

    expect(validateVerificationReport(sanitized, { mode: "v2_summary" })).toEqual({ valid: true, errors: [] });
    const decoded = decodeSharedReport(encodeReportForShare(report));

    expect(decoded).toMatchObject({
      reportSchemaVersion: "verification-report.v2",
      verificationContract: { state: "absent" }
    });
    expect(JSON.stringify(decoded)).not.toContain("verificationBindingDigest");
    expect(validateVerificationReport(decoded, { mode: "v2_summary" })).toEqual({ valid: true, errors: [] });
  });

  it("emits an exact version-3 envelope with neutral hashless planning provenance", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.planner = { version: 1, contractVersion: "hybrid_requirement_planner.v1", schemaVersion: "agentproof_requirement_span_plan_v1", promptVersion: "2026-08-12.v1", model: "gpt-5-mini", inputHash: PLANNER_INPUT_HASH };
    for (const requirement of report.requirements) requirement.classificationBasis = "enhanced_plan";
    report.requirements[0]!.plannerAxisSubjects = ["documentation"];
    report.requirements[0]!.proofAxes = [{ subject: "documentation", polarity: "present", state: "incomplete", evidenceRefs: [] }];
    for (const node of report.proofGraph.nodes) node.classificationBasis = "enhanced_plan";

    const payload = encodeReportForShare(report);
    const envelope = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const shared = decodeSharedReport(payload);
    const sanitized = sanitizeReportForShare(report);

    expect(envelope.version).toBe(3);
    expect(Object.keys(envelope).sort()).toEqual([
      "createdAt", "limitations", "planner", "proofGraph", "requirements", "reviewPriority", "scope", "source", "summary", "testing", "version"
    ]);
    expect(envelope.planner).toEqual({
      version: 1,
      contractVersion: "hybrid_requirement_planner.v1",
      schemaVersion: "agentproof_requirement_span_plan_v1",
      promptVersion: "2026-08-12.v1",
      model: "gpt-5-mini"
    });
    expect(JSON.stringify(envelope)).not.toContain("inputHash");
    expect(JSON.stringify(envelope)).not.toContain(PLANNER_INPUT_HASH);
    expect(Object.hasOwn(shared.planner!, "inputHash")).toBe(false);
    expect(Object.hasOwn(sanitized.planner!, "inputHash")).toBe(false);
    expect(JSON.stringify(shared)).not.toContain(PLANNER_INPUT_HASH);
    expect(JSON.stringify(sanitized)).not.toContain(PLANNER_INPUT_HASH);
    expect(reportToMarkdown(shared)).toContain("Enhanced planning policy");
    expect(shared.authenticity?.trust).toBe("portable_unverified");
    expect(shared.requirements[0]).toMatchObject({ classificationBasis: "enhanced_plan", plannerAxisSubjects: ["documentation"] });
    expect(shared.proofGraph.nodes[0]).toMatchObject({ classificationBasis: "enhanced_plan" });
  });
  it("round-trips a summary-only report without raw evidence or re-prompt text", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.evidenceIndex.push({
      id: "ev_annotation_secret",
      kind: "check",
      label: "unit tests",
      summary: "Check annotations: failure at src/private/auth.test.ts:42. raw_details annotation message with ghp_secret_should_not_leak",
      confidence: 0.9
    });
    report.claims.push({
      id: "claim_annotation_secret",
      text: "Annotation raw_details retained sk-secret_should_not_leak",
      evidenceRefs: ["ev_annotation_secret"],
      supported: false
    });
    report.proofGraph.nodes[0].implementationEvidenceRefs = ["ev_annotation_secret"];
    report.proofGraph.nodes[0].gapSignals.push({
      kind: "missing_execution",
      severity: "medium",
      message: "Patch excerpt raw_details should not survive summary sharing.",
      evidenceRefs: ["ev_annotation_secret"]
    });
    report.reprompt.prompt = "raw_details re-prompt with github_pat_secret_should_not_leak";
    const payload = encodeReportForShare(report);
    const shared = decodeSharedReport(payload);
    const serialized = JSON.stringify(shared);

    expect(shared.source.title).toBe(report.source.title);
    expect(shared.requirements).toHaveLength(report.requirements.length);
    expect(shared.requirements[0]?.proofAxes).toEqual(report.requirements[0]?.proofAxes?.map((axis) => ({
      ...axis,
      evidenceRefs: []
    })));
    expect(shared.evidenceIndex).toHaveLength(0);
    expect(shared.claims).toHaveLength(0);
    expect(shared.scope.provenance).toBeUndefined();
    expect(shared.testing.missingTests.every((item) => item.provenance === undefined)).toBe(true);
    expect(shared.reprompt.prompt).not.toContain("Explain or revert");
    expect(shared.testing.missingTests.every((item) => item.evidenceRefs.length === 0)).toBe(true);
    expect(shared.reviewPriority.every((item) => !item.evidenceRefs || item.evidenceRefs.length === 0)).toBe(true);
    expect(shared.requirements.every((requirement) =>
      requirement.proofAxes?.every((axis) => axis.evidenceRefs.length === 0) ?? true
    )).toBe(true);
    expect(shared.proofGraph.nodes.every((node) =>
      node.implementationEvidenceRefs.length === 0 &&
      node.targetedTestEvidenceRefs.length === 0 &&
      node.executionEvidenceRefs.length === 0 &&
      node.gapSignals.every((gap) => gap.evidenceRefs.length === 0)
    )).toBe(true);
    expect(serialized).not.toContain("Patch excerpt");
    expect(serialized).not.toContain("raw_details");
    expect(serialized).not.toContain("src/private/auth.test.ts:42");
    expect(serialized).not.toContain("ghp_secret_should_not_leak");
    expect(serialized).not.toContain("sk-secret_should_not_leak");
    expect(serialized).not.toContain("github_pat_secret_should_not_leak");
    expect(serialized).not.toContain("ev_");
    expect(validateVerificationReport(shared, { mode: "summary" })).toEqual({ valid: true, errors: [] });
  });

  it("preserves PR-description authority separately from evidence coverage", () => {
    const report = generateVerificationReport({
      title: "Add retry label",
      taskText: "",
      description: "## Requirements\n- Add a retry status label.",
      changedFiles: [{ path: "src/retry-label.ts", status: "added", patch: "+ export const retryLabel = () => 'Retry';" }],
      checks: [{ name: "retry label tests", status: "passed", summary: "retry label tests passed" }],
      logs: [{ source: "retry label tests", status: "passed", text: "retry label tests passed" }]
    });

    const shared = decodeSharedReport(encodeReportForShare(report));

    expect(report.requirements[0]).toMatchObject({ sourceAuthority: "pr_description" });
    expect(shared.requirements[0]).toMatchObject({
      sourceAuthority: "pr_description",
      evidenceStatus: report.requirements[0]?.evidenceStatus
    });
    expect(validateVerificationReport(shared, { mode: "summary" })).toEqual({ valid: true, errors: [] });
  });

  it("redacts retained summary fields before sharing", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    report.source.title = "PR with github_pat_secret_should_not_leak_1234567890";
    report.summary.oneLine = "Summary with sk-secret_should_not_leak";
    report.summary.topRisks = ["Risk includes https://hooks.slack.com/services/T000/B000/secret"];
    report.requirements[0].requirementText = "Requirement has token=secret_should_not_leak";
    report.requirements[0].gaps = ["Gap has Bearer abc.def.ghi"];
    report.requirements[0].reviewerNote = "Note has AKIAABCDEFGHIJKLMNOP";
    report.testing.missingTests.push({ path: "src/test.ts", why: "Needs test", evidenceRefs: [] });
    report.reviewPriority.push({ path: "src/review.ts", reason: "Needs review", priority: "medium" });
    report.testing.missingTests[0].path = "src/github_pat_secret_should_not_leak_1234567890/test.ts";
    report.testing.missingTests[0].why = "Reason has api_key=secret_should_not_leak";
    report.reviewPriority[0].reason = "Review has -----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----";
    report.limitations.push("Limitation has password=secret_should_not_leak");

    const shared = decodeSharedReport(encodeReportForShare(report));
    const serialized = JSON.stringify(shared);

    expect(serialized).toContain("[redacted]");
    expect(serialized).not.toContain("github_pat_secret");
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("hooks.slack.com/services");
    expect(serialized).not.toContain("Bearer abc");
    expect(serialized).not.toContain("AKIA");
    expect(serialized).not.toContain("BEGIN PRIVATE KEY");
    expect(serialized).not.toContain("secret_should_not_leak");
    expect(validateVerificationReport(shared, { mode: "summary" })).toEqual({ valid: true, errors: [] });
  });

  it("builds a portable share URL", () => {
    const report = generateVerificationReport(demoScenarios["clean"]);
    const url = buildShareUrl(report, "https://agentproof.example");

    expect(url).toContain("https://agentproof.example/reports/share#report=");
  });

  it("does not duplicate the summary-only limitation when re-sharing sanitized reports", () => {
    const report = generateVerificationReport(demoScenarios["scope-creep"]);
    const reshared = sanitizeReportForShare(sanitizeReportForShare(report));
    const summaryOnlyLimitations = reshared.limitations.filter((limitation) => limitation === SUMMARY_ONLY_LIMITATION);

    expect(summaryOnlyLimitations).toHaveLength(1);
  });

  it("omits semantic LLM analysis from portable share payloads", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.semanticAnalysis = { status: "unavailable", attempts: 2 };
    report.semantic = {
      requirement_evidence_relations: [],
      requirement_assessments: [{
        requirement_id: report.requirements[0]!.requirementId,
        requirement_summary: "Review the supplied evidence for this requirement.",
        evidence_support: "no_evidence_found",
        summary: "No supplied evidence directly supports this requirement.",
        evidence_ids: [],
        uncertainty: "high"
      }],
      evidence_gaps: [],
      review_targets: [],
      remediation_requests: [],
      uncertainties: []
    };

    const shared = decodeSharedReport(encodeReportForShare(report));

    expect(shared.semantic).toBeUndefined();
    expect(shared.semanticAnalysis).toBeUndefined();
    expect(JSON.stringify(shared)).not.toContain("No supplied evidence directly supports this requirement.");
  });

  it("preserves direct deterministic scope state and snapshot provenance even when top risks omit scope wording", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.scope = {
      suspected: true,
      outOfScopeFiles: ["src/unrelated.ts"],
      reasons: ["Changed file is unrelated to the declared requirement."],
      evidenceRefs: [report.evidenceIndex[0].id]
    };
    report.summary.topRisks = ["Risk one", "Risk two", "Risk three", "Risk four", "Risk five"];
    report.source.provenance = {
      version: 1,
      origin: "github_snapshot",
      headSha: "a".repeat(40),
      changedFileInventory: {
        version: 1,
        completeness: "complete",
        headSha: "a".repeat(40)
      },
      evidenceCapturedAt: "2026-07-12T00:00:00.000Z",
      inputFingerprint: {
        version: 1,
        algorithm: "sha256",
        value: "b".repeat(64),
        coverage: "github_metadata"
      }
    };

    const shared = decodeSharedReport(encodeReportForShare(report));

    expect(shared.scope).toEqual({
      suspected: true,
      outOfScopeFiles: ["src/unrelated.ts"],
      reasons: ["Changed file is unrelated to the declared requirement."]
    });
    expect(shared.source.provenance).toEqual(report.source.provenance);
    expect(Object.hasOwn(sanitizeReportForShare(report).source.provenance!, "baseSha")).toBe(false);
    expect(shared.authenticity?.trust).toBe("portable_unverified");
    expect(shared.limitations.join("\n")).toContain("unverified");
  });

  it("rejects malformed portable payloads before they can render as reports", () => {
    const payload = Buffer.from(JSON.stringify({ version: 2 }), "utf8").toString("base64url");

    expect(() => decodeSharedReport(payload)).toThrow("Shared report");
  });

  it("rejects unknown planner, finding, and proof-node fields before portable sanitization", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.planner = { version: 1, contractVersion: "hybrid_requirement_planner.v1", schemaVersion: "agentproof_requirement_span_plan_v1", promptVersion: "2026-08-12.v1", model: "gpt-5-mini", inputHash: PLANNER_INPUT_HASH };
    for (const requirement of report.requirements) requirement.classificationBasis = "enhanced_plan";
    for (const node of report.proofGraph.nodes) node.classificationBasis = "enhanced_plan";
    const envelope = JSON.parse(Buffer.from(encodeReportForShare(report), "base64url").toString("utf8")) as Record<string, unknown>;

    const injections: Array<[Record<string, unknown>, string]> = [
      [envelope.planner as Record<string, unknown>, "rawPlan"],
      [(envelope.requirements as Array<Record<string, unknown>>)[0]!, "rawFinding"],
      [((envelope.proofGraph as { nodes: Array<Record<string, unknown>> }).nodes)[0]!, "rawNode"]
    ];
    for (const [target, key] of injections) {
      target[key] = "must-reject";
      const payload = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
      expect(() => decodeSharedReport(payload)).toThrow("Shared report");
      delete target[key];
    }
    (envelope.planner as Record<string, unknown>).inputHash = PLANNER_INPUT_HASH;
    expect(() => decodeSharedReport(Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url"))).toThrow("Shared report");
    delete (envelope.planner as Record<string, unknown>).inputHash;
    expect(() => decodeSharedReport(encodeReportForShare(report))).not.toThrow();
  });

  it("decodes historical version-2 planner provenance safely and re-shares without its input hash", () => {
    const report = generateVerificationReport(demoScenarios.clean);
    report.planner = { version: 1, contractVersion: "hybrid_requirement_planner.v1", schemaVersion: "agentproof_requirement_span_plan_v1", promptVersion: "2026-08-12.v1", model: "gpt-5-mini", inputHash: PLANNER_INPUT_HASH };
    for (const requirement of report.requirements) requirement.classificationBasis = "enhanced_plan";
    for (const node of report.proofGraph.nodes) node.classificationBasis = "enhanced_plan";
    const historical = JSON.parse(Buffer.from(encodeReportForShare(report), "base64url").toString("utf8")) as Record<string, unknown>;
    historical.version = 2;
    (historical.planner as Record<string, unknown>).inputHash = PLANNER_INPUT_HASH;

    const decoded = decodeSharedReport(Buffer.from(JSON.stringify(historical), "utf8").toString("base64url"));
    const reshared = JSON.parse(Buffer.from(encodeReportForShare(decoded), "base64url").toString("utf8")) as Record<string, unknown>;

    expect(decoded.authenticity?.trust).toBe("portable_unverified");
    expect(decoded.planner).toBeDefined();
    expect(Object.hasOwn(decoded.planner!, "inputHash")).toBe(false);
    expect(JSON.stringify(decoded)).not.toContain(PLANNER_INPUT_HASH);
    expect(reshared.version).toBe(3);
    expect(JSON.stringify(reshared)).not.toContain("inputHash");
    expect(JSON.stringify(reshared)).not.toContain(PLANNER_INPUT_HASH);
  });

  it("continues to decode the legacy version-1 portable envelope", () => {
    const envelope = JSON.parse(Buffer.from(encodeReportForShare(generateVerificationReport(demoScenarios.clean)), "base64url").toString("utf8")) as Record<string, unknown>;
    envelope.version = 1;
    delete envelope.scope;
    delete envelope.planner;
    const legacyPayload = Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");

    expect(decodeSharedReport(legacyPayload).authenticity?.trust).toBe("legacy_unverified");
  });

  it("does not retain raw linked issue body evidence in share summaries", () => {
    const rawIssueBody = "RAW_LINKED_ISSUE_BODY_SHOULD_NOT_SHARE";
    const report = generateVerificationReport({
      ...demoScenarios.clean,
      taskSource: "issue",
      taskText: [
        "Linked issue acme/repo#42: Reject expired reset links",
        "Acceptance criteria:",
        "- Reject expired reset links.",
        "```text",
        rawIssueBody,
        "```"
      ].join("\n")
    });
    const shared = sanitizeReportForShare(report);
    const serialized = JSON.stringify(shared);

    expect(report.evidenceIndex.some((item) => item.summary.includes(rawIssueBody))).toBe(true);
    expect(serialized).not.toContain(rawIssueBody);
    expect(serialized).not.toContain("Linked issue acme/repo#42");
    expect(shared.evidenceIndex).toEqual([]);
  });
});
