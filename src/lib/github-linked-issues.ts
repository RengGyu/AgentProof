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
  const allReferences: SupportedIssueReference[] = [];

  for (const match of text.matchAll(SUPPORTED_CLOSING_KEYWORD_REF)) {
    const qualified = match.groups?.qualified;
    const number = Number(match.groups?.qualifiedNumber ?? match.groups?.localNumber);
    const parsed = qualified ? parseQualifiedRepository(qualified) : repository;

    if (parsed && Number.isInteger(number) && number > 0) {
      allReferences.push({ ...parsed, number });
    }
  }

  for (const match of text.matchAll(SUPPORTED_QUALIFIED_REF)) {
    const parsed = parseQualifiedRepository(match.groups?.qualified ?? "");
    const number = Number(match.groups?.number);

    if (parsed && Number.isInteger(number) && number > 0) {
      allReferences.push({ ...parsed, number });
    }
  }

  const unique = uniqueIssueReferences(allReferences);

  return {
    references: unique.slice(0, maxReferences),
    totalSupportedReferences: unique.length,
    capped: unique.length > maxReferences
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

function uniqueIssueReferences(references: SupportedIssueReference[]): SupportedIssueReference[] {
  const seen = new Set<string>();
  const unique: SupportedIssueReference[] = [];

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
