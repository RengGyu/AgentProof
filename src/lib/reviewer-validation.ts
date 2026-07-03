import { readFileSync } from "node:fs";
import { join } from "node:path";
import { containsSecretPattern } from "./redact";

export const REVIEWER_VALIDATION_FIXTURE_PATH = join(
  process.cwd(),
  "eval/fixtures/reviewer-validation.v1.json"
);

const REVIEWER_SLOTS = ["reviewer-1", "reviewer-2", "reviewer-3"] as const;
const OUTREACH_STATUSES = ["ready-to-send", "outreach-sent", "scheduled", "declined", "no-response"] as const;
const SESSION_STATUSES = [
  "completed",
  "scheduled",
  "outreach-sent",
  "declined",
  "no-response",
  "internal-only-biased-and-insufficient"
] as const;
const REVIEWER_PROFILES = [
  "cto-or-tech-lead",
  "senior-reviewer",
  "staff-engineer",
  "engineering-manager",
  "staff-engineer-or-engineering-manager",
  "unclear"
] as const;
const PR_SOURCES = ["public-oss-pr", "shareable-team-pr", "demo-pr", "unclear"] as const;
const REPORT_PATHS = ["public-pr-url-only", "public-pr-plus-task-text", "private-beta-assisted", "demo"] as const;
const TRI_STATE = ["yes", "no", "unclear"] as const;
const USEFULNESS = ["useful", "partially-useful", "not-useful", "unclear"] as const;
const WOULD_USE_AGAIN = ["yes", "no", "maybe", "unclear"] as const;

const FORBIDDEN_KEYS = new Set([
  "name",
  "email",
  "handle",
  "contact",
  "calendarLink",
  "rawDiff",
  "diff",
  "patch",
  "rawLog",
  "log",
  "logs",
  "token",
  "secret",
  "authorization",
  "providerId",
  "customerId",
  "subscriptionId",
  "tableName",
  "envName",
  "environmentVariable"
]);

export type ReviewerSlot = (typeof REVIEWER_SLOTS)[number];
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export interface ReviewerValidationFixture {
  schemaVersion: "reviewer-validation.v1";
  privacy: "reviewer-validation-metadata-only";
  createdAt: string;
  purpose: string;
  status: "outreach_prepared_reviewer_usefulness_unclear" | "reviewer_validation_in_progress" | "reviewer_validation_ready_for_review";
  outreachSlots: ReviewerOutreachSlot[];
  feedbackRecords: ReviewerFeedbackRecord[];
  limitations: string[];
}

export interface ReviewerOutreachSlot {
  slot: ReviewerSlot;
  targetProfile: (typeof REVIEWER_PROFILES)[number];
  outreachChannelClass: "existing-network" | "design-partner-candidate";
  messageTemplate: "message-a" | "message-b" | "message-c";
  status: OutreachStatus;
  nextAction: string;
}

export interface ReviewerFeedbackRecord {
  slot: ReviewerSlot;
  sessionStatus: SessionStatus;
  reviewerProfile: (typeof REVIEWER_PROFILES)[number];
  prSource: (typeof PR_SOURCES)[number];
  reportPath: (typeof REPORT_PATHS)[number];
  timeToTopRisk: number | "not-found";
  topRiskUnderstood: (typeof TRI_STATE)[number];
  missingProofUnderstood: (typeof TRI_STATE)[number];
  firstFileOrCheckUnderstood: (typeof TRI_STATE)[number];
  nextRepromptUnderstood: (typeof TRI_STATE)[number];
  reportUsefulness: (typeof USEFULNESS)[number];
  falseBlockerObserved: (typeof TRI_STATE)[number];
  wouldUseAgain: (typeof WOULD_USE_AGAIN)[number];
  followUp: string;
}

export interface ReviewerValidationSummary {
  privacy: "reviewer-validation-summary-only";
  status: ReviewerValidationFixture["status"];
  outreachSlotCount: number;
  readyToSendCount: number;
  sentOrScheduledOrCompletedCount: number;
  completedSessionCount: number;
  realPrUsageCount: number;
  internalOnlyBiasedCount: number;
  usefulOrPartiallyUsefulCount: number;
  falseBlockerYesCount: number;
  next: "send_prepared_outreach" | "record_reviewer_sessions" | "review_feedback_before_claiming_validation";
}

