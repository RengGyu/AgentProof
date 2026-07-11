export interface GitHubRepositoryRef {
  owner: string;
  repo: string;
}

export interface SupportedIssueReference {
  owner: string;
  repo: string;
  number: number;
}

export interface SupportedIssueReferenceExtraction {
  references: SupportedIssueReference[];
  totalSupportedReferences: number;
  capped: boolean;
}

const SUPPORTED_CLOSING_KEYWORD_REF =
  /\b(?:fixes|closes|resolves):?\s+(?:(?<qualified>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(?<qualifiedNumber>\d+)|#(?<localNumber>\d+))/gi;
const SUPPORTED_QUALIFIED_REF = /\b(?<qualified>[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(?<number>\d+)\b/g;

export function extractSupportedIssueReferences(
  text: string,
  repository: GitHubRepositoryRef,
  maxReferences = 3
): SupportedIssueReferenceExtraction {
  const searchableText = stripIssueReferenceExamples(text);
  const candidateReferences: Array<SupportedIssueReference & { placeholder: boolean }> = [];

  for (const match of searchableText.matchAll(SUPPORTED_CLOSING_KEYWORD_REF)) {
    const qualified = match.groups?.qualified;
    const number = Number(match.groups?.qualifiedNumber ?? match.groups?.localNumber);
    const parsed = qualified ? parseQualifiedRepository(qualified) : repository;

    if (parsed && Number.isInteger(number) && number > 0) {
      candidateReferences.push({
        ...parsed,
        number,
        placeholder: isPlaceholderIssueReferenceLine(searchableText, match.index ?? 0, match[0])
      });
    }
  }

  for (const match of searchableText.matchAll(SUPPORTED_QUALIFIED_REF)) {
    const parsed = parseQualifiedRepository(match.groups?.qualified ?? "");
    const number = Number(match.groups?.number);

    if (parsed && Number.isInteger(number) && number > 0) {
      candidateReferences.push({
        ...parsed,
        number,
        placeholder: isPlaceholderIssueReferenceLine(searchableText, match.index ?? 0, match[0])
      });
    }
  }

  const uniqueCandidates = uniqueIssueReferenceCandidates(candidateReferences);
  const realReferences = uniqueCandidates.filter((reference) => !reference.placeholder);

  return {
    references: realReferences.slice(0, maxReferences),
    totalSupportedReferences: realReferences.length,
    capped: realReferences.length > maxReferences
  };
}

export function formatIssueReference(reference: SupportedIssueReference): string {
  return `${reference.owner}/${reference.repo}#${reference.number}`;
}

function parseQualifiedRepository(value: string): GitHubRepositoryRef | null {
  const [owner, repo] = value.split("/");

  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
}

function uniqueIssueReferenceCandidates<T extends SupportedIssueReference>(references: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const reference of references) {
    const key = formatIssueReference(reference).toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(reference);
  }

  return unique;
}

function stripIssueReferenceExamples(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/```[\s\S]*?```/g, "\n");
}

function isPlaceholderIssueReferenceLine(text: string, index: number, matchText: string): boolean {
  const lineStart = text.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const lineEndIndex = text.indexOf("\n", index);
  const lineEnd = lineEndIndex === -1 ? text.length : lineEndIndex;
  const line = text.slice(lineStart, lineEnd).trim();
  const normalizedLine = line
    .replace(/^[-*]\s*/, "")
    .replace(/^#+\s*/, "")
    .trim();
  const normalizedMatch = matchText.trim().replace(/\s+/g, " ");
  const standaloneClosingExample = new RegExp(
    `^(?:example:\\s*)?${escapeRegExp(normalizedMatch)}\\.?$`,
    "i"
  ).test(normalizedLine);

  return standaloneClosingExample && /#123\b/.test(normalizedMatch);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
