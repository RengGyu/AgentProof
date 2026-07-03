import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_ROOT = process.cwd();
const REQUIRED_P0_DOCS = [
  "README.md",
  "docs/first-real-pr-report.md",
  "docs/reviewer-validation-packet.md",
  "docs/external-pr-pilot.md",
  "docs/linked-issue-ingestion.md",
  "docs/deployment-smoke.md"
];

export function runP0BetaReadiness({
  root = DEFAULT_ROOT,
  readFile = readFileSync,
  exists = existsSync
} = {}) {
  const reviewerFixture = readJson(join(root, "eval/fixtures/reviewer-validation.v1.json"), readFile);
  const externalPilotFixture = readJson(join(root, "eval/fixtures/external-pr-pilot.v1.json"), readFile);
  const externalPilotDoc = readText(join(root, "docs/external-pr-pilot.md"), readFile);

  const gates = [
    docsGate({ root, exists }),
    externalPilotGate({ fixture: externalPilotFixture, doc: externalPilotDoc }),
    reviewerValidationGate(reviewerFixture),
    deferredScopeGate({ root, readFile })
  ];
  const blocked = gates.filter((gate) => gate.status === "blocked").length;
  const ready = gates.filter((gate) => gate.status === "ready").length;
  const unclear = gates.filter((gate) => gate.status === "unclear").length;

  return {
    ok: blocked === 0 && unclear === 0,
    privacy: "p0-beta-readiness-summary-only",
    status: blocked > 0 ? "blocked" : unclear > 0 ? "unclear" : "ready_for_design_partner_review",
    counts: {
      gates: gates.length,
      ready,
      blocked,
      unclear
    },
    next: nextReadinessAction(gates),
    gates
  };
}

function docsGate({ root, exists }) {
  const missing = REQUIRED_P0_DOCS.filter((relativePath) => !exists(join(root, relativePath)));

  return {
    key: "p0_docs",
    status: missing.length === 0 ? "ready" : "blocked",
    evidenceRefs: REQUIRED_P0_DOCS,
    counts: {
      required: REQUIRED_P0_DOCS.length,
      missing: missing.length
    },
    next: missing.length === 0 ? "keep_docs_current" : "restore_missing_p0_docs"
  };
}

function externalPilotGate({ fixture, doc }) {
  const cases = Array.isArray(fixture?.cases) ? fixture.cases : [];
  const categories = new Set(cases.map((item) => item?.category).filter(Boolean));
  const requiredCategories = ["clean_pr", "missing_tests", "scope_creep", "failed_ci", "vague_task_or_visual_gap"];
  const pendingManualLabels = cases.filter((item) => item?.manualLabels?.labelStatus !== "reviewed").length;
  const productionRunnerEvidence = /Latest production runner evidence, 2026-07-03/i.test(doc) &&
    /qualityGateSummary\.ok: true/i.test(doc) &&
    /productionTokenForwarded: false/i.test(doc);
  const hasFiveCategories = cases.length === 5 && requiredCategories.every((category) => categories.has(category));

  return {
    key: "external_pr_5_case_pilot",
    status: hasFiveCategories && productionRunnerEvidence && pendingManualLabels === 0 ? "ready" : "blocked",
    evidenceRefs: [
      "eval/fixtures/external-pr-pilot.v1.json",
      "docs/external-pr-pilot.md"
    ],
    counts: {
      cases: cases.length,
      requiredCategories: requiredCategories.length,
      coveredCategories: requiredCategories.filter((category) => categories.has(category)).length,
      pendingManualLabels
    },
    checks: {
      fiveCaseFixtureReady: hasFiveCategories,
      productionRunnerEvidence,
      manualLabelsReviewed: pendingManualLabels === 0
    },
    next: pendingManualLabels > 0
      ? "fill_manual_labels_after_reviewer_sessions"
      : productionRunnerEvidence && hasFiveCategories
        ? "review_pilot_results"
        : "rerun_external_pr_pilot_smoke"
  };
}

