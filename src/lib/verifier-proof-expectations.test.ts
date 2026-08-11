import { describe, expect, it } from "vitest";
import { requirementProofExpectations } from "./verifier-proof-expectations";

describe("requirementProofExpectations", () => {
  it.each([
    ["Add retry handling and tests.", { implementation: true, targetedTest: true }],
    ["Add tests for retry handling.", { implementation: false, targetedTest: true }],
    ["재시도 기능을 추가하고 회귀 테스트를 추가합니다.", { implementation: true, targetedTest: true }],
    ["재시도 기능 동작을 변경하고 테스트를 추가합니다.", { implementation: true, targetedTest: true }],
    ["재시도 테스트를 추가합니다.", { implementation: false, targetedTest: true }]
  ])("classifies %s without collapsing behavior and tests", (text, expected) => {
    expect(requirementProofExpectations(text)).toMatchObject(expected);
  });
});
