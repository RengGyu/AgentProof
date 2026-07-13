#!/usr/bin/env node


import { createHash, randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createDecisionTimer } from "./llm-proof-planner-human-ab-core.mjs";
import {
  buildLabelJournalV2,
  buildLabelRowV2,
  isSafeHumanAbNoteV2,
  sha256,
  validateLabelJournalV2,
  validateRaterPacketV2,
  writeAtomicJson
} from "./llm-proof-planner-human-ab-v2-core.mjs";

export function loadRunnerStateV2({ expectedLaunchDescriptorSha256, launchDescriptorPath, packetPath, workbookPath, journalPath, resume }) {
  const launchText = readFileSync(launchDescriptorPath, "utf8");
  if (typeof expectedLaunchDescriptorSha256 !== "string" || !/^[0-9a-f]{64}$/.test(expectedLaunchDescriptorSha256) || sha256(launchText) !== expectedLaunchDescriptorSha256) throw new Error("Runner launch descriptor does not match the separately frozen expected SHA-256.");
  const launch = JSON.parse(launchText);
  const launchKeys = ["experimentId", "launchDescriptorVersion", "preparedReceiptSha256", "protocolVersion", "raterPacketSha256", "raterPseudonym", "raterWorkbookSha256"];
  if (JSON.stringify(Object.keys(launch).sort()) !== JSON.stringify(launchKeys) || launch.launchDescriptorVersion !== "agentproof-human-ab-runner-launch.v2" || launch.protocolVersion !== "agentproof-human-ab.v2" || ![launch.preparedReceiptSha256, launch.raterPacketSha256, launch.raterWorkbookSha256].every((value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value))) {
    throw new Error("Runner launch descriptor is invalid.");
  }
  const packetText = readFileSync(packetPath, "utf8");
  const packet = JSON.parse(packetText);
  const packetSha256 = sha256(packetText);
  const packetValidation = validateRaterPacketV2(packet);
  if (!packetValidation.valid) throw new Error(`Rater packet preflight failed: ${packetValidation.errors.join(" ")}`);
  if (launch.raterPacketSha256 !== packetSha256 || launch.experimentId !== packet.experimentId || launch.raterPseudonym !== packet.raterPseudonym || launch.raterWorkbookSha256 !== packet.raterWorkbookSha256) throw new Error("Runner launch descriptor does not bind the supplied rater packet.");
  const workbookSha256 = createHash("sha256").update(readFileSync(workbookPath)).digest("hex");
  if (workbookSha256 !== packet.raterWorkbookSha256) throw new Error("Distributed rater workbook hash does not match the packet binding.");
  if (resume) {
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const validation = validateLabelJournalV2(journal, { packet, packetSha256 });
    if (!validation.valid) throw new Error(`Resume journal failed validation: ${validation.errors.join(" ")}`);
    if (journal.status === "completed") throw new Error("Completed label journals cannot be resumed or overwritten.");
    return { packet, packetSha256, journal };
  }
  const journal = buildLabelJournalV2({ packet, packetSha256, rows: [], status: "in_progress" });
  writeAtomicJson(journalPath, journal, { noClobber: true });
  return { packet, packetSha256, journal };
}

export function recoverActiveAssignmentV2({ packet, packetSha256, journal, submittedAt = new Date().toISOString() }) {
  if (journal.activeAssignment === null) return journal;
  const assignment = packet.assignments[journal.rows.length];
  if (!assignment || assignment.assignmentId !== journal.activeAssignment.assignmentId) throw new Error("Active assignment cannot be recovered against the packet order.");
  const row = buildLabelRowV2({
    packet,
    packetSha256,
    assignment,
    values: {
      reviewDecision: null,
      requirementAccuracy: null,
      requirementEvidenceNote: "",
      proofPlanUsefulness: null,
      proofPlanEvidenceNote: "",
      warningAccuracy: null,
      warningEvidenceNote: "",
      reviewDecisionTimeSeconds: null,
      notScorableReason: "operational_failure",
      startedAt: journal.activeAssignment.startedAt,
      submittedAt,
      timingIntegrity: "runner_monotonic_not_scorable"
    }
  });
  return buildLabelJournalV2({ packet, packetSha256, rows: [...journal.rows, row], status: "in_progress", activeAssignment: null });
}

export function acquireJournalLockV2(journalPath, { pid = process.pid } = {}) {
  const lockPath = `${journalPath}.lock`;
  const token = randomUUID();
  let fd;
  try {
    fd = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") throw new Error("Another Human A/B runner holds the label-journal lock; stale locks require explicit operator unlock.");
    throw error;
  }
  writeFileSync(fd, `${JSON.stringify({ pid, token })}\n`, "utf8");
  return {
    lockPath,
    token,
    release() {
      try {
        const current = JSON.parse(readFileSync(lockPath, "utf8"));
        if (current.token !== token) throw new Error("Journal lock ownership changed; refusing to remove another runner's lock.");
        rmSync(lockPath);
      } finally {
        closeSync(fd);
      }
    }
  };
}

export function clearStaleJournalLockV2(journalPath, confirmation) {
  if (confirmation !== "I_CONFIRMED_NO_RUNNER_IS_ACTIVE") throw new Error("Explicit stale-lock confirmation phrase is required.");
  rmSync(`${journalPath}.lock`, { force: false });
}

