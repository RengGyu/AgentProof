# Frozen Toolchain AST Closure Design

**Status:** Approved direction, implementation not started.

**Extends:**

- `docs/superpowers/specs/2026-08-22-production-authority-blind-evaluation-design.md`
- `docs/superpowers/specs/2026-08-22-production-authority-blind-evaluation-rubric.v1.json`

**Release state:** `NO_GO` until every mandatory gate in this document passes.

## 1. Goal

Replace the handwritten JavaScript token scanner used by the frozen evaluation
toolchain manifest with grammar-aware AST parsing. The resulting manifest must
fail closed when executable tooling contains an undeclared static dependency,
direct dynamic module-loading syntax, a forbidden loader/code-construction
capability, unsupported syntax, an unbound parser runtime, or an unsupported
source extension.

This change protects the evaluation tooling used to assess AgentProof. It does
not change evidence-report semantics, requirement outcomes, verifier promotion
rules, public report schemas, or UI behavior.

## 2. Verified defect and root cause

The current scanner in
`scripts/build-evaluation-toolchain-manifest.mjs` manually recognizes strings,
comments, template literals, words, and punctuation. Its
`readTemplateExpressionEnd()` function counts braces but does not recognize
regular-expression literals.

This valid JavaScript is therefore accepted even though it contains an
undeclared dynamic import:

```js
export const load = () =>
  `${/}/.test("}") && import("../src/sut.mjs")}`;
```

The regex `}` is mistaken for the end of the template substitution. The
remaining executable `import()` is treated as raw template text and is never
examined.

The same scanner also:

- accepts malformed JavaScript such as `const = ;`;
- rejects harmless regex text such as `/createRequire/`;
- passes its existing nine tests because those tests do not cover regex-literal
  grammar.

The defect is architectural. JavaScript `/` is context-dependent: it may start
a regex or represent division. Adding another character-state branch would
continue reimplementing a JavaScript parser and would not close the trust
boundary.

## 3. Purpose lock

The implementation must preserve all of the following:

- deterministic evidence before model judgment;
- exact, reproducible toolchain manifests;
- explicit SUT import allowlists;
- a closed Node built-in capability allowlist for frozen production tooling;
- no network or protected-corpus access during development tests;
- no raw source, secret, token, oracle, or protected case identifier in release
  assessment output;
- fail-closed results when evidence, parser state, or runtime state is
  incomplete;
- the existing path normalization, declared-file closure, bundle hashing,
  sandbox-profile binding, lockfile binding, and runtime-image binding;
- no commit, push, deployment, or protected evaluation without separate user
  authorization.

The implementation must not:

- add fixture-specific or attack-string-specific production branches;
- retain the handwritten scanner as a fallback authority;
- interpret a passing unit test as proof of general parser correctness;
- weaken dynamic import, require, eval, `Function`, or loader-construction
  rejection to preserve old fixtures;
- alter AgentProof requirement or evidence-report outcomes;
- repair the broken candidate worktree with destructive Git commands.

## 4. Recovery prerequisite

The candidate directory
`/private/tmp/agentproof-canonical-evidence-promotion` currently has no `.git`
marker. `git worktree list --porcelain` reports that its gitdir points to a
non-existent location, while branch
`codex/canonical-evidence-promotion-release` still points to
`fe56c7d60eaf1758b2cb8a78516c1895cb6c71bb`.

No implementation edit may occur until all of the following are true:

1. `git worktree repair /private/tmp/agentproof-canonical-evidence-promotion`
   completes without deleting or replacing candidate files.
2. `git -C /private/tmp/agentproof-canonical-evidence-promotion status --short`
   succeeds and shows the preserved dirty changes.
3. `git -C /private/tmp/agentproof-canonical-evidence-promotion branch
   --show-current` returns `codex/canonical-evidence-promotion-release`.
4. `git -C /private/tmp/agentproof-canonical-evidence-promotion rev-parse HEAD`
   returns `fe56c7d60eaf1758b2cb8a78516c1895cb6c71bb` unless a newer base was
   explicitly approved.
5. The recovered worktree has a complete `pnpm-lock.yaml` and a working clean
   dependency install. If files are missing or the status cannot be trusted,
   stop with `WORKTREE_RECOVERY_FAILED`; do not reset, checkout, or recreate the
   tree automatically.

