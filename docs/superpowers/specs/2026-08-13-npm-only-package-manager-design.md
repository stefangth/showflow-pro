# npm-only Node package management

**Date:** 2026-08-13  
**Status:** Approved

## Context

The repository currently tracks both `package-lock.json` and `bun.lock` for the
same root `package.json`. npm is already authoritative: GitHub Actions installs
with `npm ci`, Dependabot uses the npm ecosystem, and project documentation and
scripts use npm. Bun is not exercised by CI and its lockfile has previously
drifted from the npm-resolved dependency graph.

The repository also contains Deno lockfiles for Supabase Edge Functions. Those
belong to a separate runtime and are outside this change.

## Decision

Use npm as the sole supported package manager for root Node dependencies.

- Keep `package-lock.json` as the only root Node dependency lockfile.
- Delete `bun.lock`; the obsolete `bun.lockb` is already absent.
- Declare the npm package-manager policy in `package.json` and `CLAUDE.md`,
  replacing its existing `npm install # or bun install` guidance.
- Add an automated check that rejects root `bun.lock`, `bun.lockb`, `yarn.lock`,
  and `pnpm-lock.yaml` files.
- Leave all Deno lockfiles unchanged.

## Enforcement

The policy check will be a small Node script covered by a focused test. CI and
the existing fast verification path will run it through an npm script. The
failure message will identify the unsupported lockfile and direct contributors
to use `npm install` or `npm ci`.

## Verification

- The policy test fails before enforcement exists and passes after implementation.
- The policy check passes with only `package-lock.json` present.
- The existing fast verification suite passes.
- A final repository scan confirms no unsupported root lockfile remains.

## Alternatives considered

1. **Keep npm and Bun locks:** rejected because no workflow continuously verifies
   the Bun graph and dual resolvers can select different in-range versions.
2. **Delete `bun.lock` without enforcement:** smaller, but allows the historical
   ambiguity to return silently.
3. **Adopt Bun instead of npm:** rejected because it would require changing CI,
   Dependabot, developer documentation, and established install workflows without
   a demonstrated benefit.
