#!/usr/bin/env bash
# Sweep local branches whose remote is gone AND whose PR actually merged.
# Safe by construction:
#   - only considers branches with upstream state "[gone]" (remote deleted,
#     which with delete_branch_on_merge=true almost always means the PR merged)
#   - verifies via `gh` that a MERGED PR exists for the branch before deleting
#     (squash-merge makes `git branch -d` useless, so verification replaces it)
#   - never touches a branch checked out in a worktree
#   - anything unverifiable is KEPT and reported, never deleted
# Usage: bash scripts/sweep-merged-branches.sh [--dry-run]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

git fetch --prune --quiet

deleted=0 kept=0 skipped=0
while read -r br track; do
  [ "$track" = "[gone]" ] || continue
  if git worktree list --porcelain | grep -q "^branch refs/heads/$br$"; then
    echo "SKIP (checked out in a worktree): $br"; skipped=$((skipped+1)); continue
  fi
  merged=$(gh pr list --head "$br" --state merged --json number --jq 'length' 2>/dev/null || echo 0)
  if [ "${merged:-0}" -ge 1 ]; then
    if [ "$DRY" = 1 ]; then
      echo "WOULD DELETE (merged PR): $br"
    else
      git branch -D "$br" >/dev/null && echo "DELETED (merged PR): $br"
    fi
    deleted=$((deleted+1))
  else
    echo "KEEP (no merged PR found, review manually): $br"; kept=$((kept+1))
  fi
done < <(git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads)

echo
echo "done: $deleted deleted, $kept kept for review, $skipped skipped (worktrees)"
