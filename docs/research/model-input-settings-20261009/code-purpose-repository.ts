import ts from 'typescript';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { safePurposePath } from './purpose-evidence';
import { redactSecretsPreservingLines } from './redact';
import { purposeHash, purposeContentHash, type PurposeEvidence, type PurposeReadRequest } from './purpose-contract';
import type { PullRequestInput } from './types';
export interface RepositoryEntry {
    path: string;
    blobSha: string;
    mode: '100644' | '100755';
    size: number;
}
export interface RepositoryManifest {
    repository: string;
    revision: string;
    treeSha: string;
    complete: boolean;
    entries: RepositoryEntry[];
}
export interface PurposeRepositoryBackend {
    manifest(side: 'head' | 'base', revision: string, signal: AbortSignal): Promise<RepositoryManifest>;
    readBlob(entry: RepositoryEntry, revision: string, endLine: number, signal: AbortSignal): Promise<{
        path: string;
        revision: string;
        blobSha: string;
        content: string;
        complete: boolean;
        bytesRead: number;
    } | null>;
}
export interface LocateAction {
    kind: 'browse' | 'inspect' | 'definition' | 'references' | 'searchText';
    targetId: string;
    view: 'none' | 'source' | 'outline' | 'diff';
    startLine: number;
    endLine: number;
    cursor: number;
    literal: string;
    clauseId: string;
}
type File = RepositoryEntry & {
    id: string;
    side: 'head' | 'base';
    revision: string;
};
type Directory = {
    id: string;
    path: string;
    side: 'head' | 'base';
};
type Loaded = {
    file: File;
    raw: string;
    content: string;
    complete: boolean;
    source?: ts.SourceFile;
};
type Occurrence = {
    id: string;
    fileId: string;
    name: string;
    position: number;
    startLine: number;
    endLine: number;
    declaration: boolean;
};
const js = (p: string) => /\.[cm]?[jt]sx?$/.test(p);
const gitHash = (s: string) => createHash('sha1').update('blob ' + Buffer.byteLength(s) + '\0').update(s).digest('hex');
const ordered = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Public, request-local source store. No disk reads, plugins, installs, emit or repository execution. */
export async function createPurposeRepository(input: PullRequestInput, backend: PurposeRepositoryBackend, options: {
    signal: AbortSignal;
    maxReads?: number;
}) {
    if (input.repositoryPrivate !== false)
        throw new Error('localization_public_required');
    const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/\d+$/.exec(input.url ?? '');
    if (!match || input.sourceProvenance?.origin !== 'github_snapshot')
        throw new Error('localization_manifest_invalid');
    const repository = match[1] + '/' + match[2], signal = options.signal;
    const manifests = new Map<'head' | 'base', RepositoryManifest>(), files = new Map<string, File>(), directories = new Map<string, Directory>(), exposed = new Set<string>(), loaded = new Map<string, Loaded>(), cache = new Map<string, Promise<Loaded | null>>(), occurrences = new Map<string, Occurrence>();
    const candidates: PurposeEvidence[] = [], limitations: string[] = [];
    let attempts = 0, bytes = 0, disposed = false;
    const services = new Map<'head' | 'base', {
        version: number;
        service: ts.LanguageService;
    }>();
    const maxReads = Math.min(24, Math.max(0, options.maxReads ?? 24));
    const guard = () => { signal.throwIfAborted(); if (disposed)
        throw new Error('localization_disposed'); };
    const limit = (s: string) => { if (!limitations.includes(s))
        limitations.push(s); };
    for (const side of ['head', 'base'] as const) {
        guard();
        const revision = side === 'head' ? input.sourceProvenance.headSha : input.sourceProvenance.baseSha;
        if (!revision || !/^[a-f0-9]{40}$/.test(revision))
            throw new Error('localization_manifest_invalid');
        const m = await backend.manifest(side, revision, signal);
        guard();
        if (m.repository !== repository || m.revision !== revision || !/^[a-f0-9]{40}$/.test(m.treeSha) || typeof m.complete !== 'boolean' || !Array.isArray(m.entries) || m.entries.length > 20000 || new Set(m.entries.map(e => e.path)).size !== m.entries.length || m.entries.some(e => !safePurposePath(e.path) || !/^[a-f0-9]{40}$/.test(e.blobSha) || !['100644', '100755'].includes(e.mode) || !Number.isSafeInteger(e.size) || e.size < 0))
            throw new Error('localization_manifest_invalid');
        manifests.set(side, m);
        if (!m.complete)
            limit('localization_partial');
        for (const e of m.entries) {
            const f = { ...e, side, revision, id: 'lf_' + purposeHash([repository, revision, e.path, e.blobSha]).slice(0, 24) };
            files.set(f.id, f);
        }
        const paths = new Set(['']);
        for (const e of m.entries) {
            let p = path.posix.dirname(e.path);
            while (p !== '.') {
                paths.add(p);
                p = path.posix.dirname(p);
            }
        }
        for (const p of paths) {
            const d = { id: 'ld_' + purposeHash([repository, revision, p]).slice(0, 24), path: p, side };
            directories.set(d.id, d);
            if (!p)
                exposed.add(d.id);
        }
    }
    const changed = [...files.values()].filter(f => input.changedFiles.some(x => (f.side === 'head' ? x.path : (x.previousPath ?? x.path)) === f.path)).sort((a, b) => ordered(a.path, b.path) || Number(b.side === 'head') - Number(a.side === 'head')).slice(0, 40);
    changed.forEach(f => exposed.add(f.id));
    async function load(f: File, endLine: number): Promise<Loaded | null> {
        guard();
        if (cache.has(f.id))
            return cache.get(f.id)!;
        if (attempts >= maxReads) {
            limit('localization_read_budget');
            return null;
        }
        if (bytes + Math.min(f.size, f.size > 262144 ? 2097152 : 262144) > 4194304) {
            limit('localization_source_budget');
            return null;
        }
        attempts++;
        const promise = (async () => {
            const blob = await backend.readBlob(f, f.revision, endLine, AbortSignal.any([signal, AbortSignal.timeout(8000)]));
            guard();
            if (!blob) {
                limit('localization_partial');
                return null;
            }
            if (!Number.isSafeInteger(blob.bytesRead) || blob.bytesRead < Buffer.byteLength(blob.content) || blob.bytesRead > 2097152)
                throw new Error('localization_blob_invalid');
            bytes += blob.bytesRead;
            if (bytes > 4194304) {
                limit('localization_source_budget');
                return null;
            }
            if (blob.path !== f.path || blob.revision !== f.revision || blob.blobSha !== f.blobSha || typeof blob.complete !== 'boolean' || (blob.complete && (Buffer.byteLength(blob.content) !== f.size || gitHash(blob.content) !== f.blobSha)))
                throw new Error('localization_blob_invalid');
            const raw = blob.content.replace(/\r\n?/g, '\n');
            if ([...raw.matchAll(/-----BEGIN [A-Z ]*PRIVATE KEY-----/g)].length !== [...raw.matchAll(/-----END [A-Z ]*PRIVATE KEY-----/g)].length) {
                limit('localization_partial');
                return null;
            }
            const b: Loaded = { file: f, raw, content: redactSecretsPreservingLines(raw), complete: blob.complete };
            loaded.set(f.id, b);
            return b;
        })();
        cache.set(f.id, promise);
        return promise;
    }
    function syntax(b: Loaded) {
        guard();
        if (!js(b.file.path) || !b.complete)
            return undefined;
        if (!b.source)
            b.source = ts.createSourceFile('/repo/' + b.file.path, b.content, ts.ScriptTarget.Latest, true);
        guard();
        return b.source;
    }
    const capabilities = (b?: Loaded) => ({ browse: 'manifest_only', search: 'literal_only', symbolBinding: b && js(b.file.path) && b.complete ? 'loaded_relative_js_ts' : 'unsupported', projectCompleteness: 'loaded_subset_only', parserDeadline: 'cooperative_only', execution: 'never' });
    function symbols(b: Loaded) {
        const s = syntax(b);
        if (!s)
            return [];
        const out: Occurrence[] = [];
        function walk(n: ts.Node) {
            if (out.length >= 128)
                return;
            if (ts.isIdentifier(n)) {
                const pos = n.getStart(s), start = s!.getLineAndCharacterOfPosition(pos).line + 1, end = s!.getLineAndCharacterOfPosition(n.getEnd()).line + 1;
                const parent = n.parent as ts.Node & {
                    name?: ts.Node;
                };
                const o = { id: 'lo_' + purposeHash([b.file.id, pos, n.getText(s)]).slice(0, 24), fileId: b.file.id, name: n.getText(s), position: pos, startLine: start, endLine: end, declaration: parent.name === n && !ts.isPropertyAccessExpression(parent) };
                occurrences.set(o.id, o);
                exposed.add(o.id);
                out.push(o);
            }
            ts.forEachChild(n, walk);
        }
        walk(s);
        guard();
        return out;
    }
    function materialize(b: Loaded, start: number, end: number, clauseId: string, expand = true) {
        guard();
        const lines = b.content.split('\n');
        if (start < 1 || end < start || start > lines.length || end > lines.length && !b.complete)
            return null;
        end = Math.min(end, lines.length);
        let completeness: 'full_unit' | 'window_only' | 'split_unit' = 'window_only';
        if (b.complete && lines.length <= 80 && Buffer.byteLength(b.content) <= 8000 && !js(b.file.path)) {
            start = 1;
            end = lines.length;
            completeness = 'full_unit';
        }
        const s = expand ? syntax(b) : undefined;
        if (s) {
            let unit: ts.Node | undefined;
            const position = lines.slice(0, start - 1).join('\n').length + (start > 1 ? 1 : 0);
            function find(n: ts.Node) { if (n.getStart(s) <= position && n.getEnd() >= position) {
                if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isClassDeclaration(n) || ts.isVariableStatement(n) || ts.isExpressionStatement(n) || ts.isIfStatement(n))
                    unit = n;
                ts.forEachChild(n, find);
            } }
            find(s);
            if (unit) {
                const a = s.getLineAndCharacterOfPosition(unit.getStart(s)).line + 1, z = s.getLineAndCharacterOfPosition(unit.getEnd()).line + 1;
                // Expansion may add context but must never remove any requested source line.
                const expandedStart = Math.min(start, a), expandedEnd = Math.max(end, z);
                if (expandedEnd - expandedStart < 80 && Buffer.byteLength(lines.slice(expandedStart - 1, expandedEnd).join('\n')) <= 8000) {
                    start = expandedStart;
                    end = expandedEnd;
                    completeness = start === a && end === z ? 'full_unit' : 'window_only';
                }
                else {
                    end = Math.min(lines.length, start + 79);
                    completeness = 'split_unit';
                }
            }
        }
        if (end - start >= 80)
            end = start + 79;
        const content = lines.slice(start - 1, end).join('\n');
        if (Buffer.byteLength(content) > 8000) {
            limit('localization_packet_budget');
            return null;
        }
        const rawHash = purposeContentHash(b.raw.split('\n').slice(start - 1, end).join('\n')), contentHash = purposeContentHash(content);
        const id = 'pe_' + purposeHash([input.url, b.file.path, b.file.revision, b.file.side, start, end, rawHash, contentHash]).slice(0, 24);
        let e = candidates.find(x => x.id === id);
        if (!e) {
            if (candidates.length >= 96) {
                limit('localization_packet_budget');
                return null;
            }
            e = { id, repositoryHash: purposeHash(input.url), path: b.file.path, side: b.file.side, revision: b.file.revision, startLine: start, endLine: end, rawHash, contentHash, content, completeness: 'complete_interval', collection: 'exact_blob', clauseIds: [clauseId] };
            candidates.push(e);
        }
        else if (!e.clauseIds.includes(clauseId))
            e.clauseIds.push(clauseId);
        exposed.add(e.id);
        return { evidence: e, unitCompleteness: completeness };
    }
    function service(side: 'head' | 'base') {
        const old = services.get(side);
        if (old?.version === loaded.size)
            return old.service;
        old?.service.dispose();
        const sources = new Map([...loaded.values()].filter(b => b.file.side === side && b.complete && js(b.file.path)).map(b => ['/repo/' + b.file.path, b.content]));
        const host: ts.LanguageServiceHost = { getCompilationSettings: () => ({ allowJs: true, checkJs: true, noEmit: true, noLib: true, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, target: ts.ScriptTarget.Latest }), getScriptFileNames: () => [...sources.keys()], getScriptVersion: () => '1', getScriptSnapshot: p => sources.has(p) ? ts.ScriptSnapshot.fromString(sources.get(p)!) : undefined, getCurrentDirectory: () => '/repo', getDefaultLibFileName: () => '/repo/__missing__.d.ts', fileExists: p => sources.has(p), readFile: p => sources.get(p), readDirectory: () => [], directoryExists: p => [...sources.keys()].some(f => f.startsWith(p + '/')), getDirectories: () => [], useCaseSensitiveFileNames: () => true };
        const svc = ts.createLanguageService(host, ts.createDocumentRegistry());
        services.set(side, { version: loaded.size, service: svc });
        return svc;
    }
    function staticDefinitions(o: Occurrence) {
        const b = loaded.get(o.fileId);
        if (!b || !syntax(b))
            return [];
        const svc = service(b.file.side);
        try {
            if (svc.getSyntacticDiagnostics('/repo/' + b.file.path).length)
                return [];
            const defs = svc.getDefinitionAtPosition('/repo/' + b.file.path, o.position) ?? [];
            guard();
            return defs.filter(d => d.kind !== ts.ScriptElementKind.alias && !(d as ts.DefinitionInfo & {
                unverified?: boolean;
                failedAliasResolution?: boolean;
            }).unverified && !(d as ts.DefinitionInfo & {
                failedAliasResolution?: boolean;
            }).failedAliasResolution && loaded.size && [...loaded.values()].some(x => x.file.side === b.file.side && '/repo/' + x.file.path === d.fileName && x.complete)).map(d => { const target = [...loaded.values()].find(x => x.file.side === b.file.side && '/repo/' + x.file.path === d.fileName)!; const sf = syntax(target)!; const startLine = sf.getLineAndCharacterOfPosition(d.textSpan.start).line + 1; const found = symbols(target).find(x => x.position === d.textSpan.start); return { id: found?.id ?? target.file.id, path: target.file.path, startLine, endLine: sf.getLineAndCharacterOfPosition(d.textSpan.start + d.textSpan.length).line + 1, fileId: target.file.id }; });
        }
        finally {
            guard();
        }
    }
    function validateAction(a: LocateAction) { guard(); if (!a || !['browse', 'inspect', 'definition', 'references', 'searchText'].includes(a.kind) || !exposed.has(a.targetId) || !Number.isSafeInteger(a.cursor) || a.cursor < 0 || !Number.isSafeInteger(a.startLine) || !Number.isSafeInteger(a.endLine) || a.endLine > 1000000 || a.startLine > 1000000 || a.literal.length > 120)
        throw new Error('localization_tool_reference'); }
    async function execute(a: LocateAction): Promise<any> {
        validateAction(a);
        const dir = directories.get(a.targetId), f = files.get(a.targetId), o = occurrences.get(a.targetId);
        if (a.kind === 'browse') {
            if (!dir)
                throw new Error('localization_tool_reference');
            const parent = (p: string) => path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p);
            const items = [...directories.values()].filter(d => d.side === dir.side && d.id !== dir.id && parent(d.path) === dir.path).map(d => ({ ...d, kind: 'directory' })).concat([...files.values()].filter(x => x.side === dir.side && parent(x.path) === dir.path).map(x => ({ ...x, kind: 'file' })) as any).sort((x, y) => ordered(x.path, y.path));
            const page = items.slice(a.cursor, a.cursor + 32);
            page.forEach(x => exposed.add(x.id));
            return { items: page, nextCursor: a.cursor + page.length < items.length ? a.cursor + page.length : null, complete: manifests.get(dir.side)!.complete, filesAvailable: items.length, capabilities: capabilities() };
        }
        if (a.kind === 'inspect') {
            const target = f ?? (o ? files.get(o.fileId) : undefined);
            if (!target)
                throw new Error('localization_tool_reference');
            if (a.view === 'diff') {
                const changedFile = input.changedFiles.find(x => (target.side === 'head' ? x.path : x.previousPath ?? x.path) === target.path);
                return { path: target.path, revision: target.revision, patch: redactSecretsPreservingLines(changedFile?.patch ?? ''), completeness: 'legacy_patch_may_be_truncated', evidence: [], capabilities: capabilities() };
            }
            if (!['source', 'outline'].includes(a.view) || a.view === 'source' && (a.startLine < 1 || a.endLine < a.startLine || a.endLine - a.startLine >= 80))
                throw new Error('localization_tool_reference');
            const b = await load(target, a.endLine || 80);
            if (!b)
                return { evidence: [], resolution: 'source_unavailable', capabilities: capabilities() };
            if (a.view === 'outline')
                return { path: target.path, lineCount: b.complete ? b.content.split('\n').length : null, occurrences: symbols(b), complete: b.complete, evidence: [], capabilities: capabilities(b) };
            const selected = materialize(b, o?.startLine ?? a.startLine, o?.endLine ?? a.endLine, a.clauseId);
            return { lineCount: b.complete ? b.content.split('\n').length : null, evidence: selected ? [selected.evidence] : [], unitCompleteness: selected?.unitCompleteness ?? 'range_unavailable', capabilities: capabilities(b) };
        }
        if (a.kind === 'definition') {
            if (!o)
                throw new Error('localization_tool_reference');
            const defs = staticDefinitions(o);
            defs.forEach(d => exposed.add(d.fileId));
            return { targets: defs, resolution: defs.length ? 'resolved_static' : js(files.get(o.fileId)!.path) ? 'unresolved' : 'unsupported', projectComplete: false, capabilities: capabilities(loaded.get(o.fileId)) };
        }
        if (a.kind === 'searchText' || a.kind === 'references') {
            const scope = dir ?? (o ? directories.get([...directories.values()].find(d => d.side === files.get(o.fileId)!.side && !d.path)!.id) : undefined);
            if (!scope || a.kind === 'searchText' && !a.literal)
                throw new Error('localization_tool_reference');
            const available = [...files.values()].filter(x => x.side === scope.side && (!scope.path || x.path.startsWith(scope.path + '/'))).sort((x, y) => ordered(x.path, y.path)), scan = available.slice(a.cursor, a.cursor + 4), hits: any[] = [];
            for (const x of scan) {
                const b = await load(x, 80);
                if (!b)
                    continue;
                exposed.add(x.id);
                if (a.kind === 'searchText') {
                    const lines = b.content.split('\n');
                    for (let i = 0; i < lines.length && hits.length < 16; i++)
                        if (lines[i].includes(a.literal))
                            hits.push({ fileId: x.id, path: x.path, startLine: i + 1, endLine: i + 1, resolution: 'literal_only' });
                }
                else if (o && js(x.path)) {
                    for (const p of symbols(b)) {
                        if (p.name !== o.name)
                            continue;
                        const original = staticDefinitions(o), defs = staticDefinitions(p);
                        if (original.length && defs.some(d => original.some(t => t.fileId === d.fileId && t.startLine === d.startLine)))
                            hits.push({ ...p, resolution: 'resolved_static' });
                        if (hits.length >= 16)
                            break;
                    }
                }
            }
            guard();
            return { hits, scopeId: scope.id, filesAvailable: available.length, filesScanned: scan.length, nextCursor: a.cursor + scan.length < available.length ? a.cursor + scan.length : null, complete: manifests.get(scope.side)!.complete && available.length === scan.length && scan.every(x => loaded.get(x.id)?.complete), resolution: a.kind === 'searchText' ? 'literal_only' : o && js(files.get(o.fileId)!.path) ? 'loaded_subset_static' : 'unsupported', evidence: [], capabilities: capabilities(o ? loaded.get(o.fileId) : undefined) };
        }
        throw new Error('localization_tool_reference');
    }
    const packet: PurposeEvidence[] = [];
    function append(e: PurposeEvidence) {
        const i = packet.findIndex(x => x.id === e.id);
        const merged = i >= 0 ? { ...packet[i], clauseIds: [...new Set([...packet[i].clauseIds, ...e.clauseIds])] } : structuredClone(e);
        const next = i >= 0 ? packet.map((x, n) => n === i ? merged : x) : [...packet, merged];
        if (next.length > 16 || Buffer.byteLength(JSON.stringify(next)) > 48000) {
            limit('localization_packet_budget');
            return null;
        }
        if (i >= 0)
            packet[i] = merged;
        else
            packet.push(merged);
        return merged;
    }
    function select(ids: {
        id: string;
        clauseId: string;
    }[], keepAcquired = false) {
        const planned = new Map<string, PurposeEvidence>();
        for (const { id, clauseId } of ids) {
            const e = candidates.find(x => x.id === id);
            if (!e)
                throw new Error('localization_selection_reference');
            const old = planned.get(id);
            planned.set(id, { ...e, clauseIds: [...new Set([...(old?.clauseIds ?? []), clauseId])] });
        }
        packet.length = 0;
        for (const e of planned.values())
            append(e);
        if (keepAcquired) for (const candidate of candidates)
            if (!planned.has(candidate.id)) append(candidate);
        return packet;
    }
    const collector = { evidence: packet, limitations, paths: () => [...files.values()].filter(f => f.side === 'head').map(f => f.path).slice(0, 200), metrics: () => ({ attempts, bytes }), read: async (req: PurposeReadRequest) => { const f = [...files.values()].find(x => x.path === req.path && x.side === req.side); if (!f || !safePurposePath(req.path) || req.startLine < 1 || req.endLine < req.startLine || req.endLine - req.startLine >= 80) {
            limit('read_rejected');
            return null;
        } exposed.add(f.id); const b = await load(f, req.endLine); const e = b ? materialize(b, req.startLine, req.endLine, req.clauseId) : null; return e ? append(e.evidence) : null; }, search: (query: string, paths: string[]) => packet.filter(e => paths.includes(e.path) && query && query.length <= 120 && e.content.includes(query)).map(e => ({ path: e.path, side: e.side, startLine: e.startLine, endLine: e.endLine })) };
    return { execute, initial: () => ({ roots: [...directories.values()].filter(x => !x.path), changed, manifestComplete: [...manifests].every(([, m]) => m.complete), capabilities: capabilities(), totalFiles: files.size }), candidates, select, collector, limitations, metrics: collector.metrics, dispose() { disposed = true; for (const s of services.values())
            s.service.dispose(); services.clear(); loaded.clear(); cache.clear(); occurrences.clear(); files.clear(); directories.clear(); exposed.clear(); candidates.length = 0; }, controlSource: async (id: string) => { const f = files.get(id); if (!f)
            throw new Error('localization_tool_reference'); exposed.add(id); return load(f, 80); }, fileLocators: () => [...files.values()].sort((a, b) => ordered(a.path, b.path) || ordered(a.side, b.side)) };
}
export type PurposeRepository = Awaited<ReturnType<typeof createPurposeRepository>>;
