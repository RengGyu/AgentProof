import ts from "typescript";
import path from "node:path";
import { PaidBudgetError } from "./paid-budget";
import { redactSecretsPreservingLines } from './redact';
import { purposeHash, purposeContentHash, isPurposeReadRequest, type PurposeEvidence, type PurposeReadRequest } from './purpose-contract';
import type { PullRequestInput } from './types';
export type PurposeSourceReader = (request: PurposeReadRequest & {
    revision: string;
}, signal: AbortSignal) => Promise<{
    path: string;
    revision: string;
    content: string;
    complete: boolean;
    startLine?: number;
    rawWindowHash?: string;
    bytesRead?: number;
} | null>;
/** Callback is server-owned; never accepts a model URL. All content is request-local. */
export function createPurposeCollector(input: PullRequestInput, reader?: PurposeSourceReader, signal: AbortSignal = AbortSignal.timeout(180000)) {
    const evidence: PurposeEvidence[] = [], limitations: string[] = [];
    const inventory = new Set(input.changedFiles.flatMap(f => [f.path, ...(f.previousPath ? [f.previousPath] : [])]).slice(0,200));
    const admit=(locator:string)=>{if(!safePurposePath(locator)||inventory.has(locator))return;if(inventory.size<200)inventory.add(locator);else if(!limitations.includes("locator_inventory_budget"))limitations.push("locator_inventory_budget");};
    for(const blob of input.verificationCriterionEvidenceV2?.artifactBlobs??[])if(blob.headSha===input.sourceProvenance?.headSha)admit(blob.path);
    const stated=[input.taskText,input.title,input.description].map(redactSecretsPreservingLines).join('\n');
    for(const match of stated.matchAll(/(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:[cm]?[jt]sx?|py|go|rs|md|json|ya?ml)\b/g))admit(match[0]);
    const cache = new Map<string, Promise<PurposeEvidence | null>>();
    let attempts = 0, bytes = 0;
    const limit = (reason: string) => { if (!limitations.includes(reason))
        limitations.push(reason); return null; };
    async function read(req: PurposeReadRequest): Promise<PurposeEvidence | null> {
        if (!isPurposeReadRequest(req) || !safePurposePath(req.path) || !inventory.has(req.path) || req.endLine < req.startLine || req.endLine - req.startLine >= 80)
            return limit('read_rejected');
        const revision = req.side === 'head' ? input.sourceProvenance?.headSha : input.sourceProvenance?.baseSha;
        if (!revision || !/^[a-f0-9]{40}$/.test(revision) || !reader)
            return limit('source_unavailable');
        const key = purposeHash([req.path, revision, req.startLine, req.endLine]);
        if (cache.has(key)) {
            const e = await cache.get(key)!;
            if (e && !e.clauseIds.includes(req.clauseId))
                e.clauseIds.push(req.clauseId);
            return e;
        }
        if (attempts >= 8)
            return limit('read_budget');
        attempts++;
        const work = (async () => {
            signal.throwIfAborted();
            const blob = await reader({ ...req, revision }, AbortSignal.any([signal, AbortSignal.timeout(8000)]));
            signal.throwIfAborted();
            if (!blob || blob.path !== req.path || blob.revision !== revision || !blob.complete)
                return limit('source_binding_unavailable');
            const size = blob.bytesRead ?? Buffer.byteLength(blob.content);
            bytes += size;
            if (size > (blob.startLine === undefined ? 256 * 1024 : 2 * 1024 * 1024) || bytes > 4 * 1024 * 1024)
                return limit('source_budget');
            const raw = blob.content.replace(/\r\n?/g, '\n'), rawLines = raw.split('\n');
            const offset = blob.startLine ?? 1;
            if (offset > req.startLine || req.endLine > rawLines.length + offset - 1)
                return limit('interval_unavailable');
            // Redact complete bounded blob first, so a secret crossing the selected boundary cannot escape.
            const content = redactSecretsPreservingLines(raw).split('\n').slice(req.startLine - offset, req.endLine - offset + 1).join('\n');
            if (Buffer.byteLength(content) > 8000)
                return limit('artifact_budget');
            const rawHash = blob.rawWindowHash ?? purposeContentHash(rawLines.slice(req.startLine - offset, req.endLine - offset + 1).join('\n')), contentHash = purposeContentHash(content);
            const e: PurposeEvidence = { id: `pe_${purposeHash([input.url, req.path, revision, req.side, req.startLine, req.endLine, rawHash, contentHash]).slice(0, 24)}`, repositoryHash: purposeHash(input.url), path: req.path, revision, side: req.side, startLine: req.startLine, endLine: req.endLine, rawHash, contentHash, content, completeness: 'complete_interval', collection: 'exact_blob', clauseIds: [req.clauseId] };
            // Imports are locators only; resolve no dynamic imports and execute nothing.
            if(/\.[cm]?[jt]sx?$/.test(req.path))for(const ref of ts.preProcessFile(content,true,false).importedFiles){
                if(!ref.fileName.startsWith('.'))continue;
                const target=path.posix.normalize(path.posix.join(path.posix.dirname(req.path),ref.fileName));
                if(!safePurposePath(target))continue;
                if(/\.[cm]?[jt]sx?$/.test(target))admit(target);
                else for(const suffix of ['.ts','.tsx','.js','.jsx','/index.ts'])admit(target+suffix);
            }
            evidence.push(e);
            return e;
        })().catch(error => { if (signal.aborted || error instanceof PaidBudgetError)
            throw error; return limit('source_read_failed'); });
        cache.set(key, work);
        return work;
    }
    return { read, evidence, limitations, paths:()=>[...inventory].slice(0,200), metrics: () => ({ attempts, bytes }), search(query: string, paths: string[]) { if (!query || query.length > 120 || paths.length > 8)
            return []; return evidence.filter(e => paths.includes(e.path) && e.content.includes(query)).slice(0, 16).map(e => ({ path: e.path, side: e.side, startLine: e.startLine, endLine: e.endLine })); } };
}
export function safePurposePath(path: string) { return path.length <= 300 && !path.startsWith('/') && !path.includes('\\') && !path.split('/').some(p => !p || p === '.' || p === '..') && !/[\u0000-\u001f]/.test(path); }
/** Exact array serialization budget, no byte slicing or important-evidence replacement. */
export function purposeBatches(evidence: PurposeEvidence[]) { const batches: PurposeEvidence[][] = []; let current: PurposeEvidence[] = []; for (const e of evidence) {
    const next = [...current, e];
    if (next.length > 16 || Buffer.byteLength(JSON.stringify(next)) > 48000) {
        if (current.length)
            batches.push(current);
        current = [];
    }
    if (Buffer.byteLength(JSON.stringify([e])) > 48000)
        throw new Error('purpose_artifact_budget');
    current.push(e);
} if (current.length)
    batches.push(current); return batches; }
