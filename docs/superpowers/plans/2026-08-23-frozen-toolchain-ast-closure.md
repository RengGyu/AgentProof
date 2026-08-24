# Frozen Toolchain AST Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. Each task requires its own evidence
> and independent review before the next task begins.

**Goal:** Replace the unsound handwritten import scanner with a grammar-aware,
parser-bound static dependency closure and restore a trustworthy local
pre-freeze release gate.

**Architecture:** Recover the existing dirty candidate without destructive Git
operations, then dispatch executable source files to Acorn or the TypeScript
parser by extension. Normalize both ASTs into one static-specifier result,
preserve the existing closure walker, bind the actual parser runtimes into the
signed manifest, and require independent unseen-grammar review before the full
local gate.

**Tech Stack:** Node.js 22, Acorn 8.17.0 exact, TypeScript 5.9.x locked by pnpm,
pnpm 10.32.1, Node test runner, Vitest 4, SHA-256 manifests

**Spec:**
`docs/superpowers/specs/2026-08-23-frozen-toolchain-ast-closure-design.md`

## Global constraints

- Candidate path:
  `/private/tmp/agentproof-canonical-evidence-promotion`.
- Expected branch: `codex/canonical-evidence-promotion-release`.
- Expected unrecovered branch head:
  `fe56c7d60eaf1758b2cb8a78516c1895cb6c71bb`.
- Preserve every existing candidate file and user-owned dirty change.
- Never run `git reset --hard`, `git checkout -- <path>`, recursive deletion,
  worktree pruning, or automatic clean-up.
- Do not access, list, create, modify, or score protected corpus/oracle content.
- Do not commit, push, open a PR, merge, deploy, or publish external messages.
- The handwritten scanner must not remain as a fallback.
- Any accepted undeclared/dynamic dependency or unbound parser is an immediate
  `NO_GO`.

---

### Task 1: Recover and prove the candidate worktree

**Files:**

- Modify: no project source files
- Record: `.superpowers/sdd/2026-08-23-frozen-toolchain-ast-closure/task-1-recovery.md`

**Interfaces:**

- Consumes: surviving candidate directory and main repository worktree metadata.
- Produces: a trustworthy Git worktree with preserved dirty files, branch, and
  baseline SHA evidence.

- [ ] **Step 1: Record the read-only pre-repair state**

Run:

```bash
git -C /Users/jeonggyuju/Project_folder/AgentProof worktree list --porcelain
git -C /Users/jeonggyuju/Project_folder/AgentProof show-ref --verify refs/heads/codex/canonical-evidence-promotion-release
test -e /private/tmp/agentproof-canonical-evidence-promotion/.git
```

Expected: the candidate is reported as prunable because its gitdir marker is
missing; the branch ref exists at the expected SHA; the final `test` is
non-zero.

Record a content inventory that excludes protected and generated trees:

```bash
(
  set -euo pipefail
  cd /private/tmp/agentproof-canonical-evidence-promotion
  rg --files --hidden --no-ignore --sort path -0 \
    -g '!eval/**' -g '!node_modules/**' -g '!.next/**' \
    -g '!outputs/**' -g '!.git' -g '!.git/**' \
    | xargs -0 shasum -a 256 | shasum -a 256
)
(
  set -euo pipefail
  cd /private/tmp/agentproof-canonical-evidence-promotion
  rg --files --hidden --no-ignore -0 \
    -g '!eval/**' -g '!node_modules/**' -g '!.next/**' \
    -g '!outputs/**' -g '!.git' -g '!.git/**' \
    | tr -cd '\0' | wc -c
)
```

Expected: one aggregate SHA-256 and one file count; no file content or
protected path is printed. `--no-ignore` makes the inventory cover every
surviving file except the protected/generated trees and the Git metadata file
or directory;
the explicit subshell working directory prevents accidentally hashing the main
worktree. Preserve both values in the recovery record.

- [ ] **Step 2: Repair only the worktree metadata**

Run:

```bash
git -C /Users/jeonggyuju/Project_folder/AgentProof worktree repair /private/tmp/agentproof-canonical-evidence-promotion
```

Expected: exit `0`, without deleting or replacing candidate files.

- [ ] **Step 3: Verify metadata repair did not change surviving content**

Run the two inventory commands from Step 1 again before any other write.

Expected: aggregate hash and file count exactly match the pre-repair values. A
mismatch is `WORKTREE_RECOVERY_FAILED`.

- [ ] **Step 4: Verify branch, head, preserved changes, and tracked deletions**

Run:

