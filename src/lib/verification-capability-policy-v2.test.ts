import { describe, expect, it } from "vitest";
import { readEnabledVerificationCapabilitiesV2 } from "./verification-capability-policy-v2";

describe("readEnabledVerificationCapabilitiesV2", () => {
  it("is default-off and rejects blank, duplicate, and unknown policy tokens as a whole", () => {
    expect(readEnabledVerificationCapabilitiesV2()).toEqual(new Set());
    expect(readEnabledVerificationCapabilitiesV2(" ")).toEqual(new Set());
    expect(readEnabledVerificationCapabilitiesV2("documentation_literal,documentation_literal")).toEqual(new Set());
    expect(readEnabledVerificationCapabilitiesV2("documentation_literal,unknown_capability")).toEqual(new Set());
  });

  it("accepts only the exact closed capability set", () => {
    expect(readEnabledVerificationCapabilitiesV2("documentation_literal,path_change_absence")).toEqual(new Set([
      "documentation_literal",
      "path_change_absence"
    ]));
  });

  it("rejects schema-compatible capabilities outside the current release scope", () => {
    expect(readEnabledVerificationCapabilitiesV2("test_case")).toEqual(new Set());
    expect(readEnabledVerificationCapabilitiesV2("workflow_job")).toEqual(new Set());
    expect(readEnabledVerificationCapabilitiesV2("return_value")).toEqual(new Set());
    expect(readEnabledVerificationCapabilitiesV2("documentation_literal,test_case")).toEqual(new Set());
  });
});
