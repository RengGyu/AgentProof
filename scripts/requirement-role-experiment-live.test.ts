import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  createOpenAIRequirementRoleExperimentProvider,
  loadOpenAIKeyFromEnvFile,
} from "./requirement-role-experiment-live";
import { runRequirementRoleExperiment } from "./requirement-role-experiment";

const corpus = {
  schemaVersion: "requirement_source_ablation.v1" as const,
  labelProvenance: "unlabeled live adapter test",
  cases: [{
    id: "live-adapter",
    cohort: "controlled" as const,
    input: { title: "Preserve query parameters", description: "", taskText: "", repositoryPrivate: false, changedFiles: [], checks: [], logs: [] },
    labels: [],
  }],
};
const modelProfile = { model: "test-model", promptVersion: "requirement-role-experiment.v1", inputFieldPolicyVersion: "live-source-role-research.v1" };

it("loads only OPENAI_API_KEY from the explicitly selected env file with the installed parser", () => {
  const file = join(mkdtempSync(join(tmpdir(), "role-key-")), ".env.local");
  writeFileSync(file, "OTHER_SECRET=must-not-load\nexport OPENAI_API_KEY=\"synthetic-key\" # comment\n");
  const priorKey = process.env.OPENAI_API_KEY;
  const priorOther = process.env.OTHER_SECRET;
  try {
    delete process.env.OPENAI_API_KEY;
    delete process.env.OTHER_SECRET;
    expect(loadOpenAIKeyFromEnvFile(file)).toBe("synthetic-key");
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
    expect(process.env.OTHER_SECRET).toBeUndefined();
  } finally {
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = priorKey;
    if (priorOther === undefined) delete process.env.OTHER_SECRET; else process.env.OTHER_SECRET = priorOther;
  }
});

it("uses the existing transport once and persists only sanitized response telemetry", async () => {
  const journalPath = join(mkdtempSync(join(tmpdir(), "role-journal-")), "calls.jsonl");
  let fetchCalls = 0;
  const fetchFn: typeof fetch = async (_url, init) => {
    fetchCalls++;
    const body = JSON.parse(String(init?.body));
    const input = JSON.parse(body.input[1].content[0].text);
    const output = {
      spanRoles: input.spans.map((span: { id: string }) => ({ spanId: span.id, role: "supporting_context" })),
      unionMemberCandidates: [],
    };
    return new Response(JSON.stringify({
      model: "gpt-5.6-luna-observed",
      usage: { input_tokens: 101, output_tokens: 23, total_tokens: 124 },
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }],
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const ticks = [10, 17];
  const result = await runRequirementRoleExperiment(corpus, {
    modelProfile,
    maxCalls: 1,
    provider: createOpenAIRequirementRoleExperimentProvider({ apiKey: "synthetic-key", fetchFn, clock: () => ticks.shift()!, journalPath }),
  });
  expect(fetchCalls).toBe(1);
  expect(result.actualCallCount).toBe(1);
  expect(result.cases[0]!.versions.V0.calls[0]).toMatchObject({
    state: "valid",
    telemetry: { latencyMs: 7, httpStatus: 200, observedModel: "gpt-5.6-luna-observed", inputTokens: 101, outputTokens: 23, totalTokens: 124 },
  });
  expect(JSON.stringify(result)).not.toContain("synthetic-key");
  const events = readFileSync(journalPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(events).toEqual([
    expect.objectContaining({ event: "started", state: "in_flight", callId: "live-adapter:V0:initial:1", caseId: "live-adapter", version: "V0", pass: "initial" }),
    expect.objectContaining({ event: "finished", state: "provider_succeeded", callId: "live-adapter:V0:initial:1", httpStatus: 200, observedModel: "gpt-5.6-luna-observed", inputTokens: 101, outputTokens: 23, totalTokens: 124, latencyMs: 7 }),
  ]);
  expect(JSON.stringify(events)).not.toContain("synthetic-key");
  expect(JSON.stringify(events)).not.toContain("Preserve query parameters");
});

it("records sanitized provider failure telemetry without retrying", async () => {
  const journalPath = join(mkdtempSync(join(tmpdir(), "role-journal-")), "calls.jsonl");
  let fetchCalls = 0;
  const ticks = [20, 29];
  const result = await runRequirementRoleExperiment(corpus, {
    modelProfile,
    maxCalls: 1,
    provider: createOpenAIRequirementRoleExperimentProvider({
      apiKey: "synthetic-key",
      clock: () => ticks.shift()!,
      journalPath,
      fetchFn: async () => { fetchCalls++; return new Response("{}", { status: 401 }); },
    }),
  });
  expect(fetchCalls).toBe(1);
  expect(result.cases[0]!.versions.V0.calls[0]).toMatchObject({
    state: "unavailable",
    reason: "provider_auth_failed",
    retryCount: 0,
    telemetry: { latencyMs: 9, httpStatus: 401, observedModel: null, inputTokens: null, outputTokens: null, totalTokens: null },
  });
  const events = readFileSync(journalPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(events).toHaveLength(2);
  expect(events[0]).toMatchObject({ event: "started", state: "in_flight", callId: "live-adapter:V0:initial:1" });
  expect(events[1]).toMatchObject({ event: "finished", state: "provider_failed", callId: "live-adapter:V0:initial:1", errorCategory: "auth_failed", httpStatus: 401, latencyMs: 9 });
});

it("refuses to clobber an existing call journal", () => {
  const journalPath = join(mkdtempSync(join(tmpdir(), "role-journal-")), "calls.jsonl");
  writeFileSync(journalPath, "prior evidence\n");
  expect(() => createOpenAIRequirementRoleExperimentProvider({ apiKey: "synthetic-key", journalPath })).toThrow(/journal already exists/);
  expect(readFileSync(journalPath, "utf8")).toBe("prior evidence\n");
});
