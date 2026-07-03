# Automation Engine System Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner real oversight of the automation engine by producing (1) `docs/system-map.md` — the trigger → function → data → side-effect view of every cron, edge function, DB guard, and notification/email path, verified against the code — and (2) an interactive visual canvas (HTML artifact) of the same map.

**Architecture:** Three stages. **Research:** four parallel read-only subagents each trace one layer (crons, edge functions, DB guards, frontend-initiated calls) and emit structured markdown to the scratchpad. **Synthesis:** one subagent merges the research into `docs/system-map.md` (tables + Mermaid diagrams — GitHub renders Mermaid natively, so the repo doc is visual on its own). **Verification:** adversarial fact-check subagents re-derive every claim from the code and file corrections before anything is committed. The interactive artifact is generated from the *verified* doc, never from raw research.

**Tech Stack:** Markdown + Mermaid (repo doc), self-contained HTML/CSS/JS (artifact, no external deps — CSP blocks CDNs), Agent tool subagents (research = sonnet, synthesis/artifact = opus, verification = sonnet).

## Global Constraints

- Repo root (worktree): `/Users/stefanschaal/Claude Code/showflow-pro/.claude/worktrees/mystifying-benz-f8fd00` — all paths below are relative to it.
- Scratchpad for intermediate research: `/private/tmp/claude-501/-Users-stefanschaal-Claude-Code-showflow-pro--claude-worktrees-mystifying-benz-f8fd00/c7bb880b-0a24-4b00-a211-48a11a99f634/scratchpad`
- Branch: `claude/mystifying-benz-f8fd00` (current worktree branch). Commit here; PR to `main` at the end.
- Commit messages: imperative, lowercase, ≤72 chars, `docs:` prefix; end body with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Git safety (every implementer subagent prompt must include):** "Never run `git reset`, `git checkout --`, `git clean`, `git rebase`, or `git push --force`. Stage only the files named in your task. Do not touch files outside your task."
- Research subagents are read-only: no Edit/Write to the repo, no git commands. They may Write only to the scratchpad path above.
- Every factual claim in the map must carry a `file:line` or `file` citation. No claim without a citation survives verification.
- The map documents the code **as it is on this branch** — not the live Supabase project, not intended behavior. Where migrations superseded each other (e.g. cron schedules redefined in `20260623042017` then `20260624101342`), the **latest** migration wins.
- Altitude rule: the map answers *what fires, when, guarded by what, touching what, causing what*. It does not restate domain rationale — link to `docs/app-logic.md` / `docs/adr/*` instead.
- Do not edit `supabase/migrations/` or `src/integrations/supabase/types.ts` (read-only inputs).

## Ground-truth inventory (pre-verified by the orchestrator — use as checklists, not as facts to copy blindly)

**20 edge functions** in `supabase/functions/` (plus `_shared/`):
`admin-list-users`, `airtable-poll`, `airtable-schema`, `close-offer-tier`, `create-invitation`, `cron-health-watcher`, `delete-my-account`, `expire-offers`, `export-org-data`, `fetch-remote-sheet`, `handle-email-suppression`, `handle-email-unsubscribe`, `open-offer-tier`, `platform-edge-metrics`, `preview-transactional-email`, `provision-org`, `resend-invitation`, `send-confirmation-digest`, `send-offer-digest`, `send-transactional-email`, `tier-at-risk-watcher`.

**6 pg_cron jobs** — authoritative (latest) definitions in `supabase/migrations/20260624101342_cron_dispatch_timeout.sql`:
`airtable-poll` (`*/5 * * * *`), `offer-digest` (`0 16-19 * * *`), `confirmation-digest` (`0 17-20 * * *`), `expire-offers-hourly` (`0 * * * *`), `tier-at-risk-hourly` (`5 * * * *`), `cron-health-watcher` (`*/15 * * * *`). Cron secret handling changed in `20260702120010_cron_secret_to_vault.sql`.

**JWT posture** from `supabase/config.toml`: `verify_jwt = false` for the 6 cron-called functions + `handle-email-suppression`, `handle-email-unsubscribe`, `preview-transactional-email`; `true` for the rest.

---

### Task 1: Research fan-out (4 parallel read-only subagents)

