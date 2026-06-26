import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { promoteEvalFixture, promoteEvalFixtureFromCli } from "./promote-eval-fixture.mjs";

const HIDDEN_TEST = "tests/private_oracle.py::test_future_behavior";
const SECRET_TEXT = "token=github_pat_abcdefghijklmnopqrstuvwxyz123456";

function normalizedCase(overrides = {}) {
  return {
    id: "example__project-1",
    source: {
      id: "swebench-verified",
      name: "SWE-bench Verified",
      url: "https://huggingface.co/datasets/princeton-nlp/SWE-bench_Verified",
      licenseNote: "Public source; fixture promotion strips raw hidden oracle labels.",
      oracleType: "test_transition",
      oracleStrength: "strong"
    },
    input: {
      title: "Issue-linked PR example__project-1",
      url: "https://github.com/example/project",
      description: `Reviewer context with ${SECRET_TEXT}.`,
      baseBranch: "base:abc123",
      headBranch: "candidate-fix",
      taskText: `Fix export ordering. ${SECRET_TEXT}`,
      changedFiles: [
        {
          path: "src/export.py",
          additions: 2,
          deletions: 1,
          status: "modified",
          patch: "@@ -1,2 +1,3 @@\n-headers = sorted(custom_fields)\n+headers = list(custom_fields)"
        },
        {
          path: "tests/test_export.py",
          additions: 3,
          deletions: 0,
          status: "modified",
          patch: "@@ -10,2 +10,5 @@\n+def test_custom_field_order_is_preserved():\n+    assert export_headers(['b', 'a']) == ['b', 'a']"
        }
      ],
      checks: [],
      logs: [],
      limitations: [
        "No live CI log was provided; passing behavior must stay unclear unless visible evidence proves it."
      ]
    },
    oracle: {
      description: "Generated source case contains raw oracle labels before promotion.",
      hiddenLabels: ["FAIL_TO_PASS", "PASS_TO_PASS"],
      hiddenValues: [HIDDEN_TEST],
      deniedReportTerms: ["FAIL_TO_PASS", "PASS_TO_PASS"],
      visibleImplementationFiles: ["src/export.py"],
      visibleChangedFiles: ["src/export.py", "tests/test_export.py"],
      visibleTestFiles: ["tests/test_export.py"],
      failToPassTests: [HIDDEN_TEST],
      passToPassTests: ["tests/test_export.py::test_existing_export"]
    },
    ...overrides
  };
}

