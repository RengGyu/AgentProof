import { getExecutionEvidenceItems, statusFromEvidenceSummary } from "./execution-evidence";
import { redactSecrets } from "./redact";
import type { VerificationReport } from "./types";

export const AGENTPROOF_COMMENT_MARKER = "<!-- agentproof:evidence-check:v1 -->";
const MAX_GITHUB_COMMENT_LENGTH = 12_000;

export function reportToMarkdown(report: VerificationReport): string {
  const evidenceById = new Map(report.evidenceIndex.map((item) => [item.id, item]));
  const executionEvidence = getExecutionEvidenceItems(report.evidenceIndex);
  const strictContract = strictContractPresentation(report);
  const lines = [
    `# AgentProof Evidence Report`,
    "",
    `**PR:** ${safeInlineText(report.source.title)}`,
    report.source.url ? `**URL:** ${safeInlineText(report.source.url)}` : undefined,
    `**Priority:** ${report.summary.priority.toUpperCase()}`,
    `**Evidence coverage:** ${report.summary.evidenceCoverage}%`,
    `**Confidence:** ${Math.round(report.summary.confidence * 100)}%`,
    report.planner ? `**Policy:** Enhanced planning policy` : undefined,
    strictContract ? `**Policy:** Strict verification contract` : undefined,
    strictContract ? `**Outcome policy:** ${strictContract.outcomePolicy}` : undefined,
    ...(strictContract?.guidance.map((message) => `**Contract guidance:** ${safeInlineText(message)}`) ?? []),
    strictContract ? "**Observed evidence:** implementation, targeted tests, and execution are listed below." : undefined,
    "",
    `## Summary`,
    "",
    safeInlineText(report.summary.oneLine),
    "",
    `## Requirement Coverage`,
    "",
    ...report.requirements.flatMap((requirement) => [
      `- **${strictContract ? "OUTCOME: " : ""}${requirement.status.toUpperCase()}** ${safeInlineText(requirement.requirementText)}`,
      strictContract ? `  - Observed evidence status: ${safeInlineText(requirement.evidenceStatus ?? requirement.status).toUpperCase()}` : undefined,
      requirement.reviewerNote ? `  - Evidence note: ${safeInlineText(requirement.reviewerNote)}` : undefined,
      requirement.gaps.length > 0 ? `  - Gaps: ${requirement.gaps.map(safeInlineText).join("; ")}` : undefined,
      ...evidenceLines(requirement.evidenceRefs, evidenceById, "  ")
    ]),
    "",
    `## Requirement Proof Graph`,
    "",
    `- Requirements with implementation evidence: ${report.proofGraph.summary.requirementsWithImplementation}/${report.proofGraph.summary.requirementCount}`,
    `- Requirements with targeted test evidence: ${report.proofGraph.summary.requirementsWithTargetedTests}/${report.proofGraph.summary.requirementCount}`,
    `- Requirements with execution evidence: ${report.proofGraph.summary.requirementsWithExecution}/${report.proofGraph.summary.requirementCount}`,
    `- Requirement proof gaps: ${report.proofGraph.summary.gapCount}`,
    "",
    ...report.proofGraph.nodes.flatMap((node) => [
      `- **${node.status.toUpperCase()}** ${safeInlineText(node.requirementText)}`,
      node.firstFiles.length > 0 ? `  - First files: ${node.firstFiles.map(safeInlineCode).join(", ")}` : undefined,
      `  - Evidence classes: implementation ${node.implementationEvidenceRefs.length}; targeted tests ${node.targetedTestEvidenceRefs.length}; execution ${node.executionEvidenceRefs.length}`,
      node.gapSignals.length > 0
        ? `  - Gap signals: ${node.gapSignals.map((gap) => `${gap.severity}/${gap.kind}: ${safeInlineText(gap.message)}`).join("; ")}`
        : undefined,
      ...evidenceLines(uniqueRefs([
        ...node.implementationEvidenceRefs,
        ...node.targetedTestEvidenceRefs,
        ...node.executionEvidenceRefs,
        ...node.gapSignals.flatMap((gap) => gap.evidenceRefs)
      ]), evidenceById, "  ")
    ]),
    "",
    `## Top Risks`,
    "",
    ...report.summary.topRisks.map((risk) => `- ${safeInlineText(risk)}`),
    "",
    `## Scope`,
    "",
    report.scope.suspected
      ? [
          ...report.scope.reasons.map((reason) => `- ${safeInlineText(reason)}`),
          ...provenanceLines(report.scope.provenance),
          ...evidenceLines(report.scope.evidenceRefs ?? [], evidenceById)
        ].join("\n")
      : "- No out-of-scope file cluster found from available evidence.",
    "",
    `## Testing`,
    "",
    `- Test/build: ${report.testing.ciStatus}`,
    `- Lint: ${report.testing.lintStatus}`,
    `- Typecheck: ${report.testing.typecheckStatus}`,
    ...report.testing.missingTests.flatMap((item) => [
      `- Missing test evidence for ${safeInlineCode(item.path)}: ${safeInlineText(item.why)}`,
      ...provenanceLines(item.provenance, "  "),
      ...evidenceLines(item.evidenceRefs, evidenceById, "  ")
    ]),
    "",
    `## Execution Evidence`,
    "",
    ...(executionEvidence.length > 0
      ? executionEvidence.map((item) => formatExecutionEvidenceLine(item, { locationLimit: 6 }))
      : ["- No test/build check or log evidence was available."]),
    "",
    `## Verification Priority`,
    "",
    ...report.reviewPriority.flatMap((item) => [
      `- **${item.priority.toUpperCase()}** ${safeInlineCode(item.path)}: ${safeInlineText(item.reason)}`,
      ...evidenceLines(item.evidenceRefs ?? [], evidenceById, "  ")
    ]),
    "",
    `## Re-prompt`,
    "",
    "```text",
    safeFencedText(report.reprompt.prompt),
    "```",
    "",
    `## Evidence Index`,
    "",
    ...report.evidenceIndex.map(
      (item) =>
        `- ${safeInlineCode(item.id)} source=${item.kind}; locator=${safeInlineText(item.locator ?? item.label)}; confidence=${Math.round(item.confidence * 100)}%; text=${safeInlineText(item.summary)}`
    ),
    "",
    `## Limitations`,
    "",
    ...(report.limitations.length > 0 ? report.limitations.map((item) => `- ${safeInlineText(item)}`) : ["- No major data limitations detected."])
  ];

  return lines.filter((line): line is string => typeof line === "string").join("\n");
}