**Files:**
- Create (scratchpad only): `<scratchpad>/research/R1-crons.md`, `R2-edge-functions.md`, `R3-db-guards.md`, `R4-frontend-triggers.md`

**Interfaces:**
- Consumes: the repo, read-only.
- Produces: four markdown research files whose section/table formats are specified verbatim below. Task 2 reads exactly these paths.

**Execution note:** dispatch all four agents in ONE message (parallel). Agent type `Explore` is not suitable here because agents must Write scratchpad files — use `general-purpose` with model `sonnet` and the read-only-repo constraint stated in the prompt. After completion, the orchestrator spot-checks each file exists and is non-empty via Bash (`wc -l`), not via the Read cache.

- [ ] **Step 1: Dispatch R1 — cron & scheduling layer** (model: sonnet)

Prompt (verbatim, fill `<scratchpad>`):

```
You are a read-only researcher. Repo root: /Users/stefanschaal/Claude Code/showflow-pro/.claude/worktrees/mystifying-benz-f8fd00. Do NOT edit any repo file. Do NOT run any git command that mutates state. Write your output ONLY to <scratchpad>/research/R1-crons.md.

Task: document the complete scheduling layer of this app.

Read, in this order:
1. supabase/migrations/20260514290000_pg_cron_schedules.sql
2. supabase/migrations/20260514300000_airtable_poll_cron.sql
3. supabase/migrations/20260623042017_cron_dispatch_capture.sql
4. supabase/migrations/20260624101342_cron_dispatch_timeout.sql  (this is the LATEST authoritative definition of all 6 jobs)
5. supabase/migrations/20260702120010_cron_secret_to_vault.sql
6. supabase/functions/cron-health-watcher/index.ts
7. supabase/functions/_shared/auth.ts (the requireCronOrRole helper)

Output R1-crons.md with EXACTLY these sections:

## Cron jobs (authoritative state)
A table: | job name | schedule (cron expr) | schedule (plain English, note UTC vs Berlin if the function itself gates on Berlin time) | HTTP target (edge function) | dispatch mechanism (the SQL wrapper function name, timeout ms) | auth (how X-Cron-Secret flows, where the secret lives after the vault migration) |

## Dispatch & capture plumbing
Plain-language explanation (≤15 lines) of how a pg_cron tick becomes an edge-function invocation: the wrapper function, pg_net, the dispatch-capture table (name it), the 30s timeout and why it was raised (cite the migration comment if present).

## Cron health monitoring
How cron-health-watcher works: what table it reads, what counts as failing/timed out, who gets notified and how, idempotency guard. ≤12 lines.

## Citations
Every row/claim above must cite file (and line where practical).
```

- [ ] **Step 2: Dispatch R2 — edge-function layer** (model: sonnet)

Prompt (verbatim):

```
You are a read-only researcher. Repo root: /Users/stefanschaal/Claude Code/showflow-pro/.claude/worktrees/mystifying-benz-f8fd00. Do NOT edit any repo file. Write output ONLY to <scratchpad>/research/R2-edge-functions.md.

Task: produce a per-function dossier for ALL 20 edge functions in supabase/functions/ (skip _shared, but read _shared/auth.ts, _shared/settings.ts, _shared/deps.ts, _shared/http.ts first — functions delegate auth/settings/CORS to them).

Functions: admin-list-users, airtable-poll, airtable-schema, close-offer-tier, create-invitation, cron-health-watcher, delete-my-account, expire-offers, export-org-data, fetch-remote-sheet, handle-email-suppression, handle-email-unsubscribe, open-offer-tier, platform-edge-metrics, preview-transactional-email, provision-org, resend-invitation, send-confirmation-digest, send-offer-digest, send-transactional-email, tier-at-risk-watcher. (cron-health-watcher may be summarized in 3 lines; R1 covers it in depth.)

For EACH function read supabase/functions/<name>/index.ts and output this exact block:

### <name>
- **Trigger:** cron (which job) | user action (what kind of caller) | fn→fn (invoked by which other function) | public webhook
- **Auth guard:** the exact guard call (e.g. requireOrgRole(org_id, ['admin']), requireSuperAdmin, requireCronOrRole(...), isServiceRole) and verify_jwt value from supabase/config.toml
- **Inputs:** body/query fields it actually reads
- **Reads:** DB tables/RPCs/settings keys it reads (settings via resolveOrgSetting — name the keys)
- **Writes:** DB tables it inserts/updates/deletes (with the notable columns), RPCs it calls
- **Side effects:** emails sent (which template, to whom), notifications inserted (type), other functions invoked, external APIs called (Airtable, Resend, Analytics API)
- **Failure behavior:** what happens on error (status code, partial-work risk, idempotency guard if any)
- **Cites:** file:line for the guard, the main write, and each side effect

Be precise about the booking-engine four (open-offer-tier, close-offer-tier, expire-offers, tier-at-risk-watcher): capture the tier logic, understudy handling, and any status transitions they perform.
```

