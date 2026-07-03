import { describe, expect, it, vi } from "vitest";
import { runReviewerValidationCli } from "./reviewer-validation-fixture.mjs";

describe("reviewer-validation-fixture CLI", () => {
  it("prints a summary without writing private details", () => {
    const writes = [];
    const result = runReviewerValidationCli(["summary"], {
      fixturePath: "fixture.json",
      readFile: () => JSON.stringify(fixture()),
      writeFile: (path, body) => writes.push({ path, body })
    });

    expect(result).toEqual(expect.objectContaining({
      privacy: "reviewer-validation-summary-only",
      status: "outreach_prepared_reviewer_usefulness_unclear",
      readyToSendCount: 3,
      next: "send_prepared_outreach"
    }));
    expect(writes).toEqual([]);
  });

  it("marks outreach as sent and writes only metadata", () => {
    const writes = [];
    const result = runReviewerValidationCli([
      "mark-outreach",
      "--slot", "reviewer-1",
      "--status", "outreach-sent",
      "--next-action", "Wait for bounded reviewer response."
    ], {
      fixturePath: "fixture.json",
      readFile: () => JSON.stringify(fixture()),
      writeFile: (path, body) => writes.push({ path, body })
    });

    expect(result).toEqual(expect.objectContaining({
      status: "reviewer_validation_in_progress",
      readyToSendCount: 2,
      sentOrScheduledOrCompletedCount: 1,
      next: "send_prepared_outreach"
    }));
    expect(writes).toHaveLength(1);
    const written = JSON.parse(writes[0].body);
    expect(written.outreachSlots[0]).toEqual(expect.objectContaining({
      slot: "reviewer-1",
      status: "outreach-sent",
      nextAction: "Wait for bounded reviewer response."
    }));
    expect(JSON.stringify(written)).not.toContain("email");
    expect(JSON.stringify(written)).not.toContain("rawDiff");
  });

  it("adds bounded feedback and derives ready-for-review only after three sessions with real PR usage", () => {
    let currentFixture = fixture();
    const writeFile = vi.fn((_path, body) => {
      currentFixture = JSON.parse(body);
    });

    for (const [slot, prSource] of [
      ["reviewer-1", "public-oss-pr"],
      ["reviewer-2", "demo-pr"],
      ["reviewer-3", "demo-pr"]
    ]) {
      runReviewerValidationCli([
        "add-feedback",
        "--slot", slot,
        "--session-status", "completed",
        "--reviewer-profile", slot === "reviewer-1" ? "cto-or-tech-lead" : "senior-reviewer",
        "--pr-source", prSource,
        "--report-path", prSource === "public-oss-pr" ? "public-pr-url-only" : "demo",
        "--time-to-top-risk", "24",
        "--top-risk-understood", "yes",
        "--missing-proof-understood", "yes",
        "--first-file-or-check-understood", "yes",
        "--next-reprompt-understood", "yes",
        "--report-usefulness", "useful",
        "--false-blocker-observed", "no",
        "--would-use-again", "yes",
        "--follow-up", "Reviewer identified inspection priority from bounded report metadata."
      ], {
        fixturePath: "fixture.json",
        readFile: () => JSON.stringify(currentFixture),
        writeFile
      });
    }

    expect(currentFixture.status).toBe("reviewer_validation_ready_for_review");
    const summary = runReviewerValidationCli(["summary"], {
      fixturePath: "fixture.json",
      readFile: () => JSON.stringify(currentFixture),
      writeFile
    });
    expect(summary).toEqual(expect.objectContaining({
      completedSessionCount: 3,
      realPrUsageCount: 1,
      usefulOrPartiallyUsefulCount: 3,
      next: "review_feedback_before_claiming_validation"
    }));
  });

  it("rejects private contact details and secret-looking feedback before writing", () => {
    const writeFile = vi.fn();

    expect(() => runReviewerValidationCli([
      "mark-outreach",
      "--slot", "reviewer-1",
      "--status", "outreach-sent",
      "--next-action", "Email reviewer@example.com after the session."
    ], {
      fixturePath: "fixture.json",
      readFile: () => JSON.stringify(fixture()),
      writeFile
    })).toThrow(/private or secret-looking value/i);

    expect(() => runReviewerValidationCli([
      "add-feedback",
      "--slot", "reviewer-1",
      "--session-status", "completed",
      "--reviewer-profile", "cto-or-tech-lead",
      "--pr-source", "public-oss-pr",
      "--report-path", "public-pr-url-only",
      "--time-to-top-risk", "24",
      "--top-risk-understood", "yes",
      "--missing-proof-understood", "yes",
      "--first-file-or-check-understood", "yes",
      "--next-reprompt-understood", "yes",
      "--report-usefulness", "useful",
      "--false-blocker-observed", "no",
      "--would-use-again", "yes",
      "--follow-up", "github_pat_secret_should_not_leak"
    ], {
      fixturePath: "fixture.json",
      readFile: () => JSON.stringify(fixture()),
      writeFile
    })).toThrow(/private or secret-looking value/i);

    expect(writeFile).not.toHaveBeenCalled();
  });
});

function fixture() {
  return {
    schemaVersion: "reviewer-validation.v1",
    privacy: "reviewer-validation-metadata-only",
    createdAt: "2026-07-03",
    purpose: "Track P0 reviewer outreach and feedback without storing private data.",
    status: "outreach_prepared_reviewer_usefulness_unclear",
    outreachSlots: [
      {
        slot: "reviewer-1",
        targetProfile: "cto-or-tech-lead",
        outreachChannelClass: "existing-network",
        messageTemplate: "message-a",
        status: "ready-to-send",
        nextAction: "Send the 10-minute public PR path."
      },
      {
        slot: "reviewer-2",
        targetProfile: "senior-reviewer",
        outreachChannelClass: "existing-network",
        messageTemplate: "message-b",
        status: "ready-to-send",
        nextAction: "Ask for one public or shareable PR."
      },
      {
        slot: "reviewer-3",
        targetProfile: "staff-engineer-or-engineering-manager",
        outreachChannelClass: "design-partner-candidate",
        messageTemplate: "message-c",
        status: "ready-to-send",
        nextAction: "Offer a live walkthrough or async report review."
      }
    ],
    feedbackRecords: [],
    limitations: [
      "No outreach has been recorded as sent in this fixture."
    ]
  };
}
