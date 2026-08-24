import { createHash } from "crypto";
import { describe, expect, it } from "vitest";
import * as evidenceRelation from "./evidence-relation";
import { validateVerificationReport } from "./report-validation";
import { generateVerificationReportV2FromInput } from "./verifier";
import type { PullRequestInput } from "./types";

const HEAD_SHA = "a".repeat(40);

type ResolverInput = {
  testPath: string;
  testPatch: string;
  importSpecifier: string;
  headSha: string;
  subject?: string;
  target: {
    version: 1;
    kind: "resolved_head_module";
    headSha: string;
    path: string;
    blobSha: string;
    source: string;
  };
};

type Resolver = (input: ResolverInput) => null | {
  bindingLocalName: string;
  distinctLiteralCaseCount: number;
  receipt: {
    version: 1;
    kind: "exact_head_target";
    exportKind: "named" | "default" | "commonjs";
    headSha: string;
    targetPathDigest: string;
    targetBlobSha: string;
    canonicalBindingDigest: string;
  };
};

function resolve(input: ResolverInput) {
  const resolver = (evidenceRelation as unknown as { resolveExactHeadTarget?: Resolver }).resolveExactHeadTarget;
  return resolver ? resolver(input) : null;
}

function namedTarget(overrides: Partial<ResolverInput> = {}): ResolverInput {
  const result: ResolverInput = {
    testPath: "test/repository-name-regression.test.js",
    testPatch: [
      "+import assert from 'node:assert/strict';",
      "+import { repositoryName as formatName } from '../src/repositories/name.js';",
      "+test('formats a name', () => { assert.equal(formatName(false), 'agentproof'); });"
    ].join("\n"),
    importSpecifier: "../src/repositories/name.js",
    headSha: HEAD_SHA,
    target: {
      version: 1,
      kind: "resolved_head_module",
      headSha: HEAD_SHA,
      path: "src/repositories/name.js",
      blobSha: "",
      source: "const implementation = value => value ? 'AgentProof' : 'agentproof';\nexport { implementation as repositoryName };"
    },
    ...overrides
  };
  if (overrides.target?.blobSha === undefined) result.target.blobSha = gitBlobSha(result.target.source);
  return result;
}

function gitBlobSha(source: string) {
  return createHash("sha1").update(`blob ${Buffer.byteLength(source, "utf8")}\0`).update(source).digest("hex");
}

function targetWithSource(source: string) {
  return { ...namedTarget().target, source, blobSha: gitBlobSha(source) };
}