function reviewerValidationGate(fixture) {
  const outreachSlots = Array.isArray(fixture?.outreachSlots) ? fixture.outreachSlots : [];
  const feedbackRecords = Array.isArray(fixture?.feedbackRecords) ? fixture.feedbackRecords : [];
  const readyToSend = outreachSlots.filter((slot) => slot?.status === "ready-to-send").length;
  const sentOrScheduled = outreachSlots.filter((slot) =>
    slot?.status === "outreach-sent" ||
    slot?.status === "scheduled" ||
    slot?.status === "declined" ||
    slot?.status === "no-response"
  ).length;
  const completedSessions = feedbackRecords.filter((record) => record?.sessionStatus === "completed").length;
  const realPrUsage = feedbackRecords.filter((record) =>
    record?.sessionStatus === "completed" &&
    (record?.prSource === "public-oss-pr" || record?.prSource === "shareable-team-pr")
  ).length;
  const internalOnlyBiased = feedbackRecords.filter((record) =>
    record?.sessionStatus === "internal-only-biased-and-insufficient"
  ).length;

  return {
    key: "reviewer_validation",
    status: sentOrScheduled >= 3 && completedSessions >= 3 && realPrUsage >= 1 ? "ready" : "blocked",
    evidenceRefs: [
      "eval/fixtures/reviewer-validation.v1.json",
      "docs/reviewer-validation-packet.md"
    ],
    counts: {
      outreachSlots: outreachSlots.length,
      readyToSend,
      sentOrScheduled,
      completedSessions,
      realPrUsage,
      internalOnlyBiased
    },
    next: sentOrScheduled < 3
      ? "send_prepared_reviewer_outreach"
      : completedSessions < 3
        ? "record_three_reviewer_sessions"
        : realPrUsage < 1
          ? "run_at_least_one_real_pr_session"
          : "review_feedback_before_claiming_validation"
  };
}

function deferredScopeGate({ root, readFile }) {
  const packet = readText(join(root, "docs/reviewer-validation-packet.md"), readFile);
  const readme = readText(join(root, "README.md"), readFile);
  const combined = `${packet}\n${readme}`;
  const forbiddenClaims = [
    /\bpublic signup\b/i,
    /\bcustomer portal\b/i,
    /\bprovider checkout\b/i,
    /\bdeletion\/restore automation\b/i,
    /\bVS Code\/Cursor extension\b/i
  ];
  const leakedClaims = forbiddenClaims.filter((pattern) => pattern.test(combined)).length;

  return {
    key: "p1_p2_deferred_scope",
    status: leakedClaims === 0 ? "ready" : "blocked",
    evidenceRefs: [
      "README.md",
      "docs/reviewer-validation-packet.md"
    ],
    counts: {
      leakedDeferredClaims: leakedClaims
    },
    next: leakedClaims === 0 ? "keep_p0_scope_narrow" : "remove_deferred_scope_claims_from_p0_path"
  };
}

function nextReadinessAction(gates) {
  const docsGate = gates.find((gate) => gate.key === "p0_docs");
  if (docsGate?.status === "blocked") {
    return docsGate.next;
  }

  const deferredScopeGate = gates.find((gate) => gate.key === "p1_p2_deferred_scope");
  if (deferredScopeGate?.status === "blocked") {
    return deferredScopeGate.next;
  }

  const reviewerGate = gates.find((gate) => gate.key === "reviewer_validation");
  if (
    reviewerGate?.status === "blocked" &&
    (
      reviewerGate.next === "send_prepared_reviewer_outreach" ||
      reviewerGate.next === "record_three_reviewer_sessions" ||
      reviewerGate.next === "run_at_least_one_real_pr_session"
    )
  ) {
    return reviewerGate.next;
  }

  const externalPilotGate = gates.find((gate) => gate.key === "external_pr_5_case_pilot");
  if (externalPilotGate?.status === "blocked") {
    return externalPilotGate.next;
  }

  if (reviewerGate?.status === "blocked") {
    return reviewerGate.next;
  }

  const unclear = gates.find((gate) => gate.status === "unclear");
  if (unclear) {
    return unclear.next;
  }

  return "ready_for_design_partner_review";
}

function readJson(filePath, readFile) {
  return JSON.parse(readFile(filePath, "utf8"));
}

function readText(filePath, readFile) {
  return readFile(filePath, "utf8");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    console.log(JSON.stringify(runP0BetaReadiness(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      privacy: "p0-beta-readiness-summary-only",
      error: error instanceof Error ? error.message : "P0 beta readiness check failed."
    }));
    process.exit(1);
  }
}
