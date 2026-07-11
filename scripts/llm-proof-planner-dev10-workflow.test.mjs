import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workflowPath = ".github/workflows/llm-proof-planner-dev10-smoke.yml";
const workflow = readFileSync(workflowPath, "utf8");

describe("LLM planner dev-10 smoke workflow", () => {
  it("is manual, confirmation-gated, and pinned to the frozen source", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("RUN_GPT_5_6_LUNA_DEV10_ONCE");
    expect(workflow).toContain("ref: 8807c8987ef857300fd519bb108869fa72faad22");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("environment: llm-evaluation");
    expect(workflow).not.toMatch(/\bpush:\s*$/m);
    expect(workflow).not.toMatch(/\bpull_request:\s*$/m);
  });

  it("uses the fixed model, one run, exact dev-10 limit, and no-clobber outputs", () => {
    expect(workflow).toContain("OPENAI_MODEL: gpt-5.6-luna");
    expect(workflow).toContain('AGENTPROOF_LLM_PROOF_PLANNER_RUNS: "1"');
    expect(workflow).toContain('AGENTPROOF_LLM_PROOF_PLANNER_LIMIT: "10"');
    expect(workflow).toContain('AGENTPROOF_LLM_PROOF_PLANNER_NO_CLOBBER: "1"');
    expect(workflow).toContain("Enforce one-shot artifact gate");
    expect(workflow).toContain("The immutable dev-10 smoke artifact already exists");
    expect(workflow).toContain("outputs/controlled-human-ab-v1/dev10-smoke/");
    expect(workflow).not.toContain("eval/llm-proof-planner-semantic-integrity-results.json");
  });

  it("keeps the secret out of artifacts and uploads only explicit summary files", () => {
    expect(workflow).toContain("OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}");
    expect(workflow.match(/OPENAI_API_KEY:/g)).toHaveLength(2);
    expect(workflow).toContain("rawPromptsStored: false");
    expect(workflow).toContain("rawReasoningStored: false");
    expect(workflow).toContain("apiKeyStored: false");
    expect(workflow).toContain("artifactText.includes(process.env.OPENAI_API_KEY)");
    expect(workflow).toContain("forbiddenField.test(artifactText)");
    expect(workflow).toContain('evaluationArtifactSchemaVersion !== "llm-proof-planner-evaluation.v2.1"');
    expect(workflow).toContain('plannerOutputSchemaVersion !== "2.1"');
    expect(workflow).toContain("evaluationHarnessSha256");
    expect(workflow).toContain("include-hidden-files: false");
    expect(workflow).toContain("if-no-files-found: error");
    expect(workflow).not.toMatch(/^\s+path:\s+outputs\/controlled-human-ab-v1\/dev10-smoke\/?\s*$/m);
  });
});