```bash
git -C /private/tmp/agentproof-canonical-evidence-promotion branch --show-current
git -C /private/tmp/agentproof-canonical-evidence-promotion rev-parse HEAD
git -C /private/tmp/agentproof-canonical-evidence-promotion status --short -- . ':(exclude)eval/**'
git -C /private/tmp/agentproof-canonical-evidence-promotion diff --check -- . ':(exclude)eval/**'
git -C /private/tmp/agentproof-canonical-evidence-promotion ls-files --deleted -- . ':(exclude)eval/**'
```

Expected: the declared branch and SHA match, status succeeds and shows the
preserved dirty candidate, and diff check reports no whitespace error. If any
expected file disappeared or Git cannot account for the tree, stop with
`WORKTREE_RECOVERY_FAILED`.

- [ ] **Step 5: Stop at the missing-content authority gate**

The current candidate is verified to be missing `pnpm-lock.yaml`, so at least
one tracked deletion is expected. Do not restore it automatically. Record:

```text
RECOVERY_CONTENT_DECISION_REQUIRED
trackedDeletionCount: <integer>
pnpmLockPresent: false
```

Ask the user to authorize exactly one later recovery package: restore verified
missing tracked files into this repaired worktree, or create a clean worktree
and migrate the bounded dirty candidate. Neither action is authorized by this
plan-writing task.

- [ ] **Step 6: Write the recovery record with `apply_patch`**

Record the four commands, exit codes, branch, SHA, and status summary. Do not
copy source, secrets, protected paths, or full diffs into the record.

**Task gate:** A separate read-only reviewer confirms metadata repair preserved
the surviving candidate. Task 2 remains blocked until a user-approved content
recovery completes, `pnpm-lock.yaml` exists, and tracked-deletion handling is
recorded as `RECOVERY_CONTENT_APPROVED`.

---

### Task 2: Freeze the parser contract and write RED tests

**Files:**

- Modify: `scripts/build-evaluation-toolchain-manifest.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: the recovered candidate and the design spec extension table.
- Produces: exact direct Acorn dependency and failing tests for AST extraction,
  parser binding, malformed input, and no-fallback behavior.

- [ ] **Step 0: Verify the recovery authorization and dependency baseline**

Require `RECOVERY_CONTENT_APPROVED`, an existing `pnpm-lock.yaml`, and zero
unexplained tracked deletions outside protected paths. Then run:

```bash
pnpm install --frozen-lockfile
```

Expected: exit `0` with no lockfile change before Acorn is added.

- [ ] **Step 1: Pin Acorn as a direct development dependency**

Change the development dependency to an exact version:

```json
{
  "devDependencies": {
    "acorn": "8.17.0"
  }
}
```

Run:

```bash
pnpm add -D -E acorn@8.17.0
```

Expected: only `package.json`, `pnpm-lock.yaml`, and the install tree change.
Confirm TypeScript remains direct and the lockfile resolves the exact Acorn
version.

- [ ] **Step 2: Add the known general-regression pair**

Add a negative case:

```js
writeFileSync(
  join(root, "tools/runner.mjs"),
  "export const load = () => `${/}/.test(\"}\") && import(\"../src/sut.mjs\")}`;\n"
);
assert.throws(
  () => buildEvaluationToolchainManifest({ rootDir: root, config }),
  /dynamic or generated runtime code/
);
```

Add the paired safe control:

```js
writeFileSync(
  join(root, "tools/runner.mjs"),
  "export const value = `${/}/.test(\"}\")}`;\n"
);
assert.doesNotThrow(() =>
  buildEvaluationToolchainManifest({ rootDir: root, config })
);
```

- [ ] **Step 3: Add grammar and false-positive RED cases**

Add tests asserting:

```js
assert.throws(() => buildWithSource("const = ;\n"), /tooling source syntax/);
assert.doesNotThrow(() => buildWithSource("export const p = /createRequire/;\n"));
assert.doesNotThrow(() => buildWithSource("export const s = `raw import(\"x\")`;\n"));
assert.throws(() => buildWithSource("export const x = import(\"./helper.mjs\");\n"), /dynamic or generated runtime code/);
```

Implement `buildWithSource` only as a test helper around the existing synthetic
tool tree; do not add production behavior yet.

- [ ] **Step 4: Add extension and capability RED cases**

Test `.mjs`, `.cjs`, `.ts`, `.tsx`, and `.json` positive controls. For `.js`,
test root CommonJS default, root `type: "module"`, and a nested package that
overrides the root mode; assert the controlling package file joins the declared
closure's existing `sourceFiles` collection. Reject a `.coffee` tooling entry.
Do not create any assertion for `parserArtifacts`, a parser-inclusive rollup,
`toolingBuiltinImports`, or its hash in Task 2; all four binding RED categories
are first written at the start of Task 4.

Add a TypeScript positive case for
`import helper = require("./helper.cjs")` and assert the helper joins the same
declared closure. Add a negative non-literal/unresolved import-equals case and
assert it fails rather than disappearing from `staticSpecifiers`.

Add negative controls for `node:worker_threads`, `node:child_process`,
`node:vm`, Worker `eval`, `(() => {}).constructor(...)`, computed
`["constructor"]`, `Reflect`, `Proxy`, and `Object.getPrototypeOf`. Add positive
controls for each approved production built-in. Add explicit failures for
`const F = Function; F(...)`, `{ Function: F } = globalThis`,
`global.Function`, optional `Function?.(...)`, passing `Function` as an
argument, and returning it from a function. At this stage verify only that each
approved built-in is accepted and every built-in outside the fixed safe
universe is rejected; exact list/hash binding belongs to Task 4.

- [ ] **Step 5: Run RED**

Run:

```bash
node --test scripts/build-evaluation-toolchain-manifest.test.mjs
```

Expected: new tests fail because the current scanner accepts the bypass and
malformed JavaScript, rejects the harmless regex, has no extension dispatch,
and does not enforce the closed capability policy. Existing tests must still
pass within the same run.

**Task gate:** Reviewer confirms the tests are behavior categories, not a list
of production string matches.

---

### Task 3: Implement grammar-aware source scanning

**Files:**

- Create: `scripts/tooling-source-scan.mjs`
- Create: `scripts/tooling-source-scan.test.mjs`
- Modify: `scripts/build-evaluation-toolchain-manifest.mjs`
- Test: `scripts/build-evaluation-toolchain-manifest.test.mjs`

**Interfaces:**

- Consumes:

```ts
resolveToolingSourceDescriptor({
  rootDir: string,
  path: string
}): ToolingSourceDescriptorV1

