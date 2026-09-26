import { afterEach, expect, it, vi } from "vitest";
import SharePage from "./page";

afterEach(() => vi.unstubAllEnvs());

it("does not render portable report URLs in a deployed environment", () => {
  vi.stubEnv("NODE_ENV", "production");
  expect(() => SharePage()).toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
});
