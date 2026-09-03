import { describe, expect, it, vi } from "vitest";
import {
  captureExternalPrCorpusSnapshot,
  externalPrCandidatesFromDocuments
} from "./refresh-external-pr-corpus.mjs";

describe("refresh-external-pr-corpus", () => {
  it("combines the three public source sets into 25 unique URL-only candidates", () => {
    const candidates = externalPrCandidatesFromDocuments(sourceDocuments());

    expect(candidates).toHaveLength(25);
    expect(candidates[0]).toEqual({
      id: "pilot-1",
      cohort: "pilot",
      repository: "public/pilot",
      prNumber: 1,
      prUrl: "https://github.com/public/pilot/pull/1"
    });
    expect(new Set(candidates.map((candidate) => candidate.prUrl)).size).toBe(25);
    expect(JSON.stringify(candidates)).not.toContain("publicTaskContext");
    expect(JSON.stringify(candidates)).not.toContain("manualLabels");
  });

  it("captures a public PR anchor without retaining title, body, paths, logs, or tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      html_url: "https://github.com/public/pilot/pull/1",
      state: "closed",
      draft: false,
      merged_at: "2026-08-31T00:00:00Z",
      updated_at: "2026-08-31T00:01:00Z",
      changed_files: 3,
      base: { sha: "b".repeat(40), repo: { private: false } },
      head: { sha: "a".repeat(40) }
    }));

    const snapshot = await captureExternalPrCorpusSnapshot({
      candidates: [externalPrCandidatesFromDocuments(sourceDocuments())[0]],
      observedAt: "2026-08-31T00:02:00.000Z",
      fetchImpl: fetchMock
    });

    expect(snapshot).toEqual(expect.objectContaining({
      version: 1,
      status: "ready",
      privacy: "external-pr-live-corpus-anchor-summary-only",
      observedAt: "2026-08-31T00:02:00.000Z",
      candidateCount: 1
    }));
    expect(snapshot.cases[0]).toEqual(expect.objectContaining({
      id: "pilot-1",
      cohort: "pilot",
      prUrl: "https://github.com/public/pilot/pull/1",
      captureStatus: "captured",
      anchor: {
        headSha: "a".repeat(40),
        baseSha: "b".repeat(40)
      },
      pullRequest: {
        state: "closed",
        draft: false,
        mergedAt: "2026-08-31T00:00:00Z",
        updatedAt: "2026-08-31T00:01:00Z",
        changedFileCount: 3
      }
    }));
    expect(snapshot.cases[0].anchorFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(snapshot)).not.toMatch(/title|body|path|log|token/i);
  });

  it("fails closed when a candidate is no longer confirmed public", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      html_url: "https://github.com/public/pilot/pull/1",
      state: "closed",
      draft: false,
      merged_at: null,
      updated_at: "2026-08-31T00:01:00Z",
      changed_files: 3,
      base: { sha: "b".repeat(40), repo: { private: true } },
      head: { sha: "a".repeat(40) }
    }));

    const snapshot = await captureExternalPrCorpusSnapshot({
      candidates: [externalPrCandidatesFromDocuments(sourceDocuments())[0]],
      observedAt: "2026-08-31T00:02:00.000Z",
      fetchImpl: fetchMock
    });

    expect(snapshot.status).toBe("incomplete");
    expect(snapshot.cases[0]).toEqual(expect.objectContaining({
      captureStatus: "not_public",
      anchor: null,
      pullRequest: null
    }));
  });
});

function sourceDocuments() {
  const pilot = {
    cases: Array.from({ length: 5 }, (_, index) => ({
      id: `pilot-${index + 1}`,
      reportInput: {
        pullRequestUrl: `https://github.com/public/pilot/pull/${index + 1}`,
        repository: "public/pilot",
        pullRequestNumber: index + 1,
        publicTaskContext: "must never enter the candidate list"
      },
      manualLabels: { requirementStatus: "must never enter the candidate list" }
    }))
  };
  const blind = candidateDocument("blind", "public/blind", 6);
  const roleproof = candidateDocument("roleproof", "public/roleproof", 16);

  return { pilot, blind, roleproof };
}

function candidateDocument(prefix, repository, firstNumber) {
  return {
    candidates: Array.from({ length: 10 }, (_, index) => ({
      id: `${prefix}-${index + 1}`,
      repository,
      prNumber: firstNumber + index,
      prUrl: `https://github.com/${repository}/pull/${firstNumber + index}`,
      prTitle: "must never enter the candidate list",
      manualLabelTemplate: { requirementOutcome: "must never enter the candidate list" }
    }))
  };
}
