import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_FIXTURE_PATH = join(process.cwd(), "eval/fixtures/reviewer-validation.v1.json");
const REVIEWER_SLOTS = ["reviewer-1", "reviewer-2", "reviewer-3"];
const OUTREACH_STATUSES = ["ready-to-send", "outreach-sent", "scheduled", "declined", "no-response"];
const SESSION_STATUSES = [
  "completed",
  "scheduled",
  "outreach-sent",
  "declined",
  "no-response",
  "internal-only-biased-and-insufficient"
];
const REVIEWER_PROFILES = [
  "cto-or-tech-lead",
  "senior-reviewer",
  "staff-engineer",
  "engineering-manager",
  "staff-engineer-or-engineering-manager",
  "unclear"
];
const PR_SOURCES = ["public-oss-pr", "shareable-team-pr", "demo-pr", "unclear"];
const REPORT_PATHS = ["public-pr-url-only", "public-pr-plus-task-text", "private-beta-assisted", "demo"];
const TRI_STATE = ["yes", "no", "unclear"];
const USEFULNESS = ["useful", "partially-useful", "not-useful", "unclear"];
const WOULD_USE_AGAIN = ["yes", "no", "maybe", "unclear"];
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
const SECRET_PATTERNS = [
  /github_pat_[A-Za-z0-9_]+/,
  /\bgh[opsur]_[A-Za-z0-9_]+/,
  /\bsk-[A-Za-z0-9_-]+/,
  /\bBearer\s+[A-Za-z0-9._-]+/i,
  /hooks\.slack\.com\/services\//i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
];
const OUTREACH_MESSAGES = {
  "message-a": {
    subject: "10-minute check on an AI-agent PR evidence report",
    bodyLines: [
      "I am testing AgentProof with a few reviewers before treating it as beta-ready.",
      "It creates an evidence report for an agent-authored pull request: requirement coverage, weak proof, missing tests, scope signals, first files to inspect, and the next re-prompt for the coding agent.",
      "Could you spend 10 minutes on one public or shareable PR and tell me whether the report helps you decide what to inspect first before merge?",
      "Please open https://agentproof-pearl.vercel.app, paste one public GitHub PR URL or use a demo PR, and say the top risk, missing proof, first files, and next re-prompt within the first 30 seconds.",
      "Please do not send raw diffs, full logs, private tokens, screenshots with secrets, or private customer data."
    ]
  },
  "message-b": {
    subject: "Quick feedback on agent PR verification",
    bodyLines: [
      "I am validating whether AgentProof helps reviewers of AI-agent pull requests find weak evidence faster.",
      "The report is not a merge decision. It should help a human reviewer decide what to inspect first and what to ask the coding agent to fix next.",
      "Could you try it on one public or shareable PR where the original task or linked issue is visible?",
      "I am measuring whether you can find the top risk within 30 seconds, whether missing proof or targeted tests are clear, whether any blocker is overstated, and whether the next re-prompt is useful.",
      "Feedback should stay summary-only. Please avoid raw code, logs, tokens, private repository names, or provider identifiers."
    ]
  },
  "message-c": {
    subject: "Design-partner feedback on PR evidence handoff",
    bodyLines: [
      "I am looking for a practical reviewer check, not product praise.",
      "AgentProof maps a PR back to the original issue, task, or prompt and produces a grounded evidence report for human review.",
      "Could you review one generated report and tell me whether it changes your inspection priority?",
      "The useful signal is narrow: requirement coverage, missing proof, scope creep, risky files to inspect first, test/build evidence status, and the next re-prompt to the coding agent.",
      "If the report is noisy, unclear, or not useful, that is the most important feedback. Please keep feedback bounded to outcome labels and short notes."
    ]
  }
};

