import { getExecutionEvidenceItems } from "./execution-evidence";
import type { VerificationReport } from "./types";

export const AGENTPROOF_COMMENT_MARKER = "<!-- agentproof:evidence-check:v1 -->";
const MAX_GITHUB_COMMENT_LENGTH = 12_000;

export function reportToMarkdown(report: VerificationReport): string {
  const evidenceById = new Map(report.evidenceIndex.map((item) => [item.id, item]));
  const executionEvidence = getExecutionEvidenceItems(report.evidenceIndex);
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
      requirement.reviewerNote ? `  - Evidence note: ${requirement.reviewerNote}` : undefined,
      requirement.gaps.length > 0 ? `  - Gaps: ${requirement.gaps.join("; ")}` : undefined,
      ...evidenceLines(requirement.evidenceRefs, evidenceById, "  ")
    ]),
    "",
    `## Top Risks`,
    "",
    ...report.summary.topRisks.map((risk) => `- ${risk}`),
    "",
    `## Scope`,
    "",
    report.scope.suspected
      ? [...report.scope.reasons.map((reason) => `- ${reason}`), ...evidenceLines(report.scope.evidenceRefs ?? [], evidenceById)].join("\n")
      : "- No out-of-scope file cluster found from available evidence.",
    "",
    `## Testing`,
    "",
    `- Test/build: ${report.testing.ciStatus}`,
    `- Lint: ${report.testing.lintStatus}`,
    `- Typecheck: ${report.testing.typecheckStatus}`,
    ...report.testing.missingTests.flatMap((item) => [
      `- Missing test evidence for \`${item.path}\`: ${item.why}`,
      ...evidenceLines(item.evidenceRefs, evidenceById, "  ")
    ]),
    "",
    `## Execution Evidence`,
    "",
    ...(executionEvidence.length > 0
      ? executionEvidence.map((item) => formatExecutionEvidenceLine(item))
      : ["- No test/build check or log evidence was available."]),
    "",
    `## Verification Priority`,
    "",
    ...report.reviewPriority.flatMap((item) => [
      `- **${item.priority.toUpperCase()}** \`${item.path}\`: ${item.reason}`,
      ...evidenceLines(item.evidenceRefs ?? [], evidenceById, "  ")
    ]),
    "",
    `## Re-prompt`,
    "",
    "```text",
    report.reprompt.prompt,
    "```",
    "",
    `## Evidence Index`,
    "",
    ...report.evidenceIndex.map(
      (item) =>
        `- \`${item.id}\` source=${item.kind}; locator=${item.locator ?? item.label}; confidence=${Math.round(item.confidence * 100)}%; text=${item.summary}`
    ),
    "",
    `## Limitations`,
    "",
    ...(report.limitations.length > 0 ? report.limitations.map((item) => `- ${item}`) : ["- No major data limitations detected."])
  ];

  return lines.filter((line): line is string => typeof line === "string").join("\n");
}

