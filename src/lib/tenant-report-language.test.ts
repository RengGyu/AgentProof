import { describe, expect, it } from "vitest";
import { tenantRemediationText } from "./tenant-report-language";

describe("tenant report language", () => {
  it("uses an actionable privacy-safe fallback when no specific gap kind is available", () => {
    expect(tenantRemediationText([])).toBe(
      "Collect the unavailable evidence and run the analysis again."
    );
  });
});
