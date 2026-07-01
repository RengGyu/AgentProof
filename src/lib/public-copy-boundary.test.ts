import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicCopyFiles = [
  ["public launch trust doc", "../../docs/public-launch-trust.md"],
  ["GitHub App onboarding doc", "../../docs/github-app-onboarding.md"],
  ["tenant data retention doc", "../../docs/tenant-data-retention.md"],
  ["saved report storage doc", "../../docs/saved-report-storage.md"],
  ["app metadata", "../app/layout.tsx"],
  ["home page", "../app/page.tsx"],
  ["workspace surface", "../components/AnalyzeWorkspace.tsx"],
  ["integrations page", "../app/integrations/page.tsx"],
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
});
