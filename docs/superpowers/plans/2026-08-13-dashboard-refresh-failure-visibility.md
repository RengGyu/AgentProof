# Dashboard Refresh Failure Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the logged-in user why a newer PR analysis failed directly in the dashboard, without a tenant-ID workflow.

**Architecture:** Keep job failures private to the authorized tenant session. Extend the existing safe dashboard activity and report-freshness projections with the already-redacted job error code and summary, then render the result inline in the Inbox and on the affected saved-report row.

**Tech Stack:** Next.js route handlers, React, TypeScript, Vitest.

## Global Constraints

- Do not expose tenant IDs, job IDs, provider response IDs, raw logs, payloads, or newer head SHAs.
- Show only the existing bounded `error_code` and redacted `error_summary` fields to the authorized tenant session.
- Do not add a retry/reanalysis action or modify tenant setup.

---

### Task 1: Project safe failure metadata into dashboard responses

**Files:**
- Modify: `src/lib/analysis-jobs.ts`
- Modify: `src/lib/dashboard-activity.ts`
- Test: `src/lib/analysis-jobs.test.ts`
- Test: `src/lib/dashboard-activity.test.ts`

**Interfaces:**
- Produces: `AnalysisJobFreshness.failure?: { code?: string; summary?: string }`
- Produces: `DashboardActivityEvent.failure?: { code?: string; summary?: string }`

- [ ] **Step 1: Write failing tests**

```ts
expect(await resolveAnalysisJobFreshness(input)).toMatchObject({
  freshness: "refresh_failed",
  copyEligible: false,
  failure: { code: "github_fetch_failed", summary: "GitHub request could not be completed." }
});

expect(buildDashboardActivity(input)[0]).toMatchObject({
  kind: "analysis_needs_attention",
  failure: { code: "github_fetch_failed" }
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm vitest run src/lib/analysis-jobs.test.ts src/lib/dashboard-activity.test.ts`

Expected: Failure because failure metadata is not projected.

- [ ] **Step 3: Implement the minimal projection**

```ts
if (latest.status === "failed_retryable" || latest.status === "failed_terminal") {
  return {
    freshness: "refresh_failed",
    copyEligible: false,
    failure: safeAnalysisJobFailure(latest)
  };
}
```

Pass the same bounded fields from an existing `TenantAnalysisJobSummary` to an `analysis_needs_attention` event.

- [ ] **Step 4: Re-run focused tests**

Run: `pnpm vitest run src/lib/analysis-jobs.test.ts src/lib/dashboard-activity.test.ts`

Expected: PASS.

### Task 2: Display the failure where the user already is

**Files:**
- Modify: `src/components/PublicGitHubDashboard.tsx`
- Test: `src/components/PublicGitHubDashboard.test.ts`
- Test: `src/app/api/dashboard/reports/route.test.ts`

**Interfaces:**
- Consumes: dashboard activity and report freshness `failure` metadata.
- Produces: an Inbox failure line and accurate refresh-failure title text.

- [ ] **Step 1: Write failing tests**

```ts
expect(source).toContain("Analysis refresh failed");
expect(source).toContain("event.failure?.summary");
```

```ts
expect(detail).toMatchObject({
  freshness: "refresh_failed",
  failure: { code: "github_fetch_failed" }
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm vitest run src/components/PublicGitHubDashboard.test.ts src/app/api/dashboard/reports/route.test.ts`

Expected: Failure because the dashboard has no failure detail or accurate refresh-failure copy.

- [ ] **Step 3: Implement the minimal UI copy**

```tsx
{event.failure?.summary ? <small>Analysis refresh failed · {event.failure.summary}</small> : null}
```

For a failed report freshness, replace the existing “newer analysis is still being prepared” title with “A newer analysis failed before a report was saved.”

- [ ] **Step 4: Re-run focused tests**

Run: `pnpm vitest run src/components/PublicGitHubDashboard.test.ts src/app/api/dashboard/reports/route.test.ts`

Expected: PASS.

### Task 3: Verify the authorized dashboard boundary

**Files:**
- Test: `src/app/api/dashboard/activity/route.test.ts`
- Test: `src/app/api/dashboard/reports/route.test.ts`

- [ ] **Step 1: Add a response-boundary test**

```ts
expect(JSON.stringify(body)).not.toContain("provider_response_id");
expect(JSON.stringify(body)).not.toContain("canonical_key_hash");
expect(JSON.stringify(body)).not.toContain("tenant_a");
```

- [ ] **Step 2: Run the dashboard suite**

Run: `pnpm vitest run src/lib/analysis-jobs.test.ts src/lib/dashboard-activity.test.ts src/app/api/dashboard/activity/route.test.ts src/app/api/dashboard/reports/route.test.ts src/components/PublicGitHubDashboard.test.ts`

Expected: PASS.

- [ ] **Step 3: Run project verification**

Run: `pnpm typecheck && pnpm lint && pnpm build && git diff --check`

Expected: PASS.
