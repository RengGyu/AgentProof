import { describe, expect, it } from "vitest";

import { getControlPlaneSupabaseEnv } from "./control-plane-supabase";

describe("getControlPlaneSupabaseEnv", () => {
  it("falls back to the existing onboarding Supabase settings", () => {
    expect(getControlPlaneSupabaseEnv({
      AGENTPROOF_ONBOARDING_SUPABASE_URL: "https://agentproof.supabase.co",
      AGENTPROOF_ONBOARDING_SUPABASE_SERVICE_ROLE_KEY: "onboarding-service-role"
    })).toEqual({
      url: "https://agentproof.supabase.co",
      serviceRoleKey: "onboarding-service-role"
    });
  });

  it("keeps explicit control-plane settings ahead of generic and onboarding settings", () => {
    expect(getControlPlaneSupabaseEnv({
      AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://control.supabase.co",
      AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "control-service-role",
      SUPABASE_URL: "https://generic.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "generic-service-role",
      AGENTPROOF_ONBOARDING_SUPABASE_URL: "https://onboarding.supabase.co",
      AGENTPROOF_ONBOARDING_SUPABASE_SERVICE_ROLE_KEY: "onboarding-service-role"
    })).toEqual({
      url: "https://control.supabase.co",
      serviceRoleKey: "control-service-role"
    });
  });
});
