import { describe, expect, it } from "vitest";
import { classifyGeneralPrClaimsV1 } from "./general-pr-claim-classifier";
import { parseGeneralPrStructureV1 } from "./general-pr-structure";

function classify(source: string) {
  return classifyGeneralPrClaimsV1(source, parseGeneralPrStructureV1(source));
}

describe("classifyGeneralPrClaimsV1", () => {
  it("classifies explicit objectives, observed problems, change claims, tests, scope, and process metadata without creating proof data", () => {
    const source = [
      "## Acceptance criteria",
      "The service must return `Ready` when checks pass.",
      "## Current behavior",
      "The old response fails when checks pass.",
      "## Change",
      "This PR adds the missing label.",
      "## Testing",
      "pnpm test passed locally.",
      "## Scope",
      "A follow-up PR will add analytics.",
      "## Review",
      "Risk: low; please review the migration."
    ].join("\n\n");

    const classifications = classify(source);
    const roles = classifications.map((item) => item.role);

    expect(roles).toContain("objective_candidate");
    expect(roles).toContain("problem_observation");
    expect(roles).toContain("change_claim");
    expect(roles).toContain("test_or_validation_claim");
    expect(roles).toContain("scope_or_follow_up");
    expect(roles).toContain("process_or_template_meta");
    expect(classifications.every((item) => item.version === 1 && typeof item.structuralSpanId === "string")).toBe(true);
    expect(classifications.every((item) => /^[a-f0-9]{64}$/.test(item.textHash))).toBe(true);
    expect(JSON.stringify(classifications)).not.toContain("return `Ready`");
    expect(Object.keys(classifications[0] ?? {}).sort()).toEqual([
      "abstained", "role", "structuralSpanId", "textHash", "version"
    ]);
  });

  it("abstains on an unsafe mixed clause and ignores a tampered structural binding", () => {
    const source = "This PR adds a label and tests now pass.";
    const structure = parseGeneralPrStructureV1(source);
    const classifications = classifyGeneralPrClaimsV1(source, structure);

    expect(classifications).toContainEqual(expect.objectContaining({
      role: "mixed_or_unknown",
      abstained: true
    }));

    const tampered = {
      ...structure,
      spans: structure.spans.map((span) => ({ ...span, textHash: "0".repeat(64) }))
    };
    expect(classifyGeneralPrClaimsV1(source, tampered)).toEqual([]);
  });

  it("classifies excluded code and HTML as process metadata rather than objectives", () => {
    const source = [
      "```ts",
      "// The service must return Ready.",
      "```",
      "",
      "<!-- The service must return Ready. -->"
    ].join("\n");

    expect(classify(source)).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "process_or_template_meta", abstained: false })
    ]));
    expect(classify(source)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "objective_candidate" })
    ]));
  });

  it("keeps headings and quoted text as context even when their wording looks like an objective", () => {
    const source = [
      "## The service must return Ready",
      "",
      "> The service must return Ready when checks pass.",
      "",
      "The service must return Ready when checks pass."
    ].join("\n");

    const structure = parseGeneralPrStructureV1(source);
    const classifications = classifyGeneralPrClaimsV1(source, structure);
    const roleByKind = new Map(structure.spans.map((span, index) => [span.kind, classifications[index]?.role]));

    expect(roleByKind.get("heading")).toBe("supporting_context");
    expect(roleByKind.get("blockquote")).toBe("supporting_context");
    expect(roleByKind.get("paragraph")).toBe("objective_candidate");
  });
});
