import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { it } from 'vitest';
import { enrichReviewNavigation, getReviewNavigationDiagnostics, validReviewNavigation, type ReviewNavigationOptions, type ReviewNavigationRequest } from './review-intent';
import type { PullRequestInput, VerificationReportV2 } from './types';

const head = 'a'.repeat(40), base = 'b'.repeat(40);
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const patch = '@@ -10,3 +10,2 @@\n function chooseRoute() {\n-  return legacyRoute();\n }';
const input = (extra: Partial<PullRequestInput> = {}): PullRequestInput => ({
  url: 'https://github.com/example/project/pull/1', title: '',
  description: 'Remove obsolete routing without altering ordinary routing.', taskText: '',
  repositoryPrivate: false,
  sourceProvenance: {version: 1, origin: 'github_snapshot', headSha: head, baseSha: base},
  changedFiles: [{path: 'src/router.ts', status: 'modified', additions: 0, deletions: 1, patch}],
  checks: [], logs: [], ...extra
} as PullRequestInput);
// This tests navigation's public entry point, not report generation or report storage.
const report = () => ({verificationContract: {state: 'absent'}, reviewCandidates: {}} as unknown as VerificationReportV2);
async function run(value: PullRequestInput, ranking?: (packet: ReviewNavigationRequest) => unknown, extra: Partial<ReviewNavigationOptions> = {}) {
  const packets: ReviewNavigationRequest[] = [];
  const result = await enrichReviewNavigation(value, report(), {
    model: 'offline-fixture',
    provider: async packet => {
      packets.push(structuredClone(packet));
      if (packet.stage === 'intent') return {goals: [{summary: 'Review routing changes', emphasis: 'primary', sourceRefs: packet.sources.flatMap(s => s.spans.map(p => p.id)), facets: [], openQuestions: []}], unprocessed: []};
      return ranking?.(packet) ?? {rankings: [], readPaths: []};
    }, ...extra
  });
  const navigation = result.reviewCandidates!.navigation!;
  assert.equal(validReviewNavigation(navigation), true);
  return {navigation, packets};
}
const choose = (packet: ReviewNavigationRequest, fields: Partial<{whyInspect: string; reviewQuestion: string; uncertainty: string}> = {}) => {
  const artifact = packet.artifacts.find(a => a.side === 'head')!;
  return {rankings: [{goalId: packet.goals[0]!.id, firstInspection: artifact.id,
    candidates: [{artifactId: artifact.id, relevance: 'relevant', whyInspect: 'Inspect routing decisions.', reviewQuestion: 'Could routing errors be hidden?', uncertainty: '', ...fields}], uncertainty: []}], readPaths: []};
};