export function runReviewerValidationCli(argv, {
  fixturePath = DEFAULT_FIXTURE_PATH,
  readFile = readFileSync,
  writeFile = writeFileSync
} = {}) {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  const targetPath = options.fixture ?? fixturePath;

  if (!command || command === "help" || options.help === "true") {
    return usage();
  }

  const fixture = loadFixture(targetPath, readFile);

  if (command === "summary") {
    return summarizeFixture(validateFixture(fixture));
  }

  if (command === "message") {
    return outreachMessage(fixture, options);
  }

  if (command === "outreach-pack") {
    return outreachPack(fixture);
  }

  if (command === "mark-outreach") {
    const updated = markOutreach(fixture, options);
    writeValidatedFixture(targetPath, updated, writeFile);
    return summarizeFixture(updated);
  }

  if (command === "add-feedback") {
    const updated = addFeedback(fixture, options);
    writeValidatedFixture(targetPath, updated, writeFile);
    return summarizeFixture(updated);
  }

  throw new Error(`Unsupported reviewer validation command: ${command}`);
}

function outreachPack(fixture) {
  const validated = validateFixture(fixture);
  const messages = REVIEWER_SLOTS.map((slot) => outreachMessageForSlot(validated, slot));
  const result = {
    privacy: "reviewer-validation-outreach-pack-only",
    status: validated.status,
    outreachSlotCount: validated.outreachSlots.length,
    readyToSendCount: validated.outreachSlots.filter((slot) => slot.status === "ready-to-send").length,
    messages,
    recordAllSentCommands: messages.map((message) => message.recordCommand),
    reminder: "Send only to real reviewer candidates. Do not store recipient names, handles, email addresses, private repo names, raw diffs, full logs, screenshots with secrets, tokens, provider ids, table names, or environment variable names in the fixture."
  };

  assertNoPrivateOrRawPayloads(result, "outreach-pack");

  return result;
}

function outreachMessage(fixture, options) {
  const validated = validateFixture(fixture);
  const slot = requiredEnum(options.slot, REVIEWER_SLOTS, "--slot");
  return outreachMessageForSlot(validated, slot);
}

function outreachMessageForSlot(validated, slot) {
  const outreachSlot = validated.outreachSlots.find((item) => item.slot === slot);

  if (!outreachSlot) {
    throw new Error(`Reviewer validation fixture is missing ${slot}.`);
  }

  const message = OUTREACH_MESSAGES[outreachSlot.messageTemplate];
  const result = {
    privacy: "reviewer-validation-message-only",
    slot,
    targetProfile: outreachSlot.targetProfile,
    outreachChannelClass: outreachSlot.outreachChannelClass,
    subject: message.subject,
    bodyLines: message.bodyLines,
    recordCommand: `pnpm reviewer:validation mark-outreach --slot ${slot} --status outreach-sent --next-action "Wait for bounded reviewer response."`,
    reminder: "Do not add recipient names, handles, email addresses, private repo names, raw diffs, full logs, screenshots with secrets, tokens, provider ids, table names, or environment variable names to the fixture."
  };

  assertNoPrivateOrRawPayloads(result, "message");

  return result;
}

function markOutreach(fixture, options) {
  const slot = requiredEnum(options.slot, REVIEWER_SLOTS, "--slot");
  const status = requiredEnum(options.status, OUTREACH_STATUSES.filter((item) => item !== "ready-to-send"), "--status");
  const nextAction = boundedText(options.nextAction ?? options["next-action"] ?? "Record reviewer response as bounded metadata.", "--next-action", 10, 240);
  const updated = structuredCloneCompat(fixture);
  const target = updated.outreachSlots.find((item) => item.slot === slot);

  if (!target) {
    throw new Error(`Reviewer validation fixture is missing ${slot}.`);
  }

  target.status = status;
  target.nextAction = nextAction;
  updated.status = deriveFixtureStatus(updated);

  return validateFixture(updated);
}