export function reportToGitHubComment(
  report: VerificationReport,
  options: { includeReprompt?: boolean; includeMarker?: boolean } = {}
): string {
  const evidenceById = new Map(report.evidenceIndex.map((item) => [item.id, item]));
  const executionEvidence = getExecutionEvidenceItems(report.evidenceIndex, 5);
  const requirementLines = report.requirements.slice(0, 8).map((requirement) => {
    const evidence = requirement.evidenceRefs.length > 0
      ? ` Evidence: ${formatEvidenceRefs(requirement.evidenceRefs, evidenceById)}`
      : "";
    const gaps = requirement.gaps.length > 0 ? ` Gap: ${requirement.gaps.join("; ")}` : "";

    return `- **${requirement.status.toUpperCase()}** ${requirement.requirementText}${evidence}${gaps}`;
  });
  const riskLines = report.summary.topRisks.slice(0, 5).map((risk) => `- ${risk}`);
  const priorityLines = report.reviewPriority.slice(0, 5).map(
    (item) =>
      `- **${item.priority.toUpperCase()}** \`${item.path}\`: ${item.reason}${formatOptionalEvidence(item.evidenceRefs, evidenceById)}`
  );
  const missingTestLines = report.testing.missingTests.slice(0, 5).map(
    (item) => `- \`${item.path}\`: ${item.why}${formatOptionalEvidence(item.evidenceRefs, evidenceById)}`
  );
  const limitationLines = report.limitations.slice(0, 4).map((limitation) => `- ${limitation}`);
  const scopeLines = report.scope.suspected
    ? [
        ...report.scope.reasons.slice(0, 5).map((reason) => `- ${reason}`),
        ...(report.scope.evidenceRefs && report.scope.evidenceRefs.length > 0
          ? [`- Evidence: ${formatEvidenceRefs(report.scope.evidenceRefs, evidenceById)}`]
          : [])
      ]
    : ["- No out-of-scope file cluster found from available evidence."];

  const lines = [
    options.includeMarker === false ? undefined : AGENTPROOF_COMMENT_MARKER,
    "## AgentProof Evidence Check",
    "",
    `**Priority:** ${report.summary.priority.toUpperCase()} | **Evidence:** ${report.summary.evidenceCoverage}% | **Test/Build:** ${report.testing.ciStatus}`,
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
    "### Scope",
    "",
    ...scopeLines,
    "",
    "### Verification Priority",
    "",
    ...(priorityLines.length > 0 ? priorityLines : ["- No priority files detected."]),
    "",
    "### Testing",
    "",
    `- Lint: ${report.testing.lintStatus}`,
    `- Typecheck: ${report.testing.typecheckStatus}`,
    ...(missingTestLines.length > 0 ? missingTestLines : ["- No missing test evidence detected."]),
    "",
    "### Execution Evidence",
    "",
    ...(executionEvidence.length > 0
      ? executionEvidence.map((item) => formatExecutionEvidenceLine(item))
      : ["- No test/build check or log evidence was available."]),
    ...(limitationLines.length > 0
      ? [
          "",
          "### Evidence Limits",
          "",
          ...limitationLines
        ]
      : []),
    ...(options.includeReprompt
      ? [
          "",
          "<details>",
          "<summary>Agent re-prompt</summary>",
          "",
          "```text",
          report.reprompt.prompt,
          "```",
          "",
          "</details>"
        ]
      : [])
  ].filter((line): line is string => typeof line === "string");

  return truncateComment(neutralizeGitHubMentions(lines.join("\n")));
}

function formatExecutionEvidenceLine(item: ReturnType<typeof getExecutionEvidenceItems>[number]): string {
  const locator = item.locator ?? item.label;
  const confidence = `${Math.round(item.confidence * 100)}%`;

  return `- **${item.status.toUpperCase()}** \`${item.id}\` ${item.kind} \`${locator}\` (${confidence}): ${item.summary}`;
}

function evidenceLines(
  refs: string[] | undefined,
  evidenceById: Map<string, VerificationReport["evidenceIndex"][number]>,
  indent = ""
): string[] {
  if (!refs || refs.length === 0) return [];

  return refs.map((ref) => `${indent}- Evidence: ${formatEvidenceRef(ref, evidenceById)}`);
}

function formatOptionalEvidence(
  refs: string[] | undefined,
  evidenceById: Map<string, VerificationReport["evidenceIndex"][number]>
): string {
  return refs && refs.length > 0 ? ` Evidence: ${formatEvidenceRefs(refs, evidenceById)}` : "";
}

function formatEvidenceRefs(
  refs: string[],
  evidenceById: Map<string, VerificationReport["evidenceIndex"][number]>
): string {
  return refs.map((ref) => formatEvidenceRef(ref, evidenceById, { concise: true })).join("; ");
}

function formatEvidenceRef(
  ref: string,
  evidenceById: Map<string, VerificationReport["evidenceIndex"][number]>,
  options: { concise?: boolean } = {}
): string {
  const evidence = evidenceById.get(ref);

  if (!evidence) {
    return `${ref} (missing evidence item)`;
  }

  const locator = evidence.locator ?? evidence.label;
  const confidence = `${Math.round(evidence.confidence * 100)}%`;

  if (options.concise) {
    return `${ref} ${evidence.kind} ${locator} ${confidence}`;
  }

  return `${ref} source=${evidence.kind}; locator=${locator}; confidence=${confidence}; text=${evidence.summary}`;
}

export function neutralizeGitHubMentions(value: string): string {
  return value.replace(/@(?=[a-z0-9][a-z0-9-]{0,38}\b)/gi, "@\u200B");
}

function truncateComment(value: string): string {
  if (value.length <= MAX_GITHUB_COMMENT_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_GITHUB_COMMENT_LENGTH - 80)}\n\n_Comment truncated by AgentProof for safety._`;
}