it('retains deleted lines of modified files with exact base and head coordinates', async () => {
  const {packets} = await run(input());
  const artifacts = packets.find(p => p.stage === 'ranking')!.artifacts;
  const old = artifacts.find(a => a.side === 'base');
  const current = artifacts.find(a => a.side === 'head');
  assert.ok(old, 'deleted code must be available, not only the surviving head context');
  assert.ok(current);
  assert.deepEqual([old.path, old.revision, old.startLine, old.endLine], ['src/router.ts', base, 10, 12]);
  assert.equal(old.content, 'function chooseRoute() {\n  return legacyRoute();\n}');
  assert.equal(old.hash, hash(old.content));
  assert.deepEqual([current.revision, current.startLine, current.endLine], [head, 10, 11]);
  assert.equal(current.content, 'function chooseRoute() {\n}');
  assert.notEqual(old.id, current.id);
});
it('binds deleted code in renamed files to the recorded previous path', async () => {
  const value = input(); value.changedFiles[0] = {...value.changedFiles[0]!, status: 'renamed', previousPath: 'src/old-router.ts'};
  const {packets} = await run(value);
  const artifacts = packets.find(p => p.stage === 'ranking')!.artifacts;
  assert.equal(artifacts.find(a => a.side === 'base')?.path, 'src/old-router.ts');
  assert.equal(artifacts.find(a => a.side === 'head')?.path, 'src/router.ts');
});
it('does not fabricate a base path when rename metadata is missing', async () => {
  const value = input(); value.changedFiles[0] = {...value.changedFiles[0]!, status: 'renamed'};
  const {packets, navigation} = await run(value);
  assert.equal(packets.find(p => p.stage === 'ranking')!.artifacts.some(a => a.side === 'base'), false);
  assert.ok(navigation.limitations.includes('invalid_reference'));
});
it('does not add redundant base context for an additions-only hunk', async () => {
  const value = input(); value.changedFiles[0]!.patch = '@@ -10,2 +10,3 @@\n function chooseRoute() {\n+  return nextRoute();\n }';
  const {packets} = await run(value);
  assert.equal(packets.find(p => p.stage === 'ranking')!.artifacts.some(a => a.side === 'base'), false);
});
it('continues to represent a wholly removed file on the base side only', async () => {
  const value = input(); value.changedFiles[0] = {...value.changedFiles[0]!, status: 'removed', patch: '@@ -1,2 +0,0 @@\n-export const route = 1;\n-export const active = true;'};
  const {packets} = await run(value);
  const artifacts = packets.find(p => p.stage === 'ranking')!.artifacts;
  assert.equal(artifacts.length, 1); assert.equal(artifacts[0]!.side, 'base'); assert.equal(artifacts[0]!.revision, base);
});
it('omits an unsafe explanation field without splicing replacement words into it', async () => {
  const value = input(); value.changedFiles[0]!.patch = '@@ -1,3 +1,3 @@\n try:\n     action()\n except Exception:';
  const {navigation} = await run(value, packet => choose(packet, {uncertainty: 'The implementation uses a broad except Exception: pass, which may hide errors.'}));
  const goal = navigation.goals[0]!;
  assert.ok(goal.firstInspection);
  assert.equal(goal.candidates[0]!.uncertainty, '');
  assert.equal(goal.candidates[0]!.reviewQuestion, 'Could routing errors be hidden?');
  assert.equal(goal.candidates[0]!.whyInspect, 'Inspect routing decisions.');
  assert.ok(navigation.limitations.includes('unsafe_summary_omitted'));
  assert.ok(navigation.failures?.some(f => f.reason === 'unsafe_summary'));
  assert.equal(JSON.stringify(navigation).includes('the referenced code'), false);
  assert.equal(JSON.stringify(navigation).includes('except Exception:'), false);
});
it('keeps normal prose, masks credentials, and does not persist raw snippets', async () => {
  const {navigation} = await run(input(), packet => choose(packet, {whyInspect: 'Inspect routing decisions.', uncertainty: 'token="synthetic-credential-value"'}));
  assert.equal(navigation.goals[0]!.candidates[0]!.whyInspect, 'Inspect routing decisions.');
  assert.equal(JSON.stringify(navigation).includes('synthetic-credential-value'), false);
  assert.equal(navigation.artifacts.some(a => Object.hasOwn(a, 'content')), false);
  assert.equal(JSON.stringify(getReviewNavigationDiagnostics(navigation)).includes('legacyRoute()'), false);
});
it('still refuses private-repository model calls', async () => {
  const {packets, navigation} = await run(input({repositoryPrivate: true}));
  assert.equal(packets.length, 0); assert.equal(navigation.goals.length, 0);
  assert.ok(navigation.limitations.includes('private_or_unknown_access'));
});
it('does not read code or call the model when a public repository becomes private before navigation', async () => {
  let currentReads = 0, codeReads = 0;
  const {packets,navigation} = await run(input(), packet => choose(packet), {
    readRepositoryPrivate: async () => true,
    readCurrentInput: async () => { currentReads++; return input({repositoryPrivate:true}); },
    readArtifacts: async () => { codeReads++; return []; }
  });
  assert.equal(currentReads, 0);
  assert.equal(codeReads, 0);
  assert.equal(packets.length, 0);
  assert.ok(navigation.limitations.includes('freshness_access_changed'));
});
it('blocks another model call and code read when a public repository becomes private after intent', async () => {
  let privateNow = false, codeReads = 0;
  const packets: ReviewNavigationRequest[] = [];
  const result = await enrichReviewNavigation(input(), report(), {
    model: 'offline-fixture',
    readRepositoryPrivate: async () => privateNow,
    readCurrentInput: async () => input(),
    readArtifacts: async () => { codeReads++; return []; },
    provider: async packet => {
      packets.push(packet);
      if (packet.stage === 'intent') {
        privateNow = true;
        return {goals: [{summary:'Review routing changes',emphasis:'primary',sourceRefs:packet.sources.flatMap(s=>s.spans.map(p=>p.id)),facets:[],openQuestions:[]}],unprocessed:[]};
      }
      return choose(packet);
    }
  });
  assert.deepEqual(packets.map(packet=>packet.stage), ['intent']);
  assert.equal(codeReads, 0);
  assert.equal(result.reviewCandidates?.navigation?.goals[0]?.firstInspection, null);
});
it('does not fetch a requested code path after visibility changes during ranking', async () => {
  let privateNow = false, codeReads = 0;
  const value = input();
  const {navigation,packets} = await run(value, packet => {
    privateNow = true;
    return {...choose(packet),readPaths:['src/router.ts']};
  }, {
    readRepositoryPrivate: async () => privateNow,
    readCurrentInput: async () => value,
    readArtifacts: async () => { codeReads++; return []; }
  });
  assert.deepEqual(packets.map(packet=>packet.stage), ['intent','ranking']);
  assert.equal(codeReads, 0);
  assert.ok(navigation.limitations.includes('freshness_access_changed'));
});
it('uses the same exact-head goal and first-location contract after private authorization', async () => {
  const value = input({repositoryPrivate: true});
  const {packets, navigation} = await run(value, packet => choose(packet), {authorizePrivate: async () => true, readRepositoryPrivate: async () => true, readCurrentInput: async () => value} as Partial<ReviewNavigationOptions>);
  assert.deepEqual(packets.map(packet => packet.stage), ['intent', 'ranking']);
  assert.equal(navigation.goals[0]?.firstInspection, navigation.goals[0]?.candidates[0]?.artifactId);
  assert.equal(navigation.artifacts.find(artifact => artifact.id === navigation.goals[0]?.firstInspection)?.revision, head);
});
it('keeps public navigation available while metadata confirms the repository is public', async () => {
  const value = input();
  const {packets,navigation} = await run(value, packet => choose(packet), {readRepositoryPrivate: async () => false, readCurrentInput: async () => value});
  assert.deepEqual(packets.map(packet=>packet.stage), ['intent','ranking']);
  assert.ok(navigation.goals[0]?.firstInspection);
});
it('drops private locations when access is revoked before final freshness validation', async () => {
  const value = input({repositoryPrivate: true}); let checks = 0;
  const {navigation} = await run(value, packet => choose(packet), {authorizePrivate: async () => ++checks < 4, readCurrentInput: async () => value} as Partial<ReviewNavigationOptions>);
  assert.equal(navigation.goals[0]?.firstInspection, null);
  assert.deepEqual(navigation.goals[0]?.candidates, []);
  assert.ok(navigation.limitations.includes('freshness_access_changed'));
});
it('drops private locations when the head changes and retains only snippet metadata', async () => {
  let reads = 0; const value = input({repositoryPrivate: true});
  const {navigation} = await run(value, packet => choose(packet), {
    authorizePrivate: async () => true,
    readCurrentInput: async () => ++reads === 1 ? value : {...value, sourceProvenance: {...value.sourceProvenance!, headSha: 'c'.repeat(40)}}
  });
  assert.equal(navigation.goals[0]?.firstInspection, null);
  assert.deepEqual(navigation.goals[0]?.candidates, []);
  assert.ok(navigation.limitations.includes('stale_snapshot'));
  assert.equal(JSON.stringify(navigation).includes('legacyRoute()'), false);
});
it('still removes recommendations if the source revision changes before return', async () => {
  let reads = 0; const value = input();
  const {navigation} = await run(value, packet => choose(packet), {readCurrentInput: async () => ++reads === 1 ? value : {...value, sourceProvenance: {...value.sourceProvenance!, headSha: 'c'.repeat(40)}}});
  assert.equal(navigation.goals[0]!.firstInspection, null);
  assert.deepEqual(navigation.goals[0]!.candidates, []);
  assert.ok(navigation.limitations.includes('stale_snapshot'));
});
it('does not invent a base revision when it was not collected', async () => {
  const value = input(); value.sourceProvenance = {...value.sourceProvenance!, baseSha: undefined};
  const {navigation, packets} = await run(value);
  assert.equal(packets.find(p => p.stage === 'ranking')!.artifacts.some(a => a.side === 'base'), false);
  assert.ok(navigation.limitations.includes('invalid_reference'));
});
it('keeps the shared packet within count and byte limits after adding deletion context', async () => {
  const value = input(); value.changedFiles = Array.from({length: 12}, (_,i) => ({...value.changedFiles[0]!, path: `src/router-${i}.ts`}));
  const {navigation, packets} = await run(value);
  const packet = packets.find(p => p.stage === 'ranking')!;
  assert.ok(packet.artifacts.length <= 16);
  assert.ok(Buffer.byteLength(JSON.stringify(packet.artifacts)) <= 48000);
  assert.ok(navigation.limitations.includes('retrieval_budget_exceeded'));
});