describe("resolveExactHeadTarget", () => {
  it("resolves one asserted named alias against the unchanged exact-head module", () => {
    const target = resolve(namedTarget());

    expect(target).toMatchObject({
      bindingLocalName: "formatName",
      distinctLiteralCaseCount: 1,
      receipt: {
        version: 1,
        kind: "exact_head_target",
        headSha: HEAD_SHA,
        targetBlobSha: namedTarget().target.blobSha,
        exportKind: "named",
        targetPathDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        canonicalBindingDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    });
  });

  it("keeps no-subject exact-head resolution when one sibling import is not asserted", () => {
    const target = resolve(namedTarget({
      testPatch: [
        "+import assert from 'node:assert/strict';",
        "+import { legacyLabel, repositoryName as formatName } from '../src/repositories/name.js';",
        "+test('formats a name', () => { assert.equal(formatName(false), 'agentproof'); });"
      ].join("\n"),
      target: targetWithSource([
        "const repositoryName = value => value ? 'AgentProof' : 'agentproof';",
        "const legacyLabel = value => String(value);",
        "export { legacyLabel, repositoryName };"
      ].join("\n"))
    }));

    expect(target).toMatchObject({
      bindingLocalName: "formatName",
      distinctLiteralCaseCount: 1,
      receipt: expect.objectContaining({ exportKind: "named" })
    });
  });

  it.each([
    {
      name: "quoted asserted call",
      input: namedTarget({
        testPatch: [
          "+import { repositoryName as formatName } from '../src/repositories/name.js';",
          "+test('quotes a call', () => { expect('formatName(false)').toBe('formatName(false)'); });"
        ].join("\n")
      })
    },
    {
      name: "regex-literal asserted call",
      input: namedTarget({
        testPatch: [
          "+import { repositoryName as formatName } from '../src/repositories/name.js';",
          "+test('matches call text', () => { expect(/formatName(false)/.test('fixture')).toBe(true); });"
        ].join("\n")
      })
    },
    {
      name: "commented asserted call",
      input: namedTarget({
        testPatch: [
          "+import { repositoryName as formatName } from '../src/repositories/name.js';",
          "+test('comments a call', () => { expect(/* formatName(false) */ true).toBe(true); });"
        ].join("\n")
      })
    },
    {
      name: "quoted export phrase",
      input: namedTarget({
        target: targetWithSource("const fixture = 'export function repositoryName(value) {}';")
      })
    },
    {
      name: "commented export phrase",
      input: namedTarget({
        target: targetWithSource("// export function repositoryName(value) {}\nconst fixture = true;")
      })
    },
    {
      name: "regex-literal export phrase",
      input: namedTarget({
        target: targetWithSource("const fixture = /export function repositoryName(value) {}/;")
      })
    },
    {
      name: "CommonJS re-export barrel",
      input: namedTarget({
        target: targetWithSource("const repositoryName = require('./implementation.js');\nexport { repositoryName };")
      })
    },
    {
      name: "CommonJS re-export declaration",
      input: namedTarget({
        target: targetWithSource("export const repositoryName = require('./implementation.js');")
      })
    },
    {
      name: "CommonJS derived alias barrel",
      input: namedTarget({
        target: targetWithSource([
          "const implementation = require('./implementation.js');",
          "const repositoryName = implementation.repositoryName;",
          "export { repositoryName };"
        ].join("\n"))
      })
    },
    {
      name: "CommonJS imported identifier alias barrel",
      input: namedTarget({
        target: targetWithSource([
          "const implementation = require('./implementation.js');",
          "const repositoryName = implementation;",
          "export { repositoryName };"
        ].join("\n"))
      })
    },
    {
      name: "ESM imported identifier alias barrel",
      input: namedTarget({
        target: targetWithSource([
          "import { implementation } from './implementation.js';",
          "const repositoryName = implementation;",
          "export { repositoryName };"
        ].join("\n"))
      })
    },
    {
      name: "second explicit relative import",
      input: namedTarget({
        testPatch: [
          "+import { repositoryName as formatName } from '../src/repositories/name.js';",
          "+import { unrelatedHelper } from '../src/repositories/unrelated.js';",
          "+test('formats a name', () => { expect(formatName(false)).toBe('agentproof'); });"
        ].join("\n")
      })
    },
    {
      name: "second unresolved relative import",
      input: namedTarget({
        testPatch: [
          "+import { repositoryName as formatName } from '../src/repositories/name.js';",
          "+import { unresolvedHelper } from '../src/repositories/unresolved';",
          "+test('formats a name', () => { expect(formatName(false)).toBe('agentproof'); });"
        ].join("\n")
      })
    },
    {
      name: "second side-effect relative import",
      input: namedTarget({
        testPatch: [
          "+import '../src/setup.js';",
          "+import { repositoryName as formatName } from '../src/repositories/name.js';",
          "+test('formats a name', () => { expect(formatName(false)).toBe('agentproof'); });"
        ].join("\n")
      })
    },
    {
      name: "second property-access require",
      input: namedTarget({
        testPatch: [
          "+import { repositoryName as formatName } from '../src/repositories/name.js';",
          "+const setup = require('../src/setup.js').helper;",
          "+test('formats a name', () => { expect(formatName(false)).toBe('agentproof'); });"
        ].join("\n")
      })
    },
    {
      name: "barrel re-export",
      input: namedTarget({
        target: targetWithSource("export { repositoryName } from './repository-name-implementation.js';")
      })
    },
    {
      name: "mocked target",
      input: namedTarget({
        testPatch: [
          "+import { vi } from 'vitest';",
          "+vi.mock('../src/repositories/name.js');",
          "+import { repositoryName as formatName } from '../src/repositories/name.js';",
          "+test('formats a name', () => { expect(formatName(false)).toBe('agentproof'); });"
        ].join("\n")
      })
    },
    {
      name: "dynamic import",
      input: namedTarget({
        testPatch: "+test('formats a name', async () => { const { repositoryName } = await import('../src/repositories/name.js'); expect(repositoryName(false)).toBe('agentproof'); });"
      })
    },
    {
      name: "unmatched identifier",
      input: namedTarget({
        testPatch: [
          "+import { repositoryName as formatName } from '../src/repositories/name.js';",
          "+test('formats a name', () => { expect(missingName(false)).toBe('agentproof'); });"
        ].join("\n")
      })
    },
    {
      name: "ambiguous asserted targets",
      input: namedTarget({
        testPatch: [
          "+import { repositoryName as formatName } from '../src/repositories/name.js';",
          "+import { legacyName } from '../src/repositories/legacy-name.js';",
          "+test('formats a name', () => { expect(formatName(false)).toBe(legacyName(false)); });"
        ].join("\n")
      })
    },
    {
      name: "unrelated imported binding",
      input: namedTarget({
        testPatch: [
          "+import { repositoryName as formatName, repositorySlug } from '../src/repositories/name.js';",
          "+test('formats a slug', () => { expect(repositorySlug(false)).toBe('agentproof'); });"
        ].join("\n")
      })
    },
    {
      name: "stale target head",
      input: namedTarget({ target: { ...namedTarget().target, headSha: "c".repeat(40) } })
    },
    {
      name: "stale target blob",
      input: namedTarget({ target: { ...namedTarget().target, blobSha: "c".repeat(40) } })
    },
    {
      name: "invalid target blob identity",
      input: namedTarget({ target: { ...namedTarget().target, blobSha: "stale" } })
    }
  ])("fails closed for $name", ({ input }) => {
    expect(resolve(input)).toBeNull();
  });

  it.each([
    {
      name: "default export",
      input: namedTarget({
        testPatch: [
          "+import formatName from '../src/repositories/name.js';",
          "+test('formats a name', () => { expect(formatName(false)).toBe('agentproof'); });"
        ].join("\n"),
        target: targetWithSource("export default function repositoryName(value) { return String(value); }")
      }),
      exportKind: "default"
    },
    {
      name: "CommonJS export",
      input: namedTarget({
        testPatch: [
          "+const formatName = require('../src/repositories/name.js');",
          "+test('formats a name', () => { expect(formatName(false)).toBe('agentproof'); });"
        ].join("\n"),
        target: targetWithSource("module.exports = function repositoryName(value) { return String(value); };")
      }),
      exportKind: "commonjs"
    }
  ])("accepts one direct $name", ({ input, exportKind }) => {
    expect(resolve(input)?.receipt.exportKind).toBe(exportKind);
  });
});

describe("exact test-relation subject binding", () => {
  it("does not treat prose test as an explicit code subject for a target named test", () => {
    const testPath = "test/repository-name-regression.test.js";
    const moduleSource = "export function test(value) { return String(value).toLowerCase(); }";
    const report = generateVerificationReportV2FromInput({
      title: "Add repository name regression coverage",
      description: "Adds focused regression coverage.",
      taskText: "Acceptance criteria: add a regression test for repositoryName(value).",
      taskSource: "issue",
      changedFiles: [{
        path: testPath,
        status: "added",
        patch: [
          "+import { test as targetTest } from '../src/repositories/name.js';",
          "+it('formats a repository name', () => { expect(targetTest('AgentProof')).toBe('agentproof'); });"
        ].join("\n")
      }],
      checks: [{ name: "unit-tests", status: "passed", summary: "Unit tests passed." }],
      logs: [{ source: "GitHub Actions job: unit-tests", status: "passed", text: "npm test passed." }],
      sourceProvenance: {
        version: 1,
        origin: "github_snapshot",
        headSha: HEAD_SHA,
        baseSha: "b".repeat(40),
        evidenceCapturedAt: "2026-08-17T00:00:00.000Z",
        changedFileInventory: { version: 1, completeness: "complete", headSha: HEAD_SHA },
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
        blobSha: gitBlobSha(moduleSource),
        source: moduleSource
      }]
    } satisfies PullRequestInput);

    expect(report.requirements[0]?.proofAxes).toEqual(expect.arrayContaining([
      expect.objectContaining({ subject: "targeted_test", state: "incomplete", evidenceRefs: [] })
    ]));
    expect(report.proofGraph.exactHeadTargetReceipts).toBeUndefined();
    expect(report.proofGraph.testRelationReceipts).toBeUndefined();
    expect(validateVerificationReport(report, { mode: "v2_full" })).toEqual({ valid: true, errors: [] });
  });

  it.each([
    { text: "Add normalize behavior.", expected: null },
    { text: "Add `normalize` behavior.", expected: "current_requirement" },
    { text: "Add normalize(value) behavior.", expected: "current_requirement" }
  ] as const)("binds a lowercase symbol only from explicit code notation: $text", ({ text, expected }) => {
    expect(evidenceRelation.exactTestRelationSubjectSource({
      currentRequirementText: text,
      target: { bindingExportedName: "normalize", bindingLocalName: "normalize" }
    })).toBe(expected);
  });
});

