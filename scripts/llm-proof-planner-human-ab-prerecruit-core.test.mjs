import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256, stableJson, validateHoldoutReceiptV2 } from "./llm-proof-planner-human-ab-v2-core.mjs";
import {
  HOLDOUT_EXCLUSION_REGISTRY_VERSION,
  HOLDOUT_POLICY_VERSION,
  HOLDOUT_PRIVATE_MANIFEST_VERSION,
  buildSeededAssignmentPlan,
  buildFreezeManifestFromLocalEvidence,
  deriveLocalFreezeEvidence,
  HUMAN_AB_V2_LABEL_HEADERS,
  inspectRaterWorkbookOoxml,
  sealHoldout,
  validateHoldoutExclusionRegistry,
  validateHoldoutPrivateManifest,
  validateHoldoutSelectionPolicy
} from "./llm-proof-planner-human-ab-prerecruit-core.mjs";
import { assignFiles, sealFiles } from "./llm-proof-planner-human-ab-prerecruit.mjs";

const temporary = [];
afterEach(() => temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));

function fixture() {
  const policy = {
    policyVersion: HOLDOUT_POLICY_VERSION,
    policyId: "selection-v1",
    experimentId: "experiment-001",
    sourceCommit: "a".repeat(40),
    discoveryCutoff: "2026-07-11T00:00:00.000Z",
    samplingUnit: "pull_request_head",
    strata: [{ stratumId: "service-change", quota: 1 }, { stratumId: "ui-change", quota: 1 }],
    requiredExclusionSets: ["dev10", "prompt-tuning", "manual-pilot"],
    replacementRule: "pre_output_unavailable_only"
  };
  const registry = {
    registryVersion: HOLDOUT_EXCLUSION_REGISTRY_VERSION,
    policyId: policy.policyId,
    sets: [
      { setId: "dev10", entries: [{ sourceIdentitySha256: "1".repeat(64), taskInputFingerprint: "2".repeat(64), normalizedCaseSha256: "3".repeat(64) }] },
      { setId: "prompt-tuning", entries: [] },
      { setId: "manual-pilot", entries: [] }
    ]
  };
  const privateManifest = {
    manifestVersion: HOLDOUT_PRIVATE_MANIFEST_VERSION,
    status: "ready_to_seal",
    policySha256: sha256(stableJson(policy)),
    experimentId: policy.experimentId,
    sourceCommit: policy.sourceCommit,
    sealedAt: "2026-07-11T01:00:00.000Z",
    exclusionRegistrySha256: sha256(stableJson(registry)),
    outputsObserved: false,
    replacements: [],
    cases: [
      { opaqueCaseId: "case-001", stratumId: "service-change", sourceIdentitySha256: "4".repeat(64), taskInputFingerprint: "5".repeat(64), normalizedCaseSha256: "6".repeat(64) },
      { opaqueCaseId: "case-002", stratumId: "ui-change", sourceIdentitySha256: "7".repeat(64), taskInputFingerprint: "8".repeat(64), normalizedCaseSha256: "9".repeat(64) }
    ]
  };
  return { policy, registry, privateManifest };
}

