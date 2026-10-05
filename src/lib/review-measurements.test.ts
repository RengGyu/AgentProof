import { expect, it } from 'vitest';
import * as diagnostics from './review-navigation-diagnostics';
import { enrichReviewNavigation } from './review-intent';
import { extractReviewSnippets } from './review-snippets';
import { generateVerificationReportV2FromInput } from './verifier';
import { buildPrEvidenceReview } from './pr-evidence-review';
import type { PullRequestInput } from './types';

const head = 'a'.repeat(40), base = 'b'.repeat(40);
const input = (): PullRequestInput => ({
  url: 'https://github.com/example/project/pull/1', title: 'Status update', description: 'Preserve status behavior.', taskText: '', repositoryPrivate: false,
  changedFiles: [{ path: 'src/status.ts', status: 'modified', patch: '@@ -1 +1 @@\n+status();' }], checks: [], logs: [],
  sourceProvenance: { version: 1, origin: 'github_snapshot', headSha: head, baseSha: base, evidenceCapturedAt: '2026-10-03T00:00:00Z', inputFingerprint: { version: 1, algorithm: 'sha256', value: 'f'.repeat(64), coverage: 'github_metadata' } }
});

it('represents overlapping children with explicit parents rather than an additive total', async () => {
  let now = 0;
  const trace = diagnostics.createReviewMeasurements(() => now);
  const root = trace.start('request');
  const context = { trace, parentId: root };
  let finish!: () => void;
  const first = diagnostics.measureReviewAsync(context, 'artifact_read', () => new Promise<void>(resolve => { finish = resolve; }));
  now = 5;
  await diagnostics.measureReviewAsync(context, 'freshness_read', async () => { now = 12; });
  now = 20; finish(); await first; trace.finish(root);
  expect(trace.snapshot().spans).toEqual([
    expect.objectContaining({ phase: 'request', startMs: 0, endMs: 20, durationMs: 20, parentId: null }),
    expect.objectContaining({ phase: 'artifact_read', startMs: 0, endMs: 20, durationMs: 20, parentId: root }),
    expect.objectContaining({ phase: 'freshness_read', startMs: 5, endMs: 12, durationMs: 7, parentId: root })
  ]);
  expect(trace.snapshot().timingMeaning).toBe('inclusive_intervals_do_not_sum');
});

it('connects packet, model choice, local rejection and display projection without changing the report', async () => {
  const value = input(), report = generateVerificationReportV2FromInput(value);
  const trace = diagnostics.createReviewMeasurements();
  const context = { trace, parentId: trace.start('report') };
  const packets: any[] = [];
  const provider = async (packet: any) => {
    packets.push(structuredClone(packet));
    return packet.stage === 'intent'
      ? { goals: [{ summary: 'Preserve status behavior', emphasis: 'primary', sourceRefs: packet.sources.flatMap((s: any) => s.spans.map((p: any) => p.id)), facets: [], openQuestions: [] }], unprocessed: [] }
      : { rankings: [{ goalId: packet.goals[0].id, firstInspection: packet.artifacts[0].id, candidates: [
        { artifactId: packet.artifacts[0].id, relevance: 'relevant', whyInspect: 'Inspect the status change.', reviewQuestion: 'Is status preserved?', uncertainty: '' },
        { artifactId: 'PRIVATE_UNKNOWN_PROVIDER_REFERENCE', relevance: 'relevant' }
      ], uncertainty: [] }], readPaths: [] };
  };
  const observed = await enrichReviewNavigation(value, report, { model: 'offline-fixture', provider, measurements: context });
  const unmeasured = await enrichReviewNavigation(value, report, { model: 'offline-fixture', provider });
  expect(observed).toEqual(unmeasured);
  const view = buildPrEvidenceReview(observed, { onNavigationProjection: event => diagnostics.recordReviewEvidence(context, 'projection', event) });
  const id = view.objectives[0].firstInspection!.evidenceId;
  const events = trace.snapshot().evidence;
  const packetHash = events.find(e => e.stage === 'packet' && e.artifactId === id)!.packetHash;
  const choice = events.find(e => e.stage === 'model_choice' && e.artifactId === id)!;
  expect(choice.packetHash).toBe(packetHash);
  expect(trace.snapshot().spans.find(s => s.id === choice.callSpanId)?.phase).toBe('model');
  for (const stage of ['artifact', 'packet', 'model_choice', 'local_validation', 'projection']) {
    expect(events.some(e => e.stage === stage && e.artifactId === id), stage).toBe(true);
  }
  expect(events.some(e => e.stage === 'local_validation' && e.reason === 'unknown_artifact_ref')).toBe(true);
  expect(JSON.stringify(trace.snapshot())).not.toMatch(/status\(\)|Preserve status behavior|src\/status|PRIVATE_UNKNOWN_PROVIDER_REFERENCE/);
  expect(packets[0]).not.toHaveProperty('measurements');
  const refused: diagnostics.ReviewEvidenceFields[] = [];
  const binding = { headSha: base, onNavigationProjection: (event:diagnostics.ReviewEvidenceFields) => refused.push(event) };
  expect(buildPrEvidenceReview(observed, binding)).toEqual(buildPrEvidenceReview(observed, { headSha: base }));
  expect(refused.some(e => e.artifactId === id && e.reason === 'binding_mismatch')).toBe(true);
  const missing = structuredClone(observed); missing.reviewCandidates!.navigation!.artifacts = [];
  refused.length = 0;
  const missingView = buildPrEvidenceReview(missing, { onNavigationProjection: event => refused.push(event) });
  expect(missingView.objectives[0].firstInspection).toBeUndefined();
  expect(refused.some(e => e.reason === 'missing_artifact' && e.artifactId === id)).toBe(true);
  expect(buildPrEvidenceReview(observed, { onNavigationProjection: () => { throw Error('fixture sink failed'); } })).toEqual(view);
});

