import { describe, expect, it } from "vitest";
import { requirementProofExpectations } from "./verifier-proof-expectations";

describe("requirementProofExpectations", () => {
  it.each([
    ["Add retry handling and tests.", { implementation: true, targetedTest: true, visual: false, noImplementationChanges: false }],
    ["Add tests for retry handling.", { implementation: false, targetedTest: true, visual: false, noImplementationChanges: false }],
    ["재시도 기능을 추가하고 회귀 테스트를 추가합니다.", { implementation: true, targetedTest: true, visual: false, noImplementationChanges: false }],
    ["재시도 기능 동작을 변경하고 테스트를 추가합니다.", { implementation: true, targetedTest: true, visual: false, noImplementationChanges: false }],
    ["재시도 테스트를 추가합니다.", { implementation: false, targetedTest: true, visual: false, noImplementationChanges: false }],
    ["Keep the compact settings panel readable at 375px and add regression tests.", { implementation: true, targetedTest: true, visual: true, noImplementationChanges: false }],
    ["Run the existing npm test command in the cache-check workflow.", { implementation: false, ci: true, targetedTest: false, visual: false, noImplementationChanges: false }],
    ["Reject overlapping booking windows.", { implementation: true, targetedTest: false, visual: false, noImplementationChanges: false }],
    ["Do not change implementation code.", { implementation: false, targetedTest: false, visual: false, noImplementationChanges: true }],
    ["Add regression tests without changing implementation code.", { implementation: false, targetedTest: true, visual: false, noImplementationChanges: true }],
    ["Document the retry queue without implementation changes.", { implementation: false, documentation: true, targetedTest: false, visual: false, noImplementationChanges: true }],
    ["Do not add implementation code.", { implementation: false, targetedTest: false, visual: false, noImplementationChanges: true }],
    ["Documentar el reinicio del entorno local.", { implementation: false, documentation: true, targetedTest: false, visual: false, noImplementationChanges: false }]
  ])("classifies %s without collapsing behavior and tests", (text, expected) => {
    expect(requirementProofExpectations(text)).toMatchObject(expected);
  });

  it("FH01 treats Markdown list markers as presentation while preserving behavior modality", () => {
    const plain = requirementProofExpectations("Prevent stale session renewal and add regression coverage.");

    expect(requirementProofExpectations("- Prevent stale session renewal and add regression coverage.")).toEqual(plain);
    expect(requirementProofExpectations("* Prevent stale session renewal and add regression coverage.")).toEqual(plain);
    expect(requirementProofExpectations("7. Prevent stale session renewal and add regression coverage.")).toEqual(plain);
    expect(plain).toMatchObject({ implementation: true, targetedTest: true, execution: true });
  });
});
