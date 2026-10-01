import { describe, expect, it } from "vitest";

import { normalizeLiveSmokeLabel } from "./positive-label";

describe("normalizeLiveSmokeLabel", () => {
  it("trims and uppercases input", () => {
    expect(normalizeLiveSmokeLabel("  ready ")).toBe("READY");
  });

  it("keeps an empty input empty", () => {
    expect(normalizeLiveSmokeLabel("")).toBe("");
  });
});