it('connects overlapping artifact lineage to the canonical model and display ID', async () => {
  const value=input();
  value.changedFiles[0].patch='@@ -1,2 +1,2 @@\n+export function status() {\n+  return "status";';
  value.verificationCriterionEvidenceV2={artifactBlobs:[{path:'src/status.ts',headSha:head,content:'export function status() {\n  return "status";\n}'}]};
  const trace=diagnostics.createReviewMeasurements();
  const observed=await enrichReviewNavigation(value,generateVerificationReportV2FromInput(value),{model:'offline',measurements:{trace},provider:async packet=>packet.stage==='intent'
    ? {goals:[{summary:'Preserve status behavior',emphasis:'primary',sourceRefs:packet.sources.flatMap(s=>s.spans.map(p=>p.id)),facets:[],openQuestions:[]}],unprocessed:[]}
    : {rankings:[{goalId:packet.goals[0].id,firstInspection:packet.artifacts[0].id,candidates:[{artifactId:packet.artifacts[0].id,relevance:'possible',whyInspect:'Inspect behavior.',reviewQuestion:'Is the state preserved?',uncertainty:''}],uncertainty:[]}],readPaths:[]}
  });
  const view=buildPrEvidenceReview(observed,{onNavigationProjection:e=>diagnostics.recordReviewEvidence({trace},'projection',e)});
  const merged=trace.snapshot().evidence.find(e=>e.stage==='artifact'&&e.reason==='merged')!;
  expect(merged.parentIds).toHaveLength(2);
  expect(merged.artifactId).toBe(view.objectives[0].firstInspection!.evidenceId);
  expect(trace.snapshot().evidence.some(e=>e.stage==='packet'&&e.artifactId===merged.artifactId)).toBe(true);
});

it('records unread, invalid and file-budget excluded candidates without another read or a changed result', async () => {
  const value = input();
  value.changedFiles = Array.from({ length: 10 }, (_, n) => ({ path: `src/status${n}.py`, status: 'modified' as const, patch: '' }));
  const report = generateVerificationReportV2FromInput(value), trace = diagnostics.createReviewMeasurements();
  const provider = async (packet: any) => packet.stage === 'intent'
    ? { goals: [{ summary: 'Preserve status behavior', emphasis: 'primary', sourceRefs: packet.sources.flatMap((s: any) => s.spans.map((p: any) => p.id)), facets: [], openQuestions: [] }], unprocessed: [] }
    : { rankings: packet.goals.map((g: any) => ({ goalId: g.id, firstInspection: null, candidates: [], uncertainty: [] })), readPaths: [] };
  const reads: string[][] = [];
  const readArtifacts = async (paths: string[]) => { reads.push(paths); return [
    { path: paths[0], headSha: head, content: 'def status():\n    return "status"' },
    { path: paths[1], headSha: base, content: 'PRIVATE_STALE_CODE' }
  ]; };
  const observed = await enrichReviewNavigation(value, report, { model: 'offline', provider, readArtifacts, measurements: { trace } });
  expect(observed).toEqual(await enrichReviewNavigation(value, report, { model: 'offline', provider, readArtifacts }));
  expect(reads).toHaveLength(2);
  expect(reads[0]).toHaveLength(8);
  expect(reads[0]).toEqual(reads[1]);
  const events = trace.snapshot().evidence;
  for (const reason of ['file_budget_exceeded','requested_path_unread','invalid_reference']) expect(events.some(e => e.reason === reason)).toBe(true);
  const fileId = diagnostics.reviewFileId(reads[0][0], head);
  for (const stage of ['read_candidate','read','snippet_candidate','snippet','artifact']) expect(events.some(e => e.fileId === fileId && e.stage === stage), stage).toBe(true);
  expect(JSON.stringify(trace.snapshot())).not.toMatch(/PRIVATE_STALE_CODE|src\/status/);
});

