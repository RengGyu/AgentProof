import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicCopyFiles = [
  ["public launch trust doc", "../../docs/public-launch-trust.md"],
  ["support status feedback doc", "../../docs/support-status-feedback.md"],
  ["GitHub App onboarding doc", "../../docs/github-app-onboarding.md"],
  ["tenant data retention doc", "../../docs/tenant-data-retention.md"],
  ["saved report storage doc", "../../docs/saved-report-storage.md"],
  ["app metadata", "../app/layout.tsx"],
  ["home page", "../app/page.tsx"],
  ["workspace surface", "../components/AnalyzeWorkspace.tsx"],
  ["integrations page", "../app/integrations/page.tsx"],
  ["status and support page", "../app/status/page.tsx"],
  ["tenant setup page", "../app/tenant/page.tsx"]
] as const;

function readPublicCopySources(): { label: string; source: string }[] {
  return publicCopyFiles.map(([label, path]) => ({
    label,
    source: readFileSync(new URL(path, import.meta.url), "utf8")
  }));
}

function matchingLineContexts(source: string, pattern: RegExp): string[] {
  const lines = source.split(/\r?\n/);
  const contexts: string[] = [];

  lines.forEach((line, index) => {
    if (!pattern.test(line)) return;

    contexts.push(
      lines
        .slice(Math.max(0, index - 5), Math.min(lines.length, index + 2))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
    );
  });

  return contexts;
}

describe("public launch copy boundary", () => {
  it("keeps public setup and app copy centered on evidence verification language", () => {
    const combined = readPublicCopySources()
      .map(({ source }) => source)
      .join("\n");

    for (const expected of [
      "evidence reports",
      "verification",
      "requirement coverage",
      "missing proof",
      "scope creep",
      "re-prompt",
      "grounded findings"
    ]) {
      expect(combined).toContain(expected);
    }
  });

  it("does not use broad AI review phrasing on monitored public surfaces", () => {
    for (const { label, source } of readPublicCopySources()) {
      expect(source, label).not.toMatch(/\bAI code review(?:er|ers)?\b/i);
      expect(source, label).not.toMatch(/\bgeneric AI review\b/i);
      expect(source, label).not.toMatch(/\bautomated approval\b/i);
    }
  });

  it("mentions merge authority, bug finding, or security scope only as explicit limitations", () => {
    const sensitiveTerms = /auto[- ]merge|merge approval|merge authority|bug[- ]finding|bug finder|security scanner|security certification|generic code[- ]review/i;
    const limitationContext = /\b(do not|does not|not|never|no|without|cannot|off by default|separate opt-in|limitations?)\b/i;

    for (const { label, source } of readPublicCopySources()) {
      for (const context of matchingLineContexts(source, sensitiveTerms)) {
        expect(context, `${label}: ${context}`).toMatch(limitationContext);
      }
    }
  });

  it("keeps public launch trust guidance free of unsupported market claims", () => {
    const source = readFileSync(new URL("../../docs/public-launch-trust.md", import.meta.url), "utf8");

    expect(source).toContain("Pricing language is product-owned until public launch.");
    expect(source).toContain("Do not publish market-size, willingness-to-pay, competitor, adoption, or ROI claims unless each claim has a verified public source URL.");
    expect(source).not.toMatch(/\b\d+%\b/);
    expect(source).not.toMatch(/\$\d/);
  });

  it("states the durable raw-evidence and opt-in boundaries in public launch guidance", () => {
    const source = readFileSync(new URL("../../docs/public-launch-trust.md", import.meta.url), "utf8");

    for (const expected of [
      "does not durably retain raw code evidence",
      "Raw PR evidence is processed only as needed",
      "raw diffs",
      "logs",
      "webhook payloads",
      "tokens",
      "evidence indexes",
      "claims",
      "raw re-prompt text",
      "Commenting is a separate repo-level opt-in and is off by default",
      "Slack summaries are optional"
    ]) {
      expect(source).toContain(expected);
    }
  });

  it("keeps support and status guidance summary-only and evidence-backed", () => {
    const source = readFileSync(new URL("../../docs/support-status-feedback.md", import.meta.url), "utf8");

    for (const expected of [
      "Support, Status, And Feedback Boundary",
      "summary-only report",
      "If the evidence is unavailable, say it is unavailable",
      "`setup_blocker`",
      "`report_usefulness`",
      "`false_positive_or_false_confidence`",
      "`privacy_or_retention`",
      "`billing_or_plan`",
      "`incident_or_status`",
      "Status updates must not expose tenant ids",
      "Say `unclear` when setup, report usefulness, billing, deletion, or incident evidence is incomplete"
    ]) {
      expect(source).toContain(expected);
    }

    for (const forbidden of [
      /ask customers to paste raw diffs/i,
      /full logs, full webhook payloads/i,
      /provider customer/i,
      /subscription id/i,
      /payment method/i,
      /service-role key/i,
      /environment variable name/i
    ]) {
      expect(source).toMatch(forbidden);
    }

    expect(source).not.toMatch(/\bSLA\b/);
    expect(source).not.toMatch(/\b\d+%\b/);
    expect(source).not.toMatch(/\$\d/);
  });

  it("keeps the public status support surface bounded and non-operational", () => {
    const source = readFileSync(new URL("../app/status/page.tsx", import.meta.url), "utf8");

    for (const expected of [
      "Status And Support",
      "summary-only support",
      "does not expose live tenant data",
      "raw errors",
      "provider ids",
      "table names",
      "tokens",
      "evidence reports",
      "verification",
      "requirement coverage",
      "missing proof",
      "scope creep",
      "re-prompt",
      "grounded findings",
      "setup_blocker",
      "report_usefulness",
      "privacy_or_retention",
      "incident_or_status",
      "Do Not Send Through Support",
      "Hosted status automation",
      "remain separate launch work"
    ]) {
      expect(source).toContain(expected);
    }

    expect(source).not.toMatch(/\bSLA\b/);
    expect(source).not.toMatch(/\b\d+%\b/);
    expect(source).not.toMatch(/\$\d/);
    expect(source).not.toMatch(/customer id/i);
    expect(source).not.toMatch(/subscription id/i);
  });
});
