import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildReferencePolicySealV2 } from "./evidence-release-reference-policy-v2.mjs";
const args = process.argv.slice(2); const names = ["--evidence-cases", "--boundary-cases", "--output"];
try { if (args.length !== 6 || names.some((name, i) => args[i * 2] !== name)) throw Error(); const [evidencePath, boundaryPath, outputPath] = [resolve(args[1]), resolve(args[3]), resolve(args[5])]; if (new Set([evidencePath, boundaryPath, outputPath]).size !== 3 || existsSync(outputPath)) throw Error(); const seal = buildReferencePolicySealV2({ evidenceCorpus: JSON.parse(readFileSync(evidencePath, "utf8")), boundaryCorpus: JSON.parse(readFileSync(boundaryPath, "utf8")) }); if (!seal) throw Error(); writeFileSync(outputPath, JSON.stringify(seal)); } catch { process.stderr.write("REFERENCE_POLICY_SEAL_INVALID\n"); process.exitCode = 1; }
