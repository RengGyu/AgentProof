import { it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createGitHubPurposeRepositoryBackend } from './purpose-repository-github';
import { createPurposeRepository } from './purpose-repository';
import { capturePurposeDiffIndex } from './purpose-github';
import type { PullRequestInput } from './types';
const head = 'a'.repeat(40), base = 'b'.repeat(40), tree = 'c'.repeat(40), text = '// fixed public source\n';
const sha = createHash('sha1').update('blob ' + Buffer.byteLength(text) + '\0').update(text).digest('hex');
const input = { url: 'https://github.com/acme/jobs/pull/1', repositoryPrivate: false, changedFiles: [], sourceProvenance: { origin: 'github_snapshot', headSha: head, baseSha: base } } as unknown as PullRequestInput;
function transport() { return vi.fn(async (url: any, init: any) => String(url).endsWith('/acme/jobs') ? Response.json({ full_name: 'acme/jobs', private: false }) : String(url).includes('/commits/') ? Response.json({ sha: String(url).split('/').at(-1), tree: { sha: tree } }) : String(url).includes('/trees/') ? Response.json({ sha: tree, truncated: false, tree: [{ path: 'source.py', sha, mode: '100644', type: 'blob', size: Buffer.byteLength(text) }, { path: 'link.py', sha, mode: '120000', type: 'blob', size: 12 }] }) : new Response(text)); }
it('validates public repo, commit/tree/blob and excludes symlinks with honest partial inventory', async () => {
    const f = transport(), backend = createGitHubPurposeRepositoryBackend(input, { token: 'test-not-a-real-key', fetchFn: f });
    const r = await createPurposeRepository(input, backend, { signal: new AbortController().signal });
    expect(r.initial().manifestComplete).toBe(false);
    const root = r.initial().roots.find(x => x.side === 'head')!;
    const listing = await r.execute({ kind: 'browse', targetId: root.id, clauseId: 'c', view: 'none', startLine: 0, endLine: 0, cursor: 0, literal: '' });
    expect(listing.items.map((x: any) => x.path)).toEqual(['source.py']);
    expect(f.mock.calls.every(([, i]) => i.redirect === 'error' && String(i.headers.Authorization).includes('test-not-a-real-key'))).toBe(true);
    const data = await r.execute({ kind: 'inspect', targetId: listing.items[0].id, clauseId: 'c', view: 'source', startLine: 1, endLine: 1, cursor: 0, literal: '' });
    expect(data.evidence[0].revision).toBe(head);
    expect(JSON.stringify(data)).not.toContain('test-not-a-real-key');
    r.dispose();
});
it('actual private repo and commit mismatch fail before raw blob request', async () => {
    const f = vi.fn(async () => Response.json({ full_name: 'acme/jobs', private: true })), b = createGitHubPurposeRepositoryBackend(input, { fetchFn: f });
    await expect(b.manifest('head', head, new AbortController().signal)).rejects.toThrow('localization_public_required');
    expect(f).toHaveBeenCalledTimes(1);
    const g = transport();
    g.mockImplementation(async (url: any) => String(url).endsWith('/acme/jobs') ? Response.json({ full_name: 'acme/jobs', private: false }) : Response.json({ sha: base, tree: { sha: tree } }));
    await expect(createGitHubPurposeRepositoryBackend(input, { fetchFn: g }).manifest('head', head, new AbortController().signal)).rejects.toThrow('localization_manifest_invalid');
});
it('truncated tree is partial, missing metadata size is rejected and no remote retry occurs', async () => {
    const f = transport();
    f.mockImplementation(async (url: any) => String(url).endsWith('/acme/jobs') ? Response.json({ full_name: 'acme/jobs', private: false }) : String(url).includes('/commits/') ? Response.json({ sha: head, tree: { sha: tree } }) : Response.json({ sha: tree, truncated: true, tree: [{ path: 'source.py', sha, mode: '100644', type: 'blob' }] }));
    await expect(createGitHubPurposeRepositoryBackend(input, { fetchFn: f }).manifest('head', head, new AbortController().signal)).rejects.toThrow('localization_manifest_invalid');
    expect(f).toHaveBeenCalledTimes(3);
});

it('large prefix can be reread wider for the same blob without allowing a second distinct large file',async()=>{
 const entry={path:'large.py',blobSha:sha,mode:'100644' as const,size:300000};
 const f=vi.fn(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('one\ntwo\n'));c.enqueue(new TextEncoder().encode('three\nfour\n'));c.close();}})));
 const b=createGitHubPurposeRepositoryBackend(input,{fetchFn:f}),signal=new AbortController().signal;
 const first=await b.readBlob(entry,head,1,signal),second=await b.readBlob(entry,head,4,signal);
 expect(first?.complete).toBe(false);expect(second?.content).toContain('four');expect(f).toHaveBeenCalledTimes(2);
 expect(await b.readBlob({...entry,blobSha:tree},head,4,signal)).toBeNull();expect(f).toHaveBeenCalledTimes(2);
 expect(b.readFailureReason?.({...entry,blobSha:tree},head)).toBe('large_file_budget');
});
it('failed access records HTTP reason without keeping response body or credentials',async()=>{
 const b=createGitHubPurposeRepositoryBackend(input,{fetchFn:vi.fn(async()=>new Response('private response not retained',{status:403}))});
 const entry={path:'source.py',blobSha:sha,mode:'100644' as const,size:10};
 expect(await b.readBlob(entry,head,1,new AbortController().signal)).toBeNull();expect(b.readFailureReason?.(entry,head)).toBe('http_403');
});

