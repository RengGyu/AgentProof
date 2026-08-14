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

interface PatchFile {
  path: string;
  patch?: string;
}

/**
 * Returns true only when a static relative import/require in the changed test
 * resolves directly to the candidate implementation path. The caller remains
 * responsible for rejecting edges that match more than one changed
 * implementation file.
 */
export function testImportMatchesImplementation(
  testFile: PatchFile,
  implementationFile: PatchFile
): boolean {
  return importedModuleSpecifiers(testFile.patch ?? "").some((specifier) =>
    relativeImportCandidates(testFile.path, specifier).includes(normalizeRepositoryPath(implementationFile.path))
  );
}

export function distinctDirectAssertionCallCount(
  testFile: PatchFile,
  implementationFile: PatchFile
): number {
  const bindings = importedBindingsForImplementation(testFile, implementationFile);
  if (bindings.length !== 1) return 0;

  const bindingPattern = new RegExp(`\\b${escapeRegExp(bindings[0])}\\s*\\(([^()]*)\\)`, "g");
  const signatures = new Set<string>();
  for (const line of livePatchLines(testFile.patch ?? "")) {
    const assertionRanges = assertionArgumentRanges(line);
    if (assertionRanges.length === 0) continue;

    for (const match of line.matchAll(bindingPattern)) {
      const matchIndex = match.index;
      if (
        matchIndex === undefined ||
        !isCodePosition(line, matchIndex) ||
        !assertionRanges.some(([start, end]) => matchIndex >= start && matchIndex < end)
      ) continue;
      const args = match[1].trim();
      const signature = literalArgumentSignature(args);
      if (signature !== null) signatures.add(signature);
    }
  }
  return signatures.size;
}

