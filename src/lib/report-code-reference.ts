import type { PrEvidenceReview, PrEvidenceReviewItem } from "./pr-evidence-review";

export function reportCodeReference(item: PrEvidenceReviewItem): string {
  return `${item.evidenceId}:${item.line ?? 0}`;
}

export function reviewCodeItems(review: PrEvidenceReview): PrEvidenceReviewItem[] {
  return [...review.changes, ...review.objectives.flatMap(goal => [
    ...(goal.firstInspection ? [goal.firstInspection] : []), ...goal.code, ...goal.tests, ...(goal.moreContext ?? [])
  ])].filter(item => item.kind !== "execution" && Boolean(item.url));
}

export interface ReportCodeExcerpt {
  reference: string;
  path: string;
  revision: string;
  focusLine?: number;
  totalLines: number;
  lines: Array<{ number: number; text: string }>;
  truncated: boolean;
}
