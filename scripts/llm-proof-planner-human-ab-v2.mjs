#!/usr/bin/env node


import { randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  importHumanAbV2,
  prepareHumanAbV2,
  sha256,
  stableJson
} from "./llm-proof-planner-human-ab-v2-core.mjs";

export function prepareFilesV2({ freezeManifestPath, assignmentPlanPath, blindedCasesPath, outputDirectory }) {
  const output = resolve(outputDirectory);
  if (existsSync(output)) throw new Error("Human A/B v2 output directory already exists; no-clobber refused preparation.");
  const freezeManifest = readJson(freezeManifestPath);
  const assignmentPlan = readJson(assignmentPlanPath);
  const blindedCases = readJson(blindedCasesPath);
  const prepared = prepareHumanAbV2({ freezeManifest, assignmentPlan, blindedCases });
  const files = new Map([
    ["freeze-manifest.json", prepared.freezeManifestText],
    ["blinded-cases.json", prepared.blindedCasesText],
    ["assignment-plan.json", prepared.planText],
    ["assignment-preflight.json", prepared.preflightText],
    ["prepared-receipt.json", prepared.receiptText],
    ...prepared.packets.map((packet) => [packet.fileName, packet.text])
  ]);
  const preparedReceiptSha256 = sha256(prepared.receiptText);
  const launchDescriptorSha256 = {};
  for (const packet of prepared.packets) {
    const descriptor = {
      launchDescriptorVersion: "agentproof-human-ab-runner-launch.v2",
      protocolVersion: prepared.receipt.protocolVersion,
      experimentId: prepared.receipt.experimentId,
      raterPseudonym: packet.raterPseudonym,
      preparedReceiptSha256,
      raterPacketSha256: packet.sha256,
      raterWorkbookSha256: freezeManifest.workbooks.raterWorkbookHashes[packet.raterPseudonym]
    };
    const descriptorText = stableJson(descriptor);
    files.set(`${packet.raterPseudonym}.launch.json`, descriptorText);
    launchDescriptorSha256[packet.raterPseudonym] = sha256(descriptorText);
  }
  files.set("launch-freeze-receipt.json", stableJson({
    receiptVersion: "agentproof-human-ab-launch-freeze.v2",
    protocolVersion: prepared.receipt.protocolVersion,
    experimentId: prepared.receipt.experimentId,
    preparedReceiptSha256,
    launchDescriptorSha256
  }));
  writeArtifactSetAtomically(output, files);
  return { outputDirectory: output, packetCount: prepared.packets.length, assignmentCount: prepared.receipt.assignmentCount, launchDescriptorSha256 };
}

