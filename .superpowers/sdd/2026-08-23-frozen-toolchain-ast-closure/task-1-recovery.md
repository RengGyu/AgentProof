# Task 1 — Clean worktree recovery

Status: `RECOVERY_CONTENT_APPROVED`

The user approved the clean-worktree migration path on 2026-08-24. No missing
tracked file was restored into the damaged candidate.

## Candidate metadata repair

- Candidate: `/private/tmp/agentproof-canonical-evidence-promotion`
- Expected branch: `codex/canonical-evidence-promotion-release`
- Expected HEAD: `fe56c7d60eaf1758b2cb8a78516c1895cb6c71bb`
- Before repair: candidate `.git` marker absent; worktree reported prunable.
- `git -C /Users/jeonggyuju/Project_folder/AgentProof worktree repair /private/tmp/agentproof-canonical-evidence-promotion`: exit `0`.
- With both `.git` and `.git/**` excluded, pre/post candidate inventories
  matched exactly: SHA-256
  `a45cd7b59981694ea4c38b1aee0e45791a22f0b4b0d71e18bfd34d222e7fadbb`,
  `123` files.

## Approved migration

- Destination: `/private/tmp/agentproof-frozen-toolchain-ast-closure-clean-v2`
- Destination HEAD: `fe56c7d60eaf1758b2cb8a78516c1895cb6c71bb` (detached)
- `pnpm-lock.yaml`: present from the base commit.
- Included: `46` tracked modifications and `27` untracked source/document
  files (`73` paths total).
- Excluded: all candidate tracked deletions; protected and generated paths;
  Git metadata; and `tsconfig.tsbuildinfo`.
- Source/destination path sets, SHA-256 values, file types, and modes matched
  for all `73` included paths.
- Destination status is exactly `46` modified tracked files plus `27`
  untracked files outside the protected path.
- `git diff --check`: exit `0`.

The initial migration that included generated dependencies was not used as the
candidate. It remains outside this destination and was not deleted.

## Privacy and authority

- No protected evaluation content was read, listed, created, modified, or
  scored.
- No commit, push, deployment, or dependency installation occurred in Task 1.
- The migration manifest is retained outside the repository at
  `/private/tmp/agentproof-frozen-toolchain-ast-closure-clean-v2-migration.json`.
