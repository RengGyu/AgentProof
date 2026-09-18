import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareFiles, sha256 } from "./prepare.mjs";
import { jsonHash, summarizeFiles } from "./summarize.mjs";

const clone = value => structuredClone(value);
const fraction = (numerator, denominator) => ({ numerator, denominator, rate: denominator ? numerator / denominator : null });

function corpusFixture() {
  const cases = Array.from({ length: 60 }, (_, caseIndex) => {
    const labelCount = caseIndex < 31 ? 9 : 8;
    const text = "abcdefghi";
    return {
      id: `case-${String(caseIndex + 1).padStart(2, "0")}`,
      cohort: "public",
      input: {
        title: text,
        description: text,
        taskText: "",
        changedFiles: [],
        checks: [],
        logs: [],
        repositoryPrivate: false,
      },
      labels: Array.from({ length: labelCount }, (_, labelIndex) => ({
        id: `label-${labelIndex + 1}`,
        sourceKind: labelIndex % 2 ? "pr_body" : "pr_title",
        start: labelIndex,
        end: labelIndex + 1,
        text: text[labelIndex],
        label: ["requirement", "non_requirement", "ambiguous"][labelIndex % 3],
      })),
    };
  });
  return { schemaVersion: "requirement_source_ablation.v1", labelProvenance: "source labels", cases };
}

function reviewFixture(corpus, sourceCorpusSha256) {
  return {
    sourceCorpusSha256,
    labelProvenance: "all cases manually reviewed",
    reviews: corpus.cases.map((item, index) => ({
      caseId: item.id,
      note: "reviewed",
      changes: index === 0 ? [{ labelId: "label-2", label: "ambiguous", reason: "intent remains unclear" }] : [],
    })),
  };
}

const telemetry = (live, arm) => ({
  actualRequestCount: live ? 1 : 0,
  latencyMs: live ? (arm === "B" ? 10 : 20) : null,
  httpStatus: live ? 200 : null,
  model: live ? "gpt-test-2026" : null,
  usage: live ? (arm === "B"
    ? { inputTokens: 100, outputTokens: 10, totalTokens: 110 }
    : { inputTokens: 120, outputTokens: 12, totalTokens: 132 }) : null,
});

function rowFor(label, arm, caseIndex) {
  let prediction = label.label;
  let selectionState = "full";
  let objectiveCharacters = label.label === "requirement" ? 1 : 0;
  if (arm === "B" && caseIndex === 0 && label.id === "label-1") {
    prediction = "omitted";
    selectionState = "not_selected";
    objectiveCharacters = 0;
  }
  if (arm === "C" && caseIndex === 0 && ["label-2", "label-3", "label-5"].includes(label.id)) {
    prediction = "requirement";
    objectiveCharacters = 1;
  }
  return {
    labelId: label.id,
    sourceKind: label.sourceKind,
    gold: label.label,
    contentCoverage: { prediction, selectionState, objectiveCharacters },
  };
}

function armFor(item, arm, live, caseIndex) {
  return {
    state: live ? "valid" : "not_run",
    telemetry: telemetry(live, arm),
    rows: item.labels.map(label => rowFor(label, arm, caseIndex)),
  };
}

function runFixture(batch, live, caseOffset) {
  return {
    schemaVersion: "requirement_source_ablation_result.v1",
    liveRequested: live,
    corpusHash: jsonHash(batch),
    modelProfileHash: "profile-hash",
    configuredModel: "gpt-test",
    actualRequestCount: live ? 30 : 0,
    caseCount: batch.cases.length,
    labeledUnitCount: batch.cases.reduce((sum, item) => sum + item.labels.length, 0),
    cases: batch.cases.map((item, index) => ({
      id: item.id,
      cohort: item.cohort,
      inputHash: jsonHash(item.input),
      seedHash: `seed-${item.id}`,
      sources: [{ id: `source-${item.id}`, kind: "pr_title", contentHash: `content-${item.id}` }],
      selection: { selectedSpanIds: item.labels.map(label => label.id), coverage: "complete" },
      hashes: { canonical: `A-${item.id}`, B: `B-${item.id}`, C: `C-${item.id}`, BSystem: "B-system", CSystem: "C-system", outputSchema: "schema" },
      inputBytes: { B: 100, C: 120 },
      arms: {
        B: armFor(item, "B", live, caseOffset + index),
        C: armFor(item, "C", live, caseOffset + index),
      },
    })),
  };
}

