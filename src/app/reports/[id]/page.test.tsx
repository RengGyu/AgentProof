import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createSavedReport, clearSavedReportsForTests } from "@/lib/server-report-store";
import { generateVerificationReportV2FromInput } from "@/lib/verifier";
import { demoScenarios } from "@/lib/sample-data";
import SavedReportPage from "./page";
const auth = vi.hoisted(() => ({ tenantId: "tenant_a", authorized: true }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ cookie: "session-cookie" }) }));
vi.mock("@/lib/tenant-auth", () => ({ resolveTenantAuthAccess: async () => auth }));
afterEach(() => { clearSavedReportsForTests(); vi.unstubAllEnvs(); auth.authorized = true; auth.tenantId = "tenant_a"; });
it("opens an owner URL without a share key and denies another tenant", async () => {
  const saved = await createSavedReport(generateVerificationReportV2FromInput(demoScenarios.clean), { tenantId: "tenant_a" });
  vi.stubEnv("NODE_ENV", "production");
  const page = () => SavedReportPage({ params: Promise.resolve({ id: saved.id }) });
  expect(renderToStaticMarkup(await page())).not.toContain("Report unavailable");
  auth.tenantId = "tenant_b";
  expect(renderToStaticMarkup(await page())).toContain("Report unavailable");
  auth.authorized = false;
  expect(renderToStaticMarkup(await page())).toContain("Report unavailable");
});

it("does not open a saved report by URL key for a signed-out visitor in production", async () => {
  auth.authorized = false;
  const saved = await createSavedReport(generateVerificationReportV2FromInput(demoScenarios.clean), { tenantId: "tenant_a" });
  vi.stubEnv("NODE_ENV", "production");
  for (const query of [{ key: saved.accessToken }, { reportKey: saved.accessToken }]) {
    const page = await SavedReportPage({ params: Promise.resolve({ id: saved.id }), searchParams: Promise.resolve(query) });
    expect(renderToStaticMarkup(page)).toContain("Report unavailable");
  }
});

it("does not open an unscoped development report for a signed-in tenant in production", async () => {
  const saved = await createSavedReport(generateVerificationReportV2FromInput(demoScenarios.clean));
  vi.stubEnv("NODE_ENV", "production");
  const page = await SavedReportPage({ params: Promise.resolve({ id: saved.id }) });
  expect(renderToStaticMarkup(page)).toContain("Report unavailable");
});
