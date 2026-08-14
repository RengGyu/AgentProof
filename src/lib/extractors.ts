import type {
  AgentClaim,
  ChangedFile,
  CheckRun,
  EvidenceItem,
  LogSnippet,
  PullRequestInput,
  Requirement,
  RequirementContextSignal,
  RequirementSourceSpan,
  RequirementSourceQuality,
  RequirementSourceRole,
  RequirementSpanId,
  RequirementSpanSeedExtractionResult
} from "./types";
import { hasPassingEvidenceStatusPrefix, isExecutionEvidenceSignal } from "./evidence-status";
import { compactText } from "./redact";
import { redactSecrets } from "./redact";
import {
  requirementProofAxisExpectations,
  requirementProofAxisExpectationsWithContext,
  type DeterministicProofContext,
  type RequirementProofExpectations
} from "./verifier-proof-expectations";

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "should",
  "must",
  "add",
  "added",
  "implemented",
  "fixed",
  "updated",
  "created",
  "changed",
  "removed",
  "validated",
  "tested",
  "cleaned",
  "user",
  "users",
  "flow",
  "path",
  "keep",
  "make",
  "when",
  "then",
  "have",
  "into",
  "before",
  "after",
  "existing"
]);

const TEST_FILE_PATTERN = /(\.test\.|\.spec\.|__tests__|(^|\/)tests?\/|test_|_test\.|_unittest\.|unittest_|spec_)/i;
const RISK_FILE_PATTERN = /(auth|permission|billing|payment|migration|schema|infra|session|security|token|secret|admin)/i;
const VAGUE_TASK_PATTERN = /\b(improve|better|fewer problems|more reliable|clean\s*up|cleanup|polish|enhance|optimi[sz]e|make .* easier|make .* nicer)\b/i;
const CONCRETE_ACTION_PATTERN =
  /\b(add|allow|block|create|delete|display|export|fix|handle|hide|implement|prevent|preserve|reject|remove|require|return|save|send|show|validate)\b/i;
const CLAIM_VERB_PATTERN =
  /\b(add(?:ed)?|align(?:ed)?|implement(?:ed)?|fix(?:ed)?|update(?:d)?|create(?:d)?|change(?:d)?|remove(?:d)?|redesign(?:ed)?|reframe(?:d)?|refresh(?:ed)?|rename(?:d)?|rework(?:ed)?|validate(?:d)?|verif(?:y|ied)|test(?:ed)?|pass(?:ed)?)\b/i;
const CLAIM_START_PATTERN =
  /^\s*(add(?:ed)?|align(?:ed)?|implement(?:ed)?|fix(?:ed)?|update(?:d)?|create(?:d)?|change(?:d)?|remove(?:d)?|redesign(?:ed)?|reframe(?:d)?|refresh(?:ed)?|rename(?:d)?|rework(?:ed)?|validate(?:d)?|verif(?:y|ied)|test(?:ed)?|pass(?:ed)?)\s+(.+)$/i;
const HEADING_PATTERN = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const INLINE_SECTION_PATTERN =
  /^\s*(acceptance criteria|expected behavior|expected outcome|actual behavior|actual outcome|steps to reproduce|reproducible example|code for reproduction|describe the bug|issue description|suggested fix|suggested solution|proposed fix|proposed solution|possible fix|possible solution|debug output|electron version|operating system(?: version)?|browser(?: version)?|platform|trac ticket number|jira ticket number|branch description|ai assistance disclosure|test plan|testing|validation|summary)\s*:?\s*(.*)$/i;
const ACCEPTANCE_SECTION_PATTERN = /\b(acceptance criteria|requirements?|expected behavior|expected outcome|desired behavior)\b/i;
const PROBLEM_SECTION_PATTERN = /\b(actual behavior|actual outcome|describe the bug|bug summary|issue description|error|crash|segfault|failure)\b/i;
const REPRODUCTION_SECTION_PATTERN = /\b(steps to reproduce|reproducible example|code for reproduction|reproduce|reproduction|minimal repro)\b/i;
const ENVIRONMENT_SECTION_PATTERN = /\b(os|operating system|version|electron version|browser|platform|debug output|system details|system information|environment|configuration files)\b/i;
const VISUAL_SECTION_PATTERN = /\b(screenshot|screen shot|image|visual|video|recording)\b/i;
const EXTERNAL_REFERENCE_SECTION_PATTERN = /\b(trac ticket|jira|linear|external issue|ticket number|issue link)\b/i;
const SOLUTION_HINT_SECTION_PATTERN = /\b(suggested fix|suggested solution|proposed fix|proposed solution|possible fix|possible solution|workaround)\b/i;
const SOLUTION_HINT_LINE_PATTERN =
  /\b(?:would|should|could)\s+fix\s+(?:the\s+)?(?:problem|issue|bug)|\b(?:workaround|possible fix|proposed solution|suggested fix)\b/i;
