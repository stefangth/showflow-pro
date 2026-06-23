# Handoff: migrate `bun.lock` off the Lovable npm mirror

**Status:** Pending · **Urgency:** Low (nothing is broken today) · **Created:** 2026-06-23
**Related:** PR #131 (dropped `lovable-tagger`), PR #127 (removed the Vite plugin)

---

## TL;DR (plain terms)

A *lockfile* pins the exact version **and download URL** of every package the app uses.
This repo was bootstrapped on **Lovable**, which served packages from its own **private
npm mirror** (`europe-west4-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache`) — a transparent
cache of the public npm registry. So the lockfiles recorded download URLs pointing at
**Lovable's mirror** instead of the public registry.

- ✅ `package-lock.json` (the lockfile **CI actually uses**) is **already** on the public
  registry (`registry.npmjs.org`). CI is fine.
- ✅ `deno.lock` carries **no** mirror URLs.
- ⚠️ `bun.lock` still has **144** download URLs pointing at Lovable's private mirror.

**Why it matters:** Lovable is deprecated. If that mirror is ever turned off, anyone running
`bun install` would hit 404s on those 144 packages. It's a latent dependency on a third-party
host that's going away.

**Why it's not urgent:** No CI job uses Bun — CI installs with `npm ci` against the
already-clean `package-lock.json`. The packages are byte-identical to public npm; only the
**download host** differs. Nothing is broken right now.

**The fix:** rewrite those 144 URLs from the mirror host back to `registry.npmjs.org`
(authoritatively: regenerate `bun.lock` with Bun against the public registry).

---

## Exact current state (verified 2026-06-23)

| File | Mirror URLs | Notes |
|---|---|---|
| `package-lock.json` | 0 | Already public (`registry.npmjs.org`). The only CI-relevant lockfile. |
| `deno.lock` | 0 | Clean. Also tracks the frontend npm graph; Deno auto-manages it. |
| `bun.lock` | **144** | The migration target. JSONC format. |
| `bun.lockb` | — | Deleted in PR #131 (deprecated binary duplicate). |

- No tracked `.npmrc` / `bunfig.toml` / `.yarnrc` — the mirror is **not** forced by config;
  it's baked into `bun.lock`'s recorded URLs only.
- Mirror URL shape is a 1:1 host swap with public npm, same path:
  `https://europe-west4-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache/<pkg>/-/<file>.tgz`
  ↔ `https://registry.npmjs.org/<pkg>/-/<file>.tgz`

Find them: `git grep -c "europe-west4-npm.pkg.dev/lovable-core-prod" bun.lock`

---

## Option A — regenerate with Bun (recommended, authoritative)

Requires a **Bun toolchain + public-registry network access** (NOT available in the Deno-only
env this repo is often worked in — see the env memory note).

```bash
# from repo root, in an env with bun installed
rm -f bun.lock                 # bun.lockb is already gone
bun install                    # re-resolves against the default public registry
git grep -c "pkg.dev" bun.lock # expect: 0
```

Then sanity-check that **package versions didn't move** (only URLs should change):

```bash
# compare resolved versions before/after; there should be no version churn,
# just registry host changes. Review the diff carefully.
git diff bun.lock | grep -E '^\-|^\+' | grep -iv 'pkg.dev\|registry.npmjs.org' | head
```

Commit only if the diff is host-only (plus any unavoidable formatting bun applies).

## Option B — toolchain-free host rewrite (fallback, MUST be install-verified later)

Because the mirror is a transparent cache, the tarball at each mirror URL is byte-identical
to the public-registry one, so the **integrity hashes already match** and a pure host swap is
*expected* to be valid:

```bash
# Deno-only env friendly. Rewrites the 144 hosts in place.
deno eval '
const p="bun.lock"; let t=await Deno.readTextFile(p);
const before=(t.match(/europe-west4-npm\.pkg\.dev\/lovable-core-prod\/sandbox-npm-cache\//g)||[]).length;
t=t.replaceAll("https://europe-west4-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache/","https://registry.npmjs.org/");
await Deno.writeTextFile(p,t);
console.log("rewrote",before,"mirror URLs");
'
```

⚠️ This is **not** install-verified without Bun. Before trusting it, someone must run
`bun install --frozen-lockfile` in a Bun env and confirm it resolves with no integrity errors.
Prefer Option A if a Bun env is available.

## Option C — drop `bun.lock` entirely (strategic alternative)

CI standardized on **npm** (`npm ci` + `package-lock.json`). If the team isn't actually using
Bun locally, the cleanest resolution is to **delete `bun.lock`** and commit to a single npm
lockfile — which makes this whole migration moot. This is a team/workflow decision, not a
mechanical one; raise it before doing the migration work.

---

## Verification checklist (whichever option)

- [ ] `git grep -c "pkg.dev" bun.lock` → `0`
- [ ] No package **version** changes vs. `package-lock.json` (URLs/host only).
- [ ] `bun install --frozen-lockfile` succeeds in a Bun env (no integrity/resolution errors).
- [ ] CI stays green (it won't be affected — CI uses `npm ci` — but confirm anyway).

## Gotchas / context

- This repo carries **4 Lovable-origin lockfiles**; only `package-lock.json` is CI-relevant.
  Don't assume editing `bun.lock` affects CI — it doesn't.
- The usual working env here is **Deno-only** (no `node`/`bun`/`npm`). That's the sole reason
  this wasn't done inline — it needs a package manager.
- If you also touch `package.json` while here, Deno will partially auto-prune `deno.lock`;
  finish the prune by hand (it leaves orphaned package defs). See PR #131 for the technique.