describe("bounded v2 test-relation parser context", () => {
  const bindings = [
    {
      version: 1 as const,
      kind: "requirement_source_binding" as const,
      id: "binding_subject",
      requirementId: "req_subject",
      spanId: "sp_1_1" as const,
      seedId: "seed",
      groupId: "grp_1" as const,
      source: "issue" as const,
      ordinal: 1
    },
    {
      version: 1 as const,
      kind: "requirement_source_binding" as const,
      id: "binding_current",
      requirementId: "req_current",
      spanId: "sp_2_2" as const,
      seedId: "seed",
      groupId: "grp_1" as const,
      source: "issue" as const,
      ordinal: 2
    }
  ];

  it("creates one changed-target antecedent candidate only from adjacent closed bindings", () => {
    const candidate = evidenceRelation.boundedTestRelationCandidate({
      testFile: {
        path: "test/repository-name.test.js",
        patch: [
          "+import { repositoryName } from '../src/repositories/name.js';",
          "+expect(repositoryName('AgentProof')).toBe('agentproof');"
        ].join("\n")
      },
      subject: "repositoryName",
      requirementId: "req_current",
      currentRequirementText: "Add focused tests.",
      requirementTexts: new Map([
        ["req_subject", "Add `repositoryName` behavior."],
        ["req_current", "Add focused tests."]
      ]),
      targetMode: "changed_target",
      relation: {
        version: 1,
        kind: "test_antecedent",
        antecedentRequirementId: "req_subject",
        currentSourceBindingRef: "binding_current",
        antecedentSourceBindingRef: "binding_subject"
      },
      sourceBindings: bindings
    });

    expect(candidate).toMatchObject({
      subjectSource: "test_antecedent",
      directAssertionCount: 1,
      subjectDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      importBindingDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
    });
    expect(JSON.stringify(candidate)).not.toContain("repositoryName");
  });

  it("rejects an imported subject that does not match the closed antecedent requirement", () => {
    expect(evidenceRelation.boundedTestRelationCandidate({
      testFile: {
        path: "test/repository-name.test.js",
        patch: [
          "+import { repositoryName } from '../src/repositories/name.js';",
          "+expect(repositoryName('AgentProof')).toBe('agentproof');"
        ].join("\n")
      },
      subject: "repositoryName",
      requirementId: "req_current",
      currentRequirementText: "Add focused tests.",
      requirementTexts: new Map([
        ["req_subject", "Add `repositorySlug` behavior."],
        ["req_current", "Add focused tests."]
      ]),
      targetMode: "changed_target",
      relation: {
        version: 1,
        kind: "test_antecedent",
        antecedentRequirementId: "req_subject",
        currentSourceBindingRef: "binding_current",
        antecedentSourceBindingRef: "binding_subject"
      },
      sourceBindings: bindings
    })).toBeNull();
  });

  it("changes candidate digests when the stable source identity changes", () => {
    const input = {
      testFile: {
        path: "test/repository-name.test.js",
        patch: [
          "+import { repositoryName } from '../src/repositories/name.js';",
          "+expect(repositoryName('AgentProof')).toBe('agentproof');"
        ].join("\n")
      },
      subject: "repositoryName",
      requirementId: "req_current",
      currentRequirementText: "Add focused tests.",
      requirementTexts: new Map([
        ["req_subject", "Add `repositoryName` behavior."],
        ["req_current", "Add focused tests."]
      ]),
      targetMode: "changed_target" as const,
      relation: {
        version: 1 as const,
        kind: "test_antecedent" as const,
        antecedentRequirementId: "req_subject",
        currentSourceBindingRef: "binding_current",
        antecedentSourceBindingRef: "binding_subject"
      }
    };
    const first = evidenceRelation.boundedTestRelationCandidate({ ...input, sourceBindings: bindings });
    const replay = evidenceRelation.boundedTestRelationCandidate({
      ...input,
      sourceBindings: bindings.map((binding) => ({ ...binding, seedId: "different_seed" }))
    });

    expect(first).not.toBeNull();
    expect(replay).not.toBeNull();
    expect(replay?.subjectDigest).not.toBe(first?.subjectDigest);
    expect(replay?.importBindingDigest).not.toBe(first?.importBindingDigest);
  });

  it("creates one changed-target subject-chain candidate only from three adjacent closed bindings", () => {
    const candidate = evidenceRelation.boundedTestRelationCandidate({
      testFile: {
        path: "test/repository-name.test.js",
        patch: [
          "+import { repositoryName } from '../src/repositories/name.js';",
          "+expect(repositoryName('AgentProof')).toBe('agentproof');"
        ].join("\n")
      },
      subject: "repositoryName",
      requirementId: "req_current",
      currentRequirementText: "Add focused tests.",
      requirementTexts: new Map([
        ["req_subject", "Add `repositoryName` behavior."],
        ["req_current", "Add focused tests."]
      ]),
      targetMode: "changed_target",
      relation: {
        version: 1,
        kind: "test_subject_chain",
        subjectRequirementId: "req_subject",
        bridgeRequirementId: "req_bridge",
        currentSourceBindingRef: "binding_current",
        subjectSourceBindingRef: "binding_subject",
        bridgeSourceBindingRef: "binding_bridge"
      },
      sourceBindings: [
        bindings[0]!,
        { ...bindings[1]!, id: "binding_bridge", requirementId: "req_bridge", spanId: "sp_2_2", ordinal: 2 },
        { ...bindings[1]!, ordinal: 3 }
      ]
    });

    expect(candidate).toMatchObject({ subjectSource: "test_subject_chain", directAssertionCount: 1 });
  });

  it.each([
    {
      name: "non-adjacent source bindings",
      sourceBindings: [{ ...bindings[1]!, ordinal: 3 }, bindings[0]!],
      relation: {
        version: 1 as const,
        kind: "test_antecedent" as const,
        antecedentRequirementId: "req_subject",
        currentSourceBindingRef: "binding_current",
        antecedentSourceBindingRef: "binding_subject"
      }
    },
    {
      name: "subjectless exact-head objective",
      sourceBindings: bindings,
      targetMode: "exact_head_target" as const,
      relation: undefined
    }
  ])("rejects a $name", ({ sourceBindings, relation, targetMode = "changed_target" }) => {
    expect(evidenceRelation.boundedTestRelationCandidate({
      testFile: {
        path: "test/repository-name.test.js",
        patch: [
          "+import { repositoryName } from '../src/repositories/name.js';",
          "+expect(repositoryName('AgentProof')).toBe('agentproof');"
        ].join("\n")
      },
      subject: "repositoryName",
      requirementId: "req_current",
      currentRequirementText: "Add focused tests.",
      requirementTexts: new Map([["req_current", "Add focused tests."]]),
      targetMode: targetMode as "changed_target" | "exact_head_target",
      relation,
      sourceBindings
    })).toBeNull();
  });

  it("requires an explicit current identifier for an exact-head candidate", () => {
    expect(evidenceRelation.boundedTestRelationCandidate({
      testFile: {
        path: "test/repository-name.test.js",
        patch: [
          "+import { repositoryName } from '../src/repositories/name.js';",
          "+expect(repositoryName('AgentProof')).toBe('agentproof');"
        ].join("\n")
      },
      subject: "repositoryName",
      requirementId: "req_current",
      currentRequirementText: "Add a regression test for `repositoryName`.",
      requirementTexts: new Map([["req_current", "Add a regression test for `repositoryName`."]]),
      targetMode: "exact_head_target",
      sourceBindings: [{ ...bindings[1]!, ordinal: 1 }]
    })).toMatchObject({ subjectSource: "current_requirement", directAssertionCount: 1 });
  });

  it("accepts an exact-head current subject from a Task 3 canonical bundle with source bindings empty and no relation", () => {
    const canonical = {
      version: 1 as const,
      inputKind: "selected_source" as const,
      sourceIdentityHash: "a".repeat(64),
      sourceContentHash: "b".repeat(64),
      requirements: [{
        reportRequirementId: "req_current",
        stableBindingKey: "stable_current",
        source: "issue" as const,
        authority: "authoritative" as const,
        groupId: "grp_1",
        ordinal: 1,
        normalizedTextHash: "c".repeat(64),
        text: "Add a regression test for `repositoryName`.",
        priority: "must" as const,
        sourceQuality: "explicit_acceptance_criteria" as const
      }]
    };
    expect(evidenceRelation.boundedTestRelationCandidate({
      testFile: {
        path: "test/repository-name.test.js",
        patch: [
          "+import { repositoryName } from '../src/repositories/name.js';",
          "+expect(repositoryName('AgentProof')).toBe('agentproof');"
        ].join("\n")
      },
      subject: "repositoryName",
      requirementId: "req_current",
      currentRequirementText: "Add a regression test for `repositoryName`.",
      requirementTexts: new Map([["req_current", "Add a regression test for `repositoryName`."]]),
      currentSourceBinding: evidenceRelation.canonicalCurrentRequirementBinding(canonical, "req_current") ?? undefined,
      targetMode: "exact_head_target",
      sourceBindings: []
    })).toMatchObject({ subjectSource: "current_requirement", directAssertionCount: 1 });
  });
});