export function reportToGitHubComment(
  report: VerificationReport,
  options: { includeReprompt?: boolean; includeMarker?: boolean } = {}
): string {
  const evidenceById = new Map(report.evidenceIndex.map((item) => [item.id, item]));
  const executionEvidence = getExecutionEvidenceItems(report.evidenceIndex, 5);
  const strictContract = strictContractPresentation(report);
  const requirementLines = report.requirements.slice(0, 8).map((requirement) => {
    const evidence = requirement.evidenceRefs.length > 0
      ? ` Evidence: ${formatEvidenceRefs(requirement.evidenceRefs, evidenceById)}`
      : "";
    const gaps = requirement.gaps.length > 0 ? ` Gap: ${requirement.gaps.map(safeInlineText).join("; ")}` : "";

    return `- **${requirement.status.toUpperCase()}** ${safeInlineText(requirement.requirementText)}${evidence}${gaps}`;
  });
  const riskLines = report.summary.topRisks.slice(0, 1).map((risk) => `- ${safeInlineText(risk)}`);
  const proofGapLines = report.proofGraph.nodes
    .flatMap((node) => node.gapSignals.map((gap) => ({ node, gap })))
    .filter(({ gap }) => gap.severity === "blocker" || gap.severity === "high" || gap.kind === "missing_execution")
    .slice(0, 5)
    .map(({ node, gap }) => {
      const files = node.firstFiles.length > 0 ? ` First files: ${node.firstFiles.map(safeInlineCode).join(", ")}.` : "";
      return `- **${gap.severity.toUpperCase()}** ${safeInlineText(node.requirementText)}: ${safeInlineText(gap.message)}${files}`;
    });
  const priorityLines = report.reviewPriority.slice(0, 5).map(
    (item) =>
      `- **${item.priority.toUpperCase()}** ${safeInlineCode(item.path)}: ${safeInlineText(item.reason)}${formatOptionalEvidence(item.evidenceRefs, evidenceById)}`
  );
  const missingTestLines = report.testing.missingTests.slice(0, 5).map(
    (item) => `- ${safeInlineCode(item.path)}: ${safeInlineText(item.why)}${formatOptionalProvenance(item.provenance)}${formatOptionalEvidence(item.evidenceRefs, evidenceById)}`
  );
  const limitationLines = report.limitations.slice(0, 4).map((limitation) => `- ${safeInlineText(limitation)}`);
  const scopeLines = report.scope.suspected
    ? [
        ...report.scope.reasons.slice(0, 3).map((reason) => `- ${safeInlineText(reason)}`),
        ...provenanceLines(report.scope.provenance, "", { concise: true, limit: 3 }),
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
    report.planner ? "**Policy:** Enhanced planning policy" : undefined,
    strictContract ? "**Policy:** Strict verification contract" : undefined,
    strictContract ? `**Outcome policy:** ${strictContract.outcomePolicy}` : undefined,
    ...(strictContract?.guidance.map((message) => `**Contract guidance:** ${safeInlineText(message)}`) ?? []),
    strictContract ? "**Observed evidence:** implementation, targeted tests, and execution are listed below." : undefined,
    "",
    safeInlineText(report.summary.oneLine),
    "",
    "### Requirement Coverage",
    "",
    ...(requirementLines.length > 0 ? requirementLines : ["- No requirements were extracted."]),
    "",
    "### Top Risks",
    "",
    ...(riskLines.length > 0 ? riskLines : ["- No major risks detected from available evidence."]),
    "",
    "### Requirement Proof Gaps",
    "",
    ...(proofGapLines.length > 0 ? proofGapLines : ["- No high-priority requirement proof gaps found from available evidence."]),
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
      ? executionEvidence.map((item) => formatExecutionEvidenceLine(item, { locationLimit: 2, compactLocations: true }))
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
          safeFencedText(report.reprompt.prompt),
          "```",
          "",
          "</details>"
        ]
      : [])
  ].filter((line): line is string => typeof line === "string");

  return truncateComment(neutralizeGitHubMentions(lines.join("\n")));
}