it('preserves a streamed UTF-8 BOM until complete-blob size and Git SHA verification',async()=>{
 const content='\uFEFFfirst()\r\nsecond()\r\n',raw=Buffer.from(content),blobSha=createHash('sha1').update('blob '+raw.length+'\0').update(raw).digest('hex');
 const f=vi.fn(async()=>new Response(new ReadableStream({start(c){c.enqueue(raw.subarray(0,1));c.enqueue(raw.subarray(1,3));c.enqueue(raw.subarray(3));c.close();}})));
 const backend=createGitHubPurposeRepositoryBackend(input,{fetchFn:f});
 const entry={path:'source.py',blobSha,mode:'100644' as const,size:raw.length};
 const b={...backend,manifest:async(_side:'head'|'base',revision:string)=>({repository:'acme/jobs',revision,treeSha:tree,complete:true,entries:[entry]})};
 const repository=await createPurposeRepository({...input,changedFiles:[{path:'source.py',status:'modified'}]},b,{signal:new AbortController().signal});
 const target=repository.initial().changed.find(e=>e.side==='head')!;
 const result=await repository.execute({kind:'inspect',targetId:target.id,clauseId:'c',view:'source',startLine:2,endLine:2,cursor:0,literal:''});
 expect(result.evidence[0].content).toBe('second()');expect(result.evidence[0].revision).toBe(head);expect(f).toHaveBeenCalledTimes(1);repository.dispose();
});
it('reads base blobs at the verified merge-base used by the diff-first manifest, and still rejects other revisions',async()=>{
 const mergeBase='d'.repeat(40),signal=new AbortController().signal;
 const diffInput={...input,changedFiles:[{path:'source.py',status:'modified'}]} as unknown as PullRequestInput;
 capturePurposeDiffIndex(diffInput,[{filename:'source.py',patch:'@@ -1 +1 @@\n-old\n+// fixed public source'}],{baseRefSha:base,diffBaseSha:mergeBase,headSha:head});
 const f=vi.fn(async(url:any)=>String(url).includes('/git/blobs/')?new Response(text):Response.json({}));
 const b=createGitHubPurposeRepositoryBackend(diffInput,{fetchFn:f});
 const entry={path:'source.py',blobSha:sha,mode:'100644',size:Buffer.byteLength(text)} as any;
 const read=await b.readBlob(entry,mergeBase,1,signal);
 expect(read?.content).toBe(text);expect(read?.revision).toBe(mergeBase);
 await expect(b.readBlob(entry,'e'.repeat(40),1,signal)).rejects.toThrow('localization_blob_invalid');
});


it('requires current private authority and immutable repository identity before reading private blobs',async()=>{
 const sample={...input,repositoryPrivate:true};let current=true,repoId=9,privateNow=true;
 const original=transport(),f=vi.fn(async(u:any,i:any)=>String(u).endsWith('/acme/jobs')?Response.json({id:repoId,full_name:'acme/jobs',private:privateNow}):original(u,i));
 const authorizePrivate=async()=>current;
 const b=createGitHubPurposeRepositoryBackend(sample,{token:'fixture-installation',fetchFn:f,privateAccess:{repositoryId:9,authorize:authorizePrivate}} as any);
 const r=await createPurposeRepository(sample,b,{signal:new AbortController().signal,authorizePrivate} as any);const root=r.initial().roots.find(x=>x.side==='head')!;
 const list=await r.execute({kind:'browse',targetId:root.id,clauseId:'c',view:'none',startLine:0,endLine:0,cursor:0,literal:''});const a={kind:'inspect' as const,targetId:list.items[0].id,clauseId:'c',view:'source' as const,startLine:1,endLine:1,cursor:0,literal:''};
 expect((await r.execute(a)).evidence[0].revision).toBe(head);const blobCalls=f.mock.calls.filter(([u])=>String(u).includes('/blobs/')).length;
 current=false;await expect(r.execute(a)).rejects.toThrow('purpose_private_consent_required');expect(f.mock.calls.filter(([u])=>String(u).includes('/blobs/'))).toHaveLength(blobCalls);r.dispose();
 for(const change of ['identity','visibility']){current=true;repoId=change==='identity'?10:9;privateNow=change!=='visibility';const bad=createGitHubPurposeRepositoryBackend(sample,{token:'fixture-installation',fetchFn:f,privateAccess:{repositoryId:9,authorize:authorizePrivate}} as any);await expect(bad.manifest('head',head,new AbortController().signal)).rejects.toThrow('localization_private_access_changed');}
});
it('does not grant private source access with a token or caller consent flag alone',async()=>{
 expect(()=>createGitHubPurposeRepositoryBackend({...input,repositoryPrivate:true},{token:'fixture-installation'})).toThrow('purpose_private_consent_required');
 const b={manifest:vi.fn(),readBlob:vi.fn()};await expect(createPurposeRepository({...input,repositoryPrivate:true},b,{signal:new AbortController().signal})).rejects.toThrow('purpose_private_consent_required');expect(b.manifest).not.toHaveBeenCalled();
});
