# Access & scope — Settings redesign (S-tier)

Status: DRAFT (spec) · 2026-08-14 · branch `claude/access-scope-design-build-f3b46c`
Source of truth (approved visual): Claude Design "Access & scope (S-tier)" —
project `2dc7e85c-a77d-4b90-a24c-2524cf27f9d6`, file `Access & scope (S-tier).dc.html`.
The imported design is the spec; this document maps it onto the codebase.

---

## 1. What this is

A faithful reimplementation of three Settings surfaces, redrawn in the warm-violet
Showflow design system (light + dark), replacing/merging what exists today:

| # | Design surface | Replaces today |
|---|---|---|
| A | **Roles & rights** (`isAccess`) | `permissions` tab ("Roles & permissions", `PermissionsTab`) |
| B | **Casts & coverage** (`isCasts`, two sub-tabs: Coverage + Production Ownership) | merges `casts-cities` (`CastsCitiesTab`) + `production-ownership` (`ProductionOwnershipTab`) |
| C | **Skills** (`isSkills`) | promotes `SkillsCard` (currently nested inside `CastsCitiesTab`) to a standalone tab |

The design also renders the **app shell** (left sidebar, topbar) and the **left Settings
nav rail** as context. The app shell is **out of scope** (already exists as `AppLayout`).
The Settings nav rail changes only in its entries (§6).

### 1.1 Decisions locked

- **D1 — Per-member capability exceptions: DEFERRED, explicitly.** The design's headline
  concept (team default vs. per-person "exceptions") requires a net-new member-scoped
  capability layer (new table + resolver + edge mirror + SQL twin + RLS + `useCan` member
  lookup). We are **not** building that this round. Roles & rights edits the **role
  (team default) only**. The "Individuals" list and per-person editor are rendered as an
  **explicit deferred/disabled affordance** (visible, faithful to layout, clearly labelled
  "coming soon" / not yet available), never a silent omission. Everything member-scoped in
  the design's data model (`SEED_OVERRIDES`, `staged[memberId]`, `overrideCount`,
  "Back to team defaults", per-member reference column, member rows in the picker) is stubbed
  read-only or hidden behind the deferred state.

### 1.2 Decisions locked (were open)

- **D2 — i18n: DEFER, hardcode EN.** Match the existing 100%-hardcoded-English Settings
  tree. No new `settings` namespace this round; i18n is a clean fast-follow. No keyParity
  CI surface added.
- **D3 — Sequence: Roles & rights FIRST**, then Casts & coverage + Skills (the latter two
  run in parallel with each other). See the plan for the parallelization map.

### 1.3 Decisions taken by default (design-directed, no backend change)

- **Staged & Apply write model** (Roles & rights): the design stages toggles in a
  "Staged changes" panel with a plain-language diff and an Apply/Discard footer, rather than
  the current instant-per-toggle commit. Adopted as designed — this is pure frontend
  orchestration over the **existing** `setOrgCapability` / `clearOrgCapability` writes
  (batch them on Apply). Sensitive-capability confirm still applies at Apply time.

---

## 2. Design tokens → codebase (verified)

Every design hex already exists as a token. Parity is essentially exact; the only gaps are
missing *Tailwind utilities*, reachable via arbitrary values.

