import { beforeEach, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ authorized: true }));
vi.mock("next/headers", () => ({ cookies: async () => ({ toString: () => "agentproof_session=test" }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }) }));
vi.mock("@/lib/tenant-auth", () => ({ resolveTenantAuthAccess: vi.fn(async () => ({ authorized: auth.authorized })) }));
import AnalyzePage from "./page";
beforeEach(() => { auth.authorized = true; });

it("accepts only an opaque one-time launch key and remounts when it changes for a signed-in user", async () => {
  const first = await AnalyzePage({ searchParams: Promise.resolve({ launch: "11111111-1111-4111-8111-111111111111" }) });
  const second = await AnalyzePage({ searchParams: Promise.resolve({ launch: "22222222-2222-4222-8222-222222222222" }) });
  expect(first.props.launchNonce).toBe("11111111-1111-4111-8111-111111111111");
  expect(first.key).not.toBe(second.key);
  const invalid = await AnalyzePage({ searchParams: Promise.resolve({ launch: "not-a-valid-launch-key" }) });
  expect(invalid.props.launchNonce).toBeUndefined();
});

it("sends signed-out visitors to the single sign-in entry instead of offering public PR analysis", async () => {
  auth.authorized = false;
  await expect(AnalyzePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("redirect:/");
});
