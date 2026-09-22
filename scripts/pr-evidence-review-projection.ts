import type { PrEvidenceReview } from '../src/lib/pr-evidence-review';
import type { ReviewIntentGraphV1 } from '../src/lib/review-intent';

/** Structural projection accounting, NOT semantic completeness or reviewer utility.
 * A displayed intent may represent several generated requirements. Its recorded
 * source/facet references must survive, and unmapped legacy objectives must remain.
 */
export function inspectObjectiveProjection(
  review: Pick<PrEvidenceReview, 'objectives'>,
  requirementIds: readonly string[],
  graph?: Pick<ReviewIntentGraphV1, 'goals'>
) {
  const requirements = new Set(requirementIds);
  const goals = new Map((graph?.goals ?? []).map(goal => [goal.id, goal]));
  const assigned = new Set((graph?.goals ?? []).flatMap(goal => goal.requirementIds));
  const expected = new Set([...goals.keys(), ...requirementIds.filter(id => !assigned.has(id))]);
  const displayed = new Set(review.objectives.map(objective => objective.id));
  const represented = new Set<string>();
  const seen = new Set<string>(), duplicates = new Set<string>(), mismatches = new Set<string>();
  for (const objective of review.objectives) {
    if (seen.has(objective.id)) duplicates.add(objective.id);
    seen.add(objective.id);
    const goal = goals.get(objective.id);
    if (goal) {
      for (const id of goal.requirementIds) if (requirements.has(id)) represented.add(id);
      if (JSON.stringify(objective.sourceRefs) !== JSON.stringify(goal.sourceRefs) ||
          JSON.stringify(objective.facets) !== JSON.stringify(goal.facets)) mismatches.add(goal.id);
    } else if (requirements.has(objective.id)) represented.add(objective.id);
  }
  return {
    interpretation: 'structural projection identity and source-reference preservation; not semantic coverage' as const,
    representedRequirementIds: requirementIds.filter(id => represented.has(id)),
    missingRequirementIds: requirementIds.filter(id => !represented.has(id)),
    unknownRequirementIds: [...assigned].filter(id => !requirements.has(id)),
    missingObjectiveIds: [...expected].filter(id => !displayed.has(id)),
    unexpectedObjectiveIds: [...displayed].filter(id => !expected.has(id)),
    duplicateObjectiveIds: [...duplicates],
    sourceReferenceMismatches: [...mismatches]
  };
}