describe("Human A/B pre-recruit holdout sealing", () => {
  it("seals a policy-bound private manifest into an identity-free v2 receipt", () => {
    const { policy, registry, privateManifest } = fixture();
    expect(validateHoldoutSelectionPolicy(policy)).toEqual({ valid: true, errors: [] });
    expect(validateHoldoutExclusionRegistry(registry, policy)).toEqual({ valid: true, errors: [] });
    expect(validateHoldoutPrivateManifest(privateManifest, policy, registry)).toEqual({ valid: true, errors: [] });
    const sealed = sealHoldout({ policy, registry, privateManifest, holdoutId: "holdout-001", normalizerVersion: "normalizer-v1" });
    expect(validateHoldoutReceiptV2(sealed.receipt)).toEqual({ valid: true, errors: [] });
    expect(JSON.stringify(sealed.receipt)).not.toContain("sourceIdentity");
    expect(JSON.stringify(sealed.receipt)).not.toContain("taskInput");
    expect(JSON.stringify(sealed.receipt)).not.toContain("normalizedCase");
    expect(sealed.receipt.sealedCaseSetSha256).toBe(sha256(sealed.sealedCaseSetText));
  });

  it("fails closed for a missing exclusion set, duplicate input, excluded case, wrong quota, or post-output replacement", () => {
    const { policy, registry, privateManifest } = fixture();
    const missing = structuredClone(registry);
    missing.sets.pop();
    expect(validateHoldoutExclusionRegistry(missing, policy).valid).toBe(false);
    const duplicate = structuredClone(privateManifest);
    duplicate.cases[1].taskInputFingerprint = duplicate.cases[0].taskInputFingerprint;
    expect(validateHoldoutPrivateManifest(duplicate, policy, registry).valid).toBe(false);
    const excluded = structuredClone(privateManifest);
    excluded.cases[0].sourceIdentitySha256 = "1".repeat(64);
    expect(validateHoldoutPrivateManifest(excluded, policy, registry).valid).toBe(false);
    const wrongQuota = structuredClone(privateManifest);
    wrongQuota.cases[1].stratumId = "service-change";
    expect(validateHoldoutPrivateManifest(wrongQuota, policy, registry).valid).toBe(false);
    const afterOutput = structuredClone(privateManifest);
    afterOutput.outputsObserved = true;
    afterOutput.replacements = ["pre_output_unavailable_only"];
    expect(() => sealHoldout({ policy, registry, privateManifest: afterOutput, holdoutId: "holdout-001", normalizerVersion: "normalizer-v1" })).toThrow("before any model or reviewer output");
  });

  it("refuses an in-repository private manifest path and never writes over a receipt", () => {
    const { policy, registry, privateManifest } = fixture();
    const outside = mkdtempSync(join(tmpdir(), "agentproof-holdout-"));
    temporary.push(outside);
    const policyPath = join(outside, "policy.json");
    const registryPath = join(outside, "registry.json");
    const privatePath = join(outside, "private.json");
    const receiptPath = join(outside, "receipt.json");
    writeFileSync(policyPath, stableJson(policy));
    writeFileSync(registryPath, stableJson(registry));
    writeFileSync(privatePath, stableJson(privateManifest));
    expect(sealFiles({ policyPath, registryPath, privateManifestPath: privatePath, holdoutId: "holdout-001", normalizerVersion: "normalizer-v1", receiptPath }).caseCount).toBe(2);
    expect(validateHoldoutReceiptV2(JSON.parse(readFileSync(receiptPath, "utf8"))).valid).toBe(true);
    expect(() => sealFiles({ policyPath, registryPath, privateManifestPath: privatePath, holdoutId: "holdout-001", normalizerVersion: "normalizer-v1", receiptPath })).toThrow("No-clobber");
  });
});

describe("Human A/B pre-recruit local freeze evidence", () => {
  it("recomputes source cleanliness and exact named file hashes instead of trusting caller hashes", () => {
    const cwd = process.cwd();
    const bindings = {
      protocolSha256: "docs/llm-proof-planner-human-ab-v2.md",
      plannerSourceSha256: "src/lib/llm-proof-planner.ts",
      promptSha256: "src/lib/llm-proof-planner.ts",
      plannerSchemaSha256: "src/lib/llm-proof-planner.ts",
      evaluationHarnessSha256: "scripts/llm-proof-planner-ab.mjs",
      baselineSourceSha256: "eval/llm-proof-planner-semantic-integrity-results.json",
      automaticTimerRunnerSha256: "scripts/llm-proof-planner-human-ab-v2-runner.mjs"
    };
    const evidence = deriveLocalFreezeEvidence({ cwd, fileBindings: bindings });
    expect(evidence.source).toMatchObject({ commit: expect.stringMatching(/^[0-9a-f]{40}$/), workingTreeDirty: true, reproducibleFromCommit: false });
    expect(Object.values(evidence.hashes).filter((value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value))).toHaveLength(7);
    const config = { sourceCommit: evidence.source.commit, generatedAt: "2026-07-11T01:00:00.000Z", fileBindings: bindings, planner: {}, workbooks: {}, assignment: {}, holdout: {} };
    const manifest = buildFreezeManifestFromLocalEvidence({ cwd, config });
    expect(manifest.source).toEqual(evidence.source);
    expect(manifest.status).toBe("prepared_not_frozen");
    expect(manifest.blockers).toContain("source_not_clean_and_reproducible");
  });
});