async function assertRejects(work, pattern) {
  await assert.rejects(work, pattern);
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "agentproof-bc-check-"));
  try {
    const corpus = corpusFixture();
    const corpusPath = join(root, "corpus.json");
    const corpusBytes = `${JSON.stringify(corpus, null, 2)}\n`;
    await writeFile(corpusPath, corpusBytes);
    const review = reviewFixture(corpus, sha256(corpusBytes));
    const reviewPath = join(root, "label-review.json");
    await writeFile(reviewPath, `${JSON.stringify(review, null, 2)}\n`);
    const outputDir = join(root, "prepared");

    const prepared = await prepareFiles({ corpusPath, reviewPath, outputDir });
    const reviewed = JSON.parse(await readFile(prepared.reviewedCorpusPath, "utf8"));
    assert.equal(reviewed.cases.length, 60);
    assert.equal(reviewed.cases.reduce((sum, item) => sum + item.labels.length, 0), 511);
    assert.deepEqual(reviewed.cases.map(item => item.id), corpus.cases.map(item => item.id));
    assert.equal(reviewed.cases[0].labels[1].label, "ambiguous");
    assert.equal(reviewed.cases[0].labels[1].text, "b");
    assert.deepEqual((await Promise.all(prepared.batchPaths.map(path => readFile(path, "utf8").then(JSON.parse)))).map(batch => batch.cases.length), [15, 15, 15, 15]);
    await assertRejects(() => prepareFiles({ corpusPath, reviewPath, outputDir }), /already exists/);

    const invalidReviews = [
      ["source hash", value => { value.sourceCorpusSha256 = "0".repeat(64); }],
      ["missing review", value => { value.reviews.pop(); }],
      ["unknown case", value => { value.reviews[0].caseId = "unknown-case"; }],
      ["duplicate case", value => { value.reviews.push(clone(value.reviews[0])); }],
      ["unknown label", value => { value.reviews[0].changes[0].labelId = "unknown-label"; }],
      ["duplicate label", value => { value.reviews[0].changes.push(clone(value.reviews[0].changes[0])); }],
    ];
    for (const [name, mutate] of invalidReviews) {
      const value = clone(review);
      mutate(value);
      const path = join(root, `${name.replaceAll(" ", "-")}.json`);
      await writeFile(path, JSON.stringify(value));
      await assertRejects(() => prepareFiles({ corpusPath, reviewPath: path, outputDir: join(root, `bad-${name}`) }), /invalid|mismatch|duplicate|unknown|missing/);
    }

    const invalidCorpus = clone(corpus);
    invalidCorpus.cases[0].labels[0].text = "wrong";
    const invalidCorpusPath = join(root, "invalid-corpus.json");
    const invalidCorpusBytes = JSON.stringify(invalidCorpus);
    await writeFile(invalidCorpusPath, invalidCorpusBytes);
    const boundReview = reviewFixture(invalidCorpus, sha256(invalidCorpusBytes));
    const boundReviewPath = join(root, "invalid-bound-review.json");
    await writeFile(boundReviewPath, JSON.stringify(boundReview));
    await assertRejects(() => prepareFiles({ corpusPath: invalidCorpusPath, reviewPath: boundReviewPath, outputDir: join(root, "bad-binding") }), /source binding/);

    const runsDir = join(root, "runs");
    await mkdir(runsDir);
    const batches = await Promise.all(prepared.batchPaths.map(path => readFile(path, "utf8").then(JSON.parse)));
    for (let index = 0; index < 4; index++) {
      await writeFile(join(runsDir, `live-${index + 1}.json`), JSON.stringify(runFixture(batches[index], true, index * 15)));
      await writeFile(join(runsDir, `dry-${index + 1}.json`), JSON.stringify(runFixture(batches[index], false, index * 15)));
    }
    const summary = await summarizeFiles({ directory: runsDir, reviewedCorpusPath: prepared.reviewedCorpusPath });
    assert.equal(summary.caseCount, 60);
    assert.equal(summary.labelCount, 511);
    assert.equal(summary.requests.actual, 120);
    assert.deepEqual(summary.arms.B.evaluation.all.requirementPreserved, fraction(179, 180));
    assert.deepEqual(summary.arms.B.evaluation.selectedFull.requirementPreserved, fraction(179, 179));
    assert.deepEqual(summary.arms.B.evaluation.all.notSelected, fraction(1, 511));
    assert.deepEqual(summary.arms.C.evaluation.all.nonRequirementPromoted, fraction(1, 179));
    assert.deepEqual(summary.arms.C.evaluation.all.ambiguousPromoted, fraction(2, 152));
    assert.equal(summary.arms.B.telemetry.tokens.total, 6_600);
    assert.equal(summary.arms.C.telemetry.latencyMs.total, 1_200);
    assert.equal(summary.BtoC.predictionChanged, 4);
    assert.equal(summary.BtoC.selectionStateChanged, 1);

    const live2Path = join(runsDir, "live-2.json");
    const live2 = JSON.parse(await readFile(live2Path, "utf8"));
    live2.cases[0].id = batches[0].cases[0].id;
    await writeFile(live2Path, JSON.stringify(live2));
    await assertRejects(() => summarizeFiles({ directory: runsDir, reviewedCorpusPath: prepared.reviewedCorpusPath }), /duplicate|missing|unexpected/);
    await writeFile(live2Path, JSON.stringify(runFixture(batches[1], true, 15)));
    const dry3Path = join(runsDir, "dry-3.json");
    const dry3 = JSON.parse(await readFile(dry3Path, "utf8"));
    dry3.corpusHash = "wrong";
    await writeFile(dry3Path, JSON.stringify(dry3));
    await assertRejects(() => summarizeFiles({ directory: runsDir, reviewedCorpusPath: prepared.reviewedCorpusPath }), /corpus hash mismatch/);
    await writeFile(dry3Path, JSON.stringify(runFixture(batches[2], false, 30)));
    const dry1Path = join(runsDir, "dry-1.json");
    const dry1 = JSON.parse(await readFile(dry1Path, "utf8"));
    dry1.cases[0].hashes.B = "different-request";
    await writeFile(dry1Path, JSON.stringify(dry1));
    await assertRejects(() => summarizeFiles({ directory: runsDir, reviewedCorpusPath: prepared.reviewedCorpusPath }), /request hash mismatch/);
    await writeFile(dry1Path, JSON.stringify(runFixture(batches[0], false, 0)));
    const dry1Model = JSON.parse(await readFile(dry1Path, "utf8"));
    dry1Model.configuredModel = "different-model";
    await writeFile(dry1Path, JSON.stringify(dry1Model));
    await assertRejects(() => summarizeFiles({ directory: runsDir, reviewedCorpusPath: prepared.reviewedCorpusPath }), /configured model mismatch/);
    await writeFile(dry1Path, JSON.stringify(runFixture(batches[0], false, 0)));
    await unlink(join(runsDir, "dry-4.json"));
    await assertRejects(() => summarizeFiles({ directory: runsDir, reviewedCorpusPath: prepared.reviewedCorpusPath }), /ENOENT/);

    const actualCorpusPath = join(import.meta.dirname, "..", "2026-09-14-public-60", "corpus.json");
    const actualCorpusBytes = await readFile(actualCorpusPath);
    const actualCorpus = JSON.parse(actualCorpusBytes);
    const actualReviewPath = join(root, "actual-review.json");
    await writeFile(actualReviewPath, JSON.stringify({
      sourceCorpusSha256: sha256(actualCorpusBytes),
      labelProvenance: "offline compatibility check; labels unchanged",
      reviews: actualCorpus.cases.map(item => ({ caseId: item.id, note: "schema-only check", changes: [] })),
    }));
    const actualPrepared = await prepareFiles({ corpusPath: actualCorpusPath, reviewPath: actualReviewPath, outputDir: join(root, "actual-prepared") });
    const actualReviewed = JSON.parse(await readFile(actualPrepared.reviewedCorpusPath, "utf8"));
    assert.equal(actualReviewed.cases.length, 60);
    assert.equal(actualReviewed.cases.reduce((sum, item) => sum + item.labels.length, 0), 511);

    console.log("self-check: passed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await main();
