# Verification Cache Design

## Goal

Avoid rerunning `verify:fast` in the pre-push hook when the exact source snapshot
has already passed `verify:fast` or `verify:full`, without weakening secret
scanning or GitHub CI.

## Design

- Compute a deterministic fingerprint of the current checkout's tracked source
  content and relevant non-ignored changes. The fingerprint represents content,
  not the current commit SHA, so `verify`, then `commit`, then `push` remains a
  cache hit when committing did not change file contents.
- Store successful verification stamps in worktree-local Git metadata. No cache
  files are committed, shared between worktrees, or written into application
  directories.
- A successful `verify:fast` records the fast stamp. A successful
  `verify:full` records both fast and full stamps because full includes every
  fast layer. Failed or skipped verification never records success.
- The pre-push hook always runs the pushed-history and tracked-tree secret scan.
  It skips `verify:fast` only when the current fingerprint exactly matches a
  successful fast stamp.
- Claude-managed nested checkouts under `.claude/worktrees/**` are neither lint
  targets nor fingerprint inputs. They are independent worktrees, not source
  belonging to the current checkout.
- GitHub CI remains authoritative and always runs normally.

## Implementation Boundaries

- Put fingerprint and stamp operations in a small script with explicit commands
  for checking and recording success.
- Call that script from `scripts/verify.sh` only after verification succeeds.
- Call it from `.githooks/pre-push` after secret scanning and before invoking
  `verify:fast`.
- Add `.claude/worktrees/**` to ESLint's global ignore list.

## Verification

- Unit-test cache hits after successful fast and full runs.
- Test invalidation after file-content changes.
- Test that committing an already-verified snapshot remains a hit.
- Extend the pre-push-hook tests to require unconditional secret scanning and a
  fingerprint-gated `verify:fast` call.
- Run the focused tests, lint, and the repository's fast verification suite.
