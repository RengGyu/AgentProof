import { describe, expect, it } from "vitest";
import {
  GENERAL_PR_OBSERVATION_MAX_SOURCE_VIEW_BYTES,
  buildGeneralPrObservationSeedV2,
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

describe("buildGeneralPrObservationSeedV2", () => {
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
