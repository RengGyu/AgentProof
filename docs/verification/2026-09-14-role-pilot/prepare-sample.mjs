import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";

const [sourcePath, manifestPath, outputPath] = process.argv.slice(2);
if (!sourcePath || !manifestPath || !outputPath) {
  throw new Error("Usage: prepare-sample.mjs SOURCE MANIFEST NEW_OUTPUT");
}

const sourceBytes = readFileSync(sourcePath);
const source = JSON.parse(sourceBytes.toString("utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const sha256 = value => createHash("sha256").update(value).digest("hex");
if (sha256(sourceBytes) !== manifest.sourceCorpus.sha256) throw new Error("source corpus hash changed");

const byId = new Map(source.cases.map(item => [item.id, item]));
const cases = manifest.sample.map(expected => {
  const item = byId.get(expected.caseId);
  if (!item) throw new Error(`missing case ${expected.caseId}`);
  if (sha256(JSON.stringify(item.input)) !== expected.inputSha256) throw new Error(`input hash changed for ${expected.caseId}`);
  const url = new URL(item.input.url);
  if (url.pathname.split("/").slice(1, 3).join("/") !== expected.repository) throw new Error(`repository changed for ${expected.caseId}`);
  return { id: item.id, cohort: item.cohort, input: item.input, labels: [] };
});

const repositories = cases.map(item => new URL(item.input.url).pathname.split("/").slice(1, 3).join("/"));
if (new Set(repositories).size !== cases.length) throw new Error("sample repositories are not distinct");
const sample = {
  schemaVersion: "requirement_source_ablation.v1",
  labelProvenance: "Labels removed before fixed-order source-role pilot execution; see manifest.json.",
  cases,
};
const fd = openSync(outputPath, "wx", 0o600);
try {
  writeFileSync(fd, `${JSON.stringify(sample, null, 2)}\n`);
} finally {
  closeSync(fd);
}
console.log(JSON.stringify({ outputPath, caseIds: cases.map(item => item.id), labels: 0 }));
