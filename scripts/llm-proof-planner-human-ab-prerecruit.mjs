#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFreezeManifestFromLocalEvidence, buildSeededAssignmentPlan, sealHoldout, verifyRaterWorkbookOoxml } from "./llm-proof-planner-human-ab-prerecruit-core.mjs";
import { sha256, stableJson } from "./llm-proof-planner-human-ab-v2-core.mjs";

function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
function rejectInsideRepository(path) {
  const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const target = resolve(path);
  if (target === root || target.startsWith(`${root}/`)) throw new Error("Private holdout material must be stored outside the repository.");
  return target;
}
function writeNew(path, text) {
  if (existsSync(path)) throw new Error("No-clobber refused an existing output.");
  writeFileSync(path, text, { encoding: "utf8", flag: "wx", mode: 0o600 });
}
export function sealFiles({ policyPath, registryPath, privateManifestPath, holdoutId, normalizerVersion, receiptPath }) {
  rejectInsideRepository(privateManifestPath);
  const sealed = sealHoldout({ policy: readJson(policyPath), registry: readJson(registryPath), privateManifest: readJson(privateManifestPath), holdoutId, normalizerVersion });
  writeNew(receiptPath, sealed.receiptText);
  return { receiptPath: resolve(receiptPath), receiptSha256: sha256(sealed.receiptText), caseCount: sealed.receipt.caseCount };
}
export function freezeFiles({ configPath, outputPath, cwd = process.cwd() }) {
  const manifest = buildFreezeManifestFromLocalEvidence({ cwd, config: readJson(configPath) });
  writeNew(outputPath, stableJson(manifest));
  return { outputPath: resolve(outputPath), status: manifest.status, blockers: manifest.blockers };
}
export function verifyWorkbookFiles({ workbookPath, verifierSourcePath }) {
  return verifyRaterWorkbookOoxml({ workbookPath, verifierSourceText: readFileSync(verifierSourcePath, "utf8") });
}
export function assignFiles({ receiptPath, caseIdsPath, rosterPath, seedPath, planPath, preflightPath, randomizationReceiptPath }) {
  rejectInsideRepository(caseIdsPath);
  rejectInsideRepository(rosterPath);
  rejectInsideRepository(seedPath);
  const built = buildSeededAssignmentPlan({ holdoutReceipt: readJson(receiptPath), opaqueCaseIds: readJson(caseIdsPath), raterPseudonyms: readJson(rosterPath), seed: readFileSync(seedPath, "utf8").trim() });
  writeNew(planPath, stableJson(built.plan));
  writeNew(preflightPath, stableJson(built.preflight));
  writeNew(randomizationReceiptPath, stableJson(built.randomizationReceipt));
  return { planPath: resolve(planPath), assignmentCount: built.plan.assignments.length, seedCommitmentSha256: built.randomizationReceipt.seedCommitmentSha256 };
}
function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "seal" && args.length === 6) return console.log(JSON.stringify(sealFiles({ policyPath: args[0], registryPath: args[1], privateManifestPath: args[2], holdoutId: args[3], normalizerVersion: args[4], receiptPath: args[5] }), null, 2));
  if (command === "freeze" && args.length === 2) return console.log(JSON.stringify(freezeFiles({ configPath: args[0], outputPath: args[1] }), null, 2));
  if (command === "workbook-qa" && args.length === 2) return console.log(JSON.stringify(verifyWorkbookFiles({ workbookPath: args[0], verifierSourcePath: args[1] }), null, 2));
  if (command === "assign" && args.length === 7) return console.log(JSON.stringify(assignFiles({ receiptPath: args[0], caseIdsPath: args[1], rosterPath: args[2], seedPath: args[3], planPath: args[4], preflightPath: args[5], randomizationReceiptPath: args[6] }), null, 2));
  throw new Error(`Usage: node ${basename(process.argv[1])} seal <policy.json> <registry.json> <private-manifest-outside-repo.json> <holdout-id> <normalizer-version> <new-receipt.json> | freeze <config.json> <new-manifest.json> | assign <receipt.json> <case-ids-outside-repo.json> <roster-outside-repo.json> <seed-outside-repo.txt> <new-plan.json> <new-preflight.json> <new-randomization-receipt.json> | workbook-qa <rater-workbook.xlsx> <verifier-source.mjs>`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { try { main(); } catch (error) { console.error(error instanceof Error ? error.message : "Human A/B pre-recruit coordinator failed."); process.exit(1); } }
