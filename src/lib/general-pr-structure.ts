import { createHash } from "node:crypto";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

/**
 * Private structural view of an already-selected PR source snapshot.
 * It intentionally carries positions and hashes, not source text or semantics.
 */
export type GeneralPrStructuralKindV1 =
  | "heading"
  | "paragraph"
  | "list_item"
  | "table_cell"
  | "blockquote"
  | "code"
  | "html";

export type GeneralPrStructuralSpanIdV1 = `gsp_${number}`;

export interface GeneralPrStructuralSpanV1 {
  version: 1;
  id: GeneralPrStructuralSpanIdV1;
  kind: GeneralPrStructuralKindV1;
  start: number;
  end: number;
  /** Structural heading IDs only; never heading text. */
  headingPath: GeneralPrStructuralSpanIdV1[];
  excluded: boolean;
  textHash: string;
}

export interface GeneralPrStructureResultV1 {
  version: 1;
  parseState: "complete" | "incomplete";
  spans: GeneralPrStructuralSpanV1[];
}

interface AstPosition {
  start?: { offset?: number };
  end?: { offset?: number };
}

interface AstNode {
  type?: unknown;
  depth?: unknown;
  position?: AstPosition;
  children?: unknown;
}

interface CandidateSpan {
  kind: GeneralPrStructuralKindV1;
  start: number;
  end: number;
  headingRanges: Array<{ start: number; end: number }>;
  excluded: boolean;
}

const parser = unified().use(remarkParse).use(remarkGfm);

export function parseGeneralPrStructureV1(source: string): GeneralPrStructureResultV1 {
  try {
    const root = parser.parse(source) as unknown;
    const candidates: CandidateSpan[] = [];
    const headingPath: Array<{ depth: number; range: { start: number; end: number } }> = [];
    collectStructuralSpans(root, source, headingPath, candidates);
    const ordered = candidates
      .sort((left, right) => left.start - right.start || left.end - right.end || left.kind.localeCompare(right.kind));
    const idsByRange = new Map(ordered
      .filter((candidate) => candidate.kind === "heading")
      .map((candidate, index) => [rangeKey(candidate), `gsp_${ordered.indexOf(candidate) + 1}` as GeneralPrStructuralSpanIdV1]));
    const spans = ordered
      .map((candidate, index) => ({
        version: 1 as const,
        id: `gsp_${index + 1}` as GeneralPrStructuralSpanIdV1,
        kind: candidate.kind,
        start: candidate.start,
        end: candidate.end,
        headingPath: candidate.headingRanges
          .map((range) => idsByRange.get(rangeKey(range)))
          .filter((id): id is GeneralPrStructuralSpanIdV1 => Boolean(id)),
        excluded: candidate.excluded,
        textHash: textHash(source.slice(candidate.start, candidate.end))
      }));
    return { version: 1, parseState: "complete", spans };
  } catch {
    return { version: 1, parseState: "incomplete", spans: [] };
  }
}

function collectStructuralSpans(
  value: unknown,
  source: string,
  headingPath: Array<{ depth: number; range: { start: number; end: number } }>,
  candidates: CandidateSpan[]
): void {
  if (!isAstNode(value)) return;
  const node = value;
  const type = typeof node.type === "string" ? node.type : "";
  const range = sourceRange(node, source.length);

  if (type === "heading" && range) {
    const depth = typeof node.depth === "number" && Number.isInteger(node.depth) ? node.depth : 1;
    while (headingPath.length > 0 && headingPath[headingPath.length - 1]!.depth >= depth) headingPath.pop();
    headingPath.push({ depth, range });
    candidates.push({ kind: "heading", ...range, headingRanges: headingPath.map((item) => item.range), excluded: false });
    return;
  }

  if (type === "listItem" && range) {
    candidates.push({ kind: "list_item", ...range, headingRanges: headingPath.map((item) => item.range), excluded: false });
    return;
  }

  if (type === "tableCell" && range) {
    candidates.push({ kind: "table_cell", ...range, headingRanges: headingPath.map((item) => item.range), excluded: false });
    return;
  }

  if (type === "blockquote" && range) {
    candidates.push({ kind: "blockquote", ...range, headingRanges: headingPath.map((item) => item.range), excluded: false });
    return;
  }

  if (type === "code" && range) {
    candidates.push({ kind: "code", ...range, headingRanges: headingPath.map((item) => item.range), excluded: true });
    return;
  }

  if (type === "html" && range) {
    candidates.push({
      kind: "html",
      ...range,
      headingRanges: headingPath.map((item) => item.range),
      excluded: isHtmlComment(source.slice(range.start, range.end))
    });
    return;
  }

  if (type === "paragraph" && range) {
    candidates.push({ kind: "paragraph", ...range, headingRanges: headingPath.map((item) => item.range), excluded: false });
    return;
  }

  if (Array.isArray(node.children)) {
    for (const child of node.children) collectStructuralSpans(child, source, headingPath, candidates);
  }
}

function sourceRange(value: AstNode, sourceLength: number): { start: number; end: number } | null {
  const start = value.position?.start?.offset;
  const end = value.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number" || !Number.isInteger(start) || !Number.isInteger(end) ||
    start < 0 || end <= start || end > sourceLength) return null;
  return { start, end };
}

function isAstNode(value: unknown): value is AstNode {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function textHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function rangeKey(range: { start: number; end: number }): string {
  return `${range.start}:${range.end}`;
}

function isHtmlComment(value: string): boolean {
  return /^\s*<!--[\s\S]*-->\s*$/.test(value);
}
