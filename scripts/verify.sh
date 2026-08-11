#!/usr/bin/env bash
#
# Local mirror of CI — "green here ≈ green in CI".
#
#   verify.sh --fast   Docker-free inner loop: lint, mirrors, typecheck (app +
#                      tools), build, unit tests + coverage, Deno checks + tests.
#   verify.sh --full   The pre-PR-to-main gate: everything in --fast, then the
#                      Docker-gated layers — a fresh DB reset (see below), pgTAP
#                      (test:db) and Playwright e2e.
#
# --full RESETS the local database (wipes dev data + reseeds) before pgTAP. pgTAP
# runs against the live local DB without resetting it and several suites assert on
# pristine seed, so a dev DB dirtied by prior e2e/manual runs would otherwise fail
# pgTAP on data rather than code. This matches CI (always a fresh stack); e2e below
# already mutates the DB, so --full was never data-preserving.
#
# Runs every layer, CONTINUES past failures, prints a summary, and exits non-zero
# if any layer failed OR was skipped. A skipped or failed layer never reads as a
# pass. --full leaves the stack running afterwards (use `npm run local:down`).
#
# Note: no `set -e` — we deliberately run all layers to give a full picture.
set -uo pipefail

mode="${1:-}"
case "$mode" in
  --fast) full=0 ;;
  --full) full=1 ;;
  *) echo "usage: verify.sh --fast|--full" >&2; exit 2 ;;
esac

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

cache_mode="${mode#--}"
if ! node scripts/verify-cache.mjs clear "$cache_mode"; then
  echo "verify: warning: could not clear the local verification cache" >&2
fi

names=()
statuses=()
overall=0

run() {
  local name="$1"; shift
  echo
  echo "── ▶ $name ─────────────────────────────────────────────"
  if "$@"; then
    names+=("$name"); statuses+=("PASS")
  else
    names+=("$name"); statuses+=("FAIL")
    overall=1
  fi
}

skip() {
  local name="$1" reason="$2"
  echo
  echo "── ⃠ $name — SKIPPED: $reason"
  names+=("$name"); statuses+=("SKIP")
  overall=1
}

# ── Docker-free layers (the --fast inner loop) ───────────────────────────────
run "mirrors:check"    npm run --silent sync:mirrors:check
run "lint"             npm run --silent lint
run "typecheck:app"    npx tsc -p tsconfig.app.json --noEmit
run "typecheck:tools"  npx tsc -p tsconfig.tools.json --noEmit
run "build"            npm run --silent build
run "unit+coverage"    npm run --silent test:coverage
run "deno:check"       deno check --node-modules-dir=none supabase/functions/*/index.ts
run "deno:test"        npm run --silent test:functions

# ── Docker-gated layers (added by --full) ────────────────────────────────────
if [ "$full" -eq 1 ]; then
  if docker info >/dev/null 2>&1; then
    run "local:up"          bash scripts/local-up.sh
    # Reset to a clean, seeded DB so pgTAP is hermetic (see header). This WIPES
    # local dev data. pgTAP runs next against the fresh state; e2e runs after and
    # is free to mutate it.
    echo "  ⚠  Resetting the local database (wipes dev data, reseeds) so pgTAP is hermetic…"
    run "db reset"          npm run --silent local:reset
    run "db (pgTAP)"        npm run --silent test:db
    run "e2e (playwright)"  npm run --silent test:e2e
  else
    skip "db (pgTAP)"       "no container runtime — start OrbStack, then re-run"
    skip "e2e (playwright)" "no container runtime — start OrbStack, then re-run"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo
echo "════════════════ verify ($mode) ════════════════"
for i in "${!names[@]}"; do
  printf '  %-5s  %s\n' "${statuses[$i]}" "${names[$i]}"
done
echo "═════════════════════════════════════════════════"
if [ "$overall" -eq 0 ]; then
  echo "✓ all layers passed"
  if ! node scripts/verify-cache.mjs record "$cache_mode"; then
    echo "verify: warning: passed, but could not record the local verification cache" >&2
  fi
else
  echo "✗ some layers failed or were skipped (see above)"
fi
exit "$overall"
