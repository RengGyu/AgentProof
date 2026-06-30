import { describe, expect, it } from "vitest";

import { evaluateReviewerSignalSentinels } from "./reviewer-signal-sentinels";

describe("reviewer-signal sentinels", () => {
  it("keeps deterministic 30-second reviewer handoff signals visible", () => {
    const summary = evaluateReviewerSignalSentinels();

    expect(summary.ok, formatSentinelFailures(summary)).toBe(true);
    expect(summary.caseCount).toBe(7);
    expect(summary.failedCount).toBe(0);
    expect(summary.checkCount).toBeGreaterThanOrEqual(25);
  });
});

function formatSentinelFailures(summary: ReturnType<typeof evaluateReviewerSignalSentinels>): string {
  return summary.results
    .flatMap((result) =>
      result.checks
        .filter((check) => check.status === "fail")
        .map((check) => `${result.caseId}:${check.id} ${check.detail}`)
    )
    .join("\n");
}