scanToolingSource({
  path: string,
  source: string,
  sourceMode: "module" | "script" | "typescript" | "tsx" | "json"
}): ToolingSourceScanV1
```

- Produces:

```ts
interface ToolingSourceScanV1 {
  version: 1;
  sourceKind: "esm" | "commonjs" | "typescript" | "tsx" | "json";
  staticSpecifiers: string[];
}
```

- [ ] **Step 1: Create extension dispatch and parse-failure behavior**

Use Acorn for JavaScript, the TypeScript compiler parser for TS/TSX, and
`JSON.parse` for JSON leaves. `.mjs` is ESM, `.cjs` is CommonJS, and `.js`
follows the nearest root-bounded package.json `type` with CommonJS as the
missing-type default. Reject unsupported extensions. Convert parser errors to
one bounded message such as `tooling source syntax is invalid` and do not
include full source text.

Freeze the options exactly:

```js
acorn.parse(source, {
  ecmaVersion: 2024,
  allowHashBang: true,
  sourceType
});

ts.createSourceFile(
  path,
  source,
  ts.ScriptTarget.ES2024,
  true,
  sourceMode === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS
);
```

Any Acorn parse error or TypeScript `parseDiagnostics` entry is a fixed
failure. The `.js` descriptor returns `controllingPackagePath`; the walker adds
that package file as a declared hashed leaf rather than allowing the parser to
read the filesystem.

- [ ] **Step 2: Implement the normalized AST visitor**

Collect only static string-literal specifiers from import declarations, export
declarations, side-effect imports, TypeScript `ImportEqualsDeclaration` /
`ExternalModuleReference`, and permitted direct CommonJS requires. A
TypeScript external-module reference must contain exactly one static string
literal or fail. Return sorted unique values.

- [ ] **Step 3: Implement the forbidden-form visitor**

Reject AST nodes for `import()`, dynamic/aliased require, and forbidden loader
modules/member access. Reject every runtime value-position reference to
`eval`, `Function`, `AsyncFunction`, `GeneratorFunction`, and
`AsyncGeneratorFunction`, including direct/optional calls, assignment,
aliasing, destructuring, argument passing, returns, and constructor calls;
declaration bindings and non-computed property keys are the only syntactic
non-value positions. Do not treat shadowing as permission. Reject the
`module`, `globalThis`, and Node `global` globals. Permit `process` only as the
direct receiver of `argv`, `stdout`, `stderr`, or `exitCode`; reject computed,
aliased, and all other process access. Validate config's sorted
`toolingBuiltinImports` against the safe universe `node:crypto`, `node:fs`,
`node:path`, `node:perf_hooks`, `node:url`, and `node:util`, then reject every
undeclared built-in. Reject Worker/child-process/VM capabilities,
statically recoverable `constructor`/`prototype`/`__proto__` access, `Reflect`,
`Proxy`, and the named Object reflection methods in the spec. Treat raw text in
strings, comments, templates, and regex literals as non-executable.

- [ ] **Step 4: Replace scanner authority**

Change `walkStaticImports` to call:

```js
const descriptor = resolveToolingSourceDescriptor({ rootDir: root, path });
const { staticSpecifiers } = scanToolingSource({
  path,
  source,
  sourceMode: descriptor.sourceMode
});
```

When present, visit and hash `descriptor.controllingPackagePath` as a declared
JSON leaf. It must not be silently read without joining the closure.

Delete `staticImports`, `tokenize`, `readStringToken`,
`readTemplateLiteral`, and `readTemplateExpressionEnd`. There must be no catch
block that invokes the old scanner after parser failure.

- [ ] **Step 5: Run focused GREEN**

Run:

```bash
node --test scripts/tooling-source-scan.test.mjs
node --test scripts/build-evaluation-toolchain-manifest.test.mjs
```

Expected: all old and new scanner/manifest tests pass.

This gate covers source parsing, source-mode selection, dependency collection,
and capability rejection only. “All new” means tests introduced through Task 3;
Task 4 binding tests must not exist yet. The Task 4 worker first writes and
records those binding REDs only after this gate is green.

**Task gate:** An independent reviewer receives only the required invariants
and supplies unseen valid-JavaScript grammar combinations. Any accepted dynamic
dependency or rejected harmless raw-text control blocks Task 4.

---

### Task 4: Bind parser runtimes into the manifest

**Files:**

- Modify: `scripts/build-evaluation-toolchain-manifest.mjs`
- Modify: `scripts/build-evaluation-toolchain-manifest.test.mjs`
- Modify: `scripts/evaluate-production-authority-release.mjs`
- Modify: `scripts/evaluate-production-authority-release.test.mjs`
- Modify only for the factual parser/built-in-binding sentence:
  `docs/superpowers/specs/2026-08-22-production-authority-blind-evaluation-rubric.v1.json`

**Interfaces:**

- Consumes: loaded Acorn and TypeScript runtime versions and resolved entry
  files.
- Produces: exact sorted `parserArtifacts` and a source-closure rollup over
  `{ sourceFiles, parserArtifacts }`, plus exact built-in allowlist binding.

- [ ] **Step 1: Add exact parser artifact construction**

Before changing production code, add RED assertions for the exact sorted
`parserArtifacts` envelope and mutations to parser version, parser entry hash,
artifact order, unknown/duplicate entries, and the source-closure rollup. Run
the focused manifest test once and record that these new binding assertions
fail while the completed Task 3 scanner tests remain green.

Construct only:

```js
[
  { id: "acorn", version: acornVersion, entrySha256: acornEntryHash },
  { id: "typescript", version: ts.version, entrySha256: typescriptEntryHash }
]
```

Resolve and hash the actual loaded entry files. Reject missing, duplicate,
unknown, unsorted, malformed, or mismatched artifacts.

Use the runtime module versions plus their actual resolved entry files:

```js
const acornEntry = fileURLToPath(import.meta.resolve("acorn"));
const typescriptEntry = fileURLToPath(import.meta.resolve("typescript"));
```

Derive the parser trust root from the manifest-builder module's
`import.meta.url`, not from caller-supplied `rootDir`. Require both real paths
to remain inside that builder repository root before hashing. A global or
parent-directory resolution is invalid. This keeps temporary synthetic tooling
roots valid while binding the parser actually loaded by the builder.

Treat the bare imports `acorn` and `typescript` as parser-bound leaves only when
the loaded version and resolved entry hash match `parserArtifacts`. Do not add a
generic bare-package allowlist.

- [ ] **Step 2: Include parser artifacts in the closure rollup**

Use:

```js
canonicalSha256({ sourceFiles, parserArtifacts })
```

for both generation and validation. Do not accept the old source-files-only
rollup for the new candidate.

Add exact sorted `toolingBuiltinImports` and
`evaluationToolchainBuiltinAllowlistSha256` fields. Recompute the hash from the
list and reject values outside the spec's safe universe. Add mutation tests for
unknown, unsafe, missing, duplicate, unsorted, and stale-hash entries.
Add these built-in envelope/hash assertions as RED cases before implementing
the fields; do not retroactively make Task 3 depend on them.

- [ ] **Step 3: Close release-assessment validation**

Make the assessment accept only the new exact manifest shape and reject
parser-artifact mutations before scoring. The assessment output must remain the
same aggregate-only shape and omit parser paths and hashes.

- [ ] **Step 4: Apply the narrow rubric correction**

Add parser artifacts and the exact built-in allowlist/hash binding to the
existing frozen-manifest pass condition. The release assessment must reject a
missing, extra, unsafe, unsorted, duplicate, or stale built-in allowance before
scoring. Do not change evidence source authority, points, thresholds, category
counts, or binary gates.

- [ ] **Step 5: Run focused GREEN**

Run:

```bash
node --test scripts/build-evaluation-toolchain-manifest.test.mjs
node --test scripts/evaluate-production-authority-release.test.mjs
node --test scripts/evaluate-evidence-release-gate.test.mjs
node --test scripts/evaluate-production-boundary-release-gate.test.mjs
```

Expected: all commands exit `0`, parser mutations reject, and aggregate output
has no parser details.

**Task gate:** A read-only provenance reviewer verifies that the manifest binds
the parser actually used, not merely package.json text or a self-reported
version.

---

### Task 5: Independent skeptical grammar and trust review

**Files:**

- Modify: no production files unless a reviewer finding is separately accepted
- Record: `.superpowers/sdd/2026-08-23-frozen-toolchain-ast-closure/task-5-review.md`

**Interfaces:**

- Consumes: the Task 4 candidate, design invariants, and no fixture catalog.
- Produces: `CLEAR` or evidence-backed Critical/Important findings.

- [ ] **Step 1: Assign an independent reviewer**

Provide purpose, source extensions, forbidden executable forms, parser binding,
and acceptance commands. Do not provide the implementer's test list or favored
AST-node implementation.

- [ ] **Step 2: Probe unseen grammar classes**

The reviewer must independently vary regex/division context, nested templates,
Unicode escapes, optional chains, computed members, comments, ASI, import/export
forms, CommonJS aliases, parser errors, and parser-artifact mutations.

- [ ] **Step 3: Verify no product drift**

Confirm no evidence-report status, verifier promotion, public schema, storage,
tenant, UI, or protected evaluation path changed.

- [ ] **Step 4: Record bounded evidence**

Record commands, exit codes, findings, and remaining uncertainty without raw
protected data or full source dumps.

**Task gate:** Critical/Important count must be `0`. After three failed repair
rounds, stop and return to architecture review rather than adding another local
parser patch.

---

### Task 6: Run the full local pre-freeze gate

**Files:**

- Modify: no source files during verification
- Record: `.superpowers/sdd/2026-08-23-frozen-toolchain-ast-closure/task-6-verification.md`

**Interfaces:**

- Consumes: the independently cleared candidate.
- Produces: truthful local pre-freeze status; it does not authorize protected
  evaluation or deployment.

- [ ] **Step 1: Run all engineering commands on the same candidate**

```bash
node --test scripts/tooling-source-scan.test.mjs
node --test scripts/build-evaluation-toolchain-manifest.test.mjs
node --test scripts/evaluate-production-authority-release.test.mjs
node --test scripts/evaluate-evidence-release-gate.test.mjs
node --test scripts/evaluate-production-boundary-release-gate.test.mjs
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

