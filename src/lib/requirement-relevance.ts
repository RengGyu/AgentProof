import { extractKeywords } from "./extractors";

const WEAK_REQUIREMENT_KEYWORDS = new Set([
  "api",
  "app",
  "auth",
  "code",
  "data",
  "edge",
  "file",
  "node",
  "page",
  "pages",
  "route",
  "test",
  "tests",
  "user"
]);

/**
 * Uses only the canonical requirement text, not enriched context keywords,
 * when deciding whether execution or visual evidence is requirement-specific.
 */
export function evidenceOverlapsCanonicalRequirement(
  requirementText: string,
  evidenceLabel: string,
  evidenceSummary: string
): boolean {
  const meaningfulKeywords = extractKeywords(requirementText)
    .filter((keyword) => keyword.length >= 4 && !WEAK_REQUIREMENT_KEYWORDS.has(keyword));
  const evidenceText = `${evidenceLabel} ${evidenceSummary}`.toLowerCase();
  return meaningfulKeywords.some((keyword) => evidenceText.includes(keyword));
}