function addFeedback(fixture, options) {
  const record = {
    slot: requiredEnum(options.slot, REVIEWER_SLOTS, "--slot"),
    sessionStatus: requiredEnum(options.sessionStatus ?? options["session-status"], SESSION_STATUSES, "--session-status"),
    reviewerProfile: requiredEnum(options.reviewerProfile ?? options["reviewer-profile"], REVIEWER_PROFILES, "--reviewer-profile"),
    prSource: requiredEnum(options.prSource ?? options["pr-source"], PR_SOURCES, "--pr-source"),
    reportPath: requiredEnum(options.reportPath ?? options["report-path"], REPORT_PATHS, "--report-path"),
    timeToTopRisk: parseTimeToTopRisk(options.timeToTopRisk ?? options["time-to-top-risk"]),
    topRiskUnderstood: requiredEnum(options.topRiskUnderstood ?? options["top-risk-understood"], TRI_STATE, "--top-risk-understood"),
    missingProofUnderstood: requiredEnum(options.missingProofUnderstood ?? options["missing-proof-understood"], TRI_STATE, "--missing-proof-understood"),
    firstFileOrCheckUnderstood: requiredEnum(options.firstFileOrCheckUnderstood ?? options["first-file-or-check-understood"], TRI_STATE, "--first-file-or-check-understood"),
    nextRepromptUnderstood: requiredEnum(options.nextRepromptUnderstood ?? options["next-reprompt-understood"], TRI_STATE, "--next-reprompt-understood"),
    reportUsefulness: requiredEnum(options.reportUsefulness ?? options["report-usefulness"], USEFULNESS, "--report-usefulness"),
    falseBlockerObserved: requiredEnum(options.falseBlockerObserved ?? options["false-blocker-observed"], TRI_STATE, "--false-blocker-observed"),
    wouldUseAgain: requiredEnum(options.wouldUseAgain ?? options["would-use-again"], WOULD_USE_AGAIN, "--would-use-again"),
    followUp: boundedText(options.followUp ?? options["follow-up"], "--follow-up", 0, 240)
  };
  const updated = structuredCloneCompat(fixture);

  updated.feedbackRecords = [
    ...updated.feedbackRecords.filter((item) => item.slot !== record.slot),
    record
  ].sort((left, right) => REVIEWER_SLOTS.indexOf(left.slot) - REVIEWER_SLOTS.indexOf(right.slot));

  const outreachSlot = updated.outreachSlots.find((item) => item.slot === record.slot);
  if (outreachSlot && outreachSlot.status === "ready-to-send") {
    outreachSlot.status = record.sessionStatus === "scheduled" ? "scheduled" : "outreach-sent";
    outreachSlot.nextAction = record.sessionStatus === "completed"
      ? "Review bounded feedback before claiming validation."
      : "Follow up on reviewer validation response.";
  }
  updated.status = deriveFixtureStatus(updated);

  return validateFixture(updated);
}

function deriveFixtureStatus(fixture) {
  const summary = summarizeFixture(fixture);

  if (summary.completedSessionCount >= 3 && summary.realPrUsageCount >= 1) {
    return "reviewer_validation_ready_for_review";
  }

  if (summary.sentOrScheduledOrCompletedCount > 0 || summary.completedSessionCount > 0) {
    return "reviewer_validation_in_progress";
  }

  return "outreach_prepared_reviewer_usefulness_unclear";
}

function summarizeFixture(fixture) {
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
    next: nextAction({ sentOrScheduledOrCompletedCount, completedSessionCount, realPrUsageCount })
  };
}

function nextAction({ sentOrScheduledOrCompletedCount, completedSessionCount, realPrUsageCount }) {
  if (sentOrScheduledOrCompletedCount < 3) {
    return "send_prepared_outreach";
  }

  if (completedSessionCount < 3 || realPrUsageCount < 1) {
    return "record_reviewer_sessions";
  }

  return "review_feedback_before_claiming_validation";
}

