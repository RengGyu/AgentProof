import { sanitizeReportForShare } from "./report-share";
import { validateVerificationReport } from "./report-validation";
import { demoScenarios } from "./sample-data";
import { generateVerificationReport } from "./verifier";
import type { CheckStatus, EvidenceItem, PriorityLevel, PullRequestInput, RequirementStatus, VerificationReport } from "./types";

export type ReviewerSignalSentinelStatus = "pass" | "fail";

export interface ReviewerSignalSentinelCheck {
  id: string;
  label: string;
  status: ReviewerSignalSentinelStatus;
  detail: string;
}

export interface ReviewerSignalSentinelCaseResult {
  caseId: string;
  label: string;
  checks: ReviewerSignalSentinelCheck[];
}

export interface ReviewerSignalSentinelSummary {
  ok: boolean;
  caseCount: number;
  checkCount: number;
  passedCount: number;
  failedCount: number;
  results: ReviewerSignalSentinelCaseResult[];
}

type CheckInput = VerificationReport;
type SentinelCheckBuilder = (report: CheckInput) => ReviewerSignalSentinelCheck;

interface SentinelCase {
  id: string;
  label: string;
  input: PullRequestInput;
  checks: SentinelCheckBuilder[];
}

const EXPECTED_SCOPE_PATHS = [
  "src/server/auth/sessionExpiry.ts",
  "src/server/auth/permissions.ts"
];

const EXPECTED_MISSING_TEST_PATHS = [
  "src/billing/InvoiceExportButton.tsx",
  "src/billing/exportInvoiceCsv.ts"
];

const VISUAL_WITHOUT_SCREENSHOT_INPUT: PullRequestInput = {
  title: "Improve project cards on mobile",
  taskText:
    "Improve project cards for mobile. Acceptance criteria: make project cards readable on mobile viewport; prevent text overlap in compact cards.",
  description:
    "Updated project card layout, spacing, and wrapping for small screens. Unit tests and build passed, but no browser QA artifact was attached.",
  changedFiles: [
    {
      path: "src/dashboard/ProjectCards.tsx",
      additions: 24,
      deletions: 8,
      status: "modified",
      patch:
        "+ <article className=\"project-card mobile-readable compact-wrap\">\n+ <h3 className=\"truncate-none text-wrap\">{project.name}</h3>"
    }
  ],
  checks: [
    { name: "unit tests", status: "passed", summary: "Project card unit tests passed" },
    { name: "build", status: "passed", summary: "Next.js build passed" }
  ],
  logs: []
};

const SUMMARY_ONLY_CANARY = {
  patch: "AP_RAW_PATCH_CANARY",
  check: "AP_RAW_CHECK_CANARY",
  log: "AP_RAW_LOG_CANARY"
} as const;

const SUMMARY_ONLY_CANARY_INPUT: PullRequestInput = {
  title: "Add payment export retry",
  taskText:
    "Add payment export retry. Acceptance criteria: retry transient export failures once; show an inline retry error; add tests for retry success and retry failure.",
  description:
    "Added retry handling for payment exports and tests for success and failure paths.",
  changedFiles: [
    {
      path: "src/payments/exportPayments.ts",
      additions: 18,
      deletions: 4,
      status: "modified",
      patch:
        `+ const retryMarker = "${SUMMARY_ONLY_CANARY.patch}"\n+ if (isTransientExportError(error)) return retryExportOnce(request)`
    },
    {
      path: "src/payments/exportPayments.test.ts",
      additions: 26,
      deletions: 0,
      status: "added",
      patch:
        "+ it('retries transient export failures once', async () => {})\n+ it('shows a retry failure error', async () => {})"
    }
  ],
  checks: [
    {
      name: "unit tests",
      status: "passed",
      summary: `Payment export tests passed ${SUMMARY_ONLY_CANARY.check}`
    }
  ],
  logs: [
    {
      source: "unit tests",
      status: "passed",
      text: `Payment export retry tests passed ${SUMMARY_ONLY_CANARY.log}`
    }
  ]
};