- [ ] **Step 3: Dispatch R3 — database guards ("the XOR gates")** (model: sonnet)

Prompt (verbatim):

```
You are a read-only researcher. Repo root: /Users/stefanschaal/Claude Code/showflow-pro/.claude/worktrees/mystifying-benz-f8fd00. Do NOT edit any repo file. Write output ONLY to <scratchpad>/research/R3-db-guards.md.

Task: inventory every DATABASE-LEVEL mechanism that guards or automates behavior. Source of truth: supabase/migrations/*.sql (later migrations supersede earlier ones — always report the LATEST definition; use grep to find all definitions of a name before reporting one). Also read supabase/tests/ (pgTAP) headers to understand what behaviors are pinned by tests.

Output R3-db-guards.md with EXACTLY these sections:

## Triggers
Table: | trigger name | table | ON (insert/update/delete + columns) | what it enforces/derives (1 line) | can it reject a write? (yes → when) | defined in (latest migration file) |
Must include at minimum: derive_org_id_for_booking, the booking status-transition guard, understudy auto-promotion, update_updated_at_column instances (summarize these as one row), show-date status computation (ADR-0006), and any blocked-date/booking-conflict guard.

## RPCs (SECURITY DEFINER functions callable from client or edge fns)
Table: | rpc name | who may call (role guard inside) | what it does (1 line) | tables written | defined in (latest migration) |
Must include at minimum: accept_invitation, set_org_member_role, list_org_members, remove_org_member, bulk_import_artists, list_pending_invited_artists, export_my_data, anonymize_user, delete_org, sole_admin_orgs, get_user_id_by_email — plus any others you find.

## Constraints & unique indexes that encode business rules
Table: | name | table | rule it encodes | migration |
Must include bookings_active_artist_date_uniq and any org-isolation restrictive policies pattern (summarize RLS as ONE row per pattern, not per table — e.g. "org_isolation RESTRICTIVE policy on all tenant tables").

## State machines
The booking_status transition rules as actually enforced (which transitions are allowed, by whom, guard location). Also show_date status if DB-computed (ADR-0006). Present as: current → allowed next states, with the enforcing object named.

## Citations
file references for every row.
```

- [ ] **Step 4: Dispatch R4 — frontend-initiated automation** (model: sonnet)

Prompt (verbatim):