export function loadReviewerValidationFixture(
  filePath = REVIEWER_VALIDATION_FIXTURE_PATH
): ReviewerValidationFixture {
  const fixture = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  return validateReviewerValidationFixture(fixture);
}

export function validateReviewerValidationFixture(fixture: unknown): ReviewerValidationFixture {
  if (!isRecord(fixture)) {
    throw new Error("Reviewer validation fixture must be an object.");
  }

  if (fixture.schemaVersion !== "reviewer-validation.v1") {
    throw new Error("Reviewer validation fixture schemaVersion must be reviewer-validation.v1.");
  }

  if (fixture.privacy !== "reviewer-validation-metadata-only") {
    throw new Error("Reviewer validation fixture must remain metadata-only.");
  }

  assertNoPrivateOrRawPayloads(fixture, "fixture");

  if (!Array.isArray(fixture.outreachSlots) || fixture.outreachSlots.length !== 3) {
    throw new Error("Reviewer validation fixture must contain exactly 3 outreach slots.");
  }

  const slots = new Set<string>();
  for (const outreachSlot of fixture.outreachSlots) {
    validateOutreachSlot(outreachSlot);
    slots.add(outreachSlot.slot);
  }

  for (const slot of REVIEWER_SLOTS) {
    if (!slots.has(slot)) {
      throw new Error(`Reviewer validation fixture is missing ${slot}.`);
    }
  }

  if (!Array.isArray(fixture.feedbackRecords)) {
    throw new Error("Reviewer validation fixture feedbackRecords must be an array.");
  }

  for (const record of fixture.feedbackRecords) {
    validateFeedbackRecord(record);
  }

  if (!Array.isArray(fixture.limitations) || fixture.limitations.length === 0) {
    throw new Error("Reviewer validation fixture must state limitations.");
  }

  return fixture as unknown as ReviewerValidationFixture;
}

export function summarizeReviewerValidationFixture(
  fixture: ReviewerValidationFixture
): ReviewerValidationSummary {
  const completedSessionCount = fixture.feedbackRecords.filter((record) => record.sessionStatus === "completed").length;
  const realPrUsageCount = fixture.feedbackRecords.filter((record) =>
    record.sessionStatus === "completed" &&
    (record.prSource === "public-oss-pr" || record.prSource === "shareable-team-pr")
  ).length;
  const sentOrScheduledOrCompletedCount = fixture.outreachSlots.filter((slot) =>
    slot.status === "outreach-sent" ||
    slot.status === "scheduled" ||
    slot.status === "declined" ||
    slot.status === "no-response"
  ).length + completedSessionCount;

  return {
    privacy: "reviewer-validation-summary-only",
    status: fixture.status,
    outreachSlotCount: fixture.outreachSlots.length,
    readyToSendCount: fixture.outreachSlots.filter((slot) => slot.status === "ready-to-send").length,
    sentOrScheduledOrCompletedCount,
    completedSessionCount,
    realPrUsageCount,
    internalOnlyBiasedCount: fixture.feedbackRecords.filter((record) =>
      record.sessionStatus === "internal-only-biased-and-insufficient"
    ).length,
    usefulOrPartiallyUsefulCount: fixture.feedbackRecords.filter((record) =>
      record.reportUsefulness === "useful" || record.reportUsefulness === "partially-useful"
    ).length,
    falseBlockerYesCount: fixture.feedbackRecords.filter((record) => record.falseBlockerObserved === "yes").length,
    next: nextReviewerValidationAction({
      sentOrScheduledOrCompletedCount,
      completedSessionCount,
      realPrUsageCount
    })
  };
}

function nextReviewerValidationAction({
  sentOrScheduledOrCompletedCount,
  completedSessionCount,
  realPrUsageCount
}: {
  sentOrScheduledOrCompletedCount: number;
  completedSessionCount: number;
  realPrUsageCount: number;
}): ReviewerValidationSummary["next"] {
  if (sentOrScheduledOrCompletedCount < 3) {
    return "send_prepared_outreach";
  }

  if (completedSessionCount < 3 || realPrUsageCount < 1) {
    return "record_reviewer_sessions";
  }

  return "review_feedback_before_claiming_validation";
}

