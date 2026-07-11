const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g,
  /\bAWS_SECRET_ACCESS_KEY\s*[:=]\s*["']?[A-Za-z0-9/+=]{20,}["']?/gi,
  /authorization\s*:\s*bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\bbearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi,
  /["']?[A-Za-z0-9_.-]*(?:api[_-]?key|token|secret|password)[A-Za-z0-9_.-]*["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}\]]+)/gi,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g
];

export function redactSecrets(input: string): string {
  return SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "[redacted]"),
    input
  );
}

export function containsSecretPattern(input: string): boolean {
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(input);
  });
}

export function compactText(input: string, maxLength = 1400): string {
  const clean = redactSecrets(input.trim().replace(/\r\n/g, "\n"));

  if (clean.length <= maxLength) {
    return clean;
  }

  return `${clean.slice(0, maxLength - 80).trim()}\n...[truncated for privacy and token control]`;
}
