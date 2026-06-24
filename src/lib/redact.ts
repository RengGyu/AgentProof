const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9_]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9_-]{20,}/g,
  /(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[^"'\s]+/gi
];

export function redactSecrets(input: string): string {
  return SECRET_PATTERNS.reduce(
    (text, pattern) => text.replace(pattern, "[redacted]"),
    input
  );
}

export function compactText(input: string, maxLength = 1400): string {
  const clean = redactSecrets(input.trim().replace(/\r\n/g, "\n"));

  if (clean.length <= maxLength) {
    return clean;
  }

  return `${clean.slice(0, maxLength - 80).trim()}\n...[truncated for privacy and token control]`;
}