function assertionArgumentRanges(line: string): Array<readonly [number, number]> {
  const ranges: Array<readonly [number, number]> = [];
  const assertionPattern = /\b(?:expect|assert(?:\.\w+)?)\s*\(/g;

  for (const match of line.matchAll(assertionPattern)) {
    const matchIndex = match.index;
    if (matchIndex === undefined || !isCodePosition(line, matchIndex)) continue;
    const openIndex = line.indexOf("(", matchIndex);
    const closeIndex = matchingClosingParenthesis(line, openIndex);
    if (closeIndex > openIndex) ranges.push([openIndex + 1, closeIndex]);
  }
  return ranges;
}

function matchingClosingParenthesis(line: string, openIndex: number): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (let index = openIndex; index < line.length; index += 1) {
    const character = line[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === "/" && line[index + 1] === "/") return -1;
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function isCodePosition(line: string, targetIndex: number): boolean {
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;
  let blockComment = false;

  for (let index = 0; index < targetIndex; index += 1) {
    const character = line[index];
    const next = line[index + 1];
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === "/" && next === "/") return false;
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") quote = character;
  }
  return quote === null && !blockComment;
}

function importedModuleSpecifiers(patch: string): string[] {
  const specifiers: string[] = [];

  for (const sourceLine of livePatchLines(patch)) {
    const line = sourceLine.trim();
    if (!line) continue;

    const importMatch = line.match(/^import\s+(?:(?:type\s+)?[\s\S]*?\s+from\s+)?["']([^"']+)["']/);
    const requireMatch = line.match(/^(?:const|let|var)\s+[\s\S]*?=\s*require\s*\(\s*["']([^"']+)["']\s*\)/);
    const specifier = importMatch?.[1] ?? requireMatch?.[1];
    if (specifier?.startsWith("./") || specifier?.startsWith("../")) specifiers.push(specifier);
  }

  return specifiers;
}

function importedBindingsForImplementation(testFile: PatchFile, implementationFile: PatchFile): string[] {
  const bindings: string[] = [];
  const targetPath = normalizeRepositoryPath(implementationFile.path);

  for (const sourceLine of livePatchLines(testFile.patch ?? "")) {
    const line = sourceLine.trim();
    if (!line) continue;

    const specifier = importedModuleSpecifiers(line)[0];
    if (!specifier || !relativeImportCandidates(testFile.path, specifier).includes(targetPath)) continue;

    const namedImport = line.match(/^import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["']/);
    if (namedImport) {
      for (const entry of namedImport[1].split(",")) {
        const match = entry.trim().match(/^(?:type\s+)?[A-Za-z_$][\w$]*(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
        const localName = match?.[1] ?? entry.trim().replace(/^type\s+/, "").split(/\s+/)[0];
        if (match && localName) bindings.push(localName);
      }
      continue;
    }

    const defaultImport = line.match(/^import\s+([A-Za-z_$][\w$]*)\s*(?:,|from\s+["'])/);
    if (defaultImport) {
      bindings.push(defaultImport[1]);
      continue;
    }

    const destructuredRequire = line.match(/^(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\s*\(/);
    if (destructuredRequire) {
      for (const entry of destructuredRequire[1].split(",")) {
        const match = entry.trim().match(/^[A-Za-z_$][\w$]*(?:\s*:\s*([A-Za-z_$][\w$]*))?$/);
        const localName = match?.[1] ?? entry.trim().split(/\s*:\s*/)[0];
        if (match && localName) bindings.push(localName);
      }
      continue;
    }

    const directRequire = line.match(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*require\s*\(/);
    if (directRequire) bindings.push(directRequire[1]);
  }

  return [...new Set(bindings)];
}

function livePatchLines(patch: string): string[] {
  const lines: string[] = [];
  const rawLines = patch.replace(/\r\n/g, "\n").split("\n");
  let hunkStateKnown = !rawLines.some((line) => line.startsWith("@@"));
  let blockComment = false;
  let quote: "'" | '"' | "`" | null = null;
  let escaped = false;

  for (const rawLine of rawLines) {
    if (rawLine.startsWith("@@")) {
      const hunkHeader = rawLine.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@(?:\s.*)?$/);
      hunkStateKnown = hunkHeader?.[1] === "1";
      blockComment = false;
      quote = null;
      escaped = false;
      continue;
    }
    if (!hunkStateKnown) continue;
    if (rawLine.startsWith("-")) continue;
    const line = rawLine.replace(/^\+/, "");
    let code = "";
    let suppressContinuedQuoteContent = quote !== null;

    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      const next = line[index + 1];
      if (blockComment) {
        if (character === "*" && next === "/") {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (!suppressContinuedQuoteContent) code += character;
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === quote) {
          quote = null;
          suppressContinuedQuoteContent = false;
        }
        continue;
      }
      if (character === "/" && next === "/") break;
      if (character === "/" && next === "*") {
        blockComment = true;
        index += 1;
        continue;
      }
      code += character;
      if (character === "'" || character === '"' || character === "`") quote = character;
    }

    if (code.trim()) lines.push(code);
  }

  return lines;
}

function literalArgumentSignature(args: string): string | null {
  if (!args) return "()";
  const values = args.split(",").map((value) => value.trim());
  if (values.some((value) => !/^(?:true|false|null|undefined|-?(?:\d+(?:\.\d+)?|\.\d+)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`$]*`)$/u.test(value))) {
    return null;
  }
  return values.join(",");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function relativeImportCandidates(testPath: string, specifier: string): string[] {
  const directory = normalizeRepositoryPath(testPath).split("/").slice(0, -1);
  const resolved = normalizeRepositoryPath([...directory, ...specifier.replace(/\\/g, "/").split("/")].join("/"));
  const lastSegment = resolved.split("/").at(-1) ?? "";
  if (/\.[a-z0-9]+$/i.test(lastSegment)) return [resolved];

  const extensions = [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"];
  return [
    resolved,
    ...extensions.map((extension) => `${resolved}${extension}`),
    ...extensions.map((extension) => `${resolved}/index${extension}`)
  ];
}

function normalizeRepositoryPath(path: string): string {
  const result: string[] = [];
  for (const segment of path.replace(/\\/g, "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (result.length > 0 && result.at(-1) !== "..") result.pop();
      else result.push(segment);
    }
    else result.push(segment);
  }
  return result.join("/");
}

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