The current surviving directory is known to be missing `pnpm-lock.yaml` even
though the branch tree contains it. Therefore metadata repair alone cannot
authorize implementation. Task 1 must first produce a bounded pre/post file
inventory and a post-repair tracked-deletion report. Restoring missing tracked
content or migrating the dirty candidate to a clean worktree is a separate
user decision; the execution plan must stop at that decision gate.

## 5. Parser architecture

### 5.1 Supported source kinds

The manifest builder must recognize source type from a closed extension set:

| Extension | Parser | Source mode |
|---|---|---|
| `.mjs` | Acorn | ECMAScript module |
| `.cjs` | Acorn | script/CommonJS |
| `.js` | Acorn | nearest `package.json` `type`; missing `type` means CommonJS |
| `.ts`, `.tsx` | TypeScript compiler parser | TypeScript/TSX |
| `.json` | `JSON.parse` | hashed leaf, no imports |

Every other extension is rejected with a bounded
`unsupported tooling source extension` error.

Acorn must be declared as an exact direct development dependency. The
implementation must not rely on the currently transitive pnpm installation.
TypeScript remains the already declared direct development dependency.

### 5.2 Source mode and normalized scan result

Filesystem-dependent `.js` mode resolution happens in the closure walker
before parsing:

```ts
interface ToolingSourceDescriptorV1 {
  version: 1;
  path: string;
  sourceMode: "module" | "script" | "typescript" | "tsx" | "json";
  controllingPackagePath?: string;
}

scanToolingSource({
  path: string,
  source: string,
  sourceMode: ToolingSourceDescriptorV1["sourceMode"]
}): ToolingSourceScanV1
```

The walker, not the parser, reads the root-bounded package file. When a
`controllingPackagePath` is present it is added as a hashed leaf in the same
declared closure. The parser performs no hidden filesystem access.

The parsers use frozen grammar settings:

- Acorn `8.17.0`, `ecmaVersion: 2024`, `allowHashBang: true`, and the resolved
  `sourceType`;
- TypeScript `ScriptTarget.ES2024`, `setParentNodes: true`, and extension-matched
  `ScriptKind.TS` or `ScriptKind.TSX`;
- any Acorn parse error or TypeScript `parseDiagnostics` entry fails closed.

Both AST visitors produce the same internal result:

```ts
interface ToolingSourceScanV1 {
  version: 1;
  sourceKind: "esm" | "commonjs" | "typescript" | "tsx" | "json";
  staticSpecifiers: string[];
}
```

`staticSpecifiers` must be sorted and unique. Parser diagnostics or policy
violations throw and produce no partial result.

### 5.3 Static dependencies

The scanners must collect string-literal module specifiers from:

- `import ... from "specifier"`;
- `import "specifier"`;
- `export ... from "specifier"`;
- TypeScript `ImportEqualsDeclaration` nodes whose
  `ExternalModuleReference.expression` is a string literal, including
  `import x = require("specifier")` and exported import-equals declarations;
- direct CommonJS `require("specifier")` in `.cjs` or `.js` files resolved as
  CommonJS.

A TypeScript external-module reference without a single static string literal
is rejected; it is never omitted from the closure or treated as a runtime-only
detail.

Every collected relative specifier continues through the existing normalized
path, declared tooling file, and fixed SUT allowlist checks. Manifest config
must declare a sorted unique `toolingBuiltinImports` list. Its values are
restricted to the safe universe `node:crypto`, `node:fs`, `node:path`,
`node:perf_hooks`, `node:url`, and `node:util`; a particular manifest should
declare only the members its production closure actually imports. The list and
its canonical SHA-256 are stored in the exact manifest. Tests are outside the
signed production tooling closure and do not expand this set. Every other
`node:*` or bare package import is rejected, except the two frozen parser
dependencies described in section 6.

JavaScript module mode must not be guessed from the manifest builder's own
package. `.js` resolution walks toward the declared root, uses the nearest
bounded `package.json`, accepts only `type: "module"` or `type: "commonjs"`,
and defaults to CommonJS when `type` is absent. The package file that controls
source mode must participate in the declared tooling closure.

### 5.4 Forbidden executable forms

The AST policy must reject:

- every `import()` expression, including a literal argument;
- non-literal or aliased `require`;
- `node:module` and `node:vm` imports;
- `createRequire`, `getBuiltinModule`, `_load`, `module.require`, and computed
  literal equivalents;
- direct or indirect references that assign `require` or a forbidden loader to
  another variable;