export function evaluateReviewerSignalSentinels(): ReviewerSignalSentinelSummary {
  const cases = buildSentinelCases();
  const results = cases.map((sentinelCase) => {
    const report = generateVerificationReport(sentinelCase.input);

    return {
      caseId: sentinelCase.id,
      label: sentinelCase.label,
      checks: sentinelCase.checks.map((check) => check(report))
    };
  });
  const checks = results.flatMap((result) => result.checks);
  const passedCount = checks.filter((check) => check.status === "pass").length;
  const failedCount = checks.length - passedCount;

  return {
    ok: failedCount === 0,
    caseCount: results.length,
    checkCount: checks.length,
    passedCount,
    failedCount,
    results
  };
}

function buildSentinelCases(): SentinelCase[] {
  return [
    {
      id: "clean",
      label: "Clean PR keeps reviewer handoff calm",
      input: demoScenarios.clean,
      checks: [
        fullReportIsValid(),
        hasCiStatus("passed"),
        hasPriorityIn(["low", "medium"]),
        hasNoScopeCreep(),
        hasNoMissingTests(),
        reportTextExcludesDecisionWording()
      ]
    },
    {
      id: "scope-creep",
      label: "Scope creep surfaces risky out-of-scope paths",
      input: demoScenarios["scope-creep"],
      checks: [
        fullReportIsValid(),
        includesScopePaths(EXPECTED_SCOPE_PATHS),
        reviewPriorityIncludesPaths(EXPECTED_SCOPE_PATHS),
        topRiskIncludes(/scope/i, "scope risk"),
        repromptIncludes(EXPECTED_SCOPE_PATHS, /explain|revert/i, "scope next action"),
        scopeFindingsHaveProvenance(EXPECTED_SCOPE_PATHS)
      ]
    },
    {
      id: "missing-tests",
      label: "Missing tests stay visible for behavior files",
      input: demoScenarios["missing-tests"],
      checks: [
        fullReportIsValid(),
        includesMissingTestPaths(EXPECTED_MISSING_TEST_PATHS),
        reviewPriorityIncludesPaths(EXPECTED_MISSING_TEST_PATHS),
        topRiskIncludes(/test evidence|behavior changed/i, "test evidence risk"),
        repromptIncludes(EXPECTED_MISSING_TEST_PATHS, /\b(add|identify)\b.*\btests?\b/i, "missing-test next action"),
        missingTestFindingsHaveProvenance(EXPECTED_MISSING_TEST_PATHS)
      ]
    },
    {
      id: "failed-ci",
      label: "Failed execution blocks overconfident verification",
      input: demoScenarios["failed-ci"],
      checks: [
        fullReportIsValid(),
        hasCiStatus("failed"),
        hasPriority("blocker"),
        hasBlockerExecutionLead(),
        hasNoMetRequirements(),
        repromptMentionsFailingExecution()
      ]
    },
    {
      id: "vague-task",
      label: "Vague tasks remain unclear instead of invented",
      input: demoScenarios["vague-task"],
      checks: [
        fullReportIsValid(),
        hasRequirementStatus("unclear"),
        hasConfidenceAtMost(0.6),
        hasRequirementEvidenceLead(),
        requirementGuidanceIncludes(/acceptance criteria/i, "explicit acceptance criteria")
      ]
    },
    {
      id: "visual-without-screenshot",
      label: "Visual UX requirements need browser or screenshot proof",
      input: VISUAL_WITHOUT_SCREENSHOT_INPUT,
      checks: [
        fullReportIsValid(),
        visualRequirementsAreNotMet(),
        visualGapMentionsVisualProof(),
        reportTextExcludesDecisionWording()
      ]
    },
    {
      id: "summary-only-leak-probe",
      label: "Summary-only report omits raw evidence surfaces",
      input: SUMMARY_ONLY_CANARY_INPUT,
      checks: [summaryOnlyReportIsValid(), summaryOnlyReportOmitsRawEvidence()]
    }
  ];
}

function fullReportIsValid(): SentinelCheckBuilder {
  return (report) => {
    const result = validateVerificationReport(report, { mode: "full" });

    return passFail(
      "full-report-valid",
      "Full report passes strict runtime validation",
      result.valid,
      result.valid ? "valid=true" : `errors=${result.errors.join("; ")}`
    );
  };
}

