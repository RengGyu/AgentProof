import { describe, expect, it } from "vitest";
import { buildGeneralPrChangeObservationV2 } from "./general-pr-change-observation";

describe("buildGeneralPrChangeObservationV2", () => {
  it("records path roles as candidates without deciding behavioral impact or test necessity", () => {
    const result = buildGeneralPrChangeObservationV2([
      { path: "src/status.ts", status: "modified" },
      { path: "test/status.test.ts", status: "added" },
      { path: "docs/status.md", status: "modified" },
      { path: "config/app.yaml", status: "modified" },
      { path: "db/migrations/001.sql", status: "added" },
      { path: "dist/status.js", status: "modified" },
      { path: "pnpm-lock.yaml", status: "modified" },
      { path: ".github/workflows/ci.yml", status: "modified" }
    ]);

    expect(result.facts.map((fact) => fact.roleCandidates)).toEqual([
      ["source"], ["test"], ["documentation"], ["configuration"], ["migration", "schema"], ["generated"], ["dependency"], ["workflow", "configuration"]
    ]);
    expect(JSON.stringify(result)).not.toContain("testRequired");
    expect(JSON.stringify(result)).not.toContain("behaviorAffecting");
  });

  it("forms a rename cluster from the exact rename pair", () => {
    const result = buildGeneralPrChangeObservationV2([
      { path: "src/new-status.ts", previousPath: "src/old-status.ts", status: "renamed" }
    ]);

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]).toMatchObject({ formationBasis: "rename" });
  });

  it("uses a companion cluster only with an exact released relation", () => {
    const initial = buildGeneralPrChangeObservationV2([
      { path: "src/status.ts", status: "modified" },
      { path: "dist/status.js", status: "modified" }
    ]);
    const related = buildGeneralPrChangeObservationV2([
      { path: "src/status.ts", status: "modified" },
      { path: "dist/status.js", status: "modified" }
    ], {
      releasedRelations: [{ kind: "build_relation", fileRefs: initial.facts.map((fact) => fact.fileRef), receiptDigest: "a".repeat(64) }]
    });

    expect(initial.clusters).toHaveLength(2);
    expect(related.clusters).toEqual([expect.objectContaining({ formationBasis: "build_relation", fileRefs: initial.facts.map((fact) => fact.fileRef) })]);
  });

  it("keeps unknown extensions and incomplete inventories unresolved without guessing", () => {
    const result = buildGeneralPrChangeObservationV2([
      { path: "ops/unknown.extension", status: "modified" },
      { path: "config/feature.yaml", status: "modified" }
    ], { inventoryCompleteness: "incomplete" });

    expect(result.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ language: null, completeness: "incomplete" }),
      expect.objectContaining({ roleCandidates: ["configuration"], completeness: "incomplete" })
    ]));
  });
});
