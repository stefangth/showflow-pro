# Resolved: `bun.lock` migrated off the Lovable npm mirror (+ staleness resync)

**Status:** ✅ Resolved 2026-06-23 · **Method:** canonical regen with Bun 1.3.14, install-verified
**Related:** PR #131 (dropped `lovable-tagger`; added this runbook), PR #127 (removed the Vite plugin)

---

## What this was

`bun.lock` recorded download URLs for **144** packages pointing at Lovable's private npm mirror
(`europe-west4-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache`) — a transparent cache of public npm
left over from the Lovable bootstrap. Lovable is deprecated; if that mirror is turned off, `bun install`
would 404 on those packages. (CI was never affected — it uses `npm ci` against `package-lock.json`,
which was already clean.)

## What we discovered (the bigger problem)

`bun.lock` wasn't just mirror-polluted — it was **badly stale**. Because this repo is usually worked
in a Deno-only env, nobody had run `bun install` in a long time, so `bun.lock` drifted ~100 packages
behind `package.json`:

| | HEAD `bun.lock` (stale) | `package-lock.json` (CI truth) | After fix |
|---|---|---|---|
| package entries | 540 | 649 | 644 |
| `react-day-picker` | **8.10.1** (violates `^9.14.0`) | 9.14.0 | 9.14.0 |
| `react-markdown`, `remark-gfm`, `@playwright/test`, … | **missing** | present | present |

A pure URL host-swap would therefore have left `bun.lock` broken (wrong `react-day-picker` major,
100+ missing deps, still failing `--frozen-lockfile`). So we regenerated rather than just rewriting URLs.

## How it was fixed

Bun **preserves explicit non-default-registry URLs** from an existing lockfile, so `bun install` alone
does *not* drop the mirror URLs. The working recipe is two steps — point the URLs at the default
registry first, then let bun canonicalize (it omits the URL for default-registry packages):

```bash
# 1) rewrite the 144 mirror URLs to the default registry (Deno-only-env friendly)
deno eval 'let t=await Deno.readTextFile("bun.lock");
t=t.replaceAll("https://europe-west4-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache/","https://registry.npmjs.org/");
await Deno.writeTextFile("bun.lock",t);'

# 2) canonicalize + sync to package.json: bun strips the now-default URLs (→ URL-less) and
#    adds the ~100 missing packages
bun install
```

Result: a URL-less (default public registry), in-sync `bun.lock`.

## Verification (Bun 1.3.14, install-verified)

- [x] `grep -c "pkg.dev" bun.lock` → **0** (off the mirror)
- [x] No `http(s)` URLs remain in `bun.lock` (all default-registry / URL-less)
- [x] `bun install --frozen-lockfile` → **exit 0, "no changes"** (in-sync, self-consistent, integrity OK)
- [x] `react-day-picker` → **9.14.0** (matches npm; fixes the stale major)
- [x] 644 entries (≈ npm's 649); **71/75** direct deps match `package-lock.json` exactly
- [x] CI unaffected (uses `npm ci` + `package-lock.json`)

### Expected, benign: bun ≠ npm on 4 deps

`bun.lock` and `package-lock.json` are produced by different resolvers, so a few `^`-ranged deps land
on different in-range versions: `@tanstack/react-query` (npm 5.100.10 / bun 5.99.2), `lucide-react`
(npm 1.14.0 / bun 1.8.0), `@supabase/supabase-js` (npm 2.105.4 / bun 2.104.0), `@playwright/test`
(npm 1.60.0 / bun 1.61.0). All satisfy `package.json`. CI behavior is governed by npm; this is normal,
not a defect.

## Notes for next time

- No lockfile carries mirror URLs anymore: `package-lock.json`, `deno.lock`, and `bun.lock` are all
  clean; `bun.lockb` was deleted in PR #131.
- `bun.lock` will drift stale again if deps change and nobody runs `bun install` (this env is
  Deno-only). If the team isn't actually using Bun, the cleanest long-term option is to **drop
  `bun.lock`** entirely — CI standardized on npm. That was the considered alternative here.
- Bun was installed via Homebrew solely for this migration and removed afterward.