function summaryOnlyReportIsValid(): SentinelCheckBuilder {
  return (report) => {
    const result = validateVerificationReport(sanitizeReportForShare(report), { mode: "summary" });

    return passFail(
      "summary-report-valid",
      "Summary-only report passes runtime validation",
      result.valid,
      result.valid ? "valid=true" : `errors=${result.errors.join("; ")}`
    );
  };
}

function hasCiStatus(expected: CheckStatus): SentinelCheckBuilder {
  return (report) => passFail(
    `ci-${expected}`,
    `CI status is ${expected}`,
    report.testing.ciStatus === expected,
    `ciStatus=${report.testing.ciStatus}`
  );
}

function hasPriority(expected: PriorityLevel): SentinelCheckBuilder {
  return (report) => passFail(
    `priority-${expected}`,
    `Summary priority is ${expected}`,
    report.summary.priority === expected,
    `priority=${report.summary.priority}`
  );
}

function hasPriorityIn(expected: PriorityLevel[]): SentinelCheckBuilder {
  return (report) => passFail(
    "priority-allowed",
    `Summary priority is one of ${expected.join(", ")}`,
    expected.includes(report.summary.priority),
    `priority=${report.summary.priority}`
  );
}

function hasNoScopeCreep(): SentinelCheckBuilder {
  return (report) => passFail(
    "no-scope-creep",
    "No out-of-scope files are reported",
    !report.scope.suspected && report.scope.outOfScopeFiles.length === 0,
    `scopeFiles=${report.scope.outOfScopeFiles.length}`
  );
}

function hasNoMissingTests(): SentinelCheckBuilder {
  return (report) => passFail(
    "no-missing-tests",
    "No missing-test findings are reported",
    report.testing.missingTests.length === 0,
    `missingTests=${report.testing.missingTests.length}`
  );
}

function includesScopePaths(paths: string[]): SentinelCheckBuilder {
  return (report) => {
    const missing = paths.filter((path) => !report.scope.outOfScopeFiles.includes(path));

    return passFail(
      "scope-paths",
      "Expected out-of-scope paths are present",
      missing.length === 0,
      missing.length === 0 ? `paths=${paths.length}` : `missing=${missing.join(", ")}`
    );
  };
}

function includesMissingTestPaths(paths: string[]): SentinelCheckBuilder {
  return (report) => {
    const actual = new Set(report.testing.missingTests.map((finding) => finding.path));
    const missing = paths.filter((path) => !actual.has(path));

    return passFail(
      "missing-test-paths",
      "Expected behavior files remain missing-test leads",
      missing.length === 0,
      missing.length === 0 ? `paths=${paths.length}` : `missing=${missing.join(", ")}`
    );
  };
}

function reviewPriorityIncludesPaths(paths: string[]): SentinelCheckBuilder {
  return (report) => {
    const actual = new Set(report.reviewPriority.map((item) => item.path));
    const missing = paths.filter((path) => !actual.has(path));

    return passFail(
      "review-priority-paths",
      "Review priority includes expected file leads",
      missing.length === 0,
      missing.length === 0 ? `paths=${paths.length}` : `missing=${missing.join(", ")}`
    );
  };
}

function topRiskIncludes(pattern: RegExp, signalName: string): SentinelCheckBuilder {
  return (report) => passFail(
    `top-risk-${slug(signalName)}`,
    `Top risks include ${signalName}`,
    report.summary.topRisks.some((risk) => pattern.test(risk)),
    `topRisks=${report.summary.topRisks.length}`
  );
}

function repromptIncludes(paths: string[], actionPattern: RegExp, signalName: string): SentinelCheckBuilder {
  return (report) => {
    const text = report.reprompt.prompt;
    const missingPaths = paths.filter((path) => !text.includes(path));
    const hasAction = actionPattern.test(text);

    return passFail(
      `reprompt-${slug(signalName)}`,
      `Re-prompt includes ${signalName}`,
      missingPaths.length === 0 && hasAction,
      missingPaths.length === 0 ? `action=${hasAction}` : `missing=${missingPaths.join(", ")}`
    );
  };
}

