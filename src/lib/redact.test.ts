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

  it("redacts realistic JSON, namespaced, AWS, and CI payload secrets", () => {
    const input = [
      '{"password": "super-secret-password", "token": "github_pat_abcdefghijklmnopqrstuvwxyz123456", "secret": "plain-secret-value", "api_key": "sk-abcdefghijklmnopqrstuvwxyz123456"}',
      "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "AWS_SECRET_ACCESS_KEY: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "namespace.secret=prod-secret-value",
      "ci.token: ghs_abcdefghijklmnopqrstuvwxyz123456",
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret",
      ["https://hooks.slack.com", "services", "T00000000", "B00000000", "XXXXXXXXXXXXXXXXXXXXXXXX"].join("/"),
      "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----",
      "check summary leaked token='ghp_abcdefghijklmnopqrstuvwxyz123456'"
    ].join("\n");
    const redacted = redactSecrets(input);

    for (const forbidden of [
      "super-secret-password",
      "github_pat_",
      "plain-secret-value",
      "sk-",
      "wJalrXUtnFEMI",
      "prod-secret-value",
      "ghs_",
      "eyJhbGciOi",
      "hooks.slack.com/services",
      "BEGIN OPENSSH PRIVATE KEY",
      "ghp_"
    ]) {
      expect(redacted).not.toContain(forbidden);
    }
    expect(redacted).toContain("[redacted]");
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
