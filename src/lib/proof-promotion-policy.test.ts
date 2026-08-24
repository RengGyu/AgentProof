import { afterEach, describe, expect, it } from "vitest";
import { mayPromoteObservedAxis, readRequirementLocalPromotionMode } from "./proof-promotion-policy";

const PROMOTION_MODE = "AGENTPROOF_REQUIREMENT_LOCAL_PROMOTION_MODE";
const previousMode = process.env[PROMOTION_MODE];

afterEach(() => {
  if (previousMode === undefined) delete process.env[PROMOTION_MODE];
  else process.env[PROMOTION_MODE] = previousMode;
});

describe("requirement-local promotion policy", () => {
  it("defaults unknown and absent configuration to the fail-closed mode", () => {
    delete process.env[PROMOTION_MODE];
    expect(readRequirementLocalPromotionMode()).toBe("off");

    process.env[PROMOTION_MODE] = "enabled";
    expect(readRequirementLocalPromotionMode()).toBe("off");
  });

  it("reads the receipt mode at the time a report is evaluated", () => {
    process.env[PROMOTION_MODE] = "receipt_v2";
    expect(readRequirementLocalPromotionMode()).toBe("receipt_v2");

    delete process.env[PROMOTION_MODE];
    expect(readRequirementLocalPromotionMode()).toBe("off");
  });

  it.each(["targeted_test", "execution"] as const)("promotes %s only with a validated closed receipt pair", (axis) => {
    const complete = {
      axis,
      requirementId: "req_1",
      receiptRefs: ["test_relation_v2_1"],
      receiptsValidated: true
    };

    expect(mayPromoteObservedAxis("off", complete)).toBe(false);
    expect(mayPromoteObservedAxis("receipt_v2", { ...complete, receiptsValidated: false })).toBe(false);
    expect(mayPromoteObservedAxis("receipt_v2", { ...complete, receiptRefs: [] })).toBe(false);
    expect(mayPromoteObservedAxis("receipt_v2", complete)).toBe(true);
  });
});