function scopeFindingsHaveProvenance(paths: string[]): SentinelCheckBuilder {
  return (report) => {
    const provenanceLocators = new Set((report.scope.provenance ?? []).map((item) => item.locator));
    const missing = paths.filter((path) => !provenanceLocators.has(path));
    const evidenceRefsResolve = refsResolve(report, report.scope.evidenceRefs ?? []);

    return passFail(
      "scope-provenance",
      "Scope findings cite bounded provenance",
      missing.length === 0 && evidenceRefsResolve,
      missing.length === 0 ? `refsResolve=${evidenceRefsResolve}` : `missing=${missing.join(", ")}`
    );
  };
}

function missingTestFindingsHaveProvenance(paths: string[]): SentinelCheckBuilder {
  return (report) => {
    const failures = paths.filter((path) => {
      const finding = report.testing.missingTests.find((item) => item.path === path);

      return !finding ||
        finding.evidenceRefs.length === 0 ||
        !refsResolve(report, finding.evidenceRefs) ||
        !finding.provenance?.some((item) => item.locator === path);
    });

    return passFail(
      "missing-test-provenance",
      "Missing-test findings cite bounded provenance",
      failures.length === 0,
      failures.length === 0 ? `paths=${paths.length}` : `missing=${failures.join(", ")}`
    );
  };
}

function hasBlockerExecutionLead(): SentinelCheckBuilder {
  return (report) => {
    const lead = report.reviewPriority.find((item) => item.path === "Test/build checks" && item.priority === "blocker");
    const evidence = refsToEvidence(report, lead?.evidenceRefs ?? []);
    const hasFailedExecutionEvidence = evidence.some((item) =>
      (item.kind === "check" || item.kind === "log") && /^Status: failed\b/.test(item.summary)
    );

    return passFail(
      "blocker-execution-lead",
      "Failed execution appears as the blocker review lead",
      Boolean(lead) && hasFailedExecutionEvidence,
      `lead=${Boolean(lead)} failedEvidence=${hasFailedExecutionEvidence}`
    );
  };
}

function hasNoMetRequirements(): SentinelCheckBuilder {
  return (report) => passFail(
    "no-met-requirements",
    "Failed execution prevents met requirement statuses",
    report.requirements.every((finding) => finding.status !== "met"),
    `met=${report.requirements.filter((finding) => finding.status === "met").length}`
  );
}

function repromptMentionsFailingExecution(): SentinelCheckBuilder {
  return (report) => passFail(
    "reprompt-failed-execution",
    "Re-prompt asks for failing execution proof",
    /fix the failing test\/build check/i.test(report.reprompt.prompt) &&
      /exact log line/i.test(report.reprompt.prompt),
    "expected failing check and log-line language"
  );
}

function hasRequirementStatus(expected: RequirementStatus): SentinelCheckBuilder {
  return (report) => passFail(
    `requirement-${expected}`,
    `At least one requirement is ${expected}`,
    report.requirements.some((finding) => finding.status === expected),
    `statuses=${report.requirements.map((finding) => finding.status).join(",")}`
  );
}

function hasConfidenceAtMost(maximum: number): SentinelCheckBuilder {
  return (report) => passFail(
    "confidence-cap",
    `Summary confidence stays <= ${maximum}`,
    report.summary.confidence <= maximum,
    `confidence=${report.summary.confidence}`
  );
}

function hasRequirementEvidenceLead(): SentinelCheckBuilder {
  return (report) => passFail(
    "requirement-evidence-lead",
    "Review priority asks humans to interpret requirement evidence",
    report.reviewPriority.some((item) =>
      item.path === "Requirement evidence" &&
      /human interpretation|partial evidence|no matching implementation/i.test(item.reason)
    ),
    `leads=${report.reviewPriority.length}`
  );
}

function requirementGuidanceIncludes(pattern: RegExp, signalName: string): SentinelCheckBuilder {
  return (report) => {
    const guidance = report.requirements.flatMap((finding) => [
      ...finding.gaps,
      finding.reviewerNote
    ]).join("\n");

    return passFail(
      `requirement-guidance-${slug(signalName)}`,
      `Requirement guidance mentions ${signalName}`,
      pattern.test(guidance),
      "checked gaps and reviewer notes"
    );
  };
}