it('records packet exclusion rather than claiming an omitted artifact reached the model', async () => {
  const value = input();
  value.changedFiles = Array.from({ length: 20 }, (_, n) => ({ path: `src/status${n}.ts`, status: 'modified' as const, patch: '@@ -1 +1 @@\n+status();' }));
  const trace = diagnostics.createReviewMeasurements();
  let packetIds: string[] = [];
  await enrichReviewNavigation(value, generateVerificationReportV2FromInput(value), { model: 'offline', measurements: { trace }, provider: async packet => {
    if (packet.stage === 'intent') return { goals: [{ summary: 'Preserve status behavior', emphasis: 'primary', sourceRefs: packet.sources.flatMap(s => s.spans.map(p => p.id)), facets: [], openQuestions: [] }], unprocessed: [] };
    packetIds = packet.artifacts.map(a => a.id);
    return { rankings: [], readPaths: [] };
  } });
  expect(packetIds).toHaveLength(16);
  const excluded = trace.snapshot().evidence.filter(e => e.reason === 'packet_budget_exceeded');
  expect(excluded.length).toBeGreaterThan(0);
  expect(excluded.every(e => !packetIds.includes(e.artifactId!))).toBe(true);
});

it('records failed extra reads without exposing text', async () => {
  const value = input(); value.changedFiles[0].patch = '';
  const trace = diagnostics.createReviewMeasurements();
  await enrichReviewNavigation(value, generateVerificationReportV2FromInput(value), { model: 'offline', measurements: { trace }, readArtifacts: async () => { throw Error('PRIVATE_NETWORK_ERROR'); }, provider: async packet => packet.stage === 'intent'
    ? { goals: [{ summary: 'Preserve status behavior', emphasis: 'primary', sourceRefs: packet.sources.flatMap(s => s.spans.map(p => p.id)), facets: [], openQuestions: [] }], unprocessed: [] }
    : { rankings: [], readPaths: [] }
  });
  expect(trace.snapshot().spans.find(s => s.phase === 'artifact_read')?.outcome).toBe('error');
  expect(trace.snapshot().evidence.some(e => e.reason === 'unavailable')).toBe(true);
  expect(JSON.stringify(trace.snapshot())).not.toContain('PRIVATE_NETWORK_ERROR');
});

it('records snippet selection and budget exclusions while preserving IDs and selection order', async () => {
  const files = Array.from({ length: 20 }, (_, i) => ({ path: `src/status${i}.py`, headSha: head, content: `def status${i}():\n    return "status"` }));
  const goals = [{ id: 'goal_1', terms: ['status'], anchors: [] }];
  const trace = diagnostics.createReviewMeasurements(), context = { trace };
  const measured = await extractReviewSnippets(files, goals, context);
  expect(measured).toEqual(await extractReviewSnippets(files, goals));
  const events = trace.snapshot().evidence;
  expect(events.some(e => e.stage === 'snippet_candidate')).toBe(true);
  expect(events.filter(e => e.stage === 'snippet').length).toBe(measured.snippets.length);
  expect(events.some(e => e.reason === 'snippet_budget_exceeded')).toBe(true);
  expect(JSON.stringify(events)).not.toMatch(/def status|src\/status/);
});

it('bounds diagnostics and rejects arbitrary metadata instead of retaining secret-shaped fields', () => {
  const trace = diagnostics.createReviewMeasurements();
  for (let i = 0; i < 3000; i++) diagnostics.recordReviewEvidence({ trace }, 'packet', {
    artifactId: 'PRIVATE_SECRET', path: 'PRIVATE_PATH', content: 'PRIVATE_CODE', reason: 'PRIVATE_REASON', count: 1
  } as any);
  const snapshot = trace.snapshot();
  expect(snapshot.evidence.length).toBeLessThanOrEqual(1024);
  expect(snapshot.droppedEvidence).toBeGreaterThan(0);
  expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThan(300_000);
  expect(JSON.stringify(snapshot)).not.toContain('PRIVATE');
  for(let n=0;n<300;n++)trace.finish(trace.start('model'));
  expect(trace.snapshot().spans).toHaveLength(256);
  expect(trace.snapshot().droppedSpans).toBe(44);
});