function validateFixture(fixture) {
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

  for (const slot of REVIEWER_SLOTS) {
    if (!fixture.outreachSlots.some((item) => item.slot === slot)) {
      throw new Error(`Reviewer validation fixture is missing ${slot}.`);
    }
  }

  for (const slot of fixture.outreachSlots) {
    requiredEnum(slot.slot, REVIEWER_SLOTS, "outreach slot");
    requiredEnum(slot.status, OUTREACH_STATUSES, "outreach status");
    requiredEnum(slot.targetProfile, REVIEWER_PROFILES, "target profile");
    requiredEnum(slot.messageTemplate, ["message-a", "message-b", "message-c"], "message template");
    if (slot.outreachChannelClass !== "existing-network" && slot.outreachChannelClass !== "design-partner-candidate") {
      throw new Error("Reviewer validation outreach slot has unsupported outreachChannelClass.");
    }
    boundedText(slot.nextAction, "nextAction", 10, 240);
  }

  if (!Array.isArray(fixture.feedbackRecords)) {
    throw new Error("Reviewer validation fixture feedbackRecords must be an array.");
  }

  for (const record of fixture.feedbackRecords) {
    requiredEnum(record.slot, REVIEWER_SLOTS, "feedback slot");
    requiredEnum(record.sessionStatus, SESSION_STATUSES, "session status");
    requiredEnum(record.reviewerProfile, REVIEWER_PROFILES, "reviewer profile");
    requiredEnum(record.prSource, PR_SOURCES, "PR source");
    requiredEnum(record.reportPath, REPORT_PATHS, "report path");
    requiredEnum(record.topRiskUnderstood, TRI_STATE, "top risk understood");
    requiredEnum(record.missingProofUnderstood, TRI_STATE, "missing proof understood");
    requiredEnum(record.firstFileOrCheckUnderstood, TRI_STATE, "first file or check understood");
    requiredEnum(record.nextRepromptUnderstood, TRI_STATE, "next re-prompt understood");
    requiredEnum(record.reportUsefulness, USEFULNESS, "report usefulness");
    requiredEnum(record.falseBlockerObserved, TRI_STATE, "false blocker observed");
    requiredEnum(record.wouldUseAgain, WOULD_USE_AGAIN, "would use again");
    parseTimeToTopRisk(record.timeToTopRisk);
    boundedText(record.followUp, "followUp", 0, 240);
  }

  if (!Array.isArray(fixture.limitations) || fixture.limitations.length === 0) {
    throw new Error("Reviewer validation fixture must state limitations.");
  }

  return fixture;
}

function writeValidatedFixture(filePath, fixture, writeFile) {
  const validated = validateFixture(fixture);
  writeFile(filePath, `${JSON.stringify(validated, null, 2)}\n`);
}

function loadFixture(filePath, readFile) {
  return JSON.parse(readFile(filePath, "utf8"));
}

function parseOptions(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];

    if (!item.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${item}`);
    }

    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = "true";
      continue;
    }

    options[key] = next;
    index += 1;
  }

  return options;
}

function requiredEnum(value, allowed, label) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }

  return value;
}

function parseTimeToTopRisk(value) {
  if (value === "not-found") {
    return value;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 600) {
    throw new Error("--time-to-top-risk must be bounded seconds or not-found.");
  }

  return parsed;
}

function boundedText(value, label, minLength, maxLength) {
  if (typeof value !== "string" || value.length < minLength || value.length > maxLength || value.includes("\n")) {
    throw new Error(`${label} must be one bounded line of text.`);
  }

  return value;
}

function assertNoPrivateOrRawPayloads(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPrivateOrRawPayloads(item, `${path}[${index}]`));
    return;
  }

  if (typeof value === "string") {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(value)) {
        throw new Error(`Reviewer validation fixture contains private or secret-looking value at ${path}.`);
      }
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

function usage() {
  return {
    privacy: "reviewer-validation-summary-only",
    commands: [
      "summary",
      "outreach-pack",
      "message --slot reviewer-1",
      "mark-outreach --slot reviewer-1 --status outreach-sent --next-action \"Record reviewer response.\"",
      "add-feedback --slot reviewer-1 --session-status completed --reviewer-profile cto-or-tech-lead --pr-source public-oss-pr --report-path public-pr-url-only --time-to-top-risk 24 --top-risk-understood yes --missing-proof-understood yes --first-file-or-check-understood yes --next-reprompt-understood yes --report-usefulness useful --false-blocker-observed no --would-use-again yes --follow-up \"Reviewer found the first inspection target quickly.\""
    ]
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structuredCloneCompat(value) {
  return JSON.parse(JSON.stringify(value));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = runReviewerValidationCli(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      privacy: "reviewer-validation-summary-only",
      error: error instanceof Error ? error.message : "Reviewer validation fixture command failed."
    }));
    process.exit(1);
  }
}
