# Task 2 — Parser pin and RED tests

Status: `RED_READY`

## Baseline and dependency

- `pnpm install --frozen-lockfile`: exit `0` after an initial sandbox DNS
  failure was retried in the approved package-install environment.
- `pnpm add -D -E acorn@8.17.0`: exit `0`.
- `package.json` and `pnpm-lock.yaml` now declare and resolve exact
  `acorn@8.17.0`.

## RED evidence

`node --test scripts/build-evaluation-toolchain-manifest.test.mjs` exited `1`:

- `19` tests total;
- `12` pass, including the existing closure, loader, template, SUT allowlist,
  manifest-integrity, and schema behavior;
- `7` intentional failures expose the missing AST behavior: regex/template
  dynamic import, regex false positive, malformed source, unsupported
  extension, JavaScript package-mode closure, forbidden capability, and unsafe
  built-in.

`git diff --check` exited `0`. No production scanner, manifest, or assessment
file was changed in this task.

## Scope ruling

Ruling: retain the six recovered evaluation scripts already present in
`package.json` — source and destination script maps are byte-for-byte equal;
the only destination-only development dependency is `acorn: "8.17.0"`. Cost if
wrong: unrelated recovered work could be co-reviewed with this plan, so Task 6
must keep the diff boundary explicit and not attribute those scripts to Task 2.
