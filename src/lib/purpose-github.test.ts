import { it, expect, vi } from 'vitest';
import { createGitHubPurposeReader, capturePurposeDiffIndex, getPurposeDiffIndex } from './purpose-github';
import type { PullRequestInput } from './types';
const input = { url: 'https://github.com/acme/queue/pull/1', sourceProvenance: { headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) } } as PullRequestInput;
it('captures late hunk coordinates without changing the legacy patch', () => { capturePurposeDiffIndex(input, [{ filename: 'src/q.ts', patch: '@@ -1 +1 @@\n-old\n+new\n' + ' context\n'.repeat(200) + '@@ -400 +500 @@\n-old\n+new' }]); expect(getPurposeDiffIndex(input).locators.filter(x => x.side === 'head').map(x => x.startLine)).toEqual([1, 500]); });
it('retains the tail of long hunks and distinguishes absent sides and incomplete patch text', () => {
    const value = {...input};
    const patch = '@@ -1,161 +1,161 @@\n' + Array.from({length: 161}, (_, i) => ' line' + i).join('\n');
    capturePurposeDiffIndex(value, [{filename: 'src/q.ts', patch}, {filename: 'added.txt', patch: '@@ -0,0 +1 @@\n+added'}, {filename: 'partial.txt', patch: '@@ -1,2 +1,2 @@\n-old\n+new'}, {filename: 'binary.dat'}]);
    const index = getPurposeDiffIndex(value);
    expect(index.locators.filter(x => x.path === 'src/q.ts' && x.side === 'head')).toEqual([{path:'src/q.ts', side:'head', startLine:1, endLine:80}, {path:'src/q.ts', side:'head', startLine:81, endLine:160}, {path:'src/q.ts', side:'head', startLine:161, endLine:161}]);
    expect(index.hunks[0]).toMatchObject({complete:true, after:{startLine:1,endLine:161}});
    expect(index.hunks[1]).toMatchObject({before:null, complete:true});
    expect(index.hunks[2].complete).toBe(false);
    expect(index.files.at(-1)?.state).toBe('unavailable');
    expect(index.limitations).toContain('patch_hunk_partial');
});
it('reads a bounded exact-revision window of a large file, masks prefix secrets, never follows redirects', async () => {
    const source = '// prefix\n'.repeat(30000) + 'assert(pending());\n';
    const f = vi.fn(async (_url: any, init: any) => init.headers.Accept === 'application/vnd.github+json' ? Response.json({ type: 'file', path: 'src/q.ts', size: Buffer.byteLength(source), sha: 'c'.repeat(40) }) : new Response(source));
    const read = createGitHubPurposeReader(input, { token: 'fixture-key', fetchFn: f });
    const e = await read({ path: 'src/q.ts', side: 'head', revision: 'a'.repeat(40), startLine: 30001, endLine: 30001, clauseId: 'c', reason: 'inspect' }, new AbortController().signal);
    expect(e).toMatchObject({ startLine: 30001, content: 'assert(pending());', complete: true });
    expect(f.mock.calls.every(c => c[1].redirect === 'error')).toBe(true);
    expect(f.mock.calls[0][0]).toContain('ref=' + 'a'.repeat(40));
});
it('rejects symlinks before raw download and forwards cancellation', async () => { const f = vi.fn(async () => Response.json({ type: 'symlink', path: 'src/q.ts', size: 5, sha: 'c'.repeat(40), target: 'secret' })); const read = createGitHubPurposeReader(input, { fetchFn: f }); expect(await read({ path: 'src/q.ts', side: 'head', revision: 'a'.repeat(40), startLine: 1, endLine: 1, clauseId: 'c', reason: 'inspect' }, new AbortController().signal)).toBeNull(); expect(f).toHaveBeenCalledTimes(1); });