const AUTHOR_CLAIM_SECTION_PATTERN = /\b(summary|testing|test plan|validation|verified|changes|what changed|implementation)\b/i;
const TEMPLATE_SECTION_PATTERN = /\b(preflight checklist|checklist|ai assistance disclosure|code of conduct|contributing|submission checklist|before submitting)\b/i;
const CHECKBOX_ONLY_PATTERN = /^\s*\[[ xX-]\]\s*(?:\*\*)?\s*(?:no ai tools were used|if ai tools were used|i have read|i agree|i confirm|i verified|i have checked|i have searched|this pull request|code of conduct|contributing|tests added|documentation added).*/i;
const MARKDOWN_IMAGE_PATTERN = /^\s*!\[[^\]]*]\([^)]+\)\s*$/;
const EXTERNAL_REFERENCE_PATTERN = /\b(?:trac|jira|linear|fixes|closes|resolves|refs?)\b.{0,60}(?:#\d+|[A-Z][A-Z0-9]+-\d+|ticket|\b\d{3,}\b)|https?:\/\/\S*(?:issues?|browse|ticket)\S*/i;
const REQUIREMENT_LANGUAGE_PATTERN =
  /\b(acceptance criteria|must|should|shall|required|expected|expectation|add|implement|prevent|preserve|allow|reject|return|support|handle|fix|ensure|validate|do not|don't|without crashing|should not|must not|successfully)\b/i;
const ISSUE_PROBLEM_PATTERN = /\b(bug|crash|segfault|error|exception|fails?|broken|regression|incorrect|wrong|unable|cannot|does not|doesn't|missing required argument)\b/i;
const KOREAN_REQUIREMENT_PATTERN = /(?:표시한다|이동한다|유지한다|복원한다|차단한다|제공한다|지원한다|저장한다|삭제한다|보여준다|할 수 없어야 한다|하지 않아야 한다|필요는 없(?:다|음))\.?$/;
const AMBIGUITY_PATTERN = /\b(?:undefined|not defined|unclear|ambiguous|unspecified)\b|(?:정의하지 않|명확하지 않|모호|불명확)/i;
const AUTHOR_EVIDENCE_SECTION_PATTERN = /\b(testing|test plan|validation|verified)\b/i;
const PR_OBJECTIVE_ACTION_PATTERN =
  /\b(?:add|align|allow|block|create|delete|disable|display|document|enable|ensure|export|fix|handle|hide|implement|keep|migrate|prevent|preserve|refactor|refresh|rename|replace|require|return|rework|save|send|show|support|test|update|validat|verif)(?:e?s?|ed|es|ing|ied)?\b|(?:추가|수정|삭제|구현|문서화|리팩터링|지원|방지|유지|개선|변경|테스트|허용|표시|보장|보여줍니다)|\b(?:documentar|agregar|añadir|actualizar|mostrar|permitir|impedir|devolver|mantener)\b/i;
const PR_META_PURPOSE_PATTERN =
  /\b(?:this|the)\b.{0,90}\b(?:PR|scenario|fixture|benchmark|demo)\b.{0,120}\b(?:evaluat|exercis|test|record|verif|validat)\w*\b.{0,120}\b(?:review|verification|semantic|analysis)\b|(?:이|본)\s*PR(?:은|는)?\s*(?:검토|검증|분석)\s*파이프라인을?\s*(?:테스트|평가|검증|실행)(?:합니다|한다|해요|함)?/i;
const EVALUATION_CONTEXT_SECTION_PATTERN =
  /\b(?:canary|fixture|evaluation)\b\s+(?:scope|context|notes?|scenario|case)\b|\b(?:scope|context|notes?|scenario|case)\b.{0,40}\b(?:canary|fixture|benchmark|evaluation|demo)\b/i;
const SELF_REFERENTIAL_EVALUATION_PATTERN =
  /^(?:this|the)\s+(?:pull request|pr|change|fixture|scenario|benchmark|demo|canary)\b.{0,90}\b(?:is|are|was|were|serves as|used|created|intended|for)\b.{0,120}\b(?:canary|fixture|benchmark|demo|evaluat|exercis|review pipeline|verification pipeline|analysis pipeline)\b/i;
export const MAX_REPORT_EVIDENCE_ITEMS = 200;

export interface RequirementExtractionResult {
  requirements: Requirement[];
  contexts: RequirementContextSignal[];
  omittedRequirementCount: number;
}
export interface EvidenceIndexResult { items: EvidenceItem[]; omittedByKind: Partial<Record<EvidenceItem["kind"], number>>; }

const MAX_REQUIREMENT_SOURCE_SPANS = 12;
const MAX_REQUIREMENT_SPAN_CONTEXTS = 8;
const MAX_REQUIREMENT_SPAN_CONTEXT_TEXT_LENGTH = 160;

interface ClassifiedRequirementLine {
  text: string;
  source: Requirement["source"];
  role: RequirementSourceRole;
  sourceQuality: RequirementSourceQuality;
  sourceSection?: string | null;
}

export function extractRequirements(
  taskText: string,
  prDescription: string,
  taskSource: PullRequestInput["taskSource"] = "task"
): Requirement[] {
  return extractRequirementEvidence(taskText, prDescription, taskSource).requirements;
}

export function extractRequirementContexts(
  taskText: string,
  prDescription: string,
  taskSource: PullRequestInput["taskSource"] = "task"
): RequirementContextSignal[] {
  return extractRequirementEvidence(taskText, prDescription, taskSource).contexts;
}

/**
 * Builds the transient source-span seed for enhanced planning. It intentionally
 * does not alter the BASE requirement extraction path above.
 */
export function extractRequirementSpanSeed(
  taskText: string,
  prDescription: string,
  taskSource: PullRequestInput["taskSource"] = "task"
): RequirementSpanSeedExtractionResult {
  const redactedTask = redactSecrets(taskText);
  const redactedPr = redactSecrets(prDescription);
  const hasTaskSource = redactedTask.trim().length > 0;
  const sourceText = hasTaskSource ? redactedTask : redactedPr;
  const source: Requirement["source"] = hasTaskSource ? taskSource : "pr_description";
  const isPrBody = !hasTaskSource;
  const analysisContext = source === "issue"
    ? "linked_issue"
    : source === "pr_description"
      ? "unlinked_pr"
      : "provided_requirement";
  const candidates = spanCandidatesFromSource(sourceText, source, isPrBody);
  const selectedCandidates = selectSpanCandidates(candidates, isPrBody);

  if (selectedCandidates.length > MAX_REQUIREMENT_SOURCE_SPANS) {
    return { eligible: false, overflow: true, seed: null };
  }

  const spans = toRequirementSourceSpans(selectedCandidates, sourceText, isPrBody);
  const contexts = extractRequirementEvidence(taskText, prDescription, taskSource).contexts
    .filter((context) => context.source === source)
    .slice(0, MAX_REQUIREMENT_SPAN_CONTEXTS)
    .map((context) => ({
      ...context,
      text: context.text.slice(0, MAX_REQUIREMENT_SPAN_CONTEXT_TEXT_LENGTH)
    }));

  return {
    eligible: spans.length > 0,
    overflow: false,
    seed: {
      version: 1,
      analysisContext,
      spans,
      contexts,
      seedHash: ""
    }
  };
}

export interface DeterministicRequirementRelations {
  proofExpectationsByRequirement: ReadonlyMap<string, RequirementProofExpectations>;
  evidenceContextRequirementIdsByRequirement: ReadonlyMap<string, readonly string[]>;
}

/** Derives BASE-only proof relations from ordered spans in the selected authoritative source. */
export function deriveDeterministicRequirementRelations(
  input: Pick<PullRequestInput, "taskText" | "description" | "taskSource">,
  requirements: readonly Requirement[]
): DeterministicRequirementRelations {
  const proofExpectationsByRequirement = new Map<string, RequirementProofExpectations>();
  const evidenceContextRequirementIdsByRequirement = new Map<string, readonly string[]>();
  for (const requirement of requirements) {
    proofExpectationsByRequirement.set(requirement.id, requirementProofAxisExpectations(requirement.text));
  }

  const spanExtraction = extractRequirementSpanSeed(input.taskText, input.description, input.taskSource);
  const spans = spanExtraction.seed?.spans ?? [];
  if (
    spans.length !== requirements.length ||
    spans.some((span, index) =>
      normalizedRelationText(span.text) !== normalizedRelationText(requirements[index]?.text ?? "")
    )
  ) {
    return { proofExpectationsByRequirement, evidenceContextRequirementIdsByRequirement };
  }

  for (let index = 0; index < requirements.length; index += 1) {
    const requirement = requirements[index]!;
    const presentationExpectations = requirementProofAxisExpectationsWithContext(
      requirement.text,
      { kind: "review_presentation" }
    );
    if (presentationExpectations.visual && !requirementProofAxisExpectations(requirement.text).visual) {
      proofExpectationsByRequirement.set(requirement.id, presentationExpectations);
      continue;
    }

    const workflowContext = deterministicWorkflowAntecedentContext(spans, requirements, index);
    if (workflowContext.kind !== "workflow_antecedent") continue;
    proofExpectationsByRequirement.set(
      requirement.id,
      requirementProofAxisExpectationsWithContext(requirement.text, workflowContext)
    );
    evidenceContextRequirementIdsByRequirement.set(requirement.id, [workflowContext.requirementId]);
  }

  return { proofExpectationsByRequirement, evidenceContextRequirementIdsByRequirement };
}

function deterministicWorkflowAntecedentContext(
  spans: readonly RequirementSourceSpan[],
  requirements: readonly Requirement[],
  index: number
): DeterministicProofContext {
  const span = spans[index];
  const requirement = requirements[index];
  if (!span || !requirement || !/^(?:it|this workflow|the job)\b/i.test(normalizedRelationText(requirement.text))) {
    return { kind: "none" };
  }

  const workflowIndexes = spans
    .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
    .filter(({ candidate, candidateIndex }) =>
      candidateIndex < index &&
      candidate.groupId === span.groupId &&
      requirementProofAxisExpectations(requirements[candidateIndex]?.text ?? "").ci
    )
    .map(({ candidateIndex }) => candidateIndex);
  const antecedentIndex = workflowIndexes.length === 1 ? workflowIndexes[0] : undefined;
  if (antecedentIndex === undefined || antecedentIndex !== index - 1) return { kind: "none" };

  return { kind: "workflow_antecedent", requirementId: requirements[antecedentIndex]!.id };
}

function normalizedRelationText(value: string): string {
  return normalizeSentence(value
    .trim()
    .replace(/^\s{0,3}(?:[-*+]\s+|\d+[.)]\s+)/, ""))
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

interface SpanCandidate {
  start: number;
  end: number;
  text: string;
  source: Requirement["source"];
  role: RequirementSourceRole;
  sourceQuality: RequirementSourceQuality;
  sourceSection: string | null;
  priority: Requirement["priority"];
  group: number;
  listIndent: number | null;
}

function spanCandidatesFromSource(
  sourceText: string,
  source: Requirement["source"],
  isPrBody: boolean
): SpanCandidate[] {
  const candidates: SpanCandidate[] = [];
  const excludedRanges = baseExcludedSourceRanges(sourceText);
  const cleanedSourceText = cleanRequirementSourceText(sourceText);
  const sourceHasAcceptanceLanguage = /acceptance criteria|must|required|given|when|then/i.test(cleanedSourceText);
  let section: string | undefined;
  let group = 0;
  let needsNewGroup = true;
  let lineStart = 0;
  let excludedRangeCursor = 0;

  for (const rawLine of sourceText.split(/\r\n|\n|\r/)) {
    const lineEnd = lineStart + rawLine.length;
    const trimmed = normalizeSourceLine(rawLine);
    if (!trimmed) {
      needsNewGroup = true;
      lineStart = lineEnd + lineBreakLengthAt(sourceText, lineEnd);
      continue;
    }

    const isLinkedIssueTitle = /^\s*Linked issue\s+(?:[\w.-]+\/[\w.-]+)?#\d+:/i.test(rawLine);
    const heading = sectionHeading(trimmed);
    if (heading) {
      section = heading;
      needsNewGroup = true;
      lineStart = lineEnd + lineBreakLengthAt(sourceText, lineEnd);
      continue;
    }

    const inline = inlineSection(trimmed);
    if (inline) {
      if (section !== inline.section) needsNewGroup = true;
      section = inline.section;
      if (!inline.text) {
        lineStart = lineEnd + lineBreakLengthAt(sourceText, lineEnd);
        continue;
      }
    }

    const sourceSection = isLinkedIssueTitle ? "linked_issue_title" : section ?? null;
    const contentStart = inline?.text
      ? lineStart + rawLine.indexOf(inline.text)
      : lineStart + firstNonWhitespaceIndex(rawLine);
    const contentEnd = lineStart + lastNonWhitespaceEnd(rawLine);
    const visiblePartition = visibleSourceRangesFromCursor(
      contentStart,
      contentEnd,
      excludedRanges,
      excludedRangeCursor
    );
    const visibleRanges = visiblePartition.ranges;
    excludedRangeCursor = visiblePartition.nextExcludedRangeIndex;

    if (visibleRanges.length === 0) {
      needsNewGroup = true;
      lineStart = lineEnd + lineBreakLengthAt(sourceText, lineEnd);
      continue;
    }

    for (const visibleRange of visibleRanges) {
      const fragmentStart = trimSourceRangeStart(sourceText, visibleRange.start, visibleRange.end);
      const fragmentEnd = trimSourceRangeEnd(sourceText, fragmentStart, visibleRange.end);
      if (fragmentStart === fragmentEnd) continue;

      const isListItem = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(sourceText.slice(fragmentStart, fragmentEnd));
      const listIndent = isListItem
        ? indentationColumns(sourceText.slice(lineStart, fragmentStart))
        : null;
      const boundaries = isListItem
        ? [{ start: fragmentStart, end: fragmentEnd }]
        : sourceSpanBoundaries(sourceText, fragmentStart, fragmentEnd);

      for (const boundary of boundaries) {
        const text = sourceText.slice(boundary.start, boundary.end);
        const classificationText = normalizeSourceLine(text);
        if (!classificationText) continue;
        const classifiedRole = classifyLineRole(classificationText, sourceSection ?? undefined, source, isPrBody);
        const classifiedPriority = priorityForRequirement(classificationText);
        const vagueAuthoritativeSpan = !isPrBody && classifiedPriority !== "could" &&
          isVagueRequirementLine(classificationText, sourceHasAcceptanceLanguage);
        const role = classifiedRole;

        if (
          sourceSection === "linked_issue_title" ||
          role === "template_noise" ||
          role === "external_reference" ||
          role === "solution_hint"
        ) {
          continue;
        }

        if (needsNewGroup) {
          group += 1;
          needsNewGroup = false;
        }

        candidates.push({
          start: boundary.start,
          end: boundary.end,
          text,
          source,
          role,
          sourceQuality: vagueAuthoritativeSpan
            ? "manual_check"
            : sourceQualityForLine(classificationText, sourceSection ?? undefined, role, source, isPrBody),
          sourceSection,
          priority: vagueAuthoritativeSpan ? "must" : classifiedPriority,
          group,
          listIndent
        });
      }

      if (visibleRange.end < contentEnd) needsNewGroup = true;
    }

    lineStart = lineEnd + lineBreakLengthAt(sourceText, lineEnd);
  }

  return candidates;
}

function selectSpanCandidates(candidates: SpanCandidate[], isPrBody: boolean): SpanCandidate[] {
  if (isPrBody) {
    return candidates
      .filter((candidate) => candidate.role === "author_claim")
      .filter((candidate) => !AUTHOR_EVIDENCE_SECTION_PATTERN.test(candidate.sourceSection ?? ""));
  }

  const core = candidates.filter((candidate) => candidate.role === "core_requirement");
  return core.length > 0
    ? candidates.filter((candidate) =>
      candidate.role === "core_requirement" ||
        (candidate.sourceQuality === "manual_check" && candidate.priority !== "could")
    )
    : candidates.filter((candidate) =>
      candidate.role === "problem_context" || candidate.sourceQuality === "manual_check"
    );
}

function baseExcludedSourceRanges(sourceText: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  let lineStart = 0;
  let state:
    | { kind: "outside" }
    | { kind: "html_comment"; start: number }
    | { kind: "markdown_fence"; start: number; marker: "`" | "~"; length: number } = { kind: "outside" };

  while (lineStart < sourceText.length) {
    const contentEnd = lineContentEnd(sourceText, lineStart);
    const nextLineStart = contentEnd + lineBreakLengthAt(sourceText, contentEnd);
    const line = sourceText.slice(lineStart, contentEnd);

    if (state.kind === "markdown_fence") {
      if (isMarkdownFenceCloser(line, state)) {
        ranges.push({ start: state.start, end: nextLineStart });
        state = { kind: "outside" };
      }
    } else if (state.kind === "html_comment") {
      const closingStart = sourceText.indexOf("-->", lineStart);
      if (closingStart >= 0 && closingStart + "-->".length <= contentEnd) {
        ranges.push({ start: state.start, end: closingStart + "-->".length });
        const nextCommentStart = closedHtmlCommentStartOnLine(sourceText, closingStart + "-->".length, contentEnd, ranges);
        state = nextCommentStart === null
          ? { kind: "outside" }
          : { kind: "html_comment", start: nextCommentStart };
      }
    } else {
      const fence = markdownFenceOnLine(line);
      const commentStart = sourceText.indexOf("<!--", lineStart);
      const commentIsOnLine = commentStart >= lineStart && commentStart < contentEnd;

      if (fence && (!commentIsOnLine || lineStart + fence.start < commentStart)) {
        state = { kind: "markdown_fence", start: lineStart, marker: fence.marker, length: fence.length };
      } else if (commentIsOnLine) {
        const nextCommentStart = closedHtmlCommentStartOnLine(sourceText, commentStart, contentEnd, ranges);
        if (nextCommentStart !== null) state = { kind: "html_comment", start: nextCommentStart };
      }
    }

    lineStart = nextLineStart;
  }

  if (state.kind !== "outside") ranges.push({ start: state.start, end: sourceText.length });
  return ranges;
}

function lineContentEnd(sourceText: string, lineStart: number): number {
  let cursor = lineStart;
  while (cursor < sourceText.length && sourceText[cursor] !== "\r" && sourceText[cursor] !== "\n") cursor += 1;
  return cursor;
}

function closedHtmlCommentStartOnLine(
  sourceText: string,
  start: number,
  contentEnd: number,
  ranges: Array<{ start: number; end: number }>
): number | null {
  let commentStart = sourceText.indexOf("<!--", start);
  while (commentStart >= start && commentStart < contentEnd) {
    const closingStart = sourceText.indexOf("-->", commentStart + "<!--".length);
    if (closingStart < 0 || closingStart + "-->".length > contentEnd) return commentStart;
    ranges.push({ start: commentStart, end: closingStart + "-->".length });
    commentStart = sourceText.indexOf("<!--", closingStart + "-->".length);
  }
  return null;
}

function markdownFenceOnLine(line: string): { start: number; marker: "`" | "~"; length: number } | null {
  let markerStart = 0;
  while (markerStart < line.length && line[markerStart] === " " && markerStart < 3) markerStart += 1;
  const marker = line[markerStart];
  if (marker !== "`" && marker !== "~") return null;

  let end = markerStart;
  while (line[end] === marker) end += 1;
  const length = end - markerStart;
  return length >= 3 ? { start: markerStart, marker, length } : null;
}

function isMarkdownFenceCloser(
  line: string,
  openFence: { marker: "`" | "~"; length: number }
): boolean {
  const fence = markdownFenceOnLine(line);
  return Boolean(
    fence &&
    fence.marker === openFence.marker &&
    fence.length >= openFence.length &&
    line.slice(fence.start + fence.length).trim().length === 0
  );
}

export function visibleSourceRangesFromCursor(
  start: number,
  end: number,
  excludedRanges: readonly { start: number; end: number }[],
  excludedRangeIndex: number
): {
  ranges: Array<{ start: number; end: number }>;
  nextExcludedRangeIndex: number;
} {
  const visible: Array<{ start: number; end: number }> = [];
  let cursor = start;
  let index = excludedRangeIndex;

  while (index < excludedRanges.length && excludedRanges[index]!.end <= start) index += 1;

  for (let scan = index; scan < excludedRanges.length; scan += 1) {
    const excluded = excludedRanges[scan]!;
    if (excluded.end <= cursor) continue;
    if (excluded.start >= end) break;
    if (excluded.start > cursor) visible.push({ start: cursor, end: Math.min(excluded.start, end) });
    cursor = Math.max(cursor, excluded.end);
    if (cursor >= end) break;
  }

  if (cursor < end) visible.push({ start: cursor, end });
  while (index < excludedRanges.length && excludedRanges[index]!.end <= end) index += 1;
  return { ranges: visible, nextExcludedRangeIndex: index };
}

function trimSourceRangeStart(sourceText: string, start: number, end: number): number {
  let cursor = start;
  while (cursor < end && /\s/.test(sourceText[cursor] ?? "")) cursor += 1;
  return cursor;
}

function trimSourceRangeEnd(sourceText: string, start: number, end: number): number {
  let cursor = end;
  while (cursor > start && /\s/.test(sourceText[cursor - 1] ?? "")) cursor -= 1;
  return cursor;
}

function toRequirementSourceSpans(
  candidates: SpanCandidate[],
  sourceText: string,
  isPrBody: boolean
): RequirementSourceSpan[] {
  const ordinalByGroup = new Map<number, number>();
  const previousByGroup = new Map<number, RequirementSpanId>();
  const listAncestorsByGroup = new Map<number, Array<{ indent: number; id: RequirementSpanId }>>();

  return candidates.map((candidate) => {
    const ordinal = (ordinalByGroup.get(candidate.group) ?? 0) + 1;
    const id = `sp_${candidate.group}_${ordinal}` as RequirementSpanId;
    let parent: RequirementSpanId | null;
    if (candidate.listIndent === null) {
      parent = previousByGroup.get(candidate.group) ?? null;
    } else {
      const ancestors = listAncestorsByGroup.get(candidate.group) ?? [];
      while (ancestors.length > 0 && ancestors[ancestors.length - 1]!.indent >= candidate.listIndent) {
        ancestors.pop();
      }
      parent = ancestors[ancestors.length - 1]?.id ?? null;
      ancestors.push({ indent: candidate.listIndent, id });
      listAncestorsByGroup.set(candidate.group, ancestors);
    }
    ordinalByGroup.set(candidate.group, ordinal);
    previousByGroup.set(candidate.group, id);

    return {
      id,
      groupId: `grp_${candidate.group}`,
      ordinal,
      immediateParentSpanId: parent,
      source: candidate.source,
      authority: isPrBody ? "pr_author_claim" : "authoritative",
      sourceQuality: candidate.sourceQuality,
      sourceSection: candidate.sourceSection,
      start: candidate.start,
      end: candidate.end,
      text: sourceText.slice(candidate.start, candidate.end),
      priority: candidate.priority
    };
  });
}

function indentationColumns(prefix: string): number {
  let columns = 0;
  for (const character of prefix) columns += character === "\t" ? 4 : 1;
  return columns;
}

function sourceSpanBoundaries(sourceText: string, start: number, end: number): Array<{ start: number; end: number }> {
  const boundaries: Array<{ start: number; end: number }> = [];
  const text = sourceText.slice(start, end);
  const terminal = /[.!?](?=\s|$)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = terminal.exec(text))) {
    const boundaryEnd = (match.index ?? 0) + 1;
    boundaries.push({ start: start + cursor, end: start + boundaryEnd });
    cursor = boundaryEnd;
    while (cursor < text.length && /\s/.test(text[cursor] ?? "")) cursor += 1;
  }

  if (cursor < text.length) boundaries.push({ start: start + cursor, end });
  return boundaries;
}

function firstNonWhitespaceIndex(value: string): number {
  const match = value.match(/\S/);
  return match?.index ?? value.length;
}

function lastNonWhitespaceEnd(value: string): number {
  const match = value.match(/\S\s*$/);
  return match ? (match.index ?? 0) + match[0].trimEnd().length : 0;
}

function lineBreakLengthAt(sourceText: string, index: number): number {
  return sourceText[index] === "\r" && sourceText[index + 1] === "\n" ? 2 : sourceText[index] ? 1 : 0;
}

export function extractRequirementEvidence(
  taskText: string,
  prDescription: string,
  taskSource: PullRequestInput["taskSource"] = "task"
): RequirementExtractionResult {
  const taskRaw = redactSecrets(taskText).trim();
  const prRaw = redactSecrets(prDescription).trim();
  const taskSourceType: Requirement["source"] = taskRaw ? taskSource ?? "task" : "manual";
  const taskLines = taskRaw ? classifyRequirementSource(taskRaw, taskSourceType, false) : [];
  const prLines = prRaw ? classifyRequirementSource(prRaw, "pr_description", true) : [];
  const sourceOfTruthLines = taskLines.length > 0 ? taskLines : [];
  const sourceText = cleanRequirementSourceText(taskRaw || prRaw);
  const sourceHasAcceptanceLanguage = /acceptance criteria|must|required|given|when|then/i.test(sourceText);
  const contexts = toContextSignals([...taskLines, ...prLines]);
  const coreCandidates = sourceOfTruthLines.filter((line) => line.role === "core_requirement");
  const promotedProblemCandidates = coreCandidates.length === 0 && taskLines.length > 0
    ? promoteProblemContexts(taskLines)
    : [];
  const authorIntentCandidates = taskLines.length === 0
    ? prLines
      .filter((line) => line.role === "author_claim")
      .filter((line) => !AUTHOR_EVIDENCE_SECTION_PATTERN.test(line.sourceSection ?? ""))
      .filter((line) => !isIssueTemplateNoiseLine(line.text))
      .filter(isEligibleUnlinkedPrObjective)
      .map((line) => ({ ...line, role: "core_requirement" as const, sourceQuality: "author_claim" as const }))
    : [];
  const allRequirementCandidates = (coreCandidates.length > 0
    ? coreCandidates
    : promotedProblemCandidates.length > 0
      ? promotedProblemCandidates
      : authorIntentCandidates)
    .filter((line) => line.text.length > 12)
    .filter((line) => !isVagueRequirementLine(line.text, sourceHasAcceptanceLanguage))
  const requirementCandidates = allRequirementCandidates.slice(0, 8);
  const fencedContextKeywords = extractKeywords(collectUsefulFencedContent(taskRaw || prRaw));

  const requirements = requirementCandidates
    .map((line, index) => ({
      id: `req_${index + 1}`,
      source: line.source,
      text: normalizeSentence(line.text),
      keywords: mergeKeywords(
        extractKeywords(line.text),
        mergeKeywords(contextKeywordsForRequirement(line, contexts), fencedContextKeywords)
      ),
      priority: priorityForRequirement(line.text),
      role: "core_requirement",
      sourceQuality: line.sourceQuality,
      sourceSection: line.sourceSection ?? null,
      contextRoles: contextRolesForRequirement(line, contexts)
    })) satisfies Requirement[];

  if (requirements.length > 0) {
    return {
      requirements,
      contexts,
      omittedRequirementCount: Math.max(0, allRequirementCandidates.length - requirements.length)
    };
  }

  return {
    requirements: taskRaw
      ? [{
          id: "req_1",
          source: "manual",
          text: "Original requirement is too vague to verify automatically.",
          keywords: [],
          priority: "must",
          role: "core_requirement",
          sourceQuality: "manual_check",
          sourceSection: null,
          contextRoles: contexts.map((context) => context.role).filter(uniqueRole).slice(0, 8)
        }]
      : [],
    contexts,
    omittedRequirementCount: 0
  };
}

function isEligibleUnlinkedPrObjective(line: ClassifiedRequirementLine): boolean {
  if (isEvaluationContextLine(line)) return false;
  if (PR_META_PURPOSE_PATTERN.test(line.text)) return false;
  if (ACCEPTANCE_SECTION_PATTERN.test(line.sourceSection ?? "")) return true;
  return PR_OBJECTIVE_ACTION_PATTERN.test(line.text);
}

/**
 * A narrow, deterministic source-hygiene veto used after planner admission.
 * It mirrors the BASE extraction boundary for pure self-referential evaluation
 * prose while preserving mixed sentences with a concrete product action.
 */
export function isUnlinkedPrEvaluationMetaCandidate(
  value: string,
  sourceSection?: string | null
): boolean {
  const text = normalizeSourceLine(value);
  const line: ClassifiedRequirementLine = {
    text,
    source: "pr_description",
    role: "author_claim",
    sourceQuality: "author_claim",
    sourceSection
  };
  return isEvaluationContextLine(line) ||
    /^(?:이|본)\s*PR(?:은|는)?\s*(?:검토|검증|분석)\s*파이프라인을?\s*(?:테스트|평가|검증|실행)(?:합니다|한다|해요|함)?/i.test(text) ||
    (PR_META_PURPOSE_PATTERN.test(text) && !PR_OBJECTIVE_ACTION_PATTERN.test(text));
}

function isEvaluationContextLine(line: ClassifiedRequirementLine): boolean {
  const text = line.text.trim();
  const section = line.sourceSection ?? "";
  const explicitScopeConstraint = /^(?:do not|don't|must not|should not|only|limit|restrict)\b/i.test(text);

  return (!explicitScopeConstraint && EVALUATION_CONTEXT_SECTION_PATTERN.test(section)) ||
    SELF_REFERENTIAL_EVALUATION_PATTERN.test(text);
}

function classifyRequirementSource(
  rawText: string,
  source: Requirement["source"],
  isPrBody: boolean
): ClassifiedRequirementLine[] {
  const sourceText = cleanRequirementSourceText(rawText);
  const lines: ClassifiedRequirementLine[] = [];
  let currentSection: string | undefined;

  for (const rawLine of sourceText.split(/\n+/)) {
    const isLinkedIssueTitle = /^\s*Linked issue\s+(?:[\w.-]+\/[\w.-]+)?#\d+:/i.test(rawLine);
    const trimmed = normalizeSourceLine(rawLine);
    if (!trimmed) continue;

    const heading = sectionHeading(trimmed);
    if (heading) {
      currentSection = heading;
      continue;
    }

    const inline = inlineSection(trimmed);
    if (inline && !inline.text) {
      currentSection = inline.section;
      continue;
    }

    const section = isLinkedIssueTitle ? "linked_issue_title" : inline?.section ?? currentSection;
    const text = inline?.text || trimmed;

    for (const segment of splitRequirementSegments(text)) {
      const role = classifyLineRole(segment, section, source, isPrBody);
      const sourceQuality = sourceQualityForLine(segment, section, role, source, isPrBody);
      lines.push({
        text: normalizeSentence(segment),
        source,
        role,
        sourceQuality,
        sourceSection: section ?? null
      });
    }
  }

  return lines.filter((line) => line.text.length > 0);
}

function normalizeSourceLine(line: string): string {
  return line
    .trim()
    .replace(/^Linked issue\s+[\w.-]+\/[\w.-]+#\d+:\s*/i, "")
    .replace(/^Linked issue\s+#\d+:\s*/i, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/^\s*>\s*/, "")
    .trim();
}

function sectionHeading(line: string): string | undefined {
  const match = line.match(HEADING_PATTERN);
  if (!match) return undefined;

  const heading = normalizeSection(match[1]);
  return heading || undefined;
}

function inlineSection(line: string): { section: string; text: string } | null {
  const match = line.match(INLINE_SECTION_PATTERN);
  if (!match) return null;

  const section = normalizeSection(match[1]);
  const text = match[2]?.trim() ?? "";

  return { section, text };
}

function normalizeSection(value: string): string {
  return value
    .replace(/^#+\s*/, "")
    .replace(/^_+|_+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/:$/, "")
    .trim();
}

function splitRequirementSegments(line: string): string[] {
  if (MARKDOWN_IMAGE_PATTERN.test(line)) {
    return [line];
  }

  return line
    .split(/;|(?<=\.)\s+|(?:^|\s)(?:-|\*|\d+\.)\s+/)
    .map((segment) => segment.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean);
}

function classifyLineRole(
  line: string,
  section: string | undefined,
  source: Requirement["source"],
  isPrBody: boolean
): RequirementSourceRole {
  const normalized = normalizeSection(line);
  const sectionText = section ?? "";

  if (isIssueTemplateNoiseLine(line) || TEMPLATE_SECTION_PATTERN.test(sectionText) || CHECKBOX_ONLY_PATTERN.test(line)) {
    return "template_noise";
  }

  if (MARKDOWN_IMAGE_PATTERN.test(line) || VISUAL_SECTION_PATTERN.test(sectionText)) {
    return "visual_context";
  }

  if (EXTERNAL_REFERENCE_SECTION_PATTERN.test(sectionText) || EXTERNAL_REFERENCE_PATTERN.test(line)) {
    return "external_reference";
  }

  if (SOLUTION_HINT_SECTION_PATTERN.test(sectionText) || isSolutionHintLine(line)) {
    return "solution_hint";
  }

  if (isPrBody && source === "pr_description") {
    return "author_claim";
  }

  if (sectionText === "linked_issue_title" || AMBIGUITY_PATTERN.test(line)) {
    return "problem_context";
  }

  if (ACCEPTANCE_SECTION_PATTERN.test(sectionText)) {
    return "core_requirement";
  }

  if (/^(expected|should|must|shall|required|do not|don't)\b/i.test(line) || /\bshould not|must not\b/i.test(line)) {
    return "core_requirement";
  }

  if (PROBLEM_SECTION_PATTERN.test(sectionText)) {
    return "problem_context";
  }

  if (REPRODUCTION_SECTION_PATTERN.test(sectionText) || /^it can be reproduced\b/i.test(line)) {
    return "reproduction_context";
  }

  if (ENVIRONMENT_SECTION_PATTERN.test(sectionText) || isEnvironmentLine(normalized)) {
    return "environment_context";
  }

  if (isPrBody && AUTHOR_CLAIM_SECTION_PATTERN.test(sectionText)) {
    return "author_claim";
  }

  if (REQUIREMENT_LANGUAGE_PATTERN.test(line) || KOREAN_REQUIREMENT_PATTERN.test(line)) {
    return "core_requirement";
  }

  if (ISSUE_PROBLEM_PATTERN.test(line)) {
    return "problem_context";
  }

  return "problem_context";
}

function sourceQualityForLine(
  line: string,
  section: string | undefined,
  role: RequirementSourceRole,
  source: Requirement["source"],
  isPrBody: boolean
): RequirementSourceQuality {
  const sectionText = section ?? "";

  if (role === "core_requirement" && ACCEPTANCE_SECTION_PATTERN.test(sectionText) && /acceptance/i.test(sectionText)) {
    return "explicit_acceptance_criteria";
  }
  if (role === "core_requirement" && /expected/i.test(sectionText)) {
    return "expected_behavior";
  }
  if (role === "core_requirement" && REQUIREMENT_LANGUAGE_PATTERN.test(line)) {
    return "requirement_language";
  }
  if (role === "solution_hint") {
    return "solution_hint";
  }
  if (role === "author_claim" || isPrBody) {
    return "author_claim";
  }
  if (source === "issue") {
    return "linked_issue";
  }
  if (role === "problem_context") {
    return "problem_statement";
  }

  return "fallback";
}

function promoteProblemContexts(lines: ClassifiedRequirementLine[]): ClassifiedRequirementLine[] {
  const candidates = lines
    .filter((line) => line.role === "problem_context")
    .filter((line) => line.text.length > 12)
    .filter((line) => !isIssueTemplateNoiseLine(line.text))
  const withoutLinkedIssueTitle = candidates.filter((line) => line.sourceSection !== "linked_issue_title");

  return (withoutLinkedIssueTitle.length > 0 ? withoutLinkedIssueTitle : candidates)
    .slice(0, 8)
    .map((line) => ({
      ...line,
      role: "core_requirement",
      sourceQuality: "problem_statement"
    }));
}

function toContextSignals(lines: ClassifiedRequirementLine[]): RequirementContextSignal[] {
  return lines
    .filter(isContextLine)
    .slice(0, 30)
    .map((line, index) => ({
      id: `ctx_${index + 1}`,
      source: line.source,
      role: line.role,
      sourceQuality: line.sourceQuality,
      sourceSection: line.sourceSection ?? null,
      text: normalizeSentence(line.text)
    })) satisfies RequirementContextSignal[];
}

function isContextLine(
  line: ClassifiedRequirementLine
): line is ClassifiedRequirementLine & { role: RequirementContextSignal["role"] } {
  return line.role !== "core_requirement" && line.role !== "template_noise";
}

function contextKeywordsForRequirement(
  requirement: ClassifiedRequirementLine,
  contexts: RequirementContextSignal[]
): string[] {
  return contexts
    .filter((context) => context.source === requirement.source)
    .filter((context) => isRelevantContext(requirement.text, context))
    .flatMap((context) => extractKeywords(context.text))
    .slice(0, 12);
}

function contextRolesForRequirement(
  requirement: ClassifiedRequirementLine,
  contexts: RequirementContextSignal[]
): RequirementSourceRole[] {
  return contexts
    .filter((context) => context.source === requirement.source)
    .filter((context) => isRelevantContext(requirement.text, context))
    .map((context) => context.role)
    .filter(uniqueRole)
    .slice(0, 8);
}

function isRelevantContext(requirementText: string, context: RequirementContextSignal): boolean {
  if (context.sourceSection === "ambiguity" || AMBIGUITY_PATTERN.test(context.text)) {
    return true;
  }
  if (context.role === "visual_context" && isVisualContextText(`${requirementText} ${context.text}`)) {
    return true;
  }
  if (context.role === "external_reference") {
    return true;
  }

  const requirementKeywords = new Set(extractKeywords(requirementText));
  return extractKeywords(context.text).some((keyword) => requirementKeywords.has(keyword));
}

function isEnvironmentLine(line: string): boolean {
  return /^(electron|pandas|python|node|npm|browser|chrome|safari|firefox|operating system|os|platform|version)\b/i.test(line) ||
    /\b(version|windows|macos|linux|ubuntu|ios|android|browser|debug output)\b/i.test(line);
}

function isSolutionHintLine(line: string): boolean {
  return SOLUTION_HINT_LINE_PATTERN.test(line) &&
    !/^(expected|actual|should|must|shall|required|do not|don't)\b/i.test(line);
}

function isVisualContextText(text: string): boolean {
  return /\b(screenshot|screen shot|image|visual|browser|ui|ux|layout|viewport|responsive|overlap|overflow)\b/i.test(text);
}

function priorityForRequirement(text: string): Requirement["priority"] {
  if (/\b(must|required|acceptance|criteria|must not|shall)\b/i.test(text)) {
    return "must";
  }
  if (/\b(could|nice to have|optional)\b/i.test(text)) {
    return "could";
  }

  return "should";
}

function uniqueRole(role: RequirementSourceRole, index: number, roles: RequirementSourceRole[]): boolean {
  return roles.indexOf(role) === index;
}

function cleanRequirementSourceText(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/~~~[\s\S]*?~~~/g, "\n")
    .replace(/\b(Acceptance criteria|Expected behavior|Expected outcome|Actual behavior|Actual outcome|Steps to reproduce|Reproducible example|Code for reproduction|Describe the bug|Issue description|Suggested fix|Suggested solution|Proposed fix|Proposed solution|Possible fix|Possible solution|Debug Output):/gi, "\n$1:")
    .trim();
}

function isIssueTemplateNoiseLine(line: string): boolean {
  const normalized = line.replace(/^#+\s*/, "").trim().replace(/^_+|_+$/g, "").replace(/:$/, "");

  return /^<!--|-->$/.test(normalized) ||
    /^https?:\/\/\S+$/i.test(normalized) ||
    /^(summary|bug summary|validation|verification|testing|test plan|description|steps to reproduce|code for reproduction|reproduce|system details|system information|actual behavior|actual outcome|expected behavior|expected outcome|additional context|additional information|no response)$/i.test(normalized) ||
    /^(corepack\s+)?pnpm\s+\S+|^npm\s+\S+|^yarn\s+\S+|^bun\s+\S+|^npx\s+\S+|^node\s+[\w./-]+\.(?:[cm]?[jt]s|json)\b|^node\s+(?:--[\w-]+|-e\b|--eval\b)|^tsc\b|^next\s+build/i.test(normalized) ||
    /^Python \d+\.\d+/i.test(normalized) ||
    /^\[GCC [\d.]+\]/i.test(normalized) ||
    /^Type "help", "copyright", "credits" or "license"/i.test(normalized) ||
    /^root@[\w.-]+:/i.test(normalized) ||
    /^(>>>|In \[\d+\]:|Out\[\d+\]:)/.test(normalized);
}

function collectUsefulFencedContent(text: string): string {
  return Array.from(text.matchAll(/```([\s\S]*?)```|~~~([\s\S]*?)~~~/g))
    .map((match) => usefulFencedContent(match[1] ?? match[2] ?? ""))
    .filter(Boolean)
    .join("\n");
}

function usefulFencedContent(content: string): string {
  const clean = content.trim().replace(/^(python|py|typescript|ts|javascript|js|text|sh|shell|bash)\n/i, "");

  if (!clean || /Traceback \(most recent call last\)|^\s*File ".*", line \d+/m.test(clean)) {
    return "";
  }

  return clean;
}

function mergeKeywords(primary: string[], context: string[]): string[] {
  return Array.from(new Set([...primary, ...context])).slice(0, 12);
}

export function extractClaims(prDescription: string, evidenceIndex: EvidenceItem[]): AgentClaim[] {
  const sentences = redactSecrets(prDescription)
    .split(/(?<=\.)\s+|\n/)
    .map((line) => line.trim())
    .filter((line) => CLAIM_VERB_PATTERN.test(line))
    .flatMap(expandClaimClauses)
    .slice(0, 6);

  return sentences.map((text, index) => {
    const keywords = extractKeywords(text);
    const supportPredicate = isExecutionClaim(text) ? isPassingExecutionClaimEvidence : isClaimSupportEvidence;
    const independentEvidence = evidenceIndex.filter(supportPredicate);
    const evidenceRefs = independentEvidence
      .filter((item) => keywords.some((keyword) => item.summary.toLowerCase().includes(keyword)))
      .slice(0, 3)
      .map((item) => item.id);
    const supportedKeywordCount = keywords.filter((keyword) =>
      independentEvidence.some((item) => item.summary.toLowerCase().includes(keyword))
    ).length;
    const supportRatio = keywords.length === 0 ? 0 : supportedKeywordCount / keywords.length;

    return {
      id: `claim_${index + 1}`,
      text: normalizeSentence(text),
      evidenceRefs,
      supported: evidenceRefs.length > 0 && supportRatio >= 0.5
    };
  });
}

function expandClaimClauses(sentence: string): string[] {
  const match = sentence.match(CLAIM_START_PATTERN);

  if (!match) {
    return [sentence];
  }

  const verb = match[1];
  const rest = match[2].replace(/\.$/, "");
  const clauses = rest
    .split(/,\s*(?:and\s+)?|\s+and\s+/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 4);

  if (clauses.length <= 1) {
    return [sentence];
  }

  return clauses.map((clause) =>
    CLAIM_START_PATTERN.test(clause)
      ? clause
      : `${verb} ${clause}`
  );
}

function isExecutionClaim(text: string): boolean {
  return /\btested\b/i.test(text) ||
    /\b(verified|validated).{0,80}\b(tests?|spec|unit|integration|e2e|ci|build|coverage)\b/i.test(text) ||
    /\b(tests?|spec|unit|integration|e2e|ci|build|coverage).{0,80}\b(pass|passed|verified|validated|succeeded|green)\b/i.test(text);
}

function isVagueRequirementLine(line: string, sourceHasAcceptanceLanguage: boolean): boolean {
  if (sourceHasAcceptanceLanguage) {
    return false;
  }

  return VAGUE_TASK_PATTERN.test(line) && !CONCRETE_ACTION_PATTERN.test(line);
}

function isClaimSupportEvidence(item: EvidenceItem): boolean {
  return item.kind === "diff" || item.kind === "test" || item.kind === "check" || item.kind === "log";
}

function isPassingExecutionClaimEvidence(item: EvidenceItem): boolean {
  return (item.kind === "check" || item.kind === "log") &&
    isExecutionEvidenceSignal(item.label, item.summary, item.locator) &&
    hasPassingEvidenceStatusPrefix(item.summary);
}

export function buildEvidenceIndex(
  taskText: string,
  prDescription: string,
  changedFiles: ChangedFile[],
  checks: CheckRun[],
  logs: LogSnippet[],
  taskSource: PullRequestInput["taskSource"] = "task"
): EvidenceItem[] {
  return buildEvidenceIndexResult(taskText, prDescription, changedFiles, checks, logs, taskSource).items;
}

export function buildEvidenceIndexResult(
  taskText: string, prDescription: string, changedFiles: ChangedFile[], checks: CheckRun[], logs: LogSnippet[], taskSource: PullRequestInput["taskSource"] = "task"
): EvidenceIndexResult {
  const items: EvidenceItem[] = [];

  if (taskText.trim()) {
    items.push({
      id: `ev_${items.length + 1}`,
      kind: "task",
      label: taskSource === "issue" ? "Linked issue" : "Original task",
      summary: compactText(redactSecrets(taskText), 700),
      confidence: 0.95
    });
  }

  if (prDescription.trim()) {
    items.push({
      id: `ev_${items.length + 1}`,
      kind: "pr_description",
      label: "PR description",
      summary: compactText(redactSecrets(prDescription), 700),
      confidence: 0.7
    });
  }

  for (const file of changedFiles) {
    const safePath = redactSecrets(file.path);
    const status = file.status ? `${file.status} ` : "";
    const stats =
      typeof file.additions === "number" || typeof file.deletions === "number"
        ? ` (+${file.additions ?? 0}/-${file.deletions ?? 0})`
        : "";
    const testSignal = isTestFile(file.path) ? " Test evidence file." : "";
    const riskSignal = isRiskFile(file.path) ? " Risk-sensitive path." : "";

    const patchSummary = file.patch ? ` Patch excerpt: ${compactPatchExcerpt(file.patch)}` : "";

    items.push({
      id: `ev_${items.length + 1}`,
      kind: isTestFile(file.path) ? "test" : file.patch ? "diff" : "changed_file",
      label: safePath,
      locator: safePath,
      summary: `${status}${safePath}${stats}.${testSignal}${riskSignal}${patchSummary}`.trim(),
      confidence: 0.85
    });
  }

  for (const check of checks) {
    const safeName = redactSecrets(check.name);
    const safeSummary = check.summary ? redactSecrets(check.summary) : undefined;

    items.push({
      id: `ev_${items.length + 1}`,
      kind: "check",
      label: safeName,
      locator: sanitizeEvidenceLocator(check.url),
      summary: `Status: ${check.status}. ${safeName}${safeSummary ? ` - ${compactText(safeSummary, 350)}` : ""}`,
      confidence: check.status === "unknown" ? 0.45 : 0.9
    });
  }

  for (const log of logs) {
    const safeSource = redactSecrets(log.source);
    const status = log.status ?? "unknown";

    items.push({
      id: `ev_${items.length + 1}`,
      kind: "log",
      label: safeSource,
      locator: sanitizeEvidenceLocator(log.url),
      summary: `Status: ${status}. ${safeSource}: ${compactText(redactSecrets(log.text), 450)}`,
      confidence: status === "unknown" ? 0.45 : 0.75
    });
  }

  const buckets: EvidenceItem[][] = Array.from({ length: 6 }, () => []);
  for (const item of items) buckets[evidenceRank(item)].push(item);
  const ranked = buckets.flat();
  // Retain original IDs so existing evidence references remain stable even
  // when lower-priority items are omitted.
  const kept = ranked.slice(0, MAX_REPORT_EVIDENCE_ITEMS);
  const omittedByKind: EvidenceIndexResult["omittedByKind"] = {};
  for (const item of ranked.slice(MAX_REPORT_EVIDENCE_ITEMS)) omittedByKind[item.kind] = (omittedByKind[item.kind] ?? 0) + 1;
  return { items: kept, omittedByKind };
}

function evidenceRank(item: EvidenceItem): number {
  if ((item.kind === "check" || item.kind === "log") && /Status:\s*(failure|failed|error|cancelled|timed_out)/i.test(item.summary)) return 0;
  if ((item.kind === "check" || item.kind === "log") && /Status:\s*(pending|in_progress|queued|unknown)/i.test(item.summary)) return 1;
  if (item.kind === "check" || item.kind === "log") return 2;
  if (item.kind === "test" || item.kind === "diff") return 3;
  if (item.kind === "task" || item.kind === "pr_description") return 4;
  return 5;
}

export function extractKeywords(text: string): string[] {
  const keywords = text
    .replace(/[^a-z0-9_/.-]+/gi, " ")
    .split(/\s+/)
    .flatMap((word) => {
      const original = word.replace(/^[._/-]+|[._/-]+$/g, "").toLowerCase();
      const camelSplit = word
        .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .toLowerCase();
      const parts = camelSplit
        .replace(/^[._/-]+|[._/-]+$/g, "")
        .split(/[._/-]+|\s+/)
        .filter(Boolean);

      return [original, ...parts].flatMap(keywordVariants);
    })
    .filter((word) => (word.length > 2 || SHORT_TECH_KEYWORDS.has(word)) && !STOP_WORDS.has(word));

  return Array.from(new Set(keywords)).slice(0, 12);
}

const SHORT_TECH_KEYWORDS = new Set(["np", "py", "js", "ts"]);

const KEYWORD_ALIASES = new Map<string, string[]>([
  ["authentication", ["auth"]],
  ["indices", ["index"]],
  ["numpy", ["np"]],
  ["pickling", ["pickle"]],
  ["proxies", ["proxy"]]
]);

function keywordVariants(word: string): string[] {
  const variants = [word, ...(KEYWORD_ALIASES.get(word) ?? [])];

  if (word.endsWith("ies") && word.length > 5) {
    variants.push(`${word.slice(0, -3)}y`);
  } else if (word.endsWith("s") && word.length > 4) {
    variants.push(word.slice(0, -1));
  }

  return variants;
}

function compactPatchExcerpt(patch: string, maxLength = 500): string {
  const clean = redactSecrets(patch.trim().replace(/\r\n/g, "\n"));

  if (clean.length <= maxLength) {
    return clean;
  }

  const marker = "\n...[middle truncated for privacy and token control]\n";
  const available = maxLength - marker.length;
  const headLength = Math.max(120, Math.floor(available / 2));
  const tailLength = Math.max(120, available - headLength);

  return `${clean.slice(0, headLength).trimEnd()}${marker}${clean.slice(-tailLength).trimStart()}`;
}

function sanitizeEvidenceLocator(value: string | undefined): string | undefined {
  if (!value) return undefined;

  const redacted = redactSecrets(value);

  try {
    const url = new URL(redacted);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return redacted;
  }
}

export function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERN.test(path);
}

export function isRiskFile(path: string): boolean {
  return RISK_FILE_PATTERN.test(path);
}

export function fileKeywords(path: string): string[] {
  return extractKeywords(path.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[/.\\_-]/g, " "));
}

function normalizeSentence(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}
