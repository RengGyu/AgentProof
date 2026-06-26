import { describe, expect, it } from "vitest";
import { extractClaims, extractRequirements } from "./extractors";
import { redactSecrets } from "./redact";

describe("redaction", () => {
  it("redacts common token-like secrets", () => {
    const input = [
      "token=github_pat_abcdefghijklmnopqrstuvwxyz123456",
      "gho_abcdefghijklmnopqrstuvwxyz123456",
      "api_key=sk-abcdefghijklmnopqrstuvwxyz123456",
      "https://hooks.slack.com/services/T000/B000/abcdefghijklmnopqrstuvwxyz",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz.1234567890",
      "AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP",
      "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----"
    ].join("\n");
    const redacted = redactSecrets(input);

    expect(redacted).toContain("[redacted]");
    expect(redacted).not.toContain("github_pat_");
    expect(redacted).not.toContain("gho_");
    expect(redacted).not.toContain("sk-");
    expect(redacted).not.toContain("hooks.slack.com/services");
    expect(redacted).not.toContain("Bearer abc");
    expect(redacted).not.toContain("AKIA");
    expect(redacted).not.toContain("BEGIN PRIVATE KEY");
  });

  it("does not mistake risk-sensitive prose for an OpenAI-style key", () => {
    expect(redactSecrets("Risk-sensitive path changed.")).toBe("Risk-sensitive path changed.");
  });

  it("redacts secrets before requirement and claim extraction", () => {
    const requirements = extractRequirements(
      "Acceptance criteria: keep token=github_pat_abcdefghijklmnopqrstuvwxyz123456 out of reports.",
      ""
    );
    const claims = extractClaims("Added token=github_pat_abcdefghijklmnopqrstuvwxyz123456 handling.", []);

    expect(JSON.stringify(requirements)).not.toContain("github_pat_");
    expect(JSON.stringify(claims)).not.toContain("github_pat_");
  });
});