function strictContractPresentation(report: VerificationReport): { outcomePolicy: string; guidance: string[] } | undefined {
  const candidate = report as VerificationReport & {
    reportSchemaVersion?: string;
    verificationContract?: { state?: unknown; gaps?: unknown };
  };
  if (candidate.reportSchemaVersion !== "verification-report.v2" || !candidate.verificationContract) return undefined;
  const guidance = Array.isArray(candidate.verificationContract.gaps)
    ? candidate.verificationContract.gaps.flatMap((gap) => {
      if (!gap || typeof gap !== "object" || typeof (gap as { message?: unknown }).message !== "string") return [];
      return [(gap as { message: string }).message];
    })
    : [];
  if (candidate.verificationContract.state === "absent") {
    return { outcomePolicy: "No approved verification contract; observed evidence does not establish the requirement outcome.", guidance };
  }
  if (candidate.verificationContract.state === "invalid") {
    return { outcomePolicy: "The supplied verification contract was invalid; observed evidence does not establish the requirement outcome.", guidance };
  }
  if (candidate.verificationContract.state === "author_claim") {
    return { outcomePolicy: "PR-description contract; reviewer confirmation is required for the requirement outcome.", guidance };
  }
  return { outcomePolicy: "Requirement outcomes are evaluated against an approved verification contract.", guidance };
}

function formatExecutionEvidenceLine(
  item: ReturnType<typeof getExecutionEvidenceItems>[number],
  options: { locationLimit?: number; compactLocations?: boolean } = {}
): string {
  const locator = item.locator ?? item.label;
  const confidence = `${Math.round(item.confidence * 100)}%`;
  const baseLine = `- **${item.status.toUpperCase()}** ${safeInlineCode(item.id)} ${item.kind} ${safeInlineCode(locator)} (${confidence}): ${safeInlineText(item.displaySummary)}`;
  const locations = formatFailureLocations(item.failureLocations, options.locationLimit ?? 5, options.compactLocations);

  return locations ? `${baseLine}\n  - Failure locations: ${locations}` : baseLine;
}

function evidenceLines(
  refs: string[] | undefined,
  evidenceById: Map<string, VerificationReport["evidenceIndex"][number]>,
  indent = ""
): string[] {
  if (!refs || refs.length === 0) return [];

  return refs.map((ref) => `${indent}- Evidence: ${formatEvidenceRef(ref, evidenceById)}`);
}

