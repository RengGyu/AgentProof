import type {
  AgentClaim,
  ChangedFile,
  CheckRun,
  EvidenceItem,
  LogSnippet,
  Requirement
} from "./types";
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

const TEST_FILE_PATTERN = /(\.test\.|\.spec\.|__tests__|\/tests?\/|test_|_test\.|spec_)/i;
const RISK_FILE_PATTERN = /(auth|permission|billing|payment|migration|schema|infra|session|security|token|secret|admin)/i;

export function extractRequirements(taskText: string, prDescription: string): Requirement[] {
  const sourceText = redactSecrets(taskText).trim() || redactSecrets(prDescription).trim();
  const explicit = sourceText.match(/acceptance criteria:?([\s\S]*)/i)?.[1] ?? sourceText;
  const candidateLines = explicit
    .split(/\n|;|(?<=\.)\s+|(?:^|\s)(?:-|\*|\d+\.)\s+/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ""))
    .filter(Boolean)
    .filter((line) => !/^#+\s*(summary|verification|testing|test plan)\s*$/i.test(line))
    .filter((line) => !/^<!--[\s\S]*-->$/.test(line));

  const requirements = candidateLines
    .filter((line) => line.length > 12)
    .slice(0, 8)
    .map((text, index) => ({
      id: `req_${index + 1}`,
      source: taskText.trim() ? "task" : "pr_description",
      text: normalizeSentence(text),
      keywords: extractKeywords(text),
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

export function extractClaims(prDescription: string, evidenceIndex: EvidenceItem[]): AgentClaim[] {
  const sentences = redactSecrets(prDescription)
    .split(/(?<=\.)\s+|\n/)
    .map((line) => line.trim())
    .filter((line) => /\b(added|implemented|fixed|updated|created|changed|removed|validated|tested)\b/i.test(line))
    .flatMap(expandClaimClauses)
    .slice(0, 6);

  return sentences.map((text, index) => {
    const keywords = extractKeywords(text);
    const independentEvidence = evidenceIndex.filter((item) => item.kind !== "task" && item.kind !== "pr_description");
    const evidenceRefs = evidenceIndex
      .filter((item) => item.kind !== "task" && item.kind !== "pr_description")
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
  const match = sentence.match(/^\s*(added|implemented|fixed|updated|created|changed|removed|validated|tested)\s+(.+)$/i);

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
    /^(added|implemented|fixed|updated|created|changed|removed|validated|tested|cleaned)\b/i.test(clause)
      ? clause
      : `${verb} ${clause}`
  );
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
      summary: compactText(taskText, 700),
      confidence: 0.95
    });
  }

  if (prDescription.trim()) {
    items.push({
      id: `ev_${items.length + 1}`,
      kind: "pr_description",
      label: "PR description",
      summary: compactText(prDescription, 700),
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

    const patchSummary = file.patch ? ` Patch excerpt: ${compactText(file.patch, 500)}` : "";

    items.push({
      id: `ev_${items.length + 1}`,
      kind: file.patch ? "diff" : isTestFile(file.path) ? "test" : "changed_file",
      label: file.path,
      locator: file.path,
      summary: `${status}${file.path}${stats}.${testSignal}${riskSignal}${patchSummary}`.trim(),
      confidence: 0.85
    });
  }

  for (const check of checks) {
    items.push({
      id: `ev_${items.length + 1}`,
      kind: "check",
      label: check.name,
      locator: check.url,
      summary: `${check.name}: ${check.status}${check.summary ? ` - ${compactText(check.summary, 350)}` : ""}`,
      confidence: check.status === "unknown" ? 0.45 : 0.9
    });
  }

  for (const log of logs) {
    items.push({
      id: `ev_${items.length + 1}`,
      kind: "log",
      label: log.source,
      summary: `${log.source}${log.status ? ` (${log.status})` : ""}: ${compactText(log.text, 450)}`,
      confidence: log.status === "unknown" ? 0.45 : 0.75
    });
  }

  return items;
}

export function extractKeywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9_/.-]+/g, " ")
        .split(/\s+/)
        .map((word) => word.replace(/^[._/-]+|[._/-]+$/g, ""))
        .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
        .slice(0, 12)
    )
  );
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
