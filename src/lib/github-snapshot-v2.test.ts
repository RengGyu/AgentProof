import { describe, expect, it } from "vitest";
import { normalizeGitHubWorkflowObservationV2 } from "./github-snapshot-v2";

const headSha = "a".repeat(40);

function completeInput() {
  return {
    repository: { owner: "opaque-owner", repo: "opaque-repo" },
    requestedRunId: 4101,
    requestedRunAttempt: 2,
    initialHeadSha: headSha,
    finalHeadSha: headSha,
    collectionsComplete: true,
    checkEvidenceRef: "ev_5",
    availableCheckEvidenceRefs: ["ev_5"],
    runAttempt: {
      id: 4101,
      name: "Verification",
      path: ".github/workflows/verify.yml",
      workflow_id: 3101,
      run_attempt: 2,
      head_sha: headSha,
      check_suite_id: 5101
    },
    job: {
      id: 7101,
      run_id: 4101,
      run_attempt: 2,
      head_sha: headSha,
      name: "unit-test",
      workflow_name: "Verification",
      check_run_url: "https://api.github.com/repos/opaque-owner/opaque-repo/check-runs/6101"
    },
    checkRun: {
      id: 6101,
      head_sha: headSha,
      check_suite: { id: 5101 }
    }
  };
}

describe("normalizeGitHubWorkflowObservationV2", () => {
  it("completes only the exact run-attempt/job/check/head join", () => {
    expect(normalizeGitHubWorkflowObservationV2(completeInput())).toEqual({
      workflowPath: ".github/workflows/verify.yml",
      workflowName: "Verification",
      workflowId: 3101,
      runId: 4101,
      runAttempt: 2,
      jobId: 7101,
      jobName: "unit-test",
      headSha,
      checkEvidenceRef: "ev_5",
      completeness: "complete"
    });
  });

  it.each([
    ["missing run field", (input: ReturnType<typeof completeInput>) => { delete (input.runAttempt as { path?: string }).path; }],
    ["wrong attempt", (input: ReturnType<typeof completeInput>) => { input.job.run_attempt = 1; }],
    ["workflow-name disagreement", (input: ReturnType<typeof completeInput>) => { input.job.workflow_name = "Other workflow"; }],
    ["stale head", (input: ReturnType<typeof completeInput>) => { input.finalHeadSha = "b".repeat(40); }],
    ["wrong check suite", (input: ReturnType<typeof completeInput>) => { input.checkRun.check_suite.id = 9999; }],
    ["capped pages", (input: ReturnType<typeof completeInput>) => { input.collectionsComplete = false; }]
  ])("marks %s incomplete", (_name, mutate) => {
    const input = completeInput();
    mutate(input);

    expect(normalizeGitHubWorkflowObservationV2(input).completeness).toBe("incomplete");
  });

  it.each(["ev_0", "ev_201", "check-run:6101", "ev_6"])("rejects an unassigned evidence reference: %s", (checkEvidenceRef) => {
    const input = completeInput();
    input.checkEvidenceRef = checkEvidenceRef;

    expect(normalizeGitHubWorkflowObservationV2(input).completeness).toBe("incomplete");
  });

  it("rejects a same-label job when its check-run URL is outside the repository", () => {
    const input = completeInput();
    input.job.check_run_url = "https://api.github.com/repos/other/repo/check-runs/6101";

    expect(normalizeGitHubWorkflowObservationV2(input).completeness).toBe("incomplete");
  });

  it("normalizes a documented reusable-workflow ref suffix structurally", () => {
    const input = completeInput();
    input.runAttempt.path = ".github/workflows/verify.yml@refs/heads/main";

    expect(normalizeGitHubWorkflowObservationV2(input)).toEqual(expect.objectContaining({
      workflowPath: ".github/workflows/verify.yml",
      completeness: "complete"
    }));
  });
});
