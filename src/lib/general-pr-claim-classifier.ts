import { createHash } from "node:crypto";
import type { GeneralPrStructureResultV1, GeneralPrStructuralSpanV1 } from "./general-pr-structure";

/** Private, read-only semantic labels for bounded structural spans. */
export type GeneralPrClaimRoleV1 =
  | "objective_candidate"
  | "problem_observation"
  | "change_claim"
  | "test_or_validation_claim"
  | "supporting_context"
  | "scope_or_follow_up"
  | "process_or_template_meta"
  | "mixed_or_unknown";

export interface GeneralPrClaimClassificationV1 {
  version: 1;
  structuralSpanId: string;
  textHash: string;
  role: GeneralPrClaimRoleV1;
  abstained: boolean;
}

export function classifyGeneralPrClaimsV1(
  source: string,
  structure: GeneralPrStructureResultV1
): GeneralPrClaimClassificationV1[] {
  if (structure.parseState !== "complete" || !hasExactBindings(source, structure)) return [];
  const spansById = new Map(structure.spans.map((span) => [span.id, span]));

  return structure.spans.map((span) => {
    const text = normalizeStructuralText(source.slice(span.start, span.end));
    const role = classifySpan(text, headingText(source, span, spansById), span.excluded, span.kind);
    return {
      version: 1,
      structuralSpanId: span.id,
      textHash: span.textHash,
      role,
      abstained: role === "mixed_or_unknown"
    };
  });
}

function hasExactBindings(source: string, structure: GeneralPrStructureResultV1): boolean {
  let previousEnd = -1;
  const spansById = new Map(structure.spans.map((span) => [span.id, span]));
  return structure.spans.every((span) => {
    if (!Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > source.length || span.start < previousEnd) return false;
    previousEnd = span.end;
    return textHash(source.slice(span.start, span.end)) === span.textHash && span.headingPath.every((headingId) => {
      const heading = spansById.get(headingId);
      return heading?.kind === "heading" && heading.start <= span.start;
    });
  });
}

function headingText(
  source: string,
  span: GeneralPrStructuralSpanV1,
  spansById: ReadonlyMap<string, GeneralPrStructuralSpanV1>
): string {
  return span.headingPath
    .map((headingId) => spansById.get(headingId))
    .filter((heading): heading is GeneralPrStructuralSpanV1 => Boolean(heading))
    .map((heading) => normalizeStructuralText(source.slice(heading.start, heading.end)))
    .join(" ")
    .toLowerCase();
}

function classifySpan(
  text: string,
  heading: string,
  excluded: boolean,
  kind: GeneralPrStructuralSpanV1["kind"]
): GeneralPrClaimRoleV1 {
  if (excluded) return "process_or_template_meta";
  // Structural context never becomes an objective by wording alone.
  if (kind === "blockquote") return "supporting_context";
  if (isScope(text) || (kind === "heading" && /\b(scope|limitations?|follow[- ]?up|future work|out of scope)\b/.test(heading))) return "scope_or_follow_up";
  if (isProcess(text) || (kind === "heading" && /\b(testing|validation|review|risk|revert|checklist|template|references?)\b/.test(heading))) return "process_or_template_meta";
  if (kind === "heading") return "supporting_context";

  const isTest = isTestClaim(text);
  const isChange = isChangeClaim(text);
  const isProblem = isProblemObservation(text);
  const isObjective = isObjectiveCandidate(text, heading);

  if ([isTest, isChange, isProblem, isObjective].filter(Boolean).length > 1) return "mixed_or_unknown";
  if (isTest) return "test_or_validation_claim";
  if (isChange) return "change_claim";
  if (isProblem) return "problem_observation";
  if (isObjective) return "objective_candidate";
  return "supporting_context";
}

function normalizeStructuralText(value: string): string {
  return value
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^\s{0,3}>\s?/, "")
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "")
    .replace(/^\|?\s*|\s*\|?$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isObjectiveCandidate(text: string, heading: string): boolean {
  const hasExplicitOracle = /\b(must|shall|required|should)\b/i.test(text) || /\b(expected behavior|acceptance criteria|requirements?)\b/i.test(heading);
  const hasObservable = /\b(return|show|display|reject|allow|preserve|create|remove|emit|store|render|use|support)\b/i.test(text);
  return hasExplicitOracle && hasObservable;
}

function isProblemObservation(text: string): boolean {
  return /\b(current(?:ly)?|old|existing)\b.*\b(fails?|error|crash(?:es)?|incorrect|wrong|missing|cannot|does not)\b|\b(fails?|error|crash(?:es)?|incorrect|wrong)\b/i.test(text);
}

function isChangeClaim(text: string): boolean {
  return /\b(this pr|we|i)\b.*\b(add(?:s|ed)?|change(?:s|d)?|fix(?:es|ed)?|remove(?:s|d)?|refactor(?:s|ed)?|update(?:s|d)?|implement(?:s|ed)?)\b/i.test(text);
}

function isTestClaim(text: string): boolean {
  return /\b(pnpm|npm|yarn|vitest|jest|pytest|cargo test|go test|testing|typecheck|lint|build|ci)\b|\btests?\b.*\b(pass(?:ed)?|fail(?:ed)?|run)\b/i.test(text);
}

function isScope(text: string): boolean {
  return /\b(not supported|known limitation|out of scope|follow[- ]?up|future (?:pr|work|change)|later)\b/i.test(text);
}

function isProcess(text: string): boolean {
  return /\b(wip|risk|revert|please review|checklist|template|todo|references?)\b/i.test(text);
}

function textHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
