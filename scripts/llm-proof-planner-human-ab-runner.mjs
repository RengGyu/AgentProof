#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  classifyLabelRow,
  createDecisionTimer,
  validateAssignmentPlan,
  validateRaterPacket
} from "./llm-proof-planner-human-ab-core.mjs";

const [command, inputPath, outputPath] = process.argv.slice(2);

if (command === "preflight") {
  const plan = readJson(inputPath);
  const result = validateAssignmentPlan(plan);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.valid ? 0 : 1);
}

if (command === "label") {
  if (!inputPath || !outputPath) fail("Usage: node scripts/llm-proof-planner-human-ab-runner.mjs label <rater-packet.json> <labels.json>");
  const packet = readJson(inputPath);
  const preflight = validateRaterPacket(packet);
  if (!preflight.valid) fail(`Rater packet preflight failed: ${preflight.errors.join(" ")}`);
  const rl = createInterface({ input, output });
  const rows = [];
  writeLabelJournal(outputPath, packet, rows, "in_progress", "wx");
  try {
    for (const assignment of packet.assignments) {
      console.log(`\nAssignment ${assignment.assignmentIndex}: ${assignment.opaqueCaseId} / arm ${assignment.blindedArmId}`);
      console.log("\nBounded source packet:\n");
      console.log(assignment.sourcePacket);
      await rl.question("\nPress Enter to reveal the blinded report and start the decision timer. ");
      const timer = createDecisionTimer();
      const start = timer.reveal();
      console.log("\nBlinded report:\n");
      console.log(assignment.reportText);
      await rl.question("\nPress Enter immediately when you reach the evidence-sufficiency decision. ");
      const timing = timer.complete();
      const notScorableReason = await optionalReason(rl);
      const row = {
        protocolVersion: packet.protocolVersion,
        experimentId: packet.experimentId,
        sealedHoldoutReceiptSha256: packet.sealedHoldoutReceiptSha256,
        raterPseudonym: packet.raterPseudonym,
        opaqueCaseId: assignment.opaqueCaseId,
        blindedArmId: assignment.blindedArmId,
        assignmentIndex: assignment.assignmentIndex,
        requirementAccuracy: notScorableReason ? null : await score(rl, "Requirement accuracy (1-5): "),
        requirementEvidenceNote: notScorableReason ? "" : await boundedNote(rl, "Requirement evidence note (optional): "),
        proofPlanUsefulness: notScorableReason ? null : await score(rl, "proofPlan usefulness (1-5): "),
        proofPlanEvidenceNote: notScorableReason ? "" : await boundedNote(rl, "proofPlan evidence note (optional): "),
        warningAccuracy: notScorableReason ? null : await score(rl, "Warning accuracy (1-5): "),
        warningEvidenceNote: notScorableReason ? "" : await boundedNote(rl, "Warning evidence note (optional): "),
        reviewDecisionTimeSeconds: notScorableReason ? null : timing.reviewDecisionTimeSeconds,
        notScorableReason,
        startedAt: start.startedAt,
        submittedAt: timing.submittedAt,
        timingIntegrity: notScorableReason ? "runner_monotonic_not_scorable" : timing.timingIntegrity
      };
      const state = classifyLabelRow(row);
      if (!notScorableReason && state !== "completed") fail(`Runner produced a non-complete row for ${assignment.opaqueCaseId}.`);
      rows.push(row);
      writeLabelJournal(outputPath, packet, rows, "in_progress", "w");
    }
  } finally {
    rl.close();
  }
  writeLabelJournal(outputPath, packet, rows, "completed", "w");
  console.log(`Wrote ${outputPath}`);
  process.exit(0);
}

fail("Usage: node scripts/llm-proof-planner-human-ab-runner.mjs preflight <assignment-plan.json> | label <rater-packet.json> <labels.json>");

function readJson(path) {
  if (!path) fail("A JSON input path is required.");
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeLabelJournal(path, packet, rows, status, flag) {
  const payload = {
    protocolVersion: packet.protocolVersion,
    experimentId: packet.experimentId,
    sealedHoldoutReceiptSha256: packet.sealedHoldoutReceiptSha256,
    raterPseudonym: packet.raterPseudonym,
    status,
    completedAssignmentCount: rows.length,
    rows
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, { flag });
}

async function optionalReason(rl) {
  const value = (await rl.question("Not scorable reason (blank, insufficient_source_evidence, operational_failure): ")).trim();
  if (!["", "insufficient_source_evidence", "operational_failure"].includes(value)) fail("Invalid not-scorable reason.");
  return value || null;
}

async function score(rl, prompt) {
  const value = Number((await rl.question(prompt)).trim());
  if (!Number.isInteger(value) || value < 1 || value > 5) fail("Scores must be integers from 1 to 5.");
  return value;
}

async function boundedNote(rl, prompt) {
  const value = (await rl.question(prompt)).trim();
  if (value.length > 500) fail("Evidence notes must be at most 500 characters.");
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
