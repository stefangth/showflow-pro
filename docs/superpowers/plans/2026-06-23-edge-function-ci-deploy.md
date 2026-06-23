# Edge Function CI Auto-Deploy — Implementation Spec

> Infra change (GitHub Actions + config.toml + docs). Per the requester this is a
> well-scoped infra task, so this is a short spec rather than a bite-sized TDD plan —
> there is no unit-testable logic here; validation is "the CI deploy run succeeds and
> the functions verify live".

**Goal:** Make Supabase Edge Functions deploy automatically to the live project
(`epweartpzwvcasrzyueh`) on every merge to `main`, so the deployed set never drifts
behind the repo again — and make CLAUDE.md's "auto-deploy" claim actually true.

**Approach:** A new `deploy-functions.yml` workflow runs on push-to-`main` (paths-filtered
to functions/config) + `workflow_dispatch`, and runs `supabase functions deploy
--project-ref <ref>` via the official `supabase/setup-cli` action. Per-function
`verify_jwt` is pinned in `supabase/config.toml` (every function must be listed, or the
CLI defaults it to `true` and breaks webhooks/cron). Auth = the existing
`SUPABASE_ACCESS_TOKEN` repo secret (already configured for `db-reset-production.yml`).

---

## Why this is safe / correct (recon findings)

- **Official pattern confirmed** (Supabase docs → Deploy to Production → CI/CD): push-to-main
  + `workflow_dispatch`, `setup-cli`, `supabase functions deploy --project-ref $REF`. No
  Docker, no `--use-api` needed in CI; `config.toml` `verify_jwt` is "consistent across all
  deployments".
- **`functions deploy` (no name) deploys ALL functions** under `supabase/functions/`, skipping
  `_`-prefixed dirs (`_shared` is safe). It does NOT delete live functions absent from the repo,
  so the live `cron-health-watcher` (from unmerged PR #126) is left untouched.
- **`SUPABASE_ACCESS_TOKEN` already exists** (repo secret, 2026-06-03). No new secret to add.
- **Live `verify_jwt` matches handler analysis for all 18 functions** (verified via MCP
  `list_edge_functions` + grep of each handler). config.toml below mirrors live exactly.
- **The 3 "backfill" functions are already live** (`delete-my-account` v1, `export-org-data` v1,
  `send-transactional-email` v35; all return 204 to credential-free OPTIONS). The `isServiceRole`
  gate is present in the repo's `send-transactional-email` (line 33). The merge re-deploys them
  from `main` regardless, guaranteeing the live code == repo.

## verify_jwt mapping (the critical artifact — mirrors live)

| Function | verify_jwt | Auth mechanism | Rationale |
|---|---|---|---|
| admin-list-users | true | `requireRole` (user JWT) | authenticated admin |
| airtable-schema | true | `requireOrgRole` (user JWT) | admin-only mapping UI |
| close-offer-tier | true | `isServiceRole` ∥ `requireOrgRole` | frontend + service-role (both valid JWT) |
| create-invitation | true | `requireOrgRole` | authenticated admin |
| delete-my-account | true | caller JWT (`auth.getUser`) | self-service, needs the session |
| export-org-data | true | `requireSuperAdmin` | authenticated super-admin |
| open-offer-tier | true | `isServiceRole` ∥ `requireRole` | frontend + service-role (airtable-poll) |
| provision-org | true | `requireSuperAdmin` | authenticated super-admin |
| resend-invitation | true | `requireOrgRole`/super | authenticated admin |
| send-transactional-email | true | `isServiceRole` gate | service-role key IS a JWT → passes gateway, then gate |
| handle-email-suppression | false | Resend webhook | public webhook, no JWT |
| handle-email-unsubscribe | false | unsubscribe link/webhook | public, no JWT |
| preview-transactional-email | false | none | public preview |
| airtable-poll | false | `X-Cron-Secret` only | cron, no JWT |
| expire-offers | false | `requireCronOrRole` | cron (X-Cron-Secret path) |
| send-offer-digest | false | `requireCronOrRole` | cron |
| send-confirmation-digest | false | `requireCronOrRole` | cron |
| tier-at-risk-watcher | false | `requireCronOrRole` | cron |

`verify_jwt = true` still lets the handler do its own role check. `verify_jwt = false` is required
wherever the caller has no JWT (public webhooks; cron callers that present `X-Cron-Secret`).

---

## Changes

### 1. Create `.github/workflows/deploy-functions.yml`
- `on: push: branches:[main], paths:[supabase/functions/**, supabase/config.toml, .github/workflows/deploy-functions.yml]` + `workflow_dispatch`.
- `concurrency: { group: deploy-functions, cancel-in-progress: false }` (serialize, never cancel a live deploy).
- `permissions: { contents: read }`.
- Job: `actions/checkout@v4` → `supabase/setup-cli@v1` (version `2.98.2`, matches CI) → `supabase --version` → `supabase functions deploy --project-ref "$PROJECT_REF"`.
- `env: SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}`, `PROJECT_REF: epweartpzwvcasrzyueh`.
- Header comment block (purpose + required secret), matching `db-reset-production.yml` style.

### 2. Rewrite `supabase/config.toml`
- Keep `project_id`. Add a doc comment explaining the deploy/verify_jwt contract.
- List **all 18** functions with `verify_jwt` per the table above (currently only 8 are listed; the
  missing 10 would otherwise default to `true` and break the cron/webhook functions on deploy).

### 3. Update `CLAUDE.md`
- Replace line 40 ("Edge functions deploy automatically when files … change. No manual deploy step.")
  with the truthful mechanism: deploy on merge to `main` via `deploy-functions.yml`; new functions
  must get a `[functions.<name>]` block in `config.toml` (default `true`; `false` for webhooks/cron).

### 4. Update memory `edge-functions-not-auto-deployed`
- Add a "RESOLVED via CI (PR #…)" note: auto-deploy is now real on merge to `main`; MCP deploy
  remains the manual fallback. Update the index line in `MEMORY.md`.

---

## Verification

**Local (pre-merge):** parse-check the YAML + TOML; confirm `_shared` has no `index.ts`; confirm the
config lists exactly the 18 repo function dirs.

**Post-merge (the real test):** merging the PR edits `config.toml` → push-to-main fires the workflow.
Watch the run (`gh run watch`). Success criteria:
- The deploy job is green.
- `send-transactional-email` still sends (service-role callers pass `isServiceRole`); public webhooks
  `handle-email-unsubscribe`/`-suppression` still answer without a JWT.
- Credential-free `curl -X OPTIONS https://epweartpzwvcasrzyueh.supabase.co/functions/v1/<fn>` returns
  204/405 (deployed) — spot-check `delete-my-account`, `export-org-data`, `send-transactional-email`.

## Handoff / risk notes
- Merging triggers a production deploy. Confirm with the user before merging.
- Deploy-all bumps the version of every function each run (cosmetic; idempotent). `main` is the source
  of truth — a function MCP-deployed hotter than `main` would be reverted to `main` on next deploy
  (intended GitOps behavior; the only live function ahead of `main` is `cron-health-watcher`, which
  is absent from `main` and therefore not touched).