describe("promote eval fixture script", () => {
  it("can be imported without running the CLI", async () => {
    expect(typeof promoteEvalFixture).toBe("function");
    expect(typeof promoteEvalFixtureFromCli).toBe("function");
  });

  it("promotes normalized generated cases into scrubbed fixture and manifest files", async () => {
    const logs = [];
    const fs = memoryFs(`${JSON.stringify(normalizedCase())}\n`);
    const result = await promoteEvalFixture({
      input: "eval/generated/unit.cases.jsonl",
      output: "eval/fixtures/unit.promoted.jsonl",
      caseIds: ["example__project-1"],
      sourceOffset: 3,
      sourceLength: 1,
      generatedAt: "2026-06-26T00:00:00.000Z",
      selectionCriteria: ["Unit fixture promotion coverage."]
    }, {
      ...fs,
      logger: {
        log: (message) => logs.push(message)
      }
    });
    const fixtureText = fs.files.get(result.output);
    const manifestText = fs.files.get(result.manifestOutput);
    const [record] = fixtureText.trim().split(/\n+/).map((line) => JSON.parse(line));
    const manifest = JSON.parse(manifestText);

    expect(record.oracle.hiddenValues).toEqual([]);
    expect(record.oracle.failToPassTests).toEqual([]);
    expect(record.oracle.passToPassTests).toEqual([]);
    expect(Object.keys(record)).not.toEqual(expect.arrayContaining([
      "repo",
      "patch",
      "test_patch",
      "problem_statement",
      "FAIL_TO_PASS",
      "PASS_TO_PASS"
    ]));
    expect(record.oracle.visibleChangedFiles).toEqual(record.input.changedFiles.map((file) => file.path));
    expect(JSON.stringify(record.input)).not.toContain(SECRET_TEXT);
    expect(fixtureText).not.toContain(HIDDEN_TEST);
    expect(fixtureText).not.toContain("github_pat_");
    expect(manifest).toMatchObject({
      caseCount: 1,
      caseIds: ["example__project-1"],
      fixtureFile: "unit.promoted.jsonl",
      sourceOffset: 3,
      sourceLength: 1,
      normalizerVersion: "evaluation-pack-v1"
    });
    expect(manifest.sha256).toBe(sha256(fixtureText));
    expect(manifest.sourceRowSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.oracleLabelCount).toBe(2);
    expect(manifest.oracleLabelSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(logs.join("\n")).toContain("Promoted 1 normalized evaluation case");
    expect(logs.join("\n")).not.toContain(HIDDEN_TEST);
    expect(logs.join("\n")).not.toContain(SECRET_TEXT);
  });

  it("compacts many small patches to stay under the case byte cap", async () => {
    const patch = Array.from({ length: 40 }, (_value, index) => `+line_${index}_${"x".repeat(60)}`).join("\n");
    const testCase = normalizedCase({
      input: {
        ...normalizedCase().input,
        changedFiles: Array.from({ length: 5 }, (_value, index) => ({
          path: `src/file_${index}.py`,
          additions: 40,
          deletions: 0,
          status: "modified",
          patch
        }))
      },
      oracle: {
        ...normalizedCase().oracle,
        visibleImplementationFiles: Array.from({ length: 5 }, (_value, index) => `src/file_${index}.py`),
        visibleChangedFiles: Array.from({ length: 5 }, (_value, index) => `src/file_${index}.py`),
        visibleTestFiles: []
      }
    });
    const fs = memoryFs(`${JSON.stringify(testCase)}\n`);
    const result = await promoteEvalFixture({
      input: "eval/generated/large.cases.jsonl",
      output: "eval/fixtures/large.promoted.jsonl",
      caseIds: ["example__project-1"],
      maxCasePatchBytes: 500,
      maxFilePatchBytes: 300,
      maxPatchLines: 20,
      generatedAt: "2026-06-26T00:00:00.000Z"
    }, {
      ...fs,
      logger: { log: () => undefined }
    });
    const [record] = fs.files.get(result.output).trim().split(/\n+/).map((line) => JSON.parse(line));
    const totalPatchBytes = record.input.changedFiles.reduce(
      (total, file) => total + Buffer.byteLength(file.patch ?? "", "utf8"),
      0
    );

    expect(totalPatchBytes).toBeLessThanOrEqual(500);
    expect(Math.max(...record.input.changedFiles.map((file) => file.patch.split(/\n/).length))).toBeLessThanOrEqual(20);
    expect(record.input.changedFiles.some((file) => file.patch.includes("fixture excerpt truncated"))).toBe(true);
  });

  it("rejects raw dataset rows and path escapes before writing", async () => {
    const rawRow = JSON.stringify({
      repo: "example/project",
      patch: "diff --git a/a.py b/a.py",
      test_patch: "diff --git a/test_a.py b/test_a.py",
      problem_statement: "Fix behavior.",
      FAIL_TO_PASS: JSON.stringify([HIDDEN_TEST]),
      PASS_TO_PASS: "[]"
    });
    const rawFs = memoryFs(`${rawRow}\n`);

    await expect(promoteEvalFixture({
      input: "eval/generated/raw.cases.jsonl",
      output: "eval/fixtures/raw.promoted.jsonl",
      caseIds: ["example__project-1"]
    }, rawFs)).rejects.toThrow("must contain normalized EvaluationCase records");

    const pathEscapeFs = memoryFs(`${JSON.stringify(normalizedCase())}\n`);

    await expect(promoteEvalFixture({
      input: "eval/fixtures/not-generated.jsonl",
      output: "eval/fixtures/unit.promoted.jsonl",
      caseIds: ["example__project-1"]
    }, pathEscapeFs)).rejects.toThrow("Promotion input must be a normalized JSONL file under eval/generated");

    await expect(promoteEvalFixture({
      input: "eval/generated/unit.cases.jsonl",
      output: "eval/generated/not-fixture.jsonl",
      caseIds: ["example__project-1"]
    }, pathEscapeFs)).rejects.toThrow("Promoted evaluation fixtures must be written under eval/fixtures");
  });

  it("does not leave final fixture files when temp writes fail", async () => {
    const fs = memoryFs(`${JSON.stringify(normalizedCase())}\n`, {
      failWrite: (path) => path.includes(".manifest.json.tmp-")
    });

    await expect(promoteEvalFixture({
      input: "eval/generated/unit.cases.jsonl",
      output: "eval/fixtures/unit.promoted.jsonl",
      caseIds: ["example__project-1"]
    }, {
      ...fs,
      logger: { log: () => undefined }
    })).rejects.toThrow("Injected write failure");

    expect([...fs.files.keys()].filter((path) => path.includes("unit.promoted"))).toEqual([]);
  });

  it("parses repeated case flags from the CLI wrapper", async () => {
    const fs = memoryFs([
      JSON.stringify(normalizedCase({ id: "case-a" })),
      JSON.stringify(normalizedCase({ id: "case-b" }))
    ].join("\n") + "\n");
    const result = await promoteEvalFixtureFromCli([
      "--input",
      "eval/generated/unit.cases.jsonl",
      "--output",
      "eval/fixtures/unit.promoted.jsonl",
      "--case",
      "case-a",
      "--case",
      "case-b",
      "--generated-at",
      "2026-06-26T00:00:00.000Z"
    ], {
      ...fs,
      logger: { log: () => undefined }
    });

    expect(result.caseIds).toEqual(["case-a", "case-b"]);
  });
});

function memoryFs(inputText, options = {}) {
  const files = new Map();
  const inputPath = `${process.cwd()}/eval/generated/unit.cases.jsonl`;
  const largeInputPath = `${process.cwd()}/eval/generated/large.cases.jsonl`;
  const rawInputPath = `${process.cwd()}/eval/generated/raw.cases.jsonl`;

  files.set(inputPath, inputText);
  files.set(largeInputPath, inputText);
  files.set(rawInputPath, inputText);

  return {
    files,
    exists: (path) => files.has(path),
    mkdir: async () => undefined,
    readFile: async (path) => {
      if (!files.has(path)) {
        throw new Error(`Missing test file ${path}`);
      }
      return files.get(path);
    },
    writeFile: async (path, text) => {
      if (options.failWrite?.(path)) {
        throw new Error("Injected write failure");
      }
      files.set(path, text);
    },
    rename: async (from, to) => {
      if (!files.has(from)) {
        throw new Error(`Missing temp file ${from}`);
      }
      files.set(to, files.get(from));
      files.delete(from);
    },
    unlink: async (path) => {
      files.delete(path);
    }
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
