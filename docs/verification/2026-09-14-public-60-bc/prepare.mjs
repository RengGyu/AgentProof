import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const labels = new Set(["requirement", "non_requirement", "ambiguous"]);
const sourceKinds = new Set(["provided_requirement", "linked_issue", "pr_title", "pr_body"]);
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = message => { throw new Error(message); };

export const sha256 = value => createHash("sha256").update(value).digest("hex");

function sourceText(input, sourceKind) {
  if (sourceKind === "pr_title") return input.title;
  if (sourceKind === "pr_body") return input.description;
  return sourceKind === (input.taskSource === "issue" ? "linked_issue" : "provided_requirement") ? input.taskText : "";
}

function validateCorpus(corpus) {
  if (!record(corpus) || corpus.schemaVersion !== "requirement_source_ablation.v1" || typeof corpus.labelProvenance !== "string" || !Array.isArray(corpus.cases) || corpus.cases.length !== 60) fail("invalid corpus: expected requirement_source_ablation.v1 with 60 cases");
  const caseIds = new Set();
  let labelCount = 0;
  for (const item of corpus.cases) {
    if (!record(item) || typeof item.id !== "string" || caseIds.has(item.id) || !record(item.input) || !Array.isArray(item.labels)) fail("invalid corpus case or duplicate case id");
    caseIds.add(item.id);
    const input = item.input;
    if (typeof input.title !== "string" || typeof input.description !== "string" || typeof input.taskText !== "string") fail(`invalid corpus input: ${item.id}`);
    const labelIds = new Set();
    for (const label of item.labels) {
      labelCount++;
      if (!record(label) || typeof label.id !== "string" || labelIds.has(label.id) || !sourceKinds.has(label.sourceKind) || !labels.has(label.label) || typeof label.text !== "string" || !Number.isSafeInteger(label.start) || !Number.isSafeInteger(label.end)) fail(`invalid label: ${item.id}`);
      labelIds.add(label.id);
      const text = sourceText(input, label.sourceKind);
      if (label.start < 0 || label.end <= label.start || label.end > text.length || text.slice(label.start, label.end) !== label.text) fail(`source binding invalid: ${item.id}/${label.id}`);
    }
  }
  if (labelCount !== 511) fail(`invalid corpus: expected 511 labels, received ${labelCount}`);
}

function applyReview(corpus, review, sourceCorpusSha256) {
  if (!record(review) || review.sourceCorpusSha256 !== sourceCorpusSha256) fail("source corpus hash mismatch");
  if (typeof review.labelProvenance !== "string" || !review.labelProvenance.trim() || !Array.isArray(review.reviews)) fail("invalid label review");
  const cases = new Map(corpus.cases.map(item => [item.id, item]));
  const seenCases = new Set();
  const changes = new Map();
  for (const item of review.reviews) {
    if (!record(item) || typeof item.caseId !== "string" || typeof item.note !== "string" || !Array.isArray(item.changes)) fail("invalid review entry");
    if (!cases.has(item.caseId)) fail(`unknown case id: ${item.caseId}`);
    if (seenCases.has(item.caseId)) fail(`duplicate case review: ${item.caseId}`);
    seenCases.add(item.caseId);
    const knownLabels = new Set(cases.get(item.caseId).labels.map(label => label.id));
    const seenLabels = new Set();
    for (const change of item.changes) {
      if (!record(change) || typeof change.labelId !== "string" || !labels.has(change.label) || typeof change.reason !== "string" || !change.reason.trim()) fail(`invalid label change: ${item.caseId}`);
      if (!knownLabels.has(change.labelId)) fail(`unknown label id: ${item.caseId}/${change.labelId}`);
      if (seenLabels.has(change.labelId)) fail(`duplicate label change: ${item.caseId}/${change.labelId}`);
      seenLabels.add(change.labelId);
      changes.set(`${item.caseId}\0${change.labelId}`, change.label);
    }
  }
  if (seenCases.size !== corpus.cases.length) fail(`missing case reviews: expected ${corpus.cases.length}, received ${seenCases.size}`);
  const reviewed = structuredClone(corpus);
  reviewed.labelProvenance = review.labelProvenance;
  for (const item of reviewed.cases) {
    for (const label of item.labels) label.label = changes.get(`${item.id}\0${label.id}`) ?? label.label;
  }
  return reviewed;
}

const boundaryProjection = corpus => corpus.cases.map(item => ({
  id: item.id,
  cohort: item.cohort,
  input: item.input,
  labels: item.labels.map(({ label: _label, ...boundary }) => boundary),
}));

async function writeNewJsonFiles(files) {
  const opened = [];
  try {
    for (const [path] of files) opened.push([path, await open(path, "wx")]);
    await Promise.all(opened.map(([path, handle]) => handle.writeFile(`${JSON.stringify(files.find(([candidate]) => candidate === path)[1], null, 2)}\n`)));
  } catch (error) {
    await Promise.allSettled(opened.map(([, handle]) => handle.close()));
    await Promise.allSettled(opened.map(([path]) => unlink(path)));
    if (error?.code === "EEXIST") fail(`output already exists: ${error.path}`);
    throw error;
  }
  await Promise.all(opened.map(([, handle]) => handle.close()));
}

export async function prepareFiles({ corpusPath, reviewPath, outputDir }) {
  const corpusBytes = await readFile(corpusPath);
  const corpus = JSON.parse(corpusBytes);
  const review = JSON.parse(await readFile(reviewPath, "utf8"));
  validateCorpus(corpus);
  const reviewed = applyReview(corpus, review, sha256(corpusBytes));
  validateCorpus(reviewed);
  if (JSON.stringify(boundaryProjection(reviewed)) !== JSON.stringify(boundaryProjection(corpus))) fail("corpus boundary invariant changed");
  await mkdir(outputDir, { recursive: true });
  const reviewedCorpusPath = join(outputDir, "reviewed-corpus.json");
  const batchPaths = Array.from({ length: 4 }, (_, index) => join(outputDir, `batch-${index + 1}.json`));
  const batches = batchPaths.map((path, index) => [path, { ...reviewed, cases: reviewed.cases.slice(index * 15, (index + 1) * 15) }]);
  await writeNewJsonFiles([[reviewedCorpusPath, reviewed], ...batches]);
  return { reviewedCorpusPath, batchPaths };
}

async function cli() {
  const [corpusArg, reviewArg, outputArg] = process.argv.slice(2);
  const result = await prepareFiles({
    corpusPath: resolve(corpusArg ?? join(here, "../2026-09-14-public-60/corpus.json")),
    reviewPath: resolve(reviewArg ?? join(here, "label-review.json")),
    outputDir: resolve(outputArg ?? here),
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch(error => { console.error(error.message); process.exitCode = 1; });
}
