import { describe, expect, it } from "vitest";
import { getConciergeStoreConfigurationStatus } from "./concierge-store-configuration";

const canonical = {
  AGENTPROOF_CONCIERGE_SUPABASE_URL: "https://one-project.supabase.co",
  AGENTPROOF_CONCIERGE_SUPABASE_SERVICE_ROLE_KEY: "placeholder",
  AGENTPROOF_CONTROL_PLANE_SUPABASE_URL: "https://one-project.supabase.co",
  AGENTPROOF_CONTROL_PLANE_SUPABASE_SERVICE_ROLE_KEY: "placeholder"
} as unknown as NodeJS.ProcessEnv;

describe("Concierge durable store configuration", () => {
  it("requires every effective tenant-store URL to resolve to the Concierge project", () => {
    expect(getConciergeStoreConfigurationStatus(canonical)).toEqual({ configured: true, consistent: true });
    expect(getConciergeStoreConfigurationStatus({
      ...canonical,
      AGENTPROOF_TENANT_GRANTS_SUPABASE_URL: "https://different-project.supabase.co",
      AGENTPROOF_TENANT_GRANTS_SUPABASE_SERVICE_ROLE_KEY: "placeholder"
    })).toEqual({ configured: true, consistent: false });
    expect(getConciergeStoreConfigurationStatus({
      ...canonical,
      AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_URL: "https://different-project.supabase.co",
      AGENTPROOF_TENANT_DELETION_STATE_SUPABASE_SERVICE_ROLE_KEY: "placeholder"
    })).toEqual({ configured: true, consistent: false });
  });

  it("fails closed for missing or malformed canonical configuration", () => {
    expect(getConciergeStoreConfigurationStatus({ ...canonical, AGENTPROOF_CONCIERGE_SUPABASE_URL: "" })).toEqual({ configured: false, consistent: false });
    expect(getConciergeStoreConfigurationStatus({ ...canonical, AGENTPROOF_CONCIERGE_SUPABASE_URL: "https://one-project.supabase.co/path" })).toEqual({ configured: false, consistent: false });
  });
});
