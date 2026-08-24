import { describe, expect, it } from "vitest";

import { evaluateReviewerSignalSentinels } from "./reviewer-signal-sentinels";

describe("reviewer-signal sentinels", () => {
  it("keeps the default-off clean-fixture priority delta explicit while other reviewer signals stay green", () => {
    const summary = evaluateReviewerSignalSentinels();

    expect(summary.ok).toBe(false);
    expect(summary.caseCount).toBe(7);
    expect(summary.failedCount).toBe(1);
    expect(summary.checkCount).toBeGreaterThanOrEqual(25);
    expect(formatSentinelFailures(summary)).toBe("clean:priority-allowed priority=high");
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