export function importFilesV2({ preparedDirectory, labelsDirectory, outputDirectory }) {
  const prepared = resolve(preparedDirectory);
  const labels = resolve(labelsDirectory);
  const output = resolve(outputDirectory);
  if (existsSync(output)) throw new Error("Human A/B v2 import output already exists; no-clobber refused import.");
  const preparedReceiptText = readFileSync(join(prepared, "prepared-receipt.json"), "utf8");
  const freezeManifestText = readFileSync(join(prepared, "freeze-manifest.json"), "utf8");
  const blindedCasesText = readFileSync(join(prepared, "blinded-cases.json"), "utf8");
  const receipt = JSON.parse(preparedReceiptText);
  const assignmentPlanText = readFileSync(join(prepared, "assignment-plan.json"), "utf8");
  const assignmentPreflightText = readFileSync(join(prepared, "assignment-preflight.json"), "utf8");
  if (!Array.isArray(receipt.packets) || receipt.packets.length === 0) throw new Error("Prepared receipt has no packet descriptors.");
  const expectedPacketFiles = receipt.packets.map((item) => item.fileName).sort();
  const expectedLaunchFiles = receipt.packets.map((item) => `${item.raterPseudonym}.launch.json`).sort();
  const allPreparedFiles = readdirSync(prepared).sort();
  const expectedPreparedFiles = ["freeze-manifest.json", "blinded-cases.json", "assignment-plan.json", "assignment-preflight.json", "prepared-receipt.json", "launch-freeze-receipt.json", ...expectedPacketFiles, ...expectedLaunchFiles].sort();
  if (JSON.stringify(allPreparedFiles) !== JSON.stringify(expectedPreparedFiles)) throw new Error("Prepared directory file set contains a missing or unexpected artifact.");
  const packetFiles = allPreparedFiles.filter((name) => name.endsWith(".packet.json")).sort();
  if (JSON.stringify(packetFiles) !== JSON.stringify(expectedPacketFiles)) throw new Error("Prepared packet file set does not exactly match the receipt.");
  const packetTexts = packetFiles.map((name) => readFileSync(join(prepared, name), "utf8"));
  const preparedReceiptSha256 = sha256(preparedReceiptText);
  const launchFreeze = JSON.parse(readFileSync(join(prepared, "launch-freeze-receipt.json"), "utf8"));
  const expectedLaunchFreeze = { receiptVersion: "agentproof-human-ab-launch-freeze.v2", protocolVersion: receipt.protocolVersion, experimentId: receipt.experimentId, preparedReceiptSha256, launchDescriptorSha256: {} };
  for (const descriptor of receipt.packets) {
    const launchText = readFileSync(join(prepared, `${descriptor.raterPseudonym}.launch.json`), "utf8");
    const launch = JSON.parse(launchText);
    const packet = JSON.parse(readFileSync(join(prepared, descriptor.fileName), "utf8"));
    const expectedLaunch = {
      launchDescriptorVersion: "agentproof-human-ab-runner-launch.v2",
      protocolVersion: receipt.protocolVersion,
      experimentId: receipt.experimentId,
      raterPseudonym: descriptor.raterPseudonym,
      preparedReceiptSha256,
      raterPacketSha256: descriptor.packetSha256,
      raterWorkbookSha256: packet.raterWorkbookSha256
    };
    if (stableJson(launch) !== stableJson(expectedLaunch)) throw new Error("Runner launch descriptor does not reproduce from the prepared receipt and packet.");
    expectedLaunchFreeze.launchDescriptorSha256[descriptor.raterPseudonym] = sha256(launchText);
  }
  if (stableJson(launchFreeze) !== stableJson(expectedLaunchFreeze)) throw new Error("Launch-freeze receipt does not bind the exact per-rater launch descriptors.");
  const expectedLabelFiles = receipt.packets.map((item) => `${item.raterPseudonym}.labels.json`).sort();
  const labelFiles = readdirSync(labels).sort();
  if (JSON.stringify(labelFiles) !== JSON.stringify(expectedLabelFiles)) throw new Error("Label journal file set does not exactly match the prepared rater set.");
  const labelJournalTexts = labelFiles.map((name) => readFileSync(join(labels, name), "utf8"));
  const imported = importHumanAbV2({ freezeManifestText, blindedCasesText, preparedReceiptText, assignmentPlanText, assignmentPreflightText, packetTexts, labelJournalTexts });
  writeArtifactSetAtomically(output, new Map([
    ["blinded-summary.json", imported.summaryText],
    ["label-freeze-receipt.json", imported.importReceiptText]
  ]));
  return { outputDirectory: output, labelRowCount: imported.importReceipt.labelRowCount, summarySha256: imported.importReceipt.summarySha256 };
}

export function writeArtifactSetAtomically(outputDirectory, files) {
  const output = resolve(outputDirectory);
  if (existsSync(output)) throw new Error("Artifact-set no-clobber refused an existing output directory.");
  const temporary = join(dirname(output), `.${basename(output)}.${randomUUID()}.artifacts`);
  try {
    mkdirSync(temporary, { mode: 0o700 });
    for (const [name, text] of files) {
      if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(name) || name.includes("..") || typeof text !== "string") throw new Error("Artifact-set entry is invalid.");
      const filePath = join(temporary, name);
      writeFileSync(filePath, text, { flag: "wx", mode: 0o600 });
      const fileFd = openSync(filePath, "r");
      fsyncSync(fileFd);
      closeSync(fileFd);
    }
    const temporaryFd = openSync(temporary, "r");
    fsyncSync(temporaryFd);
    closeSync(temporaryFd);
    symlinkSync(basename(temporary), output, "dir");
    const parentFd = openSync(dirname(output), "r");
    fsyncSync(parentFd);
    closeSync(parentFd);
  } catch (error) {
    if (!existsSync(output)) rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function readJson(path) {
  if (!path) throw new Error("A JSON input path is required.");
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "prepare" && args.length === 4) {
    console.log(JSON.stringify(prepareFilesV2({ freezeManifestPath: args[0], assignmentPlanPath: args[1], blindedCasesPath: args[2], outputDirectory: args[3] }), null, 2));
    return;
  }
  if (command === "import" && args.length === 3) {
    console.log(JSON.stringify(importFilesV2({ preparedDirectory: args[0], labelsDirectory: args[1], outputDirectory: args[2] }), null, 2));
    return;
  }
  throw new Error(`Usage: node ${basename(process.argv[1])} prepare <freeze-manifest.json> <assignment-plan.json> <blinded-cases.json> <new-output-directory> | import <prepared-directory> <labels-directory> <new-output-directory>`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : "Human A/B v2 coordinator failed."); process.exit(1); }
}
