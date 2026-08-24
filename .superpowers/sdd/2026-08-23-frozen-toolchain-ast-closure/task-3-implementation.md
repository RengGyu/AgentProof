# Task 3 — AST source scanning

Status: `GREEN_WITH_UNRELATED_TYPECHECK_FAILURE`

## Implemented boundary

- Added `scripts/tooling-source-scan.mjs` with extension-closed source descriptors:
  Acorn `8.17.0` for `.mjs`, `.cjs`, and package-mode `.js`; TypeScript for
  `.ts` and `.tsx`; and `JSON.parse` for `.json` leaves.
- The descriptor resolves the nearest root-bounded `package.json` for `.js`
  mode and the manifest walker hashes that controlling package file as a
  declared closure leaf.
- Replaced the handwritten token/template scanner entirely. The closure walker
  now uses the scanner's sorted unique static specifiers, with no fallback.
- The AST policy rejects dynamic imports, nonliteral or aliased `require`,
  code constructors, loaders, unsafe built-ins, worker/VM capabilities,
  global/module escapes, unsafe `process` use, and recoverable reflection.

## Verification

- `node --test scripts/tooling-source-scan.test.mjs`: exit `0`; 2 tests passed.
- `node --test scripts/build-evaluation-toolchain-manifest.test.mjs`: exit `0`;
  19 tests passed.
- `git diff --check`: exit `0`.
- `pnpm typecheck`: exit `2`, outside this task's allowed scope. The current
  worktree is missing `src/lib/proof-promotion-policy` and
  `src/lib/evidence-receipts`; TypeScript reports four imports of those absent
  modules from `report-runtime-validation.ts`, `report-validation.ts`, and
  `verifier.ts`. No typecheck failure is attributed to the Task 3 files.

## Scope

Changed only the scanner, its focused test, and the manifest closure walker
within this task package. No manifest parser-artifact/built-in-list binding was
added; that remains Task 4 scope.
