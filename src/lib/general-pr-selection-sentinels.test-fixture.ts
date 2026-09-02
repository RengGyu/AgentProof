import { expect } from "vitest";

export const selectionSentinels = [
  "gpsp_private_selection",
  "gpea_private_evidence",
  "src/private/secret-handler.ts",
  "private-token-sketch",
  "provider-private-output",
  "selectionHash",
  "tokenSketch",
  "objectiveGroups"
] as const;

/** Test-only transient staged-observer data; it must not cross a public boundary. */
export function transientSelectionFixture(): Record<string, string> {
  return Object.fromEntries(selectionSentinels.map((sentinel, index) => [`private_${index}`, sentinel]));
}

export function expectNoSelectionSentinels(output: unknown): void {
  const serialized = typeof output === "string" ? output : JSON.stringify(output);
  for (const sentinel of selectionSentinels) expect(serialized).not.toContain(sentinel);
}