describe("bounded direct assertion literals", () => {
  const implementationFile = {
    path: "src/repositories/repository-slug.js",
    patch: "+export function repositorySlug(repository) { return `${repository.owner}/${repository.name}`; }"
  };

  it("counts direct assertions with one bounded flat object argument", () => {
    const testFile = {
      path: "test/repository-slug.test.js",
      patch: [
        "+import assert from 'node:assert/strict';",
        "+import { repositorySlug } from '../src/repositories/repository-slug.js';",
        "+test('formats a repository', () => { assert.equal(repositorySlug({ owner: 'RengGyu', name: 'AgentProof' }), 'RengGyu/AgentProof'); });"
      ].join("\n")
    };

    expect(evidenceRelation.distinctDirectAssertionCallCount(testFile, implementationFile)).toBe(1);
  });

  it("does not treat a trailing unrelated call after an expect matcher as a direct assertion", () => {
    const testFile = {
      path: "test/repository-name.test.js",
      patch: [
        "+import { repositoryName } from '../src/repositories/name.js';",
        "+expect(unrelated()).toBe(true); repositoryName(value);",
        "+expect(unrelated()).toBe(true); repositoryName('AgentProof');"
      ].join("\n")
    };
    const implementationFile = {
      path: "src/repositories/name.js",
      patch: "+export function repositoryName(value) { return String(value); }"
    };

    expect(evidenceRelation.distinctDirectAssertionCallCount(testFile, implementationFile, "repositoryName")).toBe(0);
  });

  it.each([
    "test.skip('disabled', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });",
    "it.todo('disabled', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });",
    "test.skip.each([['AgentProof']])('disabled', (value) => { expect(repositoryName(value)).toBe('agentproof'); });",
    "it.todo.each([['AgentProof']])('disabled', (value) => { expect(repositoryName(value)).toBe('agentproof'); });",
    "test.each([['AgentProof']]).skip('disabled', (value) => { expect(repositoryName(value)).toBe('agentproof'); });",
    "test.each([\n+  ['AgentProof']\n+]).skip('disabled', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });",
    "it.each([\n+  ['AgentProof']\n+]).todo('disabled', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });",
    "test.each([\n+  ['AgentProof']\n+]).pending('disabled', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });",
    "test.each`\n+  value\n+  ${'AgentProof'}\n+`.skip('disabled', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });",
    "it.each`\n+  value\n+  ${'AgentProof'}\n+`.todo('disabled', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });",
    "test.each`\n+  value\n+  ${'AgentProof'}\n+`.pending('disabled', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });",
    "if (false) { expect(repositoryName('AgentProof')).toBe('agentproof'); }",
    "test('unreachable return', () => {\n+  return;\n+  expect(repositoryName('AgentProof')).toBe('agentproof');\n+});",
    "test('unreachable throw', () => {\n+  throw new Error('stop');\n+  expect(repositoryName('AgentProof')).toBe('agentproof');\n+});"
  ])("does not count a disabled or unreachable assertion: %s", (assertion) => {
    const testFile = {
      path: "test/repository-name.test.js",
      patch: [
        "+import { repositoryName } from '../src/repositories/name.js';",
        `+${assertion}`
      ].join("\n")
    };
    const implementationFile = {
      path: "src/repositories/name.js",
      patch: "+export function repositoryName(value) { return String(value); }"
    };

    expect(evidenceRelation.distinctDirectAssertionCallCount(testFile, implementationFile, "repositoryName")).toBe(0);
  });

  it.each([
    "test.each([\n+  ['AgentProof']\n+])('formats names', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });",
    "test.each`\n+  value\n+  ${'AgentProof'}\n+`('formats names', () => { expect(repositoryName('AgentProof')).toBe('agentproof'); });"
  ])("retains a non-disabled multiline parameterized assertion: %s", (assertion) => {
    const testFile = {
      path: "test/repository-name.test.js",
      patch: [
        "+import { repositoryName } from '../src/repositories/name.js';",
        `+${assertion}`
      ].join("\n")
    };
    const implementationFile = {
      path: "src/repositories/name.js",
      patch: "+export function repositoryName(value) { return String(value); }"
    };

    expect(evidenceRelation.distinctDirectAssertionCallCount(testFile, implementationFile, "repositoryName")).toBe(1);
  });

  it.each([
    "expect(wrapper(repositoryName('AgentProof'))).toBe('agentproof');",
    "expect(() => repositoryName('AgentProof')).not.toThrow();"
  ])("does not treat a nested wrapper or callback as a direct assertion: %s", (assertion) => {
    const testFile = {
      path: "test/repository-name.test.js",
      patch: [
        "+import { repositoryName } from '../src/repositories/name.js';",
        `+${assertion}`
      ].join("\n")
    };
    const implementationFile = {
      path: "src/repositories/name.js",
      patch: "+export function repositoryName(value) { return String(value); }"
    };

    expect(evidenceRelation.distinctDirectAssertionCallCount(testFile, implementationFile, "repositoryName")).toBe(0);
  });

  it("counts one selected subject binding even when the module import also includes an unrelated sibling", () => {
    const testFile = {
      path: "test/labels.test.js",
      patch: [
        "+import assert from 'node:assert/strict';",
        "+import { legacyLabel, formatLabel } from '../src/labels.js';",
        "+assert.equal(legacyLabel({ name: 'old' }), 'old');",
        "+assert.equal(formatLabel({ owner: 'acme', name: 'app' }), 'acme/app');"
      ].join("\n")
    };
    const implementationFile = {
      path: "src/labels.js",
      patch: "+export function formatLabel(repository) { return `${repository.owner}/${repository.name}`; }"
    };

    expect(evidenceRelation.distinctDirectAssertionCallCount(testFile, implementationFile, "formatLabel")).toBe(1);
  });

  it("counts one selected subject binding through a local alias with an unrelated sibling", () => {
    const testFile = {
      path: "test/labels.test.js",
      patch: [
        "+import assert from 'node:assert/strict';",
        "+import { legacyLabel, formatLabel as renderLabel } from '../src/labels.js';",
        "+assert.equal(legacyLabel({ name: 'old' }), 'old');",
        "+assert.equal(renderLabel({ owner: 'acme', name: 'app' }), 'acme/app');"
      ].join("\n")
    };
    const implementationFile = {
      path: "src/labels.js",
      patch: "+export function formatLabel(repository) { return `${repository.owner}/${repository.name}`; }"
    };

    expect(evidenceRelation.distinctDirectAssertionCallCount(testFile, implementationFile, "formatLabel")).toBe(1);
  });

  it("fails closed when the named subject has no added assertion", () => {
    const testFile = {
      path: "test/labels.test.js",
      patch: [
        "+import assert from 'node:assert/strict';",
        "+import { legacyLabel, formatLabel } from '../src/labels.js';",
        "+assert.equal(legacyLabel({ owner: 'acme', name: 'app' }), 'acme/app');"
      ].join("\n")
    };
    const implementationFile = {
      path: "src/labels.js",
      patch: "+export function formatLabel(repository) { return `${repository.owner}/${repository.name}`; }"
    };

    expect(evidenceRelation.distinctDirectAssertionCallCount(testFile, implementationFile, "formatLabel")).toBe(0);
  });

  it("fails closed when two direct static bindings match the named subject", () => {
    const testFile = {
      path: "test/labels.test.js",
      patch: [
        "+import assert from 'node:assert/strict';",
        "+import { formatLabel, formatLabel as renamedFormatLabel } from '../src/labels.js';",
        "+assert.equal(formatLabel({ owner: 'acme', name: 'app' }), 'acme/app');",
        "+assert.equal(renamedFormatLabel({ owner: 'beta', name: 'svc' }), 'beta/svc');"
      ].join("\n")
    };
    const implementationFile = {
      path: "src/labels.js",
      patch: "+export function formatLabel(repository) { return `${repository.owner}/${repository.name}`; }"
    };

    expect(evidenceRelation.distinctDirectAssertionCallCount(testFile, implementationFile, "formatLabel")).toBe(0);
  });

  it.each([
    "{ ...repository }",
    "{ [key]: 'AgentProof' }",
    "{ owner: ownerName }",
    "{ owner: createOwner() }",
    "{ owner: { name: 'RengGyu' } }",
    "{ owner: `RengGyu${suffix}` }",
    "{ /* owner */ name: 'AgentProof' }"
  ])("rejects a non-static object argument: %s", (argument) => {
    const testFile = {
      path: "test/repository-slug.test.js",
      patch: [
        "+import assert from 'node:assert/strict';",
        "+import { repositorySlug } from '../src/repositories/repository-slug.js';",
        `+test('formats a repository', () => { assert.equal(repositorySlug(${argument}), 'RengGyu/AgentProof'); });`
      ].join("\n")
    };

    expect(evidenceRelation.distinctDirectAssertionCallCount(testFile, implementationFile)).toBe(0);
  });
});