```
You are a read-only researcher. Repo root: /Users/stefanschaal/Claude Code/showflow-pro/.claude/worktrees/mystifying-benz-f8fd00. Do NOT edit any repo file. Write output ONLY to <scratchpad>/research/R4-frontend-triggers.md.

Task: map every place the FRONTEND initiates automation — i.e. calls an edge function (supabase.functions.invoke) or an RPC (supabase.rpc), or performs a mutation that a DB trigger then acts on.

Method: grep src/ for `functions.invoke(` and `.rpc(`; for each hit, walk up to the hook (src/hooks/, src/data/) and then to the UI surface (page/component) that fires it.

Output R4-frontend-triggers.md with EXACTLY these sections:

## Edge-function calls from the client
Table: | function name | called from (data-layer file + exporting function) | UI surface (page/component + the user gesture, e.g. "AdminPage → Invites tab → Send invite button") | role who can reach it |

## RPC calls from the client
Same table shape.

## Mutations that arm DB automation
Table: | client mutation (data-layer function) | table written | DB automation it triggers (trigger name from the migrations) | net effect |
(e.g. inserting a booking → derive_org_id_for_booking fires; cancelling a primary → understudy promotion.)

## Realtime subscriptions
Which tables the client subscribes to and which UI updates live. Grep for `.channel(` / `postgres_changes`.

## Citations
file:line for each row.
```

- [ ] **Step 5: Verify research outputs exist**

Run: `wc -l "<scratchpad>/research/R1-crons.md" "<scratchpad>/research/R2-edge-functions.md" "<scratchpad>/research/R3-db-guards.md" "<scratchpad>/research/R4-frontend-triggers.md"`
Expected: all four files exist; R2 is the largest (≥150 lines); none under 30 lines. If a file is missing/thin, re-dispatch that single researcher with its same prompt.

*(No commit — scratchpad only.)*

---

### Task 2: Synthesize `docs/system-map.md`

**Files:**
- Create: `docs/system-map.md`
- Read: the four research files from Task 1

**Interfaces:**
- Consumes: `R1–R4` research files (paths above).
- Produces: `docs/system-map.md` with the exact section skeleton below. Task 3 verifies this file; Task 4 renders it; Task 5 links it.

**Execution note:** one subagent, model **opus** (synthesis quality matters more than speed). Include the git-safety clause. The subagent commits at the end of this task.

- [ ] **Step 1: Dispatch the synthesis subagent**

Prompt must contain: the git-safety clause, the four research file paths, and this exact required skeleton for `docs/system-map.md`:

```markdown
# Showflow Pro — Automation Engine System Map

> **What this is:** the trigger → function → data → side-effect view of the whole automation engine.
> **What this is not:** domain rationale (see `docs/app-logic.md`) or decision history (see `docs/adr/README.md`).
> **Maintenance rule:** any PR that adds or changes a cron job, edge function, DB trigger/RPC/constraint, email, or notification path MUST update this file in the same PR.
> **As of:** 2026-07-03, branch state (not live-project state).

## 1. The engine in one breath
[≤8 sentences of plain language covering: Airtable poll → show_dates; offer tiers → suggested bookings; artist response window; hourly expiry; two daily digests; DB guards that make double-booking impossible; who watches the watchers.]

## 2. Clocks — everything that fires on a schedule
[Table from R1: job | schedule | plain English | target function | guard | what it does in one line. Then ≤10 lines on the dispatch plumbing (pg_cron → wrapper → pg_net → edge fn, 30s timeout, vault secret) and cron-health-watcher.]

## 3. Buttons — everything a user action fires
[Two tables from R4: edge-function calls and RPC calls, each with UI surface and role. Group rows by actor: Artist / Producer / Admin / Super-admin / Public(no-auth).]

## 4. The functions — 20 edge functions at a glance
[One compact table: function | trigger | auth guard | writes | side effects. Then a subsection per SUBSYSTEM (not per function): Booking engine (open-offer-tier, close-offer-tier, expire-offers, tier-at-risk-watcher), Digests & email (send-offer-digest, send-confirmation-digest, send-transactional-email, preview-transactional-email, handle-email-suppression, handle-email-unsubscribe), Airtable sync (airtable-poll, airtable-schema), Org & platform (provision-org, create-invitation, resend-invitation, admin-list-users, platform-edge-metrics, cron-health-watcher), GDPR & import (delete-my-account, export-org-data, fetch-remote-sheet) — each subsection ≤15 lines from R2, citing files.]

## 5. The gates — database-enforced rules
[From R3: the triggers/constraints/RPC-guards tables, plus the booking_status state machine rendered as a Mermaid stateDiagram-v2. This section answers: "what can the database refuse, and why".]

## 6. The two big flows, end to end
### 6.1 A show date's life (Airtable → bookable date)
[Mermaid flowchart LR: Airtable base → airtable-poll (cron */5) → upsert show_dates → status computation → visible in UI. ≤10 lines of prose.]
### 6.2 An offer's life (tier opened → confirmed booking)
[Mermaid flowchart: open-offer-tier → suggested bookings + notifications → artist accepts (OfferResponseButtons → RPC/mutation) → soft_booked → producer confirms → confirmed; side rails: expire-offers (hourly), tier-at-risk-watcher, understudy promotion on cancel. ≤15 lines of prose.]

## 7. Messages out — every email and notification
[Matrix table: trigger moment | channel (email template name / in-app notification type) | recipient | sender function | opt-out path (suppression/unsubscribe/notification prefs). From R2.]

## 8. Observability — who watches the watchers
[cron-health-watcher + platform-edge-metrics + where to look when something breaks (get_logs, dispatch-capture table). ≤10 lines.]

## Appendix A. Full per-function dossiers
[The complete R2 blocks, verbatim-ish, tidied. This is the drill-down layer; sections 1–8 are the altitude layer.]
```

Additional instructions to the subagent: every table row keeps its citation (as a trailing `— src/...` or `— supabase/...` reference, file path only is fine in tables); Mermaid must be valid GitHub-flavored Mermaid (```mermaid fences, `flowchart LR` / `stateDiagram-v2`); resolve any conflict between research files by re-reading the cited source file, and note unresolved uncertainties in a final `## Open questions` section rather than guessing.

- [ ] **Step 2: Orchestrator sanity check (not the Read cache — use Bash)**

Run: `grep -c '```mermaid' docs/system-map.md && grep -c '^###' docs/system-map.md && wc -l docs/system-map.md`
Expected: ≥3 mermaid blocks; ≥20 headings; total length 400–900 lines. Also run `grep -n 'TODO\|TBD\|FIXME' docs/system-map.md` — expected: no hits (an `## Open questions` section is allowed; bare TODOs are not).

- [ ] **Step 3: Commit**

```bash
git add docs/system-map.md
git commit -m "docs: add automation engine system map (trigger→function→data→effect)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Adversarial verification of the map

**Files:**
- Modify: `docs/system-map.md` (corrections only)

**Interfaces:**
- Consumes: committed `docs/system-map.md`.
- Produces: a corrected, verified `docs/system-map.md`. Task 4 may only start after this task's commit.

**Execution note:** two parallel verifier subagents (model: sonnet), each covering half the map, prompted to REFUTE. They report findings; a third fixer subagent (or the orchestrator) applies corrections. Verifiers are read-only on the repo but may Write a findings file to the scratchpad.

- [ ] **Step 1: Dispatch verifier V1 (sections 2, 4, 6.1, 7, 8 + Appendix A first half)** and **V2 (sections 3, 5, 6.2 + Appendix A second half)** in one parallel message.

Shared prompt core (verbatim, with section assignment substituted):

```
You are an adversarial fact-checker. Repo root: /Users/stefanschaal/Claude Code/showflow-pro/.claude/worktrees/mystifying-benz-f8fd00. Read docs/system-map.md, sections <ASSIGNED>. For EVERY factual claim (schedule, guard name, table written, template name, role, transition), open the cited source file and try to REFUTE the claim. A claim with no citation is automatically a finding. Check Mermaid blocks for (a) syntax validity and (b) semantic truth of every edge.
Write findings ONLY to <scratchpad>/research/V<N>-findings.md as a table: | map location (heading + row) | claim | verdict (WRONG / UNCITED / STALE / OK-but-imprecise) | correction (exact replacement text) | evidence (file:line) |
Do not edit any repo file. If a section is fully correct, say so explicitly. Default to suspicion: your job is to find errors, not to confirm.
```

- [ ] **Step 2: Apply corrections**

Orchestrator reads both findings files (via Bash `cat`, not stale Read cache), applies every WRONG/UNCITED/STALE correction to `docs/system-map.md` with Edit (re-Read the file first in this session), and re-checks any correction that itself looks doubtful against the source.

- [ ] **Step 3: Run the repo's own checks (map must not break anything)**

Run: `npm run lint`
Expected: passes (the map is a doc; this simply proves the tree is still clean). pgTAP/vitest are CI-only per environment constraints — do not attempt locally.

- [ ] **Step 4: Commit**

```bash
git add docs/system-map.md
git commit -m "docs: fix system map errors found in adversarial verification" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(If verifiers found nothing: skip commit, note "verification clean" in the session log.)

---

### Task 4: Interactive visual canvas (artifact)

**Files:**
- Create (scratchpad): `<scratchpad>/system-map-canvas.html`
- No repo files (the .md with Mermaid is the in-repo visual; the artifact is the interactive layer).

**Interfaces:**
- Consumes: verified `docs/system-map.md` (post-Task-3 state).
- Produces: a published Artifact URL handed to the user.

- [ ] **Step 1: Load the `artifact-design` skill** (MANDATORY before writing the page — orchestrator does this inline, not a subagent, because the Artifact tool call happens in the main session).

- [ ] **Step 2: Build the canvas** (orchestrator inline, or one opus subagent writing the HTML file which the orchestrator then publishes)

Required design (content, not placeholder):
- **Four swimlane columns:** `TRIGGERS` (6 cron clocks + user-action groups + public webhooks) → `EDGE FUNCTIONS` (20 nodes, grouped by the 5 subsystems from map §4) → `DATABASE` (key tables: bookings, show_dates, blocked_dates, notifications, org_invitations, app_settings, artists, orgs; plus a "guards" strip: triggers/constraints from map §5) → `EFFECTS` (email templates, in-app notification types, Airtable/Resend/Analytics external calls).
- **Edges** drawn from the map's tables: trigger→function, function→table (read = dashed, write = solid), function→effect.
- **Interactions:** click a node → highlight its edges + show a detail panel (right side) with the dossier fields (trigger, auth guard, reads, writes, side effects, citation); subsystem filter chips (Booking engine / Digests & email / Airtable sync / Org & platform / GDPR & import / All); hover tooltips with the one-line description.
- **Implementation:** single self-contained HTML, data as one inline JS array of node/edge objects transcribed from the verified map (each node keeps its `file` citation, displayed in the detail panel), SVG edges positioned from DOM layout, no external libraries. Horizontal scroll inside its own container on narrow screens.

- [ ] **Step 3: Publish**

Call the Artifact tool: `file_path = <scratchpad>/system-map-canvas.html`, favicon `🗺️`, title "Showflow Pro — Automation Engine Map", description "Interactive trigger → function → data → effect canvas of the Showflow Pro automation engine."

- [ ] **Step 4: Verify against the doc**

Cross-count: number of function nodes in the artifact's data array == 20; cron nodes == 6; every edge in map §6 flowcharts exists in the artifact. Run the count via Bash grep on the HTML data array. Fix mismatches before handing the URL to the user.

---

### Task 5: Wire the map into the repo's doc system + PR

**Files:**
- Modify: `CLAUDE.md` (two one-line additions)
- Modify: `docs/adr/README.md` (one pointer line, only if it has a docs-index section; otherwise skip)

**Interfaces:**
- Consumes: verified `docs/system-map.md`.
- Produces: discoverability + the maintenance rule, committed; PR opened.

- [ ] **Step 1: Add `docs/system-map.md` to CLAUDE.md's "Key files to reference" table**

One row: `| docs/system-map.md | Automation engine system map: trigger → function → data → side effect. Update in the same PR as any automation change |`

- [ ] **Step 2: Add the maintenance rule to CLAUDE.md's architecture docs note**

In the `docs/` part of the architecture tree (where `app-logic.md` is listed), add one line: `system-map.md  # trigger→function→data→effect map of the automation engine — update with any automation PR`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/adr/README.md
git commit -m "docs: link system map from claude.md and adr index" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin claude/mystifying-benz-f8fd00
gh pr create --title "docs: automation engine system map" --body "..."
```

PR body: what the map is, the three-layer method (research → synthesis → adversarial verification), the maintenance rule, and a note that the interactive canvas artifact exists (link if shareable). End body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

- [ ] **Step 5: Hand off to the user**

Deliver: PR link, artifact link, and the "engine in one breath" paragraph pasted into chat — the user should be able to read that one paragraph and recognize their own system.

---

## Self-review notes

- **Spec coverage:** trigger tracing (T1 R1+R4), edge functions (R2), DB guards/"XOR gates" (R3), side effects/emails/notifications (R2 → map §7), repo doc (T2), verification (T3), visual canvas (T4), discoverability + maintenance rule (T5). The user's "opus or sonnet subagents" directive is encoded per-task.
- **Type consistency:** research file paths, map section numbers, and subsystem groupings are referenced identically across tasks 1–4.
- **Known deviation from TDD:** deliverables are documents; the test cycle is replaced by an explicit adversarial verification task (T3) and count-based cross-checks (T4 step 4), which is the correct analogue.
