import { describe, expect, it } from "vitest";
import {
  isGeneralPrExecutableCapabilityV2,
  isReleasedVerificationCapabilityV2,
  readEnabledVerificationCapabilitiesV2
} from "./verification-capability-policy-v2";

describe("readEnabledVerificationCapabilitiesV2", () => {
  it("is default-off and rejects blank, duplicate, and unknown policy tokens as a whole", () => {
    expect(readEnabledVerificationCapabilitiesV2()).toEqual(new Set());
    expect(readEnabledVerificationCapabilitiesV2(" ")).toEqual(new Set());
    expect(readEnabledVerificationCapabilitiesV2("documentation_literal,documentation_literal")).toEqual(new Set());
    expect(readEnabledVerificationCapabilitiesV2("documentation_literal,unknown_capability")).toEqual(new Set());
  });

  it("keeps both existing static capabilities available to typed V2 contracts", () => {
    expect(readEnabledVerificationCapabilitiesV2("documentation_literal")).toEqual(new Set([
      "documentation_literal"
    ]));
    expect(readEnabledVerificationCapabilitiesV2("documentation_literal,path_change_absence")).toEqual(new Set([
      "documentation_literal",
      "path_change_absence"
    ]));
    expect(isReleasedVerificationCapabilityV2("path_change_absence")).toBe(true);
  });

  it("limits new general-PR plans to documentation literals without narrowing typed V2 contracts", () => {
    expect(isGeneralPrExecutableCapabilityV2("documentation_literal")).toBe(true);
    expect(isGeneralPrExecutableCapabilityV2("path_change_absence")).toBe(false);
    expect(isGeneralPrExecutableCapabilityV2("test_case")).toBe(false);

    expect(readEnabledVerificationCapabilitiesV2("path_change_absence")).toEqual(new Set([
      "path_change_absence"
    ]));
    expect(readEnabledVerificationCapabilitiesV2("test_case")).toEqual(new Set());
    expect(readEnabledVerificationCapabilitiesV2("workflow_job")).toEqual(new Set());
    expect(readEnabledVerificationCapabilitiesV2("return_value")).toEqual(new Set());
    expect(readEnabledVerificationCapabilitiesV2("documentation_literal,test_case")).toEqual(new Set());
  });
});
