import { describe, expect, it } from "vitest";
import { isProhibitedEvidenceRequestText } from "./semantic-text-policy";

describe("semantic text policy", () => {
  it.each([
    "The full source is needed.",
    "Collect raw CI logs.",
    "Download the complete patch.",
    "Send the full source.",
    "Paste the raw CI logs.",
    "Show the complete patch.",
    "전체 소스가 필요합니다.",
    "CI 로그를 수집해 주세요."
  ])("rejects requests for prohibited source or execution detail: %s", (value) => {
    expect(isProhibitedEvidenceRequestText(value)).toBe(true);
  });

  it("keeps a bounded reference to an already supplied Check", () => {
    expect(isProhibitedEvidenceRequestText("Review the supplied Check reference.")).toBe(false);
  });

  it("keeps a non-retention statement separate from a bounded Check action", () => {
    expect(isProhibitedEvidenceRequestText(
      "The full logs were not stored; review the supplied Check reference."
    )).toBe(false);
  });
});