function validateOutreachSlot(value: unknown): asserts value is ReviewerOutreachSlot {
  if (!isRecord(value)) {
    throw new Error("Reviewer validation outreach slot must be an object.");
  }

  assertEnum(value.slot, REVIEWER_SLOTS, "Reviewer validation outreach slot has unsupported slot.");
  assertEnum(value.targetProfile, REVIEWER_PROFILES, "Reviewer validation outreach slot has unsupported targetProfile.");
  assertEnum(value.status, OUTREACH_STATUSES, "Reviewer validation outreach slot has unsupported status.");
  assertEnum(value.messageTemplate, ["message-a", "message-b", "message-c"], "Reviewer validation outreach slot has unsupported messageTemplate.");

  if (value.outreachChannelClass !== "existing-network" && value.outreachChannelClass !== "design-partner-candidate") {
    throw new Error("Reviewer validation outreach slot has unsupported outreachChannelClass.");
  }

  if (typeof value.nextAction !== "string" || value.nextAction.length < 10 || value.nextAction.length > 240) {
    throw new Error("Reviewer validation outreach slot nextAction must be bounded text.");
  }
}

function validateFeedbackRecord(value: unknown): asserts value is ReviewerFeedbackRecord {
  if (!isRecord(value)) {
    throw new Error("Reviewer validation feedback record must be an object.");
  }

  assertEnum(value.slot, REVIEWER_SLOTS, "Reviewer validation feedback record has unsupported slot.");
  assertEnum(value.sessionStatus, SESSION_STATUSES, "Reviewer validation feedback record has unsupported sessionStatus.");
  assertEnum(value.reviewerProfile, REVIEWER_PROFILES, "Reviewer validation feedback record has unsupported reviewerProfile.");
  assertEnum(value.prSource, PR_SOURCES, "Reviewer validation feedback record has unsupported prSource.");
  assertEnum(value.reportPath, REPORT_PATHS, "Reviewer validation feedback record has unsupported reportPath.");
  assertEnum(value.topRiskUnderstood, TRI_STATE, "Reviewer validation feedback record has unsupported topRiskUnderstood.");
  assertEnum(value.missingProofUnderstood, TRI_STATE, "Reviewer validation feedback record has unsupported missingProofUnderstood.");
  assertEnum(value.firstFileOrCheckUnderstood, TRI_STATE, "Reviewer validation feedback record has unsupported firstFileOrCheckUnderstood.");
  assertEnum(value.nextRepromptUnderstood, TRI_STATE, "Reviewer validation feedback record has unsupported nextRepromptUnderstood.");
  assertEnum(value.reportUsefulness, USEFULNESS, "Reviewer validation feedback record has unsupported reportUsefulness.");
  assertEnum(value.falseBlockerObserved, TRI_STATE, "Reviewer validation feedback record has unsupported falseBlockerObserved.");
  assertEnum(value.wouldUseAgain, WOULD_USE_AGAIN, "Reviewer validation feedback record has unsupported wouldUseAgain.");

  const timeToTopRisk = value.timeToTopRisk;
  if (
    timeToTopRisk !== "not-found" &&
    (typeof timeToTopRisk !== "number" || !Number.isSafeInteger(timeToTopRisk) || timeToTopRisk < 0 || timeToTopRisk > 600)
  ) {
    throw new Error("Reviewer validation feedback record timeToTopRisk must be bounded seconds or not-found.");
  }

  if (typeof value.followUp !== "string" || value.followUp.length > 240 || value.followUp.includes("\n")) {
    throw new Error("Reviewer validation feedback record followUp must be one bounded sentence.");
  }
}

function assertEnum<T extends readonly string[]>(value: unknown, allowed: T, message: string): asserts value is T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(message);
  }
}

function assertNoPrivateOrRawPayloads(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPrivateOrRawPayloads(item, `${path}[${index}]`));
    return;
  }

  if (typeof value === "string") {
    if (containsSecretPattern(value) || /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value)) {
      throw new Error(`Reviewer validation fixture contains private or secret-looking value at ${path}.`);
    }
    return;
  }

  if (!isRecord(value)) return;

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Reviewer validation fixture contains forbidden private/raw field ${path}.${key}.`);
    }

    assertNoPrivateOrRawPayloads(nested, `${path}.${key}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
