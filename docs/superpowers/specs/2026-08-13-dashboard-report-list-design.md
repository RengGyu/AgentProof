# Dashboard report list design

## Goal

Keep the repository report workspace compact on mobile while retaining access to
every currently visible saved report.

## Scope

- Keep the existing repository and freshness filters and newest-first ordering.
- Show the newest five report rows initially.
- When more than five rows exist, show an inline control labelled with the
  number of hidden reports.
- The control expands the same list to all rows and can collapse it back to
  the five-row view.
- Do not add a new route, change report storage, or trigger re-analysis.

## Behaviour

The UI derives `displayedReports` from the existing `selectedReports` list.
Collapsed view uses its first five items; expanded view uses the full list.
Opening a report keeps the existing detail and copy behaviour unchanged.

The list's `createdAt` value remains the timestamp of the last saved analysis.
Refreshing the UI only reloads saved reports; it does not create a new analysis
job. Re-analysis is explicitly outside this UI change.

## Acceptance criteria

1. A repository with five or fewer visible reports has no expand control.
2. A repository with six or more visible reports initially renders exactly five
   rows and a control that states how many more are available.
3. Activating the control renders all visible reports; activating it again
   returns to five.
4. Ordering and unavailable/copy guards remain unchanged.
5. The component and focused test suite pass type checking.

## Risks

Collapsing after the user opens an older row may hide that row, but must not
clear the already-open detail. This keeps the current review context intact.