describe("Human A/B pre-recruit assignment randomization", () => {
  it("derives a replayable, seed-committed plan without giving one rater both arms of a case", () => {
    const { policy, registry, privateManifest } = fixture();
    const { receipt } = sealHoldout({ policy, registry, privateManifest, holdoutId: "holdout-001", normalizerVersion: "normalizer-v1" });
    const first = buildSeededAssignmentPlan({ holdoutReceipt: receipt, opaqueCaseIds: ["case-001", "case-002"], raterPseudonyms: ["rater-1", "rater-2", "rater-3", "rater-4"], seed: "private-seed-value-1234" });
    const second = buildSeededAssignmentPlan({ holdoutReceipt: receipt, opaqueCaseIds: ["case-002", "case-001"], raterPseudonyms: ["rater-4", "rater-3", "rater-2", "rater-1"], seed: "private-seed-value-1234" });
    expect(first.plan).toEqual(second.plan);
    expect(first.preflight.passed).toBe(true);
    expect(first.randomizationReceipt.seedCommitmentSha256).toBe(sha256("private-seed-value-1234"));
    expect(JSON.stringify(first.randomizationReceipt)).not.toContain("private-seed-value-1234");
    const exposures = new Set(first.plan.assignments.map((row) => `${row.raterPseudonym}:${row.opaqueCaseId}`));
    expect(exposures.size).toBe(first.plan.assignments.length);
  });

  it("writes only no-clobber coordinator artifacts from private case, roster, and seed inputs", () => {
    const { policy, registry, privateManifest } = fixture();
    const directory = mkdtempSync(join(tmpdir(), "agentproof-assignment-"));
    temporary.push(directory);
    const policyPath = join(directory, "policy.json");
    const registryPath = join(directory, "registry.json");
    const privatePath = join(directory, "private.json");
    const receiptPath = join(directory, "receipt.json");
    const casesPath = join(directory, "cases.json");
    const rosterPath = join(directory, "roster.json");
    const seedPath = join(directory, "seed.txt");
    const planPath = join(directory, "plan.json");
    const preflightPath = join(directory, "preflight.json");
    const randomizationPath = join(directory, "randomization.json");
    writeFileSync(policyPath, stableJson(policy)); writeFileSync(registryPath, stableJson(registry)); writeFileSync(privatePath, stableJson(privateManifest));
    sealFiles({ policyPath, registryPath, privateManifestPath: privatePath, holdoutId: "holdout-001", normalizerVersion: "normalizer-v1", receiptPath });
    writeFileSync(casesPath, stableJson(["case-001", "case-002"])); writeFileSync(rosterPath, stableJson(["rater-1", "rater-2", "rater-3", "rater-4"])); writeFileSync(seedPath, "private-seed-value-1234\n");
    expect(assignFiles({ receiptPath, caseIdsPath: casesPath, rosterPath, seedPath, planPath, preflightPath, randomizationReceiptPath: randomizationPath })).toMatchObject({ assignmentCount: 8, seedCommitmentSha256: sha256("private-seed-value-1234") });
    expect(JSON.stringify(JSON.parse(readFileSync(randomizationPath, "utf8")))).not.toContain("private-seed-value-1234");
    expect(() => assignFiles({ receiptPath, caseIdsPath: casesPath, rosterPath, seedPath, planPath, preflightPath, randomizationReceiptPath: randomizationPath })).toThrow("No-clobber");
  });
});

describe("Human A/B pre-recruit workbook OOXML QA", () => {
  it("requires the exact v2 Labels header, serialized frozen header pane, and no formulas/macros/external links", () => {
    const shared = HUMAN_AB_V2_LABEL_HEADERS.map((value) => `<si><t>${value}</t></si>`).join("");
    const cells = HUMAN_AB_V2_LABEL_HEADERS.map((_, index) => `<c r="${column(index + 1)}1" t="s"><v>${index}</v></c>`).join("");
    const entries = {
      "xl/workbook.xml": '<workbook><sheets><sheet name="Labels" r:id="rId2"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
      "xl/sharedStrings.xml": `<sst>${shared}</sst>`,
      "xl/worksheets/sheet2.xml": `<worksheet><sheetViews><sheetView><pane ySplit="1" state="frozen"/></sheetView></sheetViews><sheetData><row r="1">${cells}</row></sheetData></worksheet>`
    };
    expect(inspectRaterWorkbookOoxml(entries)).toMatchObject({ serializedFreezePaneVerified: true, macrosAbsent: true, externalLinksAbsent: true, formulasAbsent: true });
    expect(inspectRaterWorkbookOoxml({ ...entries, "xl/worksheets/sheet2.xml": entries["xl/worksheets/sheet2.xml"].replace('state="frozen"', "") }).serializedFreezePaneVerified).toBe(false);
    expect(inspectRaterWorkbookOoxml({ ...entries, "xl/worksheets/sheet2.xml": `${entries["xl/worksheets/sheet2.xml"]}<f>1</f>`, "xl/vbaProject.bin": "binary", "xl/externalLinks/externalLink1.xml": "link" })).toMatchObject({ formulasAbsent: false, macrosAbsent: false, externalLinksAbsent: false });
  });
});

function column(index) { let value = ""; for (let current = index; current > 0; current = Math.floor((current - 1) / 26)) value = String.fromCharCode(65 + ((current - 1) % 26)) + value; return value; }
