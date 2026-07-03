import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupExpiredSavedReports,
  SavedReportStoreError,
  type SavedReportCleanupResult
} from "@/lib/server-report-store";
import { GET } from "./route";

vi.mock("@/lib/server-report-store", () => ({
  cleanupExpiredSavedReports: vi.fn(),
  SavedReportStoreError: class SavedReportStoreError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "SavedReportStoreError";
    }
  }
}));

const mockedCleanupExpiredSavedReports = vi.mocked(cleanupExpiredSavedReports);

describe("GET /api/cron/reports/cleanup", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns a metadata-only no-op when cron authentication is not configured", async () => {
    const response = await GET(new Request("http://localhost/api/cron/reports/cleanup"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      privacy: "saved-report-cleanup-cron-metadata-only",
      status: "disabled",
      reason: "cron_auth_not_configured"
    });
    expect(mockedCleanupExpiredSavedReports).not.toHaveBeenCalled();
  });

  it("rejects invalid cron tokens without exposing the configured token", async () => {
    vi.stubEnv("AGENTPROOF_CRON_TOKEN", "cron-secret-value");

    const response = await GET(new Request("http://localhost/api/cron/reports/cleanup", {
      headers: { authorization: "Bearer wrong-token" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(json).toEqual({
      error: "Invalid saved report cleanup cron token.",
      code: "saved_report_cleanup_cron_unauthorized"
    });
    expect(serialized).not.toContain("cron-secret-value");
    expect(mockedCleanupExpiredSavedReports).not.toHaveBeenCalled();
  });

  it("does not authenticate with query-string tokens", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");

    const response = await GET(new Request("http://localhost/api/cron/reports/cleanup?token=cron-secret-value"));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(401);
    expect(json).toEqual({
      error: "Invalid saved report cleanup cron token.",
      code: "saved_report_cleanup_cron_unauthorized"
    });
    expect(serialized).not.toContain("cron-secret-value");
    expect(mockedCleanupExpiredSavedReports).not.toHaveBeenCalled();
  });

  it("runs cleanup with metadata-only output when authorized", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    mockedCleanupExpiredSavedReports.mockResolvedValue(cleanupResult({
      deletedCount: 4,
      countBasis: "pre-delete-supabase-count",
      store: "supabase",
      durable: true,
      configured: true
    }));

    const response = await GET(new Request("http://localhost/api/cron/reports/cleanup", {
      headers: { authorization: "Bearer cron-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(json).toEqual({
      ok: true,
      privacy: "saved-report-cleanup-cron-metadata-only",
      status: "ran",
      deletedCount: 4,
      countBasis: "pre-delete-count"
    });
    expect(mockedCleanupExpiredSavedReports).toHaveBeenCalledWith();
    expect(serialized).not.toContain("cron-secret-value");
    expect(serialized).not.toContain("supabase");
    expect(serialized).not.toContain("durable");
    expect(serialized).not.toContain("configured");
    expect(serialized).not.toContain("saved_reports_test");
    expect(serialized).not.toContain("service-role-secret");
    expect(serialized).not.toContain("tenant_a");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("evidenceIndex");
    expect(serialized).not.toContain("claims");
    expect(serialized).not.toContain("reprompt");
  });

  it("generalizes exact memory cleanup count basis without exposing store internals", async () => {
    vi.stubEnv("AGENTPROOF_CRON_TOKEN", "cron-secret-value");
    mockedCleanupExpiredSavedReports.mockResolvedValue(cleanupResult({
      deletedCount: 2,
      countBasis: "exact-memory-delete-count",
      store: "memory",
      durable: false,
      configured: false
    }));

    const response = await GET(new Request("http://localhost/api/cron/reports/cleanup", {
      headers: { "x-agentproof-cron-token": "cron-secret-value" }
    }));
    const json = await response.json();
    const serialized = JSON.stringify(json);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      privacy: "saved-report-cleanup-cron-metadata-only",
      deletedCount: 2,
      countBasis: "exact-delete-count"
    });
    expect(serialized).not.toContain("memory");
    expect(serialized).not.toContain("durable");
    expect(serialized).not.toContain("configured");
  });

  it("returns unavailable metadata when cleanup storage fails", async () => {
    vi.stubEnv("AGENTPROOF_CRON_TOKEN", "cron-secret-value");
    mockedCleanupExpiredSavedReports.mockRejectedValue(new SavedReportStoreError("Saved report cleanup failed"));

    const response = await GET(new Request("http://localhost/api/cron/reports/cleanup", {
      headers: { "x-agentproof-cron-token": "cron-secret-value" }
    }));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json).toEqual({
      error: "Saved report cleanup is unavailable.",
      code: "saved_report_cleanup_unavailable"
    });
  });
});

function cleanupResult(overrides: Partial<SavedReportCleanupResult> = {}): SavedReportCleanupResult {
  return {
    privacy: "saved-report-cleanup-metadata-only",
    deletedCount: 1,
    countBasis: "exact-memory-delete-count",
    store: "memory",
    durable: false,
    configured: false,
    ...overrides
  };
}
