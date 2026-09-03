import { describe, expect, it } from "vitest";
import {
  GENERAL_PR_OBSERVATION_MAX_SOURCE_VIEW_BYTES,
  buildGeneralPrObservationSeedV2,
  canonicalizeGeneralPrObservationCollectionsV1,
  validateGeneralPrObservationSeedV2
} from "./general-pr-observation-source";
import type { PullRequestInput } from "./types";

function input(overrides: Partial<PullRequestInput> = {}): PullRequestInput {
  return {
    title: "Return Ready when checks pass",
    description: "## Change\nThe service must return Ready when checks pass.",
    taskText: "",
    changedFiles: [{ path: "src/status.ts", status: "modified", patch: "export const status = 'Ready';" }],
    checks: [],
    logs: [],
    ...overrides
  };
}

function permutations<T>(items: readonly T[]): T[][] {
  return items.length < 2
    ? [[...items]]
    : items.flatMap((item, index) => permutations(items.filter((_, other) => other !== index)).map((tail) => [item, ...tail]));
}

describe("buildGeneralPrObservationSeedV2", () => {
  it("keeps the full seed invariant under file and check permutations", () => {
    const original = input({
      changedFiles: [
        { path: "src/z.ts", status: "modified" },
        { path: "test/z.test.ts", status: "added" },
        { path: "docs/a.md", status: "modified" }
      ],
      checks: [
        { name: "z-unit", status: "passed" },
        { name: "a-lint", status: "passed" },
        { name: "b-type", status: "passed" }
      ]
    });
    const untouched = structuredClone(original);
    const expected = buildGeneralPrObservationSeedV2(original);

    for (const changedFiles of permutations(original.changedFiles)) {
      for (const checks of permutations(original.checks)) {
        expect(buildGeneralPrObservationSeedV2({ ...original, changedFiles, checks })).toEqual(expected);
      }
    }
    expect(original).toEqual(untouched);
  });

  it("copies, orders, and preserves duplicate collection records", () => {
    const original = input({
      changedFiles: [
        { path: "src\\z.ts", status: "modified" },
        { path: "src/a.ts", status: "added" }
      ],
      checks: [
        { name: "same", status: "passed", workflowExecutionIdentity: { version: 1, kind: "workflow_execution_identity", workflowPath: ".github/z.yml", workflowName: "z", workflowId: 1, runId: 2, runAttempt: 1, jobId: 3, jobName: "z", headSha: "a".repeat(40), checkEvidenceRef: "z" } },
        { name: "same", status: "passed", workflowExecutionIdentity: { version: 1, kind: "workflow_execution_identity", workflowPath: ".github/a.yml", workflowName: "a", workflowId: 4, runId: 5, runAttempt: 2, jobId: 6, jobName: "a", headSha: "a".repeat(40), checkEvidenceRef: "a" } },
        { name: "duplicate", status: "passed" },
        { name: "duplicate", status: "passed" }
      ]
    });
    const untouched = structuredClone(original);
    const canonical = canonicalizeGeneralPrObservationCollectionsV1(original);

    expect(canonical).toEqual(canonicalizeGeneralPrObservationCollectionsV1(canonical));
    expect(canonical.changedFiles).toHaveLength(original.changedFiles.length);
    expect(canonical.checks).toHaveLength(original.checks.length);
    expect(canonical.checks.filter((check) => check.name === "duplicate")).toHaveLength(2);
    expect(canonical.checks.map((check) => check.workflowExecutionIdentity?.workflowPath).filter(Boolean)).toEqual([".github/a.yml", ".github/z.yml"]);
    expect(original).toEqual(untouched);
  });

  it("does not mutate frozen records and keeps canonical records by reference", () => {
    const files = Object.freeze([Object.freeze({ path: "src/z.ts", status: "modified" as const }), Object.freeze({ path: "src/a.ts", status: "added" as const })]);
    const checks = Object.freeze([Object.freeze({ name: "same", status: "passed" as const, workflowExecutionIdentity: { version: 1 as const, kind: "workflow_execution_identity" as const, workflowPath: ".github/a.yml", workflowName: "a", workflowId: 1, runId: 2, runAttempt: 1, jobId: 3, jobName: "a", headSha: "a".repeat(40), checkEvidenceRef: "a" } })]);
    const canonical = canonicalizeGeneralPrObservationCollectionsV1({ changedFiles: files as unknown as PullRequestInput["changedFiles"], checks: checks as unknown as PullRequestInput["checks"] });

    expect(canonical.changedFiles).toEqual([files[1], files[0]]);
    expect(canonical.changedFiles[0]).toBe(files[1]);
    expect(canonical.checks[0]).toBe(checks[0]);
  });

  it("still changes the seed for every covered field mutation", () => {
    const base = input({
      sourceProvenance: {
        version: 1,
        origin: "github_snapshot",
        baseSha: "a".repeat(40),
        headSha: "b".repeat(40),
        changedFileInventory: { version: 1, completeness: "complete", headSha: "b".repeat(40) },
        evidenceCapturedAt: "2026-09-04T00:00:00.000Z",
        inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
      },
      description: "First source sentence.\n\nSecond source sentence.",
      checks: [{ name: "unit", status: "passed", workflowExecutionIdentity: { version: 1, kind: "workflow_execution_identity", workflowPath: ".github/a.yml", workflowName: "a", workflowId: 1, runId: 2, runAttempt: 1, jobId: 3, jobName: "unit", headSha: "b".repeat(40), checkEvidenceRef: "a" } }]
    });
    const expected = buildGeneralPrObservationSeedV2(base).seedHash;
    const changes = [
      { ...base, sourceProvenance: { ...base.sourceProvenance!, headSha: "d".repeat(40), changedFileInventory: { ...base.sourceProvenance!.changedFileInventory!, headSha: "d".repeat(40) } } },
      { ...base, sourceProvenance: { ...base.sourceProvenance!, baseSha: "d".repeat(40) } },
      { ...base, description: "Different source." },
      { ...base, description: "Second source sentence.\n\nFirst source sentence." },
      { ...base, requirementSourceIdentityHash: "d".repeat(64) },
      { ...base, changedFiles: [{ ...base.changedFiles[0]!, path: "src/renamed-status.ts" }] },
      { ...base, changedFiles: [{ ...base.changedFiles[0]!, previousPath: "src/old-status.ts" }] },
      { ...base, checks: [{ ...base.checks[0]!, name: "renamed-unit" }] },
      { ...base, checks: [{ ...base.checks[0]!, status: "failed" as const }] },
      { ...base, sourceProvenance: { ...base.sourceProvenance!, changedFileInventory: { ...base.sourceProvenance!.changedFileInventory!, completeness: "incomplete" as const } } },
      ...(["workflowPath", "workflowId", "runId", "runAttempt", "jobId"] as const).map((field) => ({ ...base, checks: [{ ...base.checks[0]!, workflowExecutionIdentity: { ...base.checks[0]!.workflowExecutionIdentity!, [field]: field === "workflowPath" ? ".github/b.yml" : base.checks[0]!.workflowExecutionIdentity![field] + 1 } }] }))
    ];

    for (const changed of changes) expect(buildGeneralPrObservationSeedV2(changed).seedHash).not.toBe(expected);
  });

  it("creates a separately bound author-claim title source when the PR has no authoritative source", () => {
    const seed = buildGeneralPrObservationSeedV2(input({ description: "" }));

    expect(seed.sources).toHaveLength(1);
    expect(seed.sources[0]).toMatchObject({ kind: "pr_title", authority: "author_claim", roleCeiling: "objective" });
    expect(seed.spans).toEqual(expect.arrayContaining([
      expect.objectContaining({ structuralKind: "title", authorityCeiling: "author_claim" })
    ]));
    expect(JSON.stringify(seed)).not.toContain("Return Ready when checks pass");
  });

  it("keeps title and body as separate fallback sources without changing their authority", () => {
    const seed = buildGeneralPrObservationSeedV2(input({
      taskSource: "issue",
      taskText: "The service must return Ready when checks pass.",
      description: "This PR adds the label."
    }));

    expect(seed.sources.map((source) => [source.kind, source.authority, source.roleCeiling, source.admissionTier])).toEqual([
      ["linked_issue", "authoritative", "objective", "primary"],
      ["pr_title", "author_claim", "objective", "fallback"],
      ["pr_body", "author_claim", "objective", "fallback"]
    ]);
    expect(seed.sources[1]?.sourceContentHash).not.toBe(seed.sources[2]?.sourceContentHash);
  });

  it("keeps fallback PR spans eligible without granting linked-Issue authority", () => {
    const seed = buildGeneralPrObservationSeedV2(input({
      taskSource: "issue",
      taskText: "The service must return Ready when checks pass."
    }));
    const fallbackSourceIds = new Set(seed.sources.filter((source) => source.admissionTier === "fallback").map((source) => source.id));

    expect(seed.spans.filter((span) => fallbackSourceIds.has(span.sourceUnitId)).every((span) => (
      span.authorityCeiling === "author_claim"
    ))).toBe(true);
  });

  it("keeps templates, comments, code, risk, follow-up, and test claims out of deterministic objectives", () => {
    const seed = buildGeneralPrObservationSeedV2(input({
      description: [
        "<!-- The service must return Ready. -->",
        "```ts\nconst result = 'Ready';\n```",
        "Risk: low; revert is easy.",
        "A follow-up will add analytics.",
        "pnpm test passed."
      ].join("\n\n")
    }));

    expect(seed.spans.filter((span) => span.deterministicRole === "objective_candidate")).toHaveLength(1);
    expect(seed.spans.map((span) => span.deterministicRole)).toEqual(expect.arrayContaining([
      "template_or_process", "risk_or_revert", "follow_up", "test_claim"
    ]));
  });

  it("changes the seed hash whenever raw source, redacted source, or subject identity changes", () => {
    const base = input({
      sourceProvenance: {
        version: 1,
        origin: "github_snapshot",
        headSha: "h1",
        baseSha: "b1",
        evidenceCapturedAt: "2026-08-31T00:00:00.000Z",
        inputFingerprint: { version: 1, algorithm: "sha256", value: "a".repeat(64), coverage: "github_metadata" }
      }
    });
    const changedRaw = { ...base, description: `${base.description}\n\nToken: sk-123456789` };
    const changedSubject = { ...base, sourceProvenance: { ...base.sourceProvenance!, headSha: "h2" } };

    expect(buildGeneralPrObservationSeedV2(base).seedHash).not.toBe(buildGeneralPrObservationSeedV2(changedRaw).seedHash);
    expect(buildGeneralPrObservationSeedV2(base).seedHash).not.toBe(buildGeneralPrObservationSeedV2(changedSubject).seedHash);
  });

  it("retains collected workflow identity only as an incomplete execution observation until its immutable workflow source is available", () => {
    const headSha = "a".repeat(40);
    const seed = buildGeneralPrObservationSeedV2(input({
      url: "https://github.com/acme/example/pull/17",
      checks: [{
        name: "unit-test",
        status: "passed",
        workflowExecutionIdentity: {
          version: 1,
          kind: "workflow_execution_identity",
          workflowPath: ".github/workflows/verify.yml",
          workflowName: "Verification",
          workflowId: 3101,
          runId: 4101,
          runAttempt: 2,
          jobId: 7101,
          jobName: "unit-test",
          headSha,
          checkEvidenceRef: "ev_3"
        }
      }],
      sourceProvenance: {
        version: 1,
        origin: "github_snapshot",
        baseSha: "b".repeat(40),
        headSha,
        changedFileInventory: { version: 1, completeness: "complete", headSha },
        evidenceCapturedAt: "2026-08-31T00:00:00.000Z",
        inputFingerprint: { version: 1, algorithm: "sha256", value: "c".repeat(64), coverage: "github_metadata" }
      }
    }));
    const serialized = JSON.stringify(seed);

    expect(seed.executions).toHaveLength(1);
    expect(seed.executions[0]).toMatchObject({
      runId: "4101",
      runAttempt: 2,
      jobId: "7101",
      completeness: "incomplete"
    });
    expect(seed.evidenceAtoms.some((atom) => atom.kind === "execution")).toBe(true);
    expect(serialized).not.toContain(".github/workflows/verify.yml");
    expect(serialized).not.toContain("unit-test");
  });

  it("rejects duplicate IDs, tampered ranges and incomplete identity that claims completeness", () => {
    const seed = buildGeneralPrObservationSeedV2(input());
    const duplicate = { ...seed, spans: [...seed.spans, { ...seed.spans[0]! }] };
    const tampered = { ...seed, spans: seed.spans.map((span, index) => index === 0 ? { ...span, end: span.start } : span) };
    const incompleteAsComplete = { ...seed, headSha: null, completeness: "complete" as const };

    expect(validateGeneralPrObservationSeedV2(duplicate).valid).toBe(false);
    expect(validateGeneralPrObservationSeedV2(tampered).valid).toBe(false);
    expect(validateGeneralPrObservationSeedV2(incompleteAsComplete).valid).toBe(false);
  });

  it("fails closed for unsupported source text, oversized source views, and overlapping span bindings", () => {
    const unsupported = buildGeneralPrObservationSeedV2(input({ description: `The service must return Ready.${String.fromCharCode(0xd800)}` }));
    const oversized = buildGeneralPrObservationSeedV2(input({ description: "x".repeat(GENERAL_PR_OBSERVATION_MAX_SOURCE_VIEW_BYTES + 1) }));
    const normal = buildGeneralPrObservationSeedV2(input({ description: "The service must return Ready.\n\nThe service must show status." }));
    const sameSource = normal.spans.filter((span) => span.sourceUnitId === normal.sources.find((source) => source.kind === "pr_body")?.id);
    if (sameSource.length < 2) throw new Error("fixture must include two body spans");
    const overlapping = {
      ...normal,
      spans: normal.spans.map((span) => span.id === sameSource[1]!.id ? { ...span, start: sameSource[0]!.start + 1 } : span)
    };

    expect(unsupported.parseState).toBe("incomplete");
    expect(unsupported.spans.some((span) => span.sourceUnitId === unsupported.sources.find((source) => source.kind === "pr_body")?.id)).toBe(false);
    expect(oversized.parseState).toBe("incomplete");
    expect(oversized.spans.some((span) => span.sourceUnitId === oversized.sources.find((source) => source.kind === "pr_body")?.id)).toBe(false);
    expect(validateGeneralPrObservationSeedV2(overlapping)).toMatchObject({ valid: false, errors: expect.arrayContaining(["span ranges overlap"]) });
  });
});
