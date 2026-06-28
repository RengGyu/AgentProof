import type {
  AgentClaim,
  ChangedFile,
  CheckRun,
  EvidenceItem,
  LogSnippet,
  Requirement
} from "./types";
import { hasPassingEvidenceStatusPrefix, isExecutionEvidenceSignal } from "./evidence-status";
import { compactText } from "./redact";
import { redactSecrets } from "./redact";

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

const TEST_FILE_PATTERN = /(\.test\.|\.spec\.|__tests__|(^|\/)tests?\/|test_|_test\.|spec_)/i;
const RISK_FILE_PATTERN = /(auth|permission|billing|payment|migration|schema|infra|session|security|token|secret|admin)/i;
const VAGUE_TASK_PATTERN = /\b(improve|better|fewer problems|more reliable|clean\s*up|cleanup|polish|enhance|optimi[sz]e|make .* easier|make .* nicer)\b/i;
const CONCRETE_ACTION_PATTERN =
  /\b(add|allow|block|create|delete|display|export|fix|handle|hide|implement|prevent|preserve|reject|remove|require|return|save|send|show|validate)\b/i;
const CLAIM_VERB_PATTERN =
  /\b(add(?:ed)?|align(?:ed)?|implement(?:ed)?|fix(?:ed)?|update(?:d)?|create(?:d)?|change(?:d)?|remove(?:d)?|redesign(?:ed)?|reframe(?:d)?|refresh(?:ed)?|rename(?:d)?|rework(?:ed)?|validate(?:d)?|verif(?:y|ied)|test(?:ed)?|pass(?:ed)?)\b/i;
const CLAIM_START_PATTERN =
  /^\s*(add(?:ed)?|align(?:ed)?|implement(?:ed)?|fix(?:ed)?|update(?:d)?|create(?:d)?|change(?:d)?|remove(?:d)?|redesign(?:ed)?|reframe(?:d)?|refresh(?:ed)?|rename(?:d)?|rework(?:ed)?|validate(?:d)?|verif(?:y|ied)|test(?:ed)?|pass(?:ed)?)\s+(.+)$/i;

export function extractRequirements(taskText: string, prDescription: string): Requirement[] {
  const rawSourceText = redactSecrets(taskText).trim() || redactSecrets(prDescription).trim();
  const sourceText = cleanRequirementSourceText(rawSourceText);
  const contextKeywords = extractKeywords(collectUsefulFencedContent(rawSourceText));
  const explicit = sourceText.match(/acceptance criteria:?([\s\S]*)/i)?.[1] ?? sourceText;
  const candidateLines = explicit
    .split(/\n|;|(?<=\.)\s+|(?:^|\s)(?:-|\*|\d+\.)\s+/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean)
    .filter((line) => !isIssueTemplateNoiseLine(line));

  const requirements = candidateLines
    .filter((line) => line.length > 12)
    .filter((line) => !isVagueRequirementLine(line, sourceText))
    .slice(0, 8)
    .map((text, index) => ({
      id: `req_${index + 1}`,
      source: taskText.trim() ? "task" : "pr_description",
      text: normalizeSentence(text),
      keywords: mergeKeywords(extractKeywords(text), contextKeywords),
      priority: /\b(must|required|acceptance|criteria)\b/i.test(text) ? "must" : "should"
    })) satisfies Requirement[];

  if (requirements.length > 0) {
    return requirements;
  }

  return [
    {
      id: "req_1",
      source: "manual",
      text: "Original requirement is too vague to verify automatically.",
      keywords: [],
      priority: "must"
    }
  ];
}

function cleanRequirementSourceText(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/~~~[\s\S]*?~~~/g, "\n")
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

function isVagueRequirementLine(line: string, sourceText: string): boolean {
  if (/acceptance criteria|must|required|given|when|then/i.test(sourceText)) {
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
  logs: LogSnippet[]
): EvidenceItem[] {
  const items: EvidenceItem[] = [];

  if (taskText.trim()) {
    items.push({
      id: `ev_${items.length + 1}`,
      kind: "task",
      label: "Original task",
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
      label: file.path,
      locator: file.path,
      summary: `${status}${file.path}${stats}.${testSignal}${riskSignal}${patchSummary}`.trim(),
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
      summary: `Status: ${status}. ${safeSource}: ${compactText(redactSecrets(log.text), 450)}`,
      confidence: status === "unknown" ? 0.45 : 0.75
    });
  }

  return items;
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
