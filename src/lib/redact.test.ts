import { describe, expect, it } from "vitest";
import { extractClaims, extractRequirements } from "./extractors";
import { redactSecrets } from "./redact";

describe("redaction", () => {
  it("redacts common token-like secrets", () => {
    expect(redactSecrets("token=github_pat_abcdefghijklmnopqrstuvwxyz123456")).toContain("[redacted]");
    expect(redactSecrets("api_key=sk-abcdefghijklmnopqrstuvwxyz123456")).toContain("[redacted]");
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
