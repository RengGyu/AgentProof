import { expect, it } from "vitest";
import AnalyzePage from "./page";

it("accepts only an opaque one-time launch key and remounts when it changes", async () => {
  const first = await AnalyzePage({ searchParams: Promise.resolve({ launch: "11111111-1111-4111-8111-111111111111" }) });
  const second = await AnalyzePage({ searchParams: Promise.resolve({ launch: "22222222-2222-4222-8222-222222222222" }) });
  expect(first.props.launchNonce).toBe("11111111-1111-4111-8111-111111111111");
  expect(first.key).not.toBe(second.key);
  const invalid = await AnalyzePage({ searchParams: Promise.resolve({ launch: "not-a-valid-launch-key" }) });
  expect(invalid.props.launchNonce).toBeUndefined();
});