- every runtime value-position reference to `eval`, `Function`,
  `AsyncFunction`, `GeneratorFunction`, or `AsyncGeneratorFunction`, not only
  direct calls. This includes assignment, aliasing, destructuring, passing as
  an argument, returning, optional calls, and constructor calls. Declaration
  binding names and non-computed property keys are not value-position uses;
  shadowing does not relax this conservative frozen-tooling rule;
- importing or referencing `Worker`, `SharedWorker`, `child_process`,
  `worker_threads`, `vm`, or native-addon/WASI/FFI loaders;
- property or element access whose statically recoverable name is
  `constructor`, `prototype`, or `__proto__`;
- `Reflect`, `Proxy`, `Object.getPrototypeOf`,
  `Object.getOwnPropertyDescriptor`, and equivalent statically recoverable
  reflection access used to obtain a code constructor;
- parser diagnostics and malformed source.

To prevent computed loader aliases without implementing whole-program dataflow:

- any `module` global reference is rejected;
- any `globalThis` or Node `global` access is rejected in frozen tooling;
- `process` may appear only as the direct receiver of `argv`, `stdout`,
  `stderr`, or `exitCode` property access;
- computed `process[...]`, assigning `process` to another value, or every other
  `process` property is rejected.

Raw strings, comments, regex literals, and non-substitution template text that
contain words such as `import`, `require`, or `createRequire` are not executable
nodes and must not be rejected for those words alone.

The scanner establishes grammar-correct dependency closure and rejects the
closed capability set above. It does not claim to prove the absence of every
possible JavaScript computation. The signed source hashes, exact built-in
allowlist, independent review, and no-network/read-only sandbox remain
mandatory, separate defenses. Release language must not describe the AST scan
alone as a JavaScript sandbox or proof of general runtime safety.

### 5.5 No fallback

The functions `tokenize`, `readStringToken`, `readTemplateLiteral`, and
`readTemplateExpressionEnd` must be removed from release authority. If AST
parsing is unavailable or fails, manifest generation fails. The old scanner
must not run as a fallback or vote in parallel.

## 6. Parser trust binding

The parser implementation becomes part of the evaluation trust boundary.

`EvaluationToolchainManifestV1` must add the exact field:

```ts
parserArtifacts: [
  {
    id: "acorn";
    version: string;
    entrySha256: string;
  },
  {
    id: "typescript";
    version: string;
    entrySha256: string;
  }
];
```

It must also add:

```ts
toolingBuiltinImports: string[];
evaluationToolchainBuiltinAllowlistSha256: string;
```

Rules:

- entries are sorted by `id` and have exact keys;
- `id` is limited to the two values above;
- version must match the loaded parser runtime;
- `entrySha256` is recomputed from the actual resolved parser entry file;
- the source-closure rollup hash is recomputed over both `sourceFiles` and
  `parserArtifacts`;
- the built-in allowlist hash is recomputed from the exact sorted
  `toolingBuiltinImports` list;
- the lockfile, package scripts, and runtime-image hashes remain separately
  bound;
- a parser version, entry file, lockfile, or rollup change invalidates the
  frozen manifest;
- an unknown, unsafe, missing, duplicate, unsorted, or hash-mismatched built-in
  allowance invalidates the manifest;
- the aggregate release assessment never emits parser paths, parser source, or
  parser bytes.

When the manifest scanner encounters the bare imports `acorn` or `typescript`
in its own declared tooling closure, it treats them only as the two
parser-bound leaves above. Every other bare package remains undeclared. The
loaded module version, resolved entry file, and recorded artifact must refer to
the same runtime instance; hashing an unrelated path is invalid. Parser paths
are resolved relative to the manifest-builder module and must remain inside the
builder's repository root after `realpath`. This parser trust root is derived
from `import.meta.url`; it is not caller-controlled and is distinct from the
synthetic `rootDir` whose tooling tree is being tested. Resolution to a
parent/global `node_modules` directory fails closed.

The rubric may receive only the narrow factual corrections needed to state
that the signed manifest binds both parser artifacts and the exact built-in
allowlist plus its canonical hash. The release assessment must validate both
bindings before the frozen-manifest gate can pass. Score weights, evidence
authority, category counts, binary gates, and release thresholds must not
change.

## 7. Data flow

```text
declared tooling entry
-> extension dispatch
-> grammar-aware parser
-> normalized static specifiers OR fixed failure
-> existing path/allowlist closure walker
-> source + parser artifact hashes
-> exact signed toolchain manifest
-> closed release assessment
```