function visualRequirementsAreNotMet(): SentinelCheckBuilder {
  return (report) => {
    const visualFindings = report.requirements.filter((finding) =>
      /\b(layout|mobile|overlap|readable|viewport|visual|ui|ux)\b/i.test(finding.requirementText)
    );

    return passFail(
      "visual-not-met-without-proof",
      "Visual requirements are not marked met without browser proof",
      visualFindings.length > 0 && visualFindings.every((finding) => finding.status !== "met"),
      `visualFindings=${visualFindings.length}`
    );
  };
}

function visualGapMentionsVisualProof(): SentinelCheckBuilder {
  return (report) => {
    const visualText = report.requirements.flatMap((finding) => [
      ...finding.gaps,
      finding.reviewerNote
    ]).join("\n");

    return passFail(
      "visual-proof-gap",
      "Visual gap asks for browser, screenshot, or visual QA evidence",
      /browser|screenshot|visual QA|visual proof/i.test(visualText),
      "checked requirement gaps and reviewer notes"
    );
  };
}

function reportTextExcludesDecisionWording(): SentinelCheckBuilder {
  return (report) => {
    const text = [
      report.summary.oneLine,
      ...report.summary.topRisks,
      ...report.reviewPriority.map((item) => item.reason),
      report.reprompt.prompt
    ].join("\n");

    return passFail(
      "no-auto-merge-wording",
      "Report avoids auto-merge decision wording",
      !/\b(approve|approved|auto-merge|automerge|merge safe|safe to merge|ship it)\b/i.test(text),
      "checked summary, risks, review priority, and re-prompt"
    );
  };
}

function summaryOnlyReportOmitsRawEvidence(): SentinelCheckBuilder {
  return (report) => {
    const shared = sanitizeReportForShare(report);
    const issues: string[] = [];

    if (shared.evidenceIndex.length > 0) issues.push("evidenceIndex");
    if (shared.claims.length > 0) issues.push("claims");
    if (shared.scope.outOfScopeFiles.length > 0) issues.push("scopePaths");
    if ((shared.scope.evidenceRefs?.length ?? 0) > 0) issues.push("scopeEvidenceRefs");
    if ((shared.scope.provenance?.length ?? 0) > 0) issues.push("scopeProvenance");
    if (shared.requirements.some((finding) => finding.evidenceRefs.length > 0)) issues.push("requirementEvidenceRefs");
    if (shared.testing.missingTests.some((finding) => finding.evidenceRefs.length > 0 || (finding.provenance?.length ?? 0) > 0)) {
      issues.push("missingTestEvidence");
    }
    if (shared.reviewPriority.some((item) => (item.evidenceRefs?.length ?? 0) > 0)) issues.push("reviewPriorityEvidenceRefs");
    if (!/omit re-prompt text/i.test(shared.reprompt.prompt)) issues.push("rawReprompt");
    const serializedShared = JSON.stringify(shared);
    if (Object.values(SUMMARY_ONLY_CANARY).some((marker) => serializedShared.includes(marker))) {
      issues.push("rawPatchOrLogPhrase");
    }

    return passFail(
      "summary-only-no-raw-evidence",
      "Summary-only report omits raw evidence surfaces",
      issues.length === 0,
      issues.length === 0 ? "summary-only=true" : `leaked=${issues.join(",")}`
    );
  };
}

function refsResolve(report: VerificationReport, refs: string[]): boolean {
  if (refs.length === 0) {
    return false;
  }

  const evidenceById = new Set(report.evidenceIndex.map((item) => item.id));

  return refs.every((ref) => evidenceById.has(ref));
}

function refsToEvidence(report: VerificationReport, refs: string[]): EvidenceItem[] {
  const evidenceById = new Map(report.evidenceIndex.map((item) => [item.id, item]));

  return refs.flatMap((ref) => {
    const evidence = evidenceById.get(ref);

    return evidence ? [evidence] : [];
  });
}

function passFail(
  id: string,
  label: string,
  passed: boolean,
  detail: string
): ReviewerSignalSentinelCheck {
  return {
    id,
    label,
    status: passed ? "pass" : "fail",
    detail
  };
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
