#!/usr/bin/env bash
#
# Share local dev environment across all git worktrees, safely.
#
# The main checkout's .env is the single source of truth for local dev config,
# INCLUDING the gitignored VITE_DEV_AUTOLOGIN_* credentials. This script points
# the current worktree's .env at that file via a symlink, so every worktree reads
# the same env without the secret ever being copied around — or committed.
#
# The .env stays gitignored and is NEVER committed. Only this wiring script is
# tracked, which is what makes the setup persist across worktrees: run it once in
# any new worktree.
#
# Usage, from inside any worktree:
#   bash scripts/link-dev-env.sh
#
set -euo pipefail

# Resolve the main checkout root (parent of the shared .git common dir), coping
# with git returning either an absolute or a relative common-dir path.
common_dir="$(git rev-parse --git-common-dir)"
case "$common_dir" in
  /*) : ;;
  *) common_dir="$(cd "$common_dir" && pwd)" ;;
esac
main_root="$(dirname "$common_dir")"
worktree_root="$(git rev-parse --show-toplevel)"

shared_env="$main_root/.env"
target_env="$worktree_root/.env"

if [ "$worktree_root" = "$main_root" ]; then
  echo "This is the main checkout; its .env is the shared source. Nothing to link."
  exit 0
fi

if [ ! -e "$shared_env" ]; then
  echo "No shared .env at: $shared_env"
  echo "Create it in the main checkout first (copy from .env.example), then re-run."
  exit 1
fi

if [ -L "$target_env" ]; then
  ln -sfn "$shared_env" "$target_env"
  echo "Re-linked $target_env -> $shared_env"
elif [ -e "$target_env" ]; then
  echo "A real .env already exists at: $target_env"
  echo "Move or delete it first, then re-run to replace it with the shared symlink."
  exit 1
else
  ln -s "$shared_env" "$target_env"
  echo "Linked $target_env -> $shared_env"
fi
