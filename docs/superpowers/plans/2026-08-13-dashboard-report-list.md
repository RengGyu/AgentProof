# Dashboard Report List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only the five newest visible saved reports initially and expand the same list on request.

**Architecture:** Keep `visibleRepositoryReports` as the single source for repository, freshness, and newest-first filtering. `PublicGitHubDashboard` owns a local expanded/collapsed UI state and derives the rendered list from that already-filtered result; no report storage, API response, or analysis job changes are needed.

**Tech Stack:** Next.js, React, TypeScript, Vitest.

## Global Constraints

- Preserve existing newest-first ordering and stale/superseded filtering.
- Render five rows initially when more than five current workspace reports exist.
- Expand and collapse inline; do not add a route or trigger re-analysis.
- Preserve unavailable-report and bulk-copy guards.

---

### Task 1: Compact report-list state and UI

**Files:**
- Modify: `src/components/PublicGitHubDashboard.tsx`
- Test: `src/components/PublicGitHubDashboard.test.ts`

**Interfaces:**
- Consumes: `selectedReports` from `visibleRepositoryReports`.
- Produces: `displayedReports`, a five-row collapsed view or complete expanded view.

- [ ] **Step 1: Write the failing test**

Add source assertions that require a `reportListExpanded` state, a five-item slice, and an inline control with both `Show all` and `Show fewer` labels.

- [ ] **Step 2: Run the focused test to verify it fails**

Run `pnpm vitest run src/components/PublicGitHubDashboard.test.ts`. It must fail because the state, slice, and labels do not exist.

- [ ] **Step 3: Write the minimal implementation**

Add a `DASHBOARD_REPORT_LIST_LIMIT` constant with value `5`, reset expansion when the selected repository changes, derive `displayedReports`, and map that list rather than `selectedReports`. Render a button only when hidden reports exist.

```tsx
const displayedReports = reportListExpanded
  ? selectedReports
  : selectedReports.slice(0, DASHBOARD_REPORT_LIST_LIMIT);
```

- [ ] **Step 4: Run focused tests to verify they pass**

Run `pnpm vitest run src/components/PublicGitHubDashboard.test.ts src/lib/dashboard-report-list.test.ts`. Ordering and freshness tests must remain unchanged.

- [ ] **Step 5: Commit**

Stage only `src/components/PublicGitHubDashboard.tsx` and `src/components/PublicGitHubDashboard.test.ts`, then make a commit named `fix: compact dashboard report list`.

### Task 2: Verify the dashboard package

**Files:**
- Modify: none expected
- Test: `src/components/PublicGitHubDashboard.test.ts`, `src/lib/dashboard-report-list.test.ts`

**Interfaces:**
- Consumes: the completed compact-list UI.
- Produces: evidence that the UI stays type-safe and buildable.

- [ ] **Step 1: Run the relevant test package**

Run the focused tests, `pnpm typecheck`, `pnpm build`, and `git diff --check`. Every command must exit with status `0`.

- [ ] **Step 2: Inspect the final diff**

Confirm only the dashboard component and its focused test changed for the implementation task; leave unrelated untracked evaluation and documentation files untouched.
