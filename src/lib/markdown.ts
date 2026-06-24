import type { VerificationReport } from "./types";

export function reportToMarkdown(report: VerificationReport): string {
  const lines = [
    `# AgentProof Evidence Report`,
    "",
    `**PR:** ${report.source.title}`,
    report.source.url ? `**URL:** ${report.source.url}` : undefined,
    `**Priority:** ${report.summary.priority.toUpperCase()}`,
    `**Evidence coverage:** ${report.summary.evidenceCoverage}%`,
    `**Confidence:** ${Math.round(report.summary.confidence * 100)}%`,
    "",
    `## Summary`,
    "",
    report.summary.oneLine,
    "",
    `## Requirement Coverage`,
    "",
    ...report.requirements.flatMap((requirement) => [
      `- **${requirement.status.toUpperCase()}** ${requirement.requirementText}`,
      requirement.reviewerNote ? `  - Reviewer note: ${requirement.reviewerNote}` : undefined,
      requirement.gaps.length > 0 ? `  - Gaps: ${requirement.gaps.join("; ")}` : undefined,
      requirement.evidenceRefs.length > 0 ? `  - Evidence: ${requirement.evidenceRefs.join(", ")}` : undefined
    ]),
    "",
    `## Top Risks`,
    "",
    ...report.summary.topRisks.map((risk) => `- ${risk}`),
    "",
    `## Scope`,
    "",
    report.scope.suspected
      ? report.scope.reasons.map((reason) => `- ${reason}`).join("\n")
      : "- No out-of-scope file cluster found from available evidence.",
    "",
    `## Testing`,
    "",
    `- CI: ${report.testing.ciStatus}`,
    `- Lint: ${report.testing.lintStatus}`,
    `- Typecheck: ${report.testing.typecheckStatus}`,
    ...report.testing.missingTests.map((item) => `- Missing test evidence for \`${item.path}\`: ${item.why}`),
    "",
    `## Review Priority`,
    "",
    ...report.reviewPriority.map((item) => `- **${item.priority.toUpperCase()}** \`${item.path}\`: ${item.reason}`),
    "",
    `## Re-prompt`,
    "",
    "```text",
    report.reprompt.prompt,
    "```",
    "",
    `## Evidence Index`,
    "",
    ...report.evidenceIndex.map((item) => `- \`${item.id}\` ${item.kind} / ${item.label}: ${item.summary}`),
    "",
    `## Limitations`,
    "",
    ...(report.limitations.length > 0 ? report.limitations.map((item) => `- ${item}`) : ["- No major data limitations detected."])
  ];

  return lines.filter((line): line is string => typeof line === "string").join("\n");
}