| Design | Use it as |
|---|---|
| accent 50/100/200/500/600/700 (`#F4F1FF … #4738B0`) | `bg-accent-100`, `text-accent-700`, … (exact) |
| bg `#F6F4EF` | `bg-background` |
| surface `#FFFFFF` | `bg-card` (**not** `bg-surface`) |
| surface-2 `#FAF8F4` | `bg-muted` (**not** `bg-surface-2`) |
| surface-3 `#EFEDE7` (segmented track) | `bg-[var(--surface-3)]` (no utility) |
| text `#15131C` / text-muted `#5B5A57` | `text-foreground` / `text-muted-foreground` |
| green/amber/red 100+600 (badge tints) | `bg-[var(--green-100)] text-[var(--green-600)]` etc. |
| radius xs/s/m/l/xxl/pill | `rounded-xs/-s/-m/-l/-xxl/-pill` |
| radius **xl = 14px** (sheets/hero) | `rounded-[14px]` (no `rounded-xl` at 14 — Tailwind's built-in differs) |
| shadows 1/2/3 | already `--shadow-1..4`; card uses `shadow-2` pattern |
| Geist / Geist Mono | `font-sans`/`font-display`, `font-mono` + `tabular-nums` |

**Gotchas (from CLAUDE.md + index.css):**
- Accent numbered stops are plain hex → **opacity modifiers silently fail** (`bg-accent-500/20`
  yields solid). Use a solid stop, an `rgba()`, or a dedicated token.
- `bg-accent` (bare shadcn role) ≠ `bg-accent-50`. Don't confuse them.
- Dark mode is already defined for every token — the redesign is theme-aware for free if we
  stick to tokens.
- Badge tint pattern is `variant="hold"` (amber) for **Sensitive**; `variant="accent"`
  (accent-50/700/200) for the violet "Granting/Removing" change chip; lucide `Lock` +
  neutral chip for **Managed by ShowFlow**. Reuse `src/components/ui/badge.tsx` variants
  (`confirmed`/`hold`/`risk`/`accent`/`neutral`) rather than inventing.

---

## 3. Surface A — Roles & rights

### 3.1 Reuse as-is (backend + data)
- 29-capability registry `src/lib/capabilities.ts` (groups, labels, descriptions,
  `risk: sensitive`, `defaultEnabled`, `module`). **Use the real 29** — the design's `CAPS`
  list is cosmetic mock (e.g. `invite` ≈ `producer_can_invite`; design shows
  `resend_account_invite` where the registry has `view_linked_accounts`). Faithful = the
  layout/interaction wired to the real registry.
- Layered resolver `resolveCapability`/`resolveAllCapabilities`, `useCapabilityMatrix(orgId)`,
  `useCan`, org-override table `org_capabilities`, platform-policy table
  `org_capability_policies`, `is_capability_enabled` / `is_capability_locked`.
- **"Managed by ShowFlow" (locked)** = the existing platform-policy `locked` layer
  (`ResolvedCapability.locked`, `source: policy_lock`). Not a registry flag; the design's
  hardcoded lock on `rename_org` maps to whatever the policy layer reports.
- Audit trail: `settings_audit_log` already records `capability:*` / `capability_policy:*`
  (SECURITY DEFINER triggers). `fetchSettingsAudit` / `useSettingsAudit` already exist and
  power Booking-flow's history rail.

### 3.2 Build (frontend only)
- **New Roles & rights layout** (replaces `PermissionsMatrix`/`PermissionRow` presentation):
  - Header + eyebrow + subtitle + **Change log** button (opens audit for `capability:*`).
  - **Editor card**: title/subtitle + preset segmented control **Restricted / Standard /
    Full / Custom** (Custom is auto-selected when staged ≠ preset baseline). Presets map to
    capability-key sets (Restricted = a curated on-set; Standard = `defaultEnabled`;
    Full = all unlocked on). Diff row: git-compare icon + plain-language sentence +
    "Reset to baseline".
  - **Search** ("Find a right…") + **filter chips** All / Sensitive / Changed / Off, each with
    a live count.
  - **Grouped right cards** (one per registry group), each with a header showing "N of M on",
    a **Turn all on/off** bulk control, and rows: label + Sensitive/Locked/Change badges +
    description + reference column + **Switch**. Locked rows render disabled at 0.4 opacity.
    Row bg tints when changed.
  - **Empty state** when a filter matches nothing.
  - **Right rail** (sticky):
    - **Editing** picker card: "Production Team" (team default, selected) + an **Individuals**
      section — see D1: rendered explicitly deferred (member rows disabled/greyed with a
      "Per-person exceptions — coming soon" note; not interactive).
    - **Staged changes** card: count, scope line, per-change list (dot + label +
      "Off → On · sensitive"), delta sentence, **Discard** / **Apply** footer (dimmed when
      nothing staged).
- **Staged/Apply orchestration**: local staged map over `useCapabilityMatrix`; Apply batches
  `setOrgCapability`/`clearOrgCapability` for changed keys (sensitive confirm dialog first),
  invalidates `['capabilities']`; Discard clears local state.
- **Change log panel/drawer**: reuse `fetchSettingsAudit({ keys: ['capability:*'] })`.

### 3.3 Delete / replace
- `PermissionsMatrix.tsx` + `PermissionRow.tsx` presentation is superseded (platform-mode
  lock editing must survive — either kept for the super-admin platform surface or ported).
  **Do not delete the platform-policy editing path**; the redesign is the **org-admin** view.

---

## 4. Surface B — Casts & coverage

Merges two existing tabs into one page with a **Coverage** / **Production Ownership**
segmented switch. Data model already supports everything except the routing-check tester.

### 4.1 Reuse as-is (backend + data)
- **Offer order, two levels, correct precedence already built**:
  - Org default: `cast_city_priority (cast_id, city_id, priority)` — `UNIQUE(cast_id,city_id)`,
    `UNIQUE(city_id,priority)`.
  - Per-show override: nullable `show_cast_eligibility.priority` (partial unique on
    `(show_id,city_id,priority)`).
  - Resolver: `src/data/tierLadder.ts` `fetchTierCastMap` (client) mirrored by
    `_shared/eligibility.ts` `resolveTierLadder` (edge): show-scoped prioritized rows win,
    else fall back to org `cast_city_priority`.
  - Editing entry points already exist in `CastsCitiesTab` (scope select → org vs per-show).
- Casts/cities: `src/data/casts.ts`, `src/data/cities.ts` (+ `merge_cities` RPC, admin-only).
- Cast detail sheet: `src/components/casts/CastDetailsSheet.tsx` (Members + City-eligibility).
- Production ownership: `ProductionOwnershipTab`, `src/data/showAssignments.ts`,
  `resolve_show_assignments` RPC (specificity 4→1: sub+city / city / sub / program) with
  **admin fallback in app code** (empty producer set → org admins), as used by
  `expire-offers` et al.
- Skills catalog (for the cast-sheet skill chips + the standalone Skills tab): `skills.ts`,
  `useSkills.ts`, `skill_catalog` RPC, `SkillsCard`.

### 4.2 Build (mostly presentation)
- **Casts & coverage page** with a Coverage/Ownership segmented control; new tab plumbing in
  `src/lib/settingsTabs.ts` + `SettingsPage.tsx` nav rail (§6).
- **Coverage sub-tab**:
  - Org-default vs Per-show scope segmented control + hint line.
  - **KPI row** (Cities / Offers blocked / Single tier / Show overrides) — computed from the
    matrix (blocked = no Tier 1; single = 1 filled).
  - **Offer-order matrix** (city × Tier 1/2/3) with per-cell dropdown (cast options + "Clear
    slot"), dashed empty cells, source/coverage status chip per row. Org scope writes
    `cast_city_priority`; per-show scope writes `show_cast_eligibility.priority` and shows an
    override banner + "Clear all overrides". (Design shows 3 tiers; existing data allows ≥1 —
    keep 3 visible tiers, matching the design and current `CHECK(priority>=1)`.)
  - **Casts list** (name / members / usage → opens the detail sheet) + **Cities list**
    (name / usage / delete-when-unused).
- **Cast detail sheet** relocated into Settings, extended to **three** tabs:
  Members · Eligibility · **Offer order** (new tab surfacing per-city tier placement —
  read/edit the same `priority` the matrix edits). Today's sheet has Members + Eligibility
  only; add Offer order. Resolve the shared-vs-move question with `CastsSection` (Artists
  page) — prefer sharing one component.
- **Production Ownership sub-tab**:
  - "Owners by program" grouped list with specificity chips (program / sub-program / city) and
    a **rank badge** ("Wins first" / Exact / City / Sub / Program) from the same specificity
    ranking as the RPC.
  - **Assign-owner composer** (Member / Program / Sub-program / City) — writes `show_assignments`.
  - No-owner warning banner (routes to admins only).
  - **NEW: Routing check tester** — pick Program / Sub-program / City → show the winning owner
    + reason + a precedence ladder (rank 1→4) with admin fallback. Client-side reuse of the
    specificity logic (or call `resolve_show_assignments`); no backend change.

### 4.3 Delete / replace
- `CastsCitiesTab` and `ProductionOwnershipTab` are superseded by the merged page. The
  `SkillsCard` mount inside `CastsCitiesTab` moves out (→ Surface C). Keep the underlying
  data-access + `CastDetailsSheet` (shared).

---

## 5. Surface C — Skills

### 5.1 Reuse as-is
- `SkillsCard` already renders the full grid (name / artists / required-by / archive-restore /
  delete-when-unused) via `skill_catalog` RPC + `useSkills` mutations, gated `manage_skills`.

### 5.2 Build
- Promote to a **standalone "Skills" Settings tab** (nav entry + tab plumbing). Re-skin the
  existing card to the design's table layout (search + New skill + columns SKILL / ARTISTS /
  REQUIRED BY / action; Archived badge; violet action link). Logic unchanged.

### 5.3 Delete
- Remove the `SkillsCard` mount from `CastsCitiesTab` (which itself is being replaced anyway).

---

## 6. Settings nav rail delta

Organization group changes:
- Rename `permissions` label "Roles & permissions" → **"Roles & rights"**.
- Replace `production-ownership` + `casts-cities` with a single **"Casts & coverage"**
  (`casts-coverage`), two internal sub-tabs.
- Add standalone **"Skills"** (`skills`).

Update `SETTINGS_TAB_PARAMS` + `resolveInitialTab` in `src/lib/settingsTabs.ts` for the new
values, and keep back-compat redirects for the old `?tab=production-ownership` /
`?tab=casts-cities` deep links (→ `casts-coverage`). Nav rail entries + gating in
`SettingsPage.tsx` (`permissions` stays admin-only; Casts & coverage admin/producer;
Skills admin/producer). Icons per design: `shield-check`, `map-pin`, `sparkles`.

---

## 7. Cross-cutting

- **Design faithfulness**: reproduce layout, spacing, radii, badges, segmented controls,
  sticky rails, sheet, popover cells, empty states, and the plain-language sentences exactly;
  wire to real data. Mock data (member names, seed overrides, matrix seed) is illustrative
  only.
- **shadcn primitives**: `Tabs`/`ToggleGroup` (segmented), `Switch`, `Sheet`, `Popover`
  (matrix cell dropdown), `Badge`, `Input`, `Select`, `AlertDialog` (sensitive confirm),
  `Card`. No `SegmentedControl`/`SearchBar` primitive exists — build small local wrappers or
  compose. `surface-3` segmented track + `rounded-*` via tokens.
- **Capability gates on the surfaces themselves**: Roles & rights admin-only (unchanged);
  Coverage writes gated `manage_cities`; ownership writes `manage_ownership`; skills
  `manage_skills`; city delete admin-only.
- **Help center impact**: admin-facing changes to where roles/casts/skills are managed →
  update `src/lib/help/items.ts` (EN + DE, "Du") in the same PR, or state "No help center
  impact."
- **Testing** (test-first): pure functions get unit tests (preset→keyset, staged-diff
  sentence builder, matrix KPI computation, specificity/routing resolver, filter/search
  predicates). Data-access already tested; add coverage for any new helper. No RLS/schema
  change means no new pgTAP for surface A/C; surface B adds none either.
- **No migrations** under the locked decisions. (If D1 were reversed, per-member overrides
  would add a table + resolver + edge mirror + RLS + SQL twin — a separate spec.)

---

## 8. Decisions — all resolved

D1 defer per-member; D2 defer i18n (hardcode EN); D3 Roles & rights first. See §1.1–1.3.
Implementation sequencing + parallelization live in the plan:
`docs/superpowers/plans/2026-08-14-access-and-scope-redesign.md`.

---

## 9. Gap summary (build / change / delete)

**Build (new):** Roles & rights layout + preset/search/filter/staged-Apply/change-log
(frontend only); merged Casts & coverage page + Coverage/Ownership switch; routing-check
tester; Offer-order tab in the cast sheet; standalone Skills tab; nav-rail + tab plumbing.

**Change:** rename permissions label; move `SkillsCard` out of `CastsCitiesTab`; relocate/
share `CastDetailsSheet` into Settings; re-skin to design; `settingsTabs.ts` values + deep-link
back-compat; stale "super-admin only" comment at `src/data/platform.ts:336`.

**Delete/supersede:** `CastsCitiesTab`, `ProductionOwnershipTab`, and the
`PermissionsMatrix`/`PermissionRow` org-mode presentation (preserve the platform-policy lock
editing path for super-admins).

**Explicitly deferred (D1):** per-member capability exceptions (all member-scoped backend +
the interactive Individuals editor). The Individuals panel ships as a visible, disabled
"coming soon" affordance.
