import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadExternalPrBatchSmokeCases,
  runExternalPrBatchSmoke
} from "./external-pr-batch-smoke.mjs";

describe("external-pr-batch-smoke", () => {
  it("loads a fixed 25-public-PR collection without labels or raw PR content", () => {
    const cases = loadExternalPrBatchSmokeCases();

    expect(cases).toHaveLength(25);
    expect(new Set(cases.map((testCase) => testCase.id)).size).toBe(25);
    expect(new Set(cases.map((testCase) => testCase.prUrl)).size).toBe(25);
    expect(cases.every((testCase) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(testCase.prUrl))).toBe(true);
    expect(cases.every((testCase) => !/RengGyu\/AgentProof/i.test(testCase.prUrl))).toBe(true);

    const serialized = JSON.stringify(cases);
    expect(serialized).not.toMatch(/expected|oracle|label|outcome|manual|raw|token|secret/i);
  });

  it("requires a runtime GitHub token before a 25-PR collection run", async () => {
    await expect(runExternalPrBatchSmoke({
      baseUrl: "https://agentproof-git-test-renggyus-projects.vercel.app",
      cases: sampleCases(),
      pilotFixturePath: reviewedPilotFixturePath()
    })).rejects.toThrow("requires a GitHub token");
  });

  it("keeps a case failure bounded while collecting the rest of the batch", async () => {
    const calls = [];
    const result = await runExternalPrBatchSmoke({
      baseUrl: "https://agentproof-git-test-renggyus-projects.vercel.app",
      githubToken: "github_pat_example_token",
      cases: sampleCases(),
      pilotFixturePath: reviewedPilotFixturePath(),
      analyzePr: async ({ prUrl }) => {
        calls.push(prUrl);
        if (prUrl.endsWith("/2")) throw new Error("GitHub API rate limit was reached until tomorrow.");
        return {
          priority: "medium",
          confidence: 0.6,
          evidenceCoverage: 40,
          ciStatus: "unknown",
          requirementCount: 2,
          evidenceCount: 3,
          limitationCount: 1,
          qualityGate: { ok: true }
        };
      }
    });

    expect(calls).toEqual(sampleCases().map((testCase) => testCase.prUrl));
    expect(result).toEqual(expect.objectContaining({
      version: 1,
      privacy: "external-pr-batch-run-summary-only",
      caseCount: 20,
      analyzedCount: 19,
      failedCount: 1,
      releaseState: "no_go"
    }));
    expect(result.results).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "external-pr-batch-one", state: "analyzed", qualityGate: "passed" }),
      expect.objectContaining({ id: "external-pr-batch-two", state: "failed", reasonCode: "github_rate_limited" })
    ]));
    expect(JSON.stringify(result)).not.toContain("github_pat_example_token");
    expect(JSON.stringify(result)).not.toContain("until tomorrow");
  });

  it("refuses to send a runtime GitHub token to the production domain", async () => {
    await expect(runExternalPrBatchSmoke({
      baseUrl: "https://agentproof-pearl.vercel.app",
      githubToken: "github_pat_example_token",
      cases: sampleCases(),
      pilotFixturePath: reviewedPilotFixturePath()
    })).rejects.toThrow("preview deployment");
  });

  it("refuses an arbitrary HTTPS host before it can receive the runtime GitHub token", async () => {
    let called = false;
    await expect(runExternalPrBatchSmoke({
      baseUrl: "https://attacker.example",
      githubToken: "github_pat_example_token",
      cases: sampleCases(),
      pilotFixturePath: reviewedPilotFixturePath(),
      analyzePr: async () => {
        called = true;
        throw new Error("should not run");
      }
    })).rejects.toThrow("preview deployment");
    expect(called).toBe(false);
  });

  it("requires completed five-case pilot labels before a 25-PR expansion", async () => {
    await expect(runExternalPrBatchSmoke({
      baseUrl: "https://agentproof-git-test-renggyus-projects.vercel.app",
      githubToken: "github_pat_example_token",
      cases: sampleCases(),
      pilotFixturePath: pendingPilotFixturePath(),
      analyzePr: async () => ({ qualityGate: { ok: true } })
    })).rejects.toThrow("five-case pilot labels");
  });
});

function sampleCases() {
  return Array.from({ length: 20 }, (_, index) => ({
    id: index === 0 ? "external-pr-batch-one" : index === 1 ? "external-pr-batch-two" : `external-pr-batch-${index + 1}`,
    prUrl: `https://github.com/public/repository/pull/${index + 1}`
  }));
}

const fixtureDirectories = [];
afterAll(() => fixtureDirectories.forEach((directory) => rmSync(directory, { recursive: true, force: true })));

function reviewedPilotFixturePath() {
  return writePilotFixture("reviewed");
}

function pendingPilotFixturePath() {
  return writePilotFixture("pending_reviewer_confirmation");
}

function writePilotFixture(labelStatus) {
  const directory = mkdtempSync(join(tmpdir(), "agentproof-external-pr-pilot-"));
  fixtureDirectories.push(directory);
  const fixturePath = join(directory, "pilot.json");
  writeFileSync(fixturePath, JSON.stringify({
    schemaVersion: "external-pr-pilot.v1",
    privacy: "external-pr-pilot-metadata-only",
    cases: Array.from({ length: 5 }, () => ({ manualLabels: { labelStatus } }))
  }));
  return fixturePath;
}
