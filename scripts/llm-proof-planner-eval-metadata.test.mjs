import { describe, expect, it } from "vitest";
import {
  buildEvaluationReproducibility,
  EVALUATION_ARTIFACT_SCHEMA_VERSION,
  hasCompleteReproducibilityMetadata,
  normalizeModelIdentifier,
  PLANNER_INPUT_SCHEMA_VERSION,
  PLANNER_OUTPUT_SCHEMA_VERSION
} from "./llm-proof-planner-eval-metadata.mjs";

const cleanCommit = "04ef1fdc8f9d91f3f72b0a6ac1df3213e27ef249";

function build(overrides = {}) {
  return buildEvaluationReproducibility({
    requestedModel: "gpt-5.6-luna",
    resolvedModels: ["gpt-5.6-luna-2026-07-01"],
    promptVersion: "llm-proof-planner-v2-semantic-integrity",
    sourceCommit: cleanCommit,
    workingTreeDirty: false,
    workingTreeChangedPathCount: 0,
    promptText: "semantic planner prompt",
    plannerSchema: { type: "object", required: [] },
    harnessSource: "evaluation harness source",
    baselineSource: "summary-only baseline source",
    previousAbSource: null,
    ...overrides
  });
}

describe("LLM proof planner evaluation reproducibility metadata", () => {
  it("records exact v1/v2.1 compatibility and a single resolved model snapshot", () => {
    const metadata = build();

    expect(metadata).toMatchObject({
      evaluationArtifactSchemaVersion: EVALUATION_ARTIFACT_SCHEMA_VERSION,
      plannerInputSchemaVersion: PLANNER_INPUT_SCHEMA_VERSION,
      plannerOutputSchemaVersion: PLANNER_OUTPUT_SCHEMA_VERSION,
      requestedModel: "gpt-5.6-luna",
      modelSnapshot: "gpt-5.6-luna-2026-07-01",
      resolvedModelSnapshots: ["gpt-5.6-luna-2026-07-01"],
      modelSnapshotStatus: "single",
      sourceCommit: cleanCommit,
      workingTreeDirty: false
    });
    expect(metadata.schemaCompatibility.legacyPlannerOutputV1).toContain("rejected");
    expect(metadata.schemaCompatibility.historicalPlannerOutputV2).toContain("rejected");
    expect(Object.values(metadata.digests).filter((value) => typeof value === "string" && value.length === 64))
      .toHaveLength(4);
    expect(hasCompleteReproducibilityMetadata(metadata)).toBe(true);
  });

  it("does not guess a snapshot when resolved models are mixed or unavailable", () => {
    const mixed = build({ resolvedModels: ["snapshot-a", "snapshot-b"] });
    const unavailable = build({ resolvedModels: [] });

    expect(mixed).toMatchObject({ modelSnapshot: null, modelSnapshotStatus: "mixed" });
    expect(unavailable).toMatchObject({ modelSnapshot: null, modelSnapshotStatus: "unavailable" });
    expect(hasCompleteReproducibilityMetadata(mixed)).toBe(false);
    expect(hasCompleteReproducibilityMetadata(unavailable)).toBe(false);
  });

  it("keeps dirty or unidentified source state blocked", () => {
    expect(hasCompleteReproducibilityMetadata(build({ workingTreeDirty: true, workingTreeChangedPathCount: 91 }))).toBe(false);
    expect(hasCompleteReproducibilityMetadata(build({ sourceCommit: null }))).toBe(false);
  });

  it("rejects secret-shaped or malformed model identifiers instead of persisting them", () => {
    expect(normalizeModelIdentifier("gpt-5.6-luna")).toBe("gpt-5.6-luna");
    expect(normalizeModelIdentifier("not a model id")).toBeNull();
    expect(normalizeModelIdentifier("x".repeat(121))).toBeNull();
  });
});