Failure to parse or bind the parser produces no manifest and therefore no
deployment-eligible assessment.

## 8. Required regression matrix

### Positive controls

- normal static helper import;
- side-effect import;
- `export ... from`;
- fixed allowlisted SUT import;
- valid regex `/}/` without dynamic import;
- raw template text containing `import()` and `require()`;
- comments and strings containing forbidden loader names;
- valid JSON leaf;
- valid TS import when `.ts` is declared.

### Negative controls

- the exact regex/template dynamic-import bypass;
- nested template, object, conditional, optional-chain, and callback dynamic
  imports;
- dynamic or aliased require;
- TypeScript import-equals with a non-literal or otherwise unresolved external
  module reference;
- `node:module`, `node:vm`, `createRequire`, `getBuiltinModule`, `_load`, and
  `module.require` forms;
- `eval`/`Function` family direct calls, optional calls, assignments,
  destructuring, and aliases, including
  `const F = Function; F("return import('../src/sut.mjs')")()`;
- Node `global`, `globalThis`, and their computed or destructured constructor
  access;
- Worker/child-process/VM capabilities and reflection-based function
  constructors;
- every unapproved `node:*` built-in;
- malformed JS, TS, and JSON;
- undeclared relative imports;
- unallowlisted SUT imports;
- unsupported extensions;
- missing parser runtime;
- parser version, parser entry hash, parser-artifact order, lockfile, or
  source-closure rollup mutation.

The exact known bypass is a regression case, not the implementation rule. At
least one independent reviewer must test unseen grammar combinations without
receiving the implementation worker's fixture catalog.

## 9. Release gates

All gates are mandatory and fail closed.

### Binary gates

- accepted undeclared or dynamic dependency count: `0`;
- accepted malformed executable tooling count: `0`;
- rejected safe regex/string/comment control count: `0`;
- parser artifacts missing or internally inconsistent: `0`;
- handwritten fallback invocations: `0`;
- protected corpus/oracle access during development: `0`;
- independent-review Critical or Important findings: `0`;
- worktree recovery uncertainty: `0`.

### Engineering commands

```bash
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

Passing these commands proves only their covered behavior. It does not replace
the independent grammar review or authorize protected evaluation, commit,
push, or deployment.

## 10. Implementation quality assessment

Score only after every binary gate passes. Any failed binary gate produces
`NO_GO` regardless of score.

Each semicolon-separated scoring unit below is worth exactly five points. A
unit receives five only when all named evidence passes; otherwise it receives
zero. No reviewer may award partial points inside a unit.

| Category | Points | Five-point scoring units |
|---|---:|---|
| Grammar-correct extraction | 30 | static/dynamic JS; regex/template; raw string/comment; malformed source; TS/TSX; `.js` mode/JSON/extensions |
| Parser trust binding | 20 | loaded versions; actual entry hashes; closure rollup; parser/lock mutation rejection |
| Closure compatibility | 15 | path/declared closure; SUT and built-in allowlists; bundle/lock/runtime/sandbox bindings |
| Fail-closed behavior | 15 | no fallback; missing/unsupported parser state; bounded errors with no partial manifest |
| Independent generalization review | 10 | unseen grammar review; product/privacy boundary review |
| Full engineering verification | 10 | focused commands; full test/type/lint/build/diff commands |

Interpretation:

- `95–100`: eligible to proceed to protected freeze preparation, not deployment;
- `85–94`: conditional candidate; correct gaps must be fixed and re-reviewed;
- below `85`: `NO_GO`;
- any binary-gate failure: `NO_GO` regardless of points.

## 11. Rollback

If a false acceptance, parser-binding mismatch, or independent Critical finding
appears after implementation:

1. stop manifest publication and protected evaluation;
2. retain the AST implementation and diagnostics for investigation;
3. mark the candidate `NO_GO`;
4. do not reactivate the handwritten scanner;
5. repair the parser policy or freeze binding under a new reviewed candidate;
6. regenerate the manifest only after the full gate passes.

## 12. Non-goals

- changing AgentProof evidence or contract semantics;
- changing UI, report persistence, public share, or tenant projection;
- creating or reading protected corpus/oracle files;
- executing a protected release assessment;
- supporting arbitrary JavaScript package loaders;
- proving general JavaScript runtime safety from AST alone;
- committing, pushing, merging, or deploying.