async function runInteractive({ expectedLaunchDescriptorSha256, launchDescriptorPath, packetPath, workbookPath, journalPath, resume }) {
  let { packet, packetSha256, journal } = loadRunnerStateV2({ expectedLaunchDescriptorSha256, launchDescriptorPath, packetPath, workbookPath, journalPath, resume });
  if (journal.activeAssignment !== null) {
    journal = recoverActiveAssignmentV2({ packet, packetSha256, journal });
    writeAtomicJson(journalPath, journal);
    console.log("Recovered a previously revealed assignment as operational_failure without re-revealing it.");
  }
  const rl = createInterface({ input, output });
  try {
    for (let index = journal.rows.length; index < packet.assignments.length; index += 1) {
      const assignment = packet.assignments[index];
      console.log(`\nAssignment ${assignment.assignmentIndex}: ${assignment.opaqueCaseId}`);
      console.log("\nBounded source packet:\n");
      console.log(assignment.sourcePacket);
      await rl.question("\nPress Enter to reveal the blinded report and start the decision timer. ");
      const timer = createDecisionTimer();
      const start = timer.reveal();
      journal = buildLabelJournalV2({
        packet,
        packetSha256,
        rows: journal.rows,
        status: "in_progress",
        activeAssignment: { assignmentId: assignment.assignmentId, assignmentIndex: assignment.assignmentIndex, state: "revealed", startedAt: start.startedAt }
      });
      writeAtomicJson(journalPath, journal);
      console.log("\nBlinded report:\n");
      console.log(assignment.reportText);
      await rl.question("\nPress Enter immediately when you reach the evidence-sufficiency decision. ");
      const timing = timer.complete();
      const notScorableReason = await optionalReason(rl);
      const values = notScorableReason ? {
        reviewDecision: null,
        requirementAccuracy: null,
        requirementEvidenceNote: "",
        proofPlanUsefulness: null,
        proofPlanEvidenceNote: "",
        warningAccuracy: null,
        warningEvidenceNote: "",
        reviewDecisionTimeSeconds: null,
        notScorableReason,
        startedAt: start.startedAt,
        submittedAt: timing.submittedAt,
        timingIntegrity: "runner_monotonic_not_scorable"
      } : {
        reviewDecision: await decision(rl),
        requirementAccuracy: await score(rl, "Requirement accuracy (1-5): "),
        requirementEvidenceNote: await note(rl, "Requirement evidence note (optional): "),
        proofPlanUsefulness: await score(rl, "proofPlan usefulness (1-5): "),
        proofPlanEvidenceNote: await note(rl, "proofPlan evidence note (optional): "),
        warningAccuracy: await score(rl, "Warning accuracy (1-5): "),
        warningEvidenceNote: await note(rl, "Warning evidence note (optional): "),
        reviewDecisionTimeSeconds: timing.reviewDecisionTimeSeconds,
        notScorableReason: null,
        startedAt: start.startedAt,
        submittedAt: timing.submittedAt,
        timingIntegrity: timing.timingIntegrity
      };
      const row = buildLabelRowV2({ packet, packetSha256, assignment, values });
      journal = buildLabelJournalV2({ packet, packetSha256, rows: [...journal.rows, row], status: "in_progress", activeAssignment: null });
      writeAtomicJson(journalPath, journal);
    }
    journal = buildLabelJournalV2({ packet, packetSha256, rows: journal.rows, status: "completed", activeAssignment: null });
    writeAtomicJson(journalPath, journal);
  } finally {
    rl.close();
  }
  console.log(`Wrote completed label journal ${journalPath}`);
}

async function decision(rl) {
  while (true) {
    const value = (await rl.question("Evidence-sufficiency decision (enough, not_enough, unclear): ")).trim();
    if (["enough", "not_enough", "unclear"].includes(value)) return value;
    console.log("Decision must be enough, not_enough, or unclear. Try again.");
  }
}

async function optionalReason(rl) {
  while (true) {
    const value = (await rl.question("Not scorable reason (blank, insufficient_source_evidence, operational_failure): ")).trim();
    if (["", "insufficient_source_evidence", "operational_failure"].includes(value)) return value || null;
    console.log("Invalid NotScorable reason. Try again.");
  }
}

async function score(rl, prompt) {
  while (true) {
    const value = Number((await rl.question(prompt)).trim());
    if (Number.isInteger(value) && value >= 1 && value <= 5) return value;
    console.log("Scores must be integers from 1 to 5. Try again.");
  }
}

async function note(rl, prompt) {
  while (true) {
    const value = (await rl.question(prompt)).trim();
    if (isSafeHumanAbNoteV2(value)) return value;
    console.log("Evidence notes must be bounded, formula-safe, and free of prohibited raw material. Try again.");
  }
}

async function main() {
  const [command, expectedLaunchDescriptorSha256, launchDescriptorPath, packetPath, workbookPath, journalPath] = process.argv.slice(2);
  if (command === "unlock") {
    clearStaleJournalLockV2(expectedLaunchDescriptorSha256, launchDescriptorPath);
    console.log(`Removed stale lock for ${expectedLaunchDescriptorSha256}`);
    return;
  }
  if (!["label", "resume"].includes(command) || !expectedLaunchDescriptorSha256 || !launchDescriptorPath || !packetPath || !workbookPath || !journalPath) {
    throw new Error(`Usage: node ${basename(process.argv[1])} label|resume <expected-launch-sha256> <runner-launch.json> <rater-packet.json> <distributed-rater-workbook.xlsx> <label-journal.json> | unlock <label-journal.json> I_CONFIRMED_NO_RUNNER_IS_ACTIVE`);
  }
  const lock = acquireJournalLockV2(journalPath);
  try {
    await runInteractive({ expectedLaunchDescriptorSha256, launchDescriptorPath, packetPath, workbookPath, journalPath, resume: command === "resume" });
  } finally {
    lock.release();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : "Human A/B v2 runner failed."); process.exit(1); });
}
