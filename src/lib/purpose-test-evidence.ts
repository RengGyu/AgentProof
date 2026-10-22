import { resolveJsTsStaticTestRelationV1 } from "./js-ts-static-test-relation";
import { redactSecretsPreservingLines } from "./redact";
import { parseAgentProofNormalizedTestResultV1 } from './normalized-test-result-v1';
import type { PullRequestInput } from './types';
import { purposeHash } from './purpose-contract';
/** No model/PR JSON/CI conclusion is accepted as checked execution authority. */
export function collectPurposeTestEvidence(input: PullRequestInput, manifest?: {
    json: string;
    subjectDigest: string;
}) {
    const parsed = manifest ? parseAgentProofNormalizedTestResultV1(manifest.json, { expectedSubjectDigest: manifest.subjectDigest }) : null;
    const completeBlobs = (input.verificationCriterionEvidenceV2?.artifactBlobs ?? []).filter(b => b.headSha === input.sourceProvenance?.headSha && Buffer.byteLength(b.content) <= 262144 && /\.[cm]?[jt]sx?$/.test(b.path)).slice(0, 8).map(b => ({ path: b.path, source: redactSecretsPreservingLines(b.content) }));
    const staticRelations = completeBlobs.filter(b => /(?:test|spec)\.[cm]?[jt]sx?$/.test(b.path)).map(test => { const r = resolveJsTsStaticTestRelationV1({ testPath: test.path, testSource: test.source, modules: completeBlobs.filter(b => b !== test) }); return { testPath: test.path, importResolved: !!r.importRelation, directAssertionResolved: !!r.assertionRelation, level: 'static_relation_only' as const }; });
    return { staticRelations, suites: (input.executionSuites ?? []).slice(0, 100).map(s => ({ runner: s.runner, status: s.status, scope: s.scope, headMatches: s.headSha === input.sourceProvenance?.headSha, level: 'reported' as const })), checks: input.checks.slice(0, 100).map(check => ({ id: `pt_${purposeHash([check.name, check.workflowExecutionIdentity, check.status]).slice(0, 24)}`, status: check.status, level: 'reported' as const, subjectMatches: false /* workflow head SHA alone cannot prove checkout subject */ })), normalized: parsed?.valid ? { level: 'reported' as const, count: parsed.manifest.tests.length, passed: parsed.manifest.tests.filter(t => t.outcome === 'passed').length, failed: parsed.manifest.tests.filter(t => t.outcome === 'failed').length, skipped: parsed.manifest.tests.filter(t => t.outcome === 'skipped').length } : null, limitations: ['case_execution_not_verified', ...(manifest && !parsed?.valid ? ['normalized_manifest_unavailable'] : [])] };
}
