const GENERIC_RELATION_TOKENS = new Set([
  "check",
  "checks",
  "ci",
  "e2e",
  "integration",
  "js",
  "jsx",
  "passed",
  "py",
  "regression",
  "spec",
  "specs",
  "src",
  "status",
  "test",
  "tests",
  "ts",
  "tsx",
  "unit",
  "workflow",
  "회귀",
  "시험",
  "테스트"
]);

export function executionEvidenceMatchesAnyTestPath(
  testPaths: readonly string[],
  label: string,
  summary: string,
  locator = ""
): boolean {
  return evidenceMatchesAnyReference(testPaths, label, summary, locator);
}

export function artifactEvidenceMatchesAnyPath(
  paths: readonly string[],
  label: string,
  summary: string,
  locator = ""
): boolean {
  return evidenceMatchesAnyReference(paths, label, summary, locator);
}

function evidenceMatchesAnyReference(
  references: readonly string[],
  label: string,
  summary: string,
  locator: string
): boolean {
  const evidenceTokens = relationTokens(`${label} ${summary} ${locator}`);
  if (evidenceTokens.size === 0) return false;

  return references.some((reference) => {
    const pathTokens = relationTokens(reference);
    const shared = [...pathTokens].filter((token) => evidenceTokens.has(token));
    return shared.length >= 2 || shared.some((token) =>
      token.length >= 8 || (/[^\x00-\x7F]/.test(token) && [...token].length >= 2)
    );
  });
}

function relationTokens(value: string): Set<string> {
  const normalized = value
    .normalize("NFKC")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase();
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(tokens
    .flatMap((token) => [token, koreanParticleStem(token)])
    .filter((token) => token.length > 0 && !GENERIC_RELATION_TOKENS.has(token)));
}

function koreanParticleStem(token: string): string {
  if (!/^[가-힣]{2,}$/.test(token)) return token;
  return token.replace(/(?:에서|에게|한테|께서|부터|까지|보다|처럼|마다|조차|마저|으로|은|는|이|가|을|를|에|의|와|과|로|도|만)$/u, "") || token;
}
