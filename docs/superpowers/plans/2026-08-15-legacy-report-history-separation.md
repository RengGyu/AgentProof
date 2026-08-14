# Legacy saved-report history separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep current evidence reports usable when historical persisted reports can no longer be decoded.

**Architecture:** Add one pure list partition at the dashboard list boundary. The dashboard renders its normal workspace from the primary partition and renders unavailable rows only behind a collapsed history control. No persistence or validation contract changes.

**Tech Stack:** TypeScript, React, Vitest.

## Global Constraints

- Preserve the existing privacy-safe unavailable row and recovery copy.
- Do not write, migrate, or delete saved reports.
- A historical unavailable row must not affect current-report copying or verification labels.

---

### Task 1: Partition and render legacy unavailable history

**Files:**

- Modify: `src/lib/dashboard-report-list.ts`
- Modify: `src/lib/dashboard-report-list.test.ts`
- Modify: `src/components/PublicGitHubDashboard.tsx`
- Modify: `src/components/PublicGitHubDashboard.test.ts`

**Interfaces:**

- Produces: `partitionVisibleRepositoryReports(reports, repositoryId)`, returning `{ primary, unavailableHistory }` in newest-first order.
- Consumes: existing `DashboardSavedReport.availability` and `visibleRepositoryReports` filtering.

- [ ] **Step 1: Write the failing partition test**

```ts
expect(partitionVisibleRepositoryReports(reports, 7)).toEqual({
  primary: [reports[0]],
  unavailableHistory: [reports[1]]
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm vitest run src/lib/dashboard-report-list.test.ts`

Expected: FAIL because `partitionVisibleRepositoryReports` does not exist.

- [ ] **Step 3: Implement the minimal partition and consume it in the dashboard**

```ts
const reportPartitions = partitionVisibleRepositoryReports(reports, selectedRepository?.repositoryId);
const primaryReports = reportPartitions.primary;
const unavailableHistory = reportPartitions.unavailableHistory;
```

Render primary reports in the existing list. Add a collapsed `Previous unavailable reports` control that reveals disabled rows and the existing recovery guidance only when expanded.

- [ ] **Step 4: Add a dashboard regression assertion**

Assert the dashboard uses `primaryReports` for the main list and does not use unavailable history to disable the copy action.

- [ ] **Step 5: Run focused tests to verify green**

Run: `pnpm vitest run src/lib/dashboard-report-list.test.ts src/components/PublicGitHubDashboard.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard-report-list.ts src/lib/dashboard-report-list.test.ts src/components/PublicGitHubDashboard.tsx src/components/PublicGitHubDashboard.test.ts
git commit -m "fix: separate legacy unavailable reports"
```