- [ ] **Step 2: Verify the diff boundary**

Run:

```bash
git status --short
git diff -- package.json pnpm-lock.yaml scripts/build-evaluation-toolchain-manifest.mjs scripts/build-evaluation-toolchain-manifest.test.mjs scripts/tooling-source-scan.mjs scripts/tooling-source-scan.test.mjs scripts/evaluate-production-authority-release.mjs scripts/evaluate-production-authority-release.test.mjs docs/superpowers/specs/2026-08-22-production-authority-blind-evaluation-rubric.v1.json
```

Expected: only the approved parser, manifest, assessment, dependency, tests,
and narrow rubric correction belong to this work package. Existing unrelated
dirty files remain untouched.

- [ ] **Step 3: Apply the implementation-quality score**

Use the six categories and binary gates in the design spec. Record evidence for
each category. A failed binary gate is `NO_GO` even when the numeric score is
95 or higher.

- [ ] **Step 4: Report the truthful boundary**

If all local gates pass, report:

```text
LOCAL_PRE_FREEZE_CLEAR
Protected evaluation: NOT RUN
Commit/push/deploy: NOT AUTHORIZED
```

Otherwise report `NO_GO` with the exact failed command or reviewer finding.

**Task gate:** The supervisor independently checks command outputs and at most
three must-read diffs before presenting the result to the user.