function provenanceLines(
  provenance: VerificationReport["testing"]["missingTests"][number]["provenance"] | VerificationReport["scope"]["provenance"],
  indent = "",
  options: { concise?: boolean; limit?: number } = {}
): string[] {
  if (!provenance || provenance.length === 0) return [];

  return provenance.slice(0, options.limit ?? 5).map((item) => {
    const locator = item.locator ?? "unknown locator";
    const confidence = `${Math.round(item.confidence * 100)}%`;

    if (options.concise) {
      return `${indent}- Provenance: ${item.sourceType} ${safeInlineCode(locator)} ${confidence}`;
    }

    return `${indent}- Provenance: ${safeInlineText(item.evidenceRef)} source=${item.sourceType}; locator=${safeInlineText(locator)}; confidence=${confidence}; text=${safeInlineText(item.evidenceText)}`;
  });
}

function formatOptionalProvenance(
  provenance: VerificationReport["testing"]["missingTests"][number]["provenance"]
): string {
  if (!provenance || provenance.length === 0) return "";

  const shown = provenance.slice(0, 2).map((item) => {
    const locator = item.locator ?? "unknown locator";
    return `${item.sourceType} ${safeInlineText(locator)} ${Math.round(item.confidence * 100)}%`;
  });

  return ` Provenance: ${shown.join("; ")}`;
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

function uniqueRefs(refs: string[]): string[] {
  return Array.from(new Set(refs));
}

function formatEvidenceRef(
  ref: string,
  evidenceById: Map<string, VerificationReport["evidenceIndex"][number]>,
  options: { concise?: boolean } = {}
): string {
  const evidence = evidenceById.get(ref);

  if (!evidence) {
    return `${safeInlineText(ref)} (missing evidence item)`;
  }

  const locator = evidence.locator ?? evidence.label;
  const confidence = `${Math.round(evidence.confidence * 100)}%`;
  const executionStatus = evidence.kind === "check" || evidence.kind === "log"
    ? ` ${statusFromEvidenceSummary(evidence.summary)}`
    : "";

  if (options.concise) {
    return `${safeInlineText(ref)} ${evidence.kind}${executionStatus} ${safeInlineText(locator)} ${confidence}`;
  }

  return `${safeInlineText(ref)} source=${evidence.kind}; locator=${safeInlineText(locator)}; confidence=${confidence}; text=${safeInlineText(evidence.summary)}`;
}

function formatFailureLocations(
  locations: ReturnType<typeof getExecutionEvidenceItems>[number]["failureLocations"],
  limit: number,
  compact = false
): string {
  if (locations.length === 0) {
    return "";
  }

  const shown = locations.slice(0, limit).map((location) => {
    const locator = location.line ? `${location.path}:${location.line}` : location.path;
    return compact ? safeInlineCode(locator) : safeInlineCode(`${location.level} at ${locator}`);
  });
  const hiddenCount = Math.max(0, locations.length - shown.length);

  return hiddenCount > 0 ? `${shown.join(", ")}, +${hiddenCount} more` : shown.join(", ");
}

export function neutralizeGitHubMentions(value: string): string {
  return value.replace(/@(?=[a-z0-9][a-z0-9-]{0,38}\b)/gi, "@\u200B");
}

function safeInlineText(value: string): string {
  return safeMarkdownBlock(value).replace(/\s*\n+\s*/g, " / ");
}

function safeInlineCode(value: string): string {
  return `\`${safeInlineText(value).replace(/`/g, "'")}\``;
}

function safeFencedText(value: string): string {
  return safeMarkdownBlock(value);
}

function safeMarkdownBlock(value: string): string {
  return neutralizeGitHubMentions(redactSecrets(value))
    .replace(/\r\n/g, "\n")
    .replace(/```/g, "`\u200B``")
    .replace(/<!--/g, "&lt;!--")
    .replace(/-->/g, "--&gt;")
    .replace(/<\/?details[^>]*>/gi, escapeHtmlTag)
    .replace(/<\/?script[^>]*>/gi, escapeHtmlTag)
    .replace(/\]\s*\(/g, "]\u200B(");
}

function escapeHtmlTag(value: string): string {
  return value.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncateComment(value: string): string {
  if (value.length <= MAX_GITHUB_COMMENT_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_GITHUB_COMMENT_LENGTH - 80)}\n\n_Comment truncated by AgentProof for safety._`;
}
