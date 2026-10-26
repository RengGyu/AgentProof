import {purposeDeadline} from './purpose-timeout';
import type { PullRequestInput } from './types';
import type { PurposeRepositoryBackend, RepositoryManifest } from './purpose-repository';
import { safePurposePath } from './purpose-evidence';
import { getPurposeDiffIndex } from './purpose-github';
type PrivateAuthorizer = (signal?: AbortSignal) => Promise<boolean>;
// Describes this factory's guard ownership, never a retained permission result.
const privateReadGuards = new WeakMap<PurposeRepositoryBackend, { subject: string; authorize: PrivateAuthorizer; readBlob: PurposeRepositoryBackend['readBlob']; manifest: PurposeRepositoryBackend['manifest'] }>();
const privateSubject = (input: PullRequestInput) => JSON.stringify([input.url,input.repositoryPrivate,input.sourceProvenance?.headSha,input.sourceProvenance?.baseSha,getPurposeDiffIndex(input).comparison?.diffBaseSha]);
export function hasMatchingPrivateReadGuards(backend: PurposeRepositoryBackend, input: PullRequestInput, authorize: PrivateAuthorizer | undefined, operation: 'manifest' | 'readBlob'): boolean {
    const owner = privateReadGuards.get(backend);
    return !!owner && input.repositoryPrivate === true && owner.authorize === authorize && owner[operation] === backend[operation] && owner.subject === privateSubject(input);
}
/** Fixed official endpoints only. Server credential is never returned. Metadata/raw transport budgets are request-local. */
export function createGitHubPurposeRepositoryBackend(input: PullRequestInput, options: {
    token?: string;
    fetchFn?: typeof fetch;
    privateAccess?: {repositoryId: number; authorize: (signal?: AbortSignal) => Promise<boolean>};
} = {}): PurposeRepositoryBackend {
    if (input.repositoryPrivate !== false && (input.repositoryPrivate !== true || !options.token || !options.privateAccess || !Number.isSafeInteger(options.privateAccess.repositoryId) || options.privateAccess.repositoryId<=0))
        throw new Error('purpose_private_consent_required');
    const repositoryPrivate=input.repositoryPrivate, privateAuthorize=options.privateAccess?.authorize;
    const parsed = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/\d+$/.exec(input.url ?? '');
    if (!parsed)
        throw new Error('localization_manifest_invalid');
    const repo = parsed[1] + '/' + parsed[2], root = 'https://api.github.com/repos/' + repo, fetchFn = options.fetchFn ?? fetch;
    const headers = { 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json', ...(options.token ? { Authorization: 'Bearer ' + options.token } : {}) };
    let metadataCalls = 0, metadataBytes = 0, rawBytes = 0, largeRead: string | undefined;
    const failures = new Map<string, string>();
    let publicCheck: Promise<void> | undefined;
    const authorize = async (signal:AbortSignal) => {signal.throwIfAborted();if(repositoryPrivate===true&&!await privateAuthorize!(signal))throw new Error('purpose_private_consent_required');signal.throwIfAborted();};
    async function requestJson(url: string, signal: AbortSignal) {
        signal.throwIfAborted();
        if (++metadataCalls > 8)
            throw new Error('localization_metadata_budget');
        const r = await fetchFn(url, { headers, signal, redirect: 'error', cache: 'no-store' });
        if (!r.ok)
            throw new Error('localization_metadata_http_' + r.status);
        const body = r.body?.getReader();
        if (!body)
            throw new Error('localization_metadata_body');
        const chunks: Uint8Array[] = [];
        try {
            while (true) {
                signal.throwIfAborted();
                const { done, value } = await body.read();
                if (done)
                    break;
                metadataBytes += value.byteLength;
                if (metadataBytes > 8388608)
                    throw new Error('localization_metadata_budget');
                chunks.push(value);
            }
            return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        }
        finally {
            await body.cancel().catch(() => { });
        }
    }
    const backend: PurposeRepositoryBackend = {
        readFailureReason: (entry, revision) => failures.get(revision + ':' + entry.blobSha),
        async manifest(side, revision, parent) {
            const expected = side === 'head' ? input.sourceProvenance?.headSha : getPurposeDiffIndex(input).comparison?.diffBaseSha ?? input.sourceProvenance?.baseSha;
            if (revision !== expected || !/^[a-f0-9]{40}$/.test(revision))
                throw new Error('localization_manifest_invalid');
            const deadline=purposeDeadline(15000,'source_manifest_deadline',parent),signal=deadline.signal;
            try {
            await authorize(signal);
            publicCheck ??= requestJson(root, signal).then(r => { if (r.private !== input.repositoryPrivate || r.full_name?.toLowerCase() !== repo.toLowerCase() || (input.repositoryPrivate===true&&r.id!==options.privateAccess!.repositoryId))
                throw new Error(input.repositoryPrivate===true?'localization_private_access_changed':'localization_public_required'); });
            await publicCheck;
            const commit = await requestJson(root + '/git/commits/' + revision, signal);
            if (commit.sha !== revision || !/^[a-f0-9]{40}$/.test(commit.tree?.sha ?? ''))
                throw new Error('localization_manifest_invalid');
            const tree = await requestJson(root + '/git/trees/' + commit.tree.sha + '?recursive=1', signal);
            if (tree.sha !== commit.tree.sha || typeof tree.truncated !== 'boolean' || !Array.isArray(tree.tree))
                throw new Error('localization_manifest_invalid');
            const entries: RepositoryManifest['entries'] = [];
            let excluded = false;
            for (const e of tree.tree) {
                if (e.type === 'tree' && e.mode === '040000')
                    continue;
                if (e.type !== 'blob' || !['100644', '100755'].includes(e.mode)) {
                    excluded = true;
                    continue;
                }
                if (!safePurposePath(e.path) || !/^[a-f0-9]{40}$/.test(e.sha) || !Number.isSafeInteger(e.size) || e.size < 0)
                    throw new Error('localization_manifest_invalid');
                if (entries.length >= 20000) {
                    excluded = true;
                    break;
                }
                entries.push({ path: e.path, mode: e.mode, blobSha: e.sha, size: e.size });
            }
            await authorize(signal);
            return { repository: repo, revision, treeSha: tree.sha, complete: !tree.truncated && !excluded, entries };
            } finally {deadline.dispose();}
        },
        async readBlob(entry, revision, endLine, signal) {
            if (!safePurposePath(entry.path) || !/^[a-f0-9]{40}$/.test(entry.blobSha) || ![input.sourceProvenance?.headSha, input.sourceProvenance?.baseSha, getPurposeDiffIndex(input).comparison?.diffBaseSha].includes(revision))
                throw new Error('localization_blob_invalid');
            await authorize(signal);
            const large = entry.size > 262144;
            const key = revision + ':' + entry.blobSha;
            const unavailable = (reason: string) => { failures.set(key, reason); return null; };
            if (large && largeRead && largeRead !== key) return unavailable('large_file_budget');
            if (large) largeRead = key;
            const cap = large ? 2097152 : 262144;
            const response = await fetchFn(root + '/git/blobs/' + entry.blobSha, { headers: { ...headers, Accept: 'application/vnd.github.raw+json' }, signal, redirect: 'error', cache: 'no-store' });
            if (!response.ok) return unavailable('http_' + response.status);
            const reader = response.body?.getReader();
            if (!reader) return unavailable('response_body_unavailable');
            // Preserve BOM bytes until repository load verifies the complete Git blob.
            const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
            let content = '', bytesRead = 0, complete = false;
            try {
                while (true) {
                    signal.throwIfAborted();
                    const { done, value } = await reader.read();
                    if (done) {
                        content += decoder.decode();
                        complete = true;
                        break;
                    }
                    bytesRead += value.byteLength;
                    rawBytes += value.byteLength;
                    if (bytesRead > cap || rawBytes > 4194304) return unavailable('source_byte_budget');
                    content += decoder.decode(value, { stream: true });
                    if (large && content.split('\n').length > endLine) {
                        content = content.slice(0, content.lastIndexOf('\n'));
                        break;
                    }
                }
            }
            finally {
                await reader.cancel().catch(() => { });
            }
            // Keep the return guard after asynchronous cleanup as well as the raw read.
            await authorize(signal);
            return { path: entry.path, revision, blobSha: entry.blobSha, content, complete, bytesRead };
        }
    };
    if (repositoryPrivate === true && privateAuthorize) privateReadGuards.set(backend,{subject:privateSubject(input),authorize:privateAuthorize,readBlob:backend.readBlob,manifest:backend.manifest});
    return backend;
}
