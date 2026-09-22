import assert from 'node:assert/strict';
import { it } from 'vitest';
import type { PrEvidenceReviewObjective } from '../src/lib/pr-evidence-review';
import type { ReviewIntentGraphV1 } from '../src/lib/review-intent';
import { inspectObjectiveProjection } from './pr-evidence-review-projection';

const ref = {start: 0, end: 40, hash: 'a'.repeat(64)};
const ids = Array.from({length: 8}, (_,i) => `req_${i + 1}`);
const group: ReviewIntentGraphV1['goals'][number] = {
  id: 'intent_0123456789abcdef', requirementIds: ids, sourceRefs: [ref],
  facets: [{kind: 'condition', sourceRef: {start: 41, end: 60, hash: 'b'.repeat(64)}}]
};
const objective = (id: string): PrEvidenceReviewObjective => ({id, text: 'Review routing', code: [], tests: [], execution: [], nextInspection: 'Inspect the collected evidence.'});
const grouped = () => ({...objective(group.id), sourceRefs: group.sourceRefs, facets: group.facets});
it('checks requirement membership and source references rather than equating goals with requirements', () => {
  const view = {objectives: [grouped()]};
  assert.notEqual(view.objectives.length, ids.length, 'the legacy equality is deliberately false');
  const result = inspectObjectiveProjection(view, ids, {goals: [group]});
  assert.deepEqual(result.representedRequirementIds, ids);
  assert.deepEqual(result.missingRequirementIds, []);
  assert.deepEqual(result.missingObjectiveIds, []);
  assert.deepEqual(result.unexpectedObjectiveIds, []);
  assert.deepEqual(result.duplicateObjectiveIds, []);
  assert.deepEqual(result.unknownRequirementIds, []);
  assert.deepEqual(result.sourceReferenceMismatches, []);
});
it('detects a dropped grouped objective instead of treating zero displayed goals as full coverage', () => {
  const result = inspectObjectiveProjection({objectives: []}, ids, {goals: [group]});
  assert.deepEqual(result.missingRequirementIds, ids);
  assert.deepEqual(result.missingObjectiveIds, [group.id]);
});
it('requires unmapped requirements to retain their separate objective', () => {
  const result = inspectObjectiveProjection({objectives: [grouped()]}, [...ids, 'req_unmapped'], {goals: [group]});
  assert.deepEqual(result.missingRequirementIds, ['req_unmapped']);
  assert.deepEqual(result.missingObjectiveIds, ['req_unmapped']);
  const retained = inspectObjectiveProjection({objectives: [grouped(), objective('req_unmapped')]}, [...ids, 'req_unmapped'], {goals: [group]});
  assert.deepEqual(retained.missingRequirementIds, []);
  assert.deepEqual(retained.missingObjectiveIds, []);
});
it('detects unknown and duplicate projected objective IDs', () => {
  const result = inspectObjectiveProjection({objectives: [grouped(), grouped(), objective('invented')]}, ids, {goals: [group]});
  assert.deepEqual(result.duplicateObjectiveIds, [group.id]);
  assert.deepEqual(result.unexpectedObjectiveIds, ['invented']);
});
it('detects lost condition references even when all grouped requirement IDs remain represented', () => {
  const result = inspectObjectiveProjection({objectives: [{...grouped(), facets: []}]}, ids, {goals: [group]});
  assert.deepEqual(result.missingRequirementIds, []);
  assert.deepEqual(result.sourceReferenceMismatches, [group.id]);
});
it('detects a graph referencing a requirement that was never generated', () => {
  const result = inspectObjectiveProjection({objectives: [grouped()]}, ids, {goals: [{...group, requirementIds: [...ids, 'unknown_requirement']}]});
  assert.deepEqual(result.unknownRequirementIds, ['unknown_requirement']);
});
it('uses direct requirement identity when no intent graph exists', () => {
  const result = inspectObjectiveProjection({objectives: [objective('req_1')]}, ['req_1', 'req_2']);
  assert.deepEqual(result.representedRequirementIds, ['req_1']);
  assert.deepEqual(result.missingRequirementIds, ['req_2']);
  assert.deepEqual(result.missingObjectiveIds, ['req_2']);
});
it('does not demand goals for an empty requirements-and-goals input', () => {
  const result = inspectObjectiveProjection({objectives: []}, [], {goals: []});
  assert.deepEqual(result.missingRequirementIds, []);
  assert.deepEqual(result.missingObjectiveIds, []);
  assert.deepEqual(result.representedRequirementIds, []);
});
