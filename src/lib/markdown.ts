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

export function reportToGitHubComment(report: VerificationReport): string {
  const requirementLines = report.requirements.slice(0, 8).map((requirement) => {
    const evidence = requirement.evidenceRefs.length > 0 ? ` Evidence: ${requirement.evidenceRefs.join(", ")}` : "";
    const gaps = requirement.gaps.length > 0 ? ` Gap: ${requirement.gaps.join("; ")}` : "";

    return `- **${requirement.status.toUpperCase()}** ${requirement.requirementText}${evidence}${gaps}`;
  });
  const riskLines = report.summary.topRisks.slice(0, 5).map((risk) => `- ${risk}`);
  const priorityLines = report.reviewPriority.slice(0, 5).map(
    (item) => `- **${item.priority.toUpperCase()}** \`${item.path}\`: ${item.reason}`
  );
  const missingTestLines = report.testing.missingTests.slice(0, 5).map(
    (item) => `- \`${item.path}\`: ${item.why}`
  );

  return [
    "## AgentProof Evidence Check",
    "",
    `**Priority:** ${report.summary.priority.toUpperCase()} | **Evidence:** ${report.summary.evidenceCoverage}% | **CI:** ${report.testing.ciStatus}`,
    "",
    report.summary.oneLine,
    "",
    "### Requirement Coverage",
    "",
    ...(requirementLines.length > 0 ? requirementLines : ["- No requirements were extracted."]),
    "",
    "### Top Risks",
    "",
    ...(riskLines.length > 0 ? riskLines : ["- No major risks detected from available evidence."]),
    "",
    "### Review Priority",
    "",
    ...(priorityLines.length > 0 ? priorityLines : ["- No priority files detected."]),
    "",
    "### Testing",
    "",
    `- Lint: ${report.testing.lintStatus}`,
    `- Typecheck: ${report.testing.typecheckStatus}`,
    ...(missingTestLines.length > 0 ? missingTestLines : ["- No missing test evidence detected."]),
    "",
    "<details>",
    "<summary>Agent re-prompt</summary>",
    "",
    "```text",
    report.reprompt.prompt,
    "```",
    "",
    "</details>"
  ].join("\n");
}
