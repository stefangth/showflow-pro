# Runbook: local development stack + database

Run the whole app and the full CI stack against a **local** Supabase database, so
development and tests never touch production. The local DB comes up with
synthetic seed data only — no production rows, no PII.

**Why this exists:** the repo `.env` points at the live production project. Left
to itself, `npm run dev` and the e2e tests mutate real customer data. This setup
flips the committed default to a local database and makes production an explicit
opt-in.

---

## One-time setup

1. **Install a container runtime.** OrbStack is the lightweight recommendation on
   macOS (Docker Desktop or Colima also work):

   ```bash
   brew install orbstack
   ```

   Launch it and wait until it reports ready (`docker info` should succeed).

2. **Install the Playwright browser** (only needed for e2e):

   ```bash
   npm run local:setup
   ```

---

## Daily flow

```bash
npm run local:up     # boot the local Supabase stack + wire this checkout at it
npm run dev          # app at http://localhost:8080, pointed at LOCAL
```

`npm run local:up` is idempotent. On first boot it applies every migration and
`supabase/seed.sql`, so these logins work immediately (password **`showflow-dev`**):

| Email | Role |
|---|---|
| `admin@example.com` | org admin |
| `producer@example.com` | org producer |
| `artist@example.com` | org artist (linked to the seeded artist) |

`npm run dev` auto-logs-in as `admin@example.com`. The dev server prints its
target on startup:

```
▶ Supabase: LOCAL (127.0.0.1:54321)
```

When you're done:

```bash
npm run local:down   # stop the stack
```

---

## Running against production (opt-in)

The committed default is local. To run the app against the live project (e.g. as
super-admin, using your gitignored `.env`):

```bash
npm run dev:prod     # ▶ Supabase: PRODUCTION (epweartpzwvcasrzyueh)
```

Confirm the banner says PRODUCTION before doing anything destructive.

---

## Testing — the two-tier convention

```bash
npm run verify:fast  # Docker-free inner loop — run this often
npm run verify:full  # the pre-PR-to-main gate — boots the stack, adds pgTAP + e2e
```

- **`verify:fast`** mirrors every CI job that doesn't need a database: lint +
  mirror-sync check, typecheck (app + tools), build, unit tests + coverage, and
  the Deno function checks + tests. No container runtime required.
- **`verify:full`** additionally boots the local stack and runs pgTAP
  (`test:db`) and Playwright e2e (`test:e2e`) — the layers CI runs only on PRs
  targeting `main`. If no container runtime is up, those two layers are reported
  **SKIPPED** and the run exits non-zero, so a skipped layer never reads as a
  pass.

Both run all layers, continue past failures, and print a summary. Individual
layers are still available directly: `npm run test`, `test:coverage`, `test:db`,
`test:functions`, `test:e2e`.

### The pre-push hook

`npm ci` installs a git **pre-push hook** — the `prepare` script points
`core.hooksPath` at the tracked `.githooks/` directory. It runs `verify:fast`
before every push so the Docker-free layers fail on your machine instead of in a
red CI run. It deliberately does **not** run `verify:full`: a Docker cold-start
on every push would just train everyone to reach for `--no-verify`. Bypass a
single push when you need to (a WIP push, a docs-only branch):

```bash
git push --no-verify             # git skips the hook entirely
SHOWFLOW_SKIP_VERIFY=1 git push  # targeted skip, still logged
```

The hook is a convenience gate, not the enforced one — GitHub CI still runs on
the merged commit regardless, and the prod edge-function deploy keys off a green
CI run. The hook only shortens the loop. Guarded by
`scripts/prePushHook.test.mjs`.

> **Heads-up:** `core.hooksPath` is repo-wide, so once `npm ci` installs it git
> looks **only** in `.githooks/` — any personal, untracked hooks you keep in
> `.git/hooks/` (a local `pre-commit`, `commit-msg`, etc.) stop firing. This is
> the same tradeoff husky makes. If you rely on such a hook, move it into
> `.githooks/` (it is tracked, so commit it) or chain to it from there.

---

## How the flip works (reference)

Vite loads `.env` files by mode, and mode-specific files win for the same key:

- `npm run dev` → **development** mode → the committed **`.env.development`**
  (local) overrides the prod-pointing `.env` symlink.
- `npm run local:up` writes **`.env.development.local`** (gitignored) with the
  live local keys, including the service-role key e2e needs. It has the highest
  priority in dev mode, so the live keys always win over the committed defaults.
- `npm run dev:prod` → **prod** mode → skips `.env.development`, falling back to
  `.env` (production).

`.env.development` is safe to commit: the URL is localhost and the anon key is the
published local-dev key (a public client key). The service-role key lives only in
the gitignored `.env.development.local`. Production builds run in production mode
and never load `.env.development`.

> **Note on `npm run build:dev`** (`vite build --mode development`): because it
> builds in *development* mode, it now loads `.env.development` and bakes
> `http://127.0.0.1:54321` into the bundle — a **local**-pointed build, not a
> prod one. `import.meta.env.DEV` is still `false` in any `vite build`, so the
> autologin path stays stripped; only the Supabase URL/anon key differ. Nothing
> in CI or Vercel uses `build:dev` (Vercel runs `npm run build`, production
> mode), so this is inert for deploys — but if you want a prod-pointed bundle,
> use `npm run build`.

---

## Troubleshooting

- **`✗ No container runtime is reachable`** — OrbStack (or Docker) isn't running.
  Start it, wait for `docker info` to succeed, re-run `npm run local:up`.
- **Port already in use (54321 / 54322 / 8080)** — another Supabase stack or dev
  server is running. Stop it, or `npm run local:down` in the other checkout.
- **Stale or corrupt local data / a migration changed** — reset the database
  (re-applies migrations + reseed; wipes local rows):

  ```bash
  npm run local:reset
  ```

- **Edge functions error locally** — function secrets (RESEND, ANALYTICS, the
  cron secret, Documenso, …) are **not** configured locally. Flows that call
  those functions won't complete locally; that's expected and out of scope for
  the local stack.
- **CLI version note** — CI pins the Supabase CLI to `2.98.2`; your local CLI may
  be newer. Not a problem in practice; pin locally only if pgTAP/migration
  behavior ever diverges from CI.
