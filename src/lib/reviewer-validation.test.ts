import { describe, expect, it } from "vitest";
import {
  loadReviewerValidationFixture,
  summarizeReviewerValidationFixture,
  validateReviewerValidationFixture
} from "./reviewer-validation";
import type { ReviewerValidationFixture } from "./reviewer-validation";

describe("reviewer validation fixture", () => {
  it("loads three ready-to-send reviewer outreach slots without claiming validation", () => {
    const fixture = loadReviewerValidationFixture();
    const summary = summarizeReviewerValidationFixture(fixture);

    expect(fixture.schemaVersion).toBe("reviewer-validation.v1");
    expect(fixture.privacy).toBe("reviewer-validation-metadata-only");
    expect(fixture.status).toBe("outreach_prepared_reviewer_usefulness_unclear");
    expect(fixture.outreachSlots.map((slot) => slot.slot)).toEqual(["reviewer-1", "reviewer-2", "reviewer-3"]);
    expect(fixture.outreachSlots.every((slot) => slot.status === "ready-to-send")).toBe(true);
    expect(fixture.feedbackRecords).toEqual([]);
    expect(summary).toEqual({
      privacy: "reviewer-validation-summary-only",
      status: "outreach_prepared_reviewer_usefulness_unclear",
      outreachSlotCount: 3,
      readyToSendCount: 3,
      sentOrScheduledOrCompletedCount: 0,
      completedSessionCount: 0,
      realPrUsageCount: 0,
      internalOnlyBiasedCount: 0,
      usefulOrPartiallyUsefulCount: 0,
      falseBlockerYesCount: 0,
      next: "send_prepared_outreach"
    });
  });

  it("summarizes sent outreach separately from completed real reviewer sessions", () => {
    const fixture = cloneFixture(loadReviewerValidationFixture());
    fixture.status = "reviewer_validation_in_progress";
    fixture.outreachSlots = fixture.outreachSlots.map((slot) => ({
      ...slot,
      status: "outreach-sent"
    }));
    fixture.feedbackRecords = [
      {
        slot: "reviewer-1",
        sessionStatus: "internal-only-biased-and-insufficient",
        reviewerProfile: "senior-reviewer",
        prSource: "demo-pr",
        reportPath: "demo",
        timeToTopRisk: "not-found",
        topRiskUnderstood: "unclear",
        missingProofUnderstood: "unclear",
        firstFileOrCheckUnderstood: "unclear",
        nextRepromptUnderstood: "unclear",
        reportUsefulness: "unclear",
        falseBlockerObserved: "unclear",
        wouldUseAgain: "unclear",
        followUp: "Internal fallback only; real reviewer evidence is still missing."
      }
    ];

    const validated = validateReviewerValidationFixture(fixture);

    expect(summarizeReviewerValidationFixture(validated)).toEqual(expect.objectContaining({
      sentOrScheduledOrCompletedCount: 3,
      completedSessionCount: 0,
      realPrUsageCount: 0,
      internalOnlyBiasedCount: 1,
      next: "record_reviewer_sessions"
    }));
  });

  it("moves to feedback review only after real completed sessions and one real PR use", () => {
    const fixture = cloneFixture(loadReviewerValidationFixture());
    fixture.status = "reviewer_validation_ready_for_review";
    fixture.outreachSlots = fixture.outreachSlots.map((slot) => ({
      ...slot,
      status: "scheduled"
    }));
    const slots = ["reviewer-1", "reviewer-2", "reviewer-3"] as const;
    fixture.feedbackRecords = slots.map((slot, index) => ({
      slot,
      sessionStatus: "completed",
      reviewerProfile: index === 0 ? "cto-or-tech-lead" : "senior-reviewer",
      prSource: index === 0 ? "public-oss-pr" : "demo-pr",
      reportPath: index === 0 ? "public-pr-url-only" : "demo",
      timeToTopRisk: 24 + index,
      topRiskUnderstood: "yes",
      missingProofUnderstood: "yes",
      firstFileOrCheckUnderstood: "yes",
      nextRepromptUnderstood: "yes",
      reportUsefulness: index === 2 ? "partially-useful" : "useful",
      falseBlockerObserved: "no",
      wouldUseAgain: index === 2 ? "maybe" : "yes",
      followUp: "Reviewer could identify inspection priority from bounded report metadata."
    }));

    const validated = validateReviewerValidationFixture(fixture);

    expect(summarizeReviewerValidationFixture(validated)).toEqual(expect.objectContaining({
      completedSessionCount: 3,
      realPrUsageCount: 1,
      usefulOrPartiallyUsefulCount: 3,
      falseBlockerYesCount: 0,
      next: "review_feedback_before_claiming_validation"
    }));
  });

  it("rejects private contact details, raw payload fields, and secret-looking values", () => {
    const fixture = cloneFixture(loadReviewerValidationFixture());
    fixture.outreachSlots[0] = {
      ...fixture.outreachSlots[0],
      email: "reviewer@example.com"
    } as typeof fixture.outreachSlots[0];

    expect(() => validateReviewerValidationFixture(fixture)).toThrow(/forbidden private\/raw field/i);

    const rawPayloadFixture = cloneFixture(loadReviewerValidationFixture());
    rawPayloadFixture.feedbackRecords = [
      {
        slot: "reviewer-1",
        sessionStatus: "completed",
        reviewerProfile: "cto-or-tech-lead",
        prSource: "public-oss-pr",
        reportPath: "public-pr-url-only",
        timeToTopRisk: 18,
        topRiskUnderstood: "yes",
        missingProofUnderstood: "yes",
        firstFileOrCheckUnderstood: "yes",
        nextRepromptUnderstood: "yes",
        reportUsefulness: "useful",
        falseBlockerObserved: "no",
        wouldUseAgain: "yes",
        followUp: "github_pat_secret_should_not_leak"
      }
    ];

    expect(() => validateReviewerValidationFixture(rawPayloadFixture)).toThrow(/private or secret-looking value/i);
  });

  it("rejects unbounded free-form feedback", () => {
    const fixture = cloneFixture(loadReviewerValidationFixture());
    fixture.feedbackRecords = [
      {
        slot: "reviewer-1",
        sessionStatus: "completed",
        reviewerProfile: "cto-or-tech-lead",
        prSource: "public-oss-pr",
        reportPath: "public-pr-url-only",
        timeToTopRisk: 18,
        topRiskUnderstood: "yes",
        missingProofUnderstood: "yes",
        firstFileOrCheckUnderstood: "yes",
        nextRepromptUnderstood: "yes",
        reportUsefulness: "useful",
        falseBlockerObserved: "no",
        wouldUseAgain: "yes",
        followUp: "Line one\nLine two"
      }
    ];

    expect(() => validateReviewerValidationFixture(fixture)).toThrow(/one bounded sentence/i);
  });
});

function cloneFixture(fixture: ReviewerValidationFixture): ReviewerValidationFixture {
  return JSON.parse(JSON.stringify(fixture)) as ReviewerValidationFixture;
}
