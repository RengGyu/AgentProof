import { afterEach, expect, it, vi } from "vitest";
import { createSavedReport, clearSavedReportsForTests } from "@/lib/server-report-store";
import { demoScenarios } from "@/lib/sample-data";
import { generateVerificationReportV2FromInput } from "@/lib/verifier";
import { DELETE, GET } from "./route";

const auth = vi.hoisted(() => ({ tenantId: "tenant_a", authorized: true }));
vi.mock("@/lib/tenant-auth", () => ({ resolveTenantAuthAccess: async () => auth }));

afterEach(() => {
  clearSavedReportsForTests();
  vi.unstubAllEnvs();
  auth.tenantId = "tenant_a";
  auth.authorized = true;
});

it("keeps the authenticated tenant report API while denying keys and other tenants in production", async () => {
  const saved = await createSavedReport(generateVerificationReportV2FromInput(demoScenarios.clean), { tenantId: "tenant_a" });
  const context = { params: Promise.resolve({ id: saved.id }) };
  const request = () => new Request(`http://localhost/api/reports/${saved.id}?key=${saved.accessToken}`);
  vi.stubEnv("NODE_ENV", "production");

  expect((await GET(request(), context)).status).toBe(200);
  auth.tenantId = "tenant_b";
  expect((await GET(request(), context)).status).toBe(404);
  expect((await DELETE(request(), context)).status).toBe(404);
  auth.authorized = false;
  expect((await GET(request(), context)).status).toBe(404);
  auth.tenantId = "tenant_a";
  auth.authorized = true;
  expect((await DELETE(request(), context)).status).toBe(200);
  expect((await GET(request(), context)).status).toBe(404);
});

it("does not expose unscoped development reports to authenticated tenants in production", async () => {
  const saved = await createSavedReport(generateVerificationReportV2FromInput(demoScenarios.clean));
  vi.stubEnv("NODE_ENV", "production");
  const context = { params: Promise.resolve({ id: saved.id }) };
  const request = new Request(`http://localhost/api/reports/${saved.id}?key=${saved.accessToken}`);
  expect((await GET(request, context)).status).toBe(404);
  expect((await DELETE(request, context)).status).toBe(404);
});
