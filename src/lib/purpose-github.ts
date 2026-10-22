import {PURPOSE_DIFF_LIMITATIONS} from './purpose-summary';
import { redactSecretsPreservingLines } from './redact';
import type { PullRequestInput } from './types';
import { purposeHash, purposeContentHash } from './purpose-contract';
import { safePurposePath, type PurposeSourceReader } from './purpose-evidence';
export interface PurposeDiffHunk {
    id: string;
    path: string;
    previousPath: string;
    before: {startLine: number; endLine: number} | null;
    after: {startLine: number; endLine: number} | null;
    patch: string;
    complete: boolean;
}
interface DiffIndex {
    comparison?: {baseRefSha: string; diffBaseSha: string; headSha: string};
    locators: {
        path: string;
        side: 'head' | 'base';
        startLine: number;
        endLine: number;
    }[];
    limitations: string[];
    hunks: PurposeDiffHunk[];
    files: {path: string; previousPath: string; state: 'provided' | 'partial' | 'unavailable'}[];
}
const indexes = new WeakMap<PullRequestInput, DiffIndex>();
/** Opt-in and request-local. Legacy ChangedFile.patch stays byte-for-byte unchanged. */
export function capturePurposeDiffIndex(input: PullRequestInput, files: readonly {
    filename: string;
    previous_filename?: string;
    patch?: string;
}[], comparison?: {baseRefSha: string; diffBaseSha: string; headSha: string}) {
    if (comparison && Object.values(comparison).some(sha => !/^[a-f0-9]{40}$/.test(sha))) throw new Error('purpose_diff_comparison_invalid');
    const index: DiffIndex = { locators: [], limitations: [], hunks: [], files: [], ...(comparison ? {comparison} : {}) };
    let bytes = 0;
    for (const file of files) {
        if (!file.patch) {
            index.limitations.push('patch_unavailable');
            index.files.push({path: file.filename, previousPath: file.previous_filename ?? file.filename, state: 'unavailable'});
            continue;
        }
        const rawBytes = Buffer.byteLength(file.patch);
        const allowed = Math.min(32768, 262144 - bytes);
        if (allowed <= 0) {
            index.limitations.push('patch_index_budget');
            index.files.push({path: file.filename, previousPath: file.previous_filename ?? file.filename, state: 'partial'});
            continue;
        }
        const raw = Buffer.from(file.patch).subarray(0, allowed).toString('utf8');
        bytes += Math.min(rawBytes, allowed);
        if (rawBytes > allowed)
            index.limitations.push('patch_index_budget');
        index.files.push({path: file.filename, previousPath: file.previous_filename ?? file.filename, state: rawBytes > allowed ? 'partial' : 'provided'});
        // These are navigation records, never source evidence. Retain one redacted patch per hunk.
        const starts = [...raw.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/gm)];
        for (let i = 0; i < starts.length; i++) {
            const m = starts[i], beforeCount = Number(m[2] ?? 1), afterCount = Number(m[4] ?? 1);
            if (![Number(m[1]), Number(m[3]), beforeCount, afterCount].every(Number.isSafeInteger) || beforeCount < 0 || afterCount < 0 || (beforeCount && Number(m[1]) < 1) || (afterCount && Number(m[3]) < 1) || Number(m[1]) + beforeCount > 1000001 || Number(m[3]) + afterCount > 1000001) {
                index.limitations.push(PURPOSE_DIFF_LIMITATIONS.hunkPartial); index.files.at(-1)!.state = 'partial'; continue;
            }
            const patch = redactSecretsPreservingLines(raw.slice(m.index, starts[i + 1]?.index ?? raw.length)).replace(/\n$/, '');
            const lines = patch.split('\n').slice(1);
            const beforeLines = lines.filter(l => l.startsWith(' ') || l.startsWith('-')).length;
            const afterLines = lines.filter(l => l.startsWith(' ') || l.startsWith('+')).length;
            const complete = beforeLines === beforeCount && afterLines === afterCount;
            if (!complete) { index.limitations.push(PURPOSE_DIFF_LIMITATIONS.hunkPartial); index.files.at(-1)!.state = 'partial'; }
            index.hunks.push({id: 'ph_' + purposeHash([file.filename, file.previous_filename, m[0], i, patch]).slice(0, 24), path: file.filename, previousPath: file.previous_filename ?? file.filename,
                before: beforeCount ? {startLine: Number(m[1]), endLine: Number(m[1]) + beforeCount - 1} : null,
                after: afterCount ? {startLine: Number(m[3]), endLine: Number(m[3]) + afterCount - 1} : null, patch, complete});
        }
        if (!starts.length) { index.limitations.push(PURPOSE_DIFF_LIMITATIONS.hunkPartial); index.files.at(-1)!.state = 'partial'; }
        for (const line of raw.split('\n')) {
            const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
            if (!match)
                continue;
            for (const side of ['head', 'base'] as const) {
                const start = Number(match[side === 'head' ? 3 : 1]), count = Number(match[side === 'head' ? 4 : 2] ?? 1);
                if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 1 || count < 1 || start + count - 1 > 1000000)
                    continue;
                if (index.locators.length >= 4096) {
                    index.limitations.push('patch_index_budget');
                    break;
                }
                // Existing readers consume bounded intervals; retain every part instead of dropping the tail.
                for (let offset = 0; offset < count; offset += 80) {
                    if (index.locators.length >= 4096) { index.limitations.push('patch_index_budget'); break; }
                    index.locators.push({ path: side === 'base' ? (file.previous_filename ?? file.filename) : file.filename, side, startLine: start + offset, endLine: start + Math.min(offset + 79, count - 1) });
                }
            }
        }
    }
    index.limitations = [...new Set(index.limitations)];
    indexes.set(input, index);
}
export function getPurposeDiffIndex(input: PullRequestInput): DiffIndex { return indexes.get(input) ?? { locators: [], limitations: ['raw_patch_index_unavailable'], hunks: [], files: [] }; }
/** Official GitHub Contents metadata + exact-ref raw stream, auth only to api.github.com. */
export function createGitHubPurposeReader(input: PullRequestInput, options: {
    token?: string;
    fetchFn?: typeof fetch;
}): PurposeSourceReader {
    const repo = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/\d+$/.exec(input.url ?? '');
    const fetchFn = options.fetchFn ?? fetch;
    let largeRead = false, totalBytes = 0, attempts = 0;
    return async (req, signal) => {
        if (!repo || !safePurposePath(req.path) || req.endLine < req.startLine || req.endLine - req.startLine >= 80 || req.revision !== (req.side === 'head' ? input.sourceProvenance?.headSha : input.sourceProvenance?.baseSha) || !/^[a-f0-9]{40}$/.test(req.revision) || attempts++ >= 8)
            return null;
        signal.throwIfAborted();
        const url = `https://api.github.com/repos/${repo[1]}/${repo[2]}/contents/${req.path.split('/').map(encodeURIComponent).join('/')}?ref=${req.revision}`;
        const headers: Record<string, string> = { 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json', ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) };
        const meta = await fetchFn(url, { headers, signal, redirect: 'error', cache: 'no-store' });
        if (!meta.ok)
            return null;
        // Metadata is also bounded; never accept directory/symlink/submodule shapes.
        const metadata = await readBounded(meta, 65536, signal);
        const obj = JSON.parse(metadata);
        if (obj.type !== 'file' || obj.path !== req.path || obj.target !== undefined || obj.submodule_git_url !== undefined || !/^[a-f0-9]{40}$/.test(obj.sha) || !Number.isSafeInteger(obj.size) || obj.size < 0)
            return null;
        const large = obj.size > 262144;
        if (large && largeRead)
            return null;
        if (large)
            largeRead = true;
        const cap = large ? 2097152 : 262144;
        const response = await fetchFn(url, { headers: { ...headers, Accept: 'application/vnd.github.raw+json' }, signal, redirect: 'error', cache: 'no-store' });
        if (!response.ok)
            return null;
        const reader = response.body?.getReader();
        if (!reader)
            return null;
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let prefix = '', bytesRead = 0, complete = false;
        try {
            while (true) {
                signal.throwIfAborted();
                const { done, value } = await reader.read();
                if (done) {
                    prefix += decoder.decode();
                    complete = true;
                    break;
                }
                bytesRead += value.byteLength;
                totalBytes += value.byteLength;
                if (bytesRead > cap || totalBytes > 4194304)
                    return null;
                prefix += decoder.decode(value, { stream: true });
                if (prefix.split('\n').length > req.endLine)
                    break;
            }
        }
        finally {
            await reader.cancel().catch(() => { });
        }
        prefix = prefix.replace(/\r\n?/g, '\n');
        const lines = prefix.split('\n');
        if (!complete && lines.length <= req.endLine || complete && lines.length < req.endLine)
            return null;
        // An open PEM at the stream boundary cannot be safely masked by a complete-block regex.
        const begins = [...prefix.matchAll(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g)].length, ends = [...prefix.matchAll(/-----END [A-Z ]*PRIVATE KEY-----/g)].length;
        if (begins !== ends)
            return null;
        const rawWindow = lines.slice(req.startLine - 1, req.endLine).join('\n'), content = redactSecretsPreservingLines(prefix).split('\n').slice(req.startLine - 1, req.endLine).join('\n');
        return { path: req.path, revision: req.revision, content, startLine: req.startLine, complete: true, rawWindowHash: purposeContentHash(rawWindow), bytesRead };
    };
}
async function readBounded(response: Response, cap: number, signal: AbortSignal) { const reader = response.body?.getReader(); if (!reader)
    throw new Error('purpose_github_body'); const chunks: Uint8Array[] = []; let size = 0; try {
    while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done)
            break;
        size += value.byteLength;
        if (size > cap)
            throw new Error('purpose_github_metadata_budget');
        chunks.push(value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
finally {
    await reader.cancel().catch(() => { });
} }
