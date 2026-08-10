# Trust Center — design

Date: 2026-08-10
Source design: Claude Design project `5a01f002` → `Trust Center.dc.html`, placements **1a** (marketing) and **1c** (in-app).

## Goal

Give a reviewer — an artist manager, a venue's data-protection officer, a
prospective customer's IT — one page that answers "who can see our show data,
and how do you prove it". Two placements:

- **1a** `showflow.pro/trust` — public, scannable, no gate.
- **1c** Settings → Trust & data — the same facts, scoped to the signed-in
  organisation, so an admin can answer the question on the call.

## Governing constraint

**Every claim must be traceable to code in this repo or to a published
artefact.** No aspirational statements, no third-party badges, no
"coming soon". The `Open items` section from the source design is excluded
entirely, and with it the **ShowFlow staff** column of the visibility matrix —
both existed to disclose things we cannot yet evidence.

Where the source design and the code disagreed, the code won. The corrections:

| Source design | Corrected to | Why |
|---|---|---|
| Audit log: production team "No access, writes but cannot read" | "Read-only — writes to it, cannot alter it" | `has_org_role(auth.uid(), org_id, 'producer')` grants SELECT on `booking_audit_log`. There is no UPDATE or DELETE policy, so append-only holds; "cannot read" does not. |
| Booking notes: artist "No access — never exposed to artists, in any view or export" | "Own booking — the row you can already read carries its notes field" | `notes` and `cancellation_reason` are columns on `bookings`, and "Artists can view own bookings" grants SELECT on the whole row. RLS is row-level, not column-level. The UI does not render them, but the API returns them. |
| Show-date chat: admin "Read-only", production team "only threads you are a participant of" | Both "Full — any thread in this organisation" | `is_chat_participant()` returns true for any org admin or producer on any chat in their org, and the INSERT policy uses the same function, so neither is read-only nor participant-limited. Only the artist branch is scoped, via the bookings join. |
| Data residency "European Union (Frankfurt)" | "European Union (Ireland)" | Supabase project `epweartpzwvcasrzyueh` is region `eu-west-1`. |
| `security@showflow.pro` | `contact@showflow.pro` | The former appears nowhere; the latter is the address published in the privacy policy. |
| "Reviewed Aug 10, 2026 · monthly" | Dropped | No review-cadence artefact exists. Replaced with the access-control count, which is verifiable. |
| Documents: DPA PDF, security overview PDF, Art. 30 records PDF, subprocessor CSV | Privacy policy, Terms, Impressum (web) + a DPA "on request" mailto | Only the three web documents exist. |
| 1c "Export organisation data" button | Per-user export in Profile + org deletion by request | `export-org-data` and `delete_org` are `requireSuperAdmin`. Org admins have no org-level export. |
| Recovery: "point-in-time recovery" | Rolling 30-day backup window only | PITR is a plan feature we cannot evidence from the repo. The 30-day window is stated in the privacy policy. |
| "Rights marked sensitive stay off until an administrator turns them on" / "9 sensitive and off by default" | "Nine are sensitive. Nine ship off. They are different sets." | Found while writing the tests. `issue_hire_orders` and `void_hire_orders` are `risk: "sensitive"` with `defaultEnabled: true`. Both counts happen to be nine, which is exactly why conflating them was easy to miss. |
| "Subprocessor list · section 6 of the privacy policy" | Section 5 | The Art. 28 processor table is in §5, *Recipients and processors*; §6 is international transfers. |
| Document links as site-relative paths | Absolute, per document | The list renders on two hosts that do not carry the same documents: the app has no `/terms`, and `showflow.pro/privacy` is the marketing site's policy, not the product policy the claim tables are drawn from. |

## Verified claim inventory

Everything below survived the audit and ships as-is.

**Access control** — `src/lib/capabilities.ts` `CAPABILITY_DEFS`: exactly 28
rights across 8 groups, 9 of them `risk: "sensitive"`. Counts, labels,
descriptions and `defaultEnabled` values are read from the registry at render
time in-app, so they cannot drift.

**Tenant isolation** — `supabase/tests/rls/org_isolation.sql` asserts an org-A
session reads and writes zero org-B rows even when it holds a global producer
role; `supabase/tests/rls/org_coverage.sql` asserts `org_id` + RLS enabled on
all 21 tenant tables. Both run in the `db-tests` CI job on every pull request.

**Retention** — all eight categories match §7 of
`docs/legal/privacy-policy.en.md` verbatim.

**Subprocessors** — all six, with purpose, region and transfer basis, match
the §6 table of the same policy. Airtable is listed as off.

**Secrets** — the org Airtable PAT is written to Supabase Vault through an
admin-guarded function and never read back to a client (`src/data/airtableKey.ts`).

**Role checks** — concentrated in the security-definer functions
`has_org_role`, `is_org_member`, `is_capability_enabled`, `is_feature_enabled`,
`capability_default`.

**Supply chain** — `scripts/scan-secrets.mjs` runs in CI Lint on every pull
request; `.github/dependabot.yml` raises grouped weekly dependency PRs.

**Self-service rights** — `export_my_data` RPC and the `delete-my-account`
edge function, both surfaced today in `src/pages/ProfilePage.tsx`; consent
withdrawal via the three categories in `src/features/consent/`.

## Architecture

### One source of truth, two consumers

The facts live once, in the app repo:

```
src/lib/trust/facts.ts     ← hand-maintained prose + tables (the claims)
src/lib/capabilities.ts    ← already the registry (the 28 rights)
        │
        └─► scripts/build-trust-json.mjs ─► public/trust.json
                                                │
        ┌───────────────────────────────────────┴───────────────┐
        ▼                                                       ▼
  Settings → Trust & data                          showflow.pro/trust
  (imports facts.ts directly)                      (fetches trust.json)
```

`public/trust.json` is generated, never hand-edited, and served with
`Access-Control-Allow-Origin: *` from `vercel.json` — the same mechanism
`changelog.json` already uses for the landing page. Generation is wired into
`npm run sync:mirrors`, so the existing `sync:mirrors:check` CI gate fails the
build if someone adds a capability without regenerating. That is the drift
check.

The landing page follows the established `Changelog.tsx` pattern exactly:
fetch the published JSON at runtime, with a committed inline fallback so the
page always renders. The fallback is generated by the same script.

### Modules

**App (`showflow-pro`)**

| File | Responsibility |
|---|---|
| `src/lib/trust/facts.ts` | The claim tables: KPIs, controls, visibility matrix, subprocessors, retention, self-serve rights, documents. Pure data, no imports beyond types. |
| `src/lib/trust/capabilityInventory.ts` | Folds `CAPABILITY_DEFS` into the grouped shape the UI renders (group → defs, with counts). Pure. |
| `src/components/settings/trust/TrustDataTab.tsx` | Orchestrator for the Settings tab. |
| `src/components/settings/trust/OrgDataCard.tsx` | "This organisation's data" — four live counts. |
| `src/components/settings/trust/VisibilityMatrix.tsx` | Role segmented control + the eight-row table. Shared shape with the public page. |
| `src/components/settings/trust/RetentionCard.tsx` | Eight retention rows. |
| `src/components/settings/trust/YourDataCard.tsx` | Export / deletion, pointing at what actually exists. |
| `src/components/settings/trust/DocumentsCard.tsx` | The three web documents + DPA on request. |
| `scripts/build-trust-json.mjs` | Emits `public/trust.json`. Registered in `scripts/mirrors.manifest.json`. |

**Landing (`showflow-pro.landingpage`)**

| File | Responsibility |
|---|---|
| `src/pages/Trust.tsx` | The whole 1a page; fetch + fallback, like `Changelog.tsx`. |
| `src/data/trustFallback.ts` | Generated inline copy. |

Route `/trust` in `App.tsx`; "Trust" added to the footer's Company group.

### Live org counts (1c)

Chosen approach: no new backend. The four tiles read from hooks that already
exist —

- **Region** — static `EU · Ireland`, from the project region.
- **Records** — bookings count for the org, plus artists and productions.
- **Members** — `useOrgMembers` (the `list_org_members` RPC), split by role.
- **Outside reach** — the constant `None`, with the isolation test named as
  its evidence.

Counts render as skeletons while loading and degrade to an em-dash on error;
no ad-hoc loading flags, per the repo convention.

### Gating

Settings → Trust & data sits in the **Organization** group, directly after
Roles & permissions, and is shown to admins and production team
(`isAdmin || isProducer`) — matching the source design's note. It is not
entitlement-gated: it describes the platform, not a module.

## Error handling

- Landing page: fetch failure renders the committed fallback. No error state
  is shown to the reviewer — a trust page that cannot render is worse than a
  slightly stale one. The published JSON carries a `generatedAt` stamp that
  the page displays, so staleness is visible rather than hidden.
- App tab: React Query `isLoading` / `isError`; the counts degrade
  individually, the static claim tables always render.

## Testing

| Layer | What |
|---|---|
| Unit | `capabilityInventory` folds all 28 defs into 8 groups with 9 sensitive; a regression test asserts the counts the page prints match `CAPABILITY_DEFS.length` so the marketing copy can never drift from the registry. |
| Unit | `facts.ts` retention and subprocessor tables are asserted row-for-row against the strings in `docs/legal/privacy-policy.en.md`, parsed at test time. If the policy changes and the page does not, CI goes red. |
| Component | `TrustDataTab` renders each role's matrix column; asserts the production-team audit-log cell reads "Read-only" (the corrected claim) and that no "ShowFlow staff" tab exists. |
| Component | Org counts show skeletons, then values; error path shows the dash and does not blank the card. |
| Generated | `sync:mirrors:check` covers `public/trust.json`. |

## Out of scope

- The `1b` narrative and `1d` first-class-nav placements.
- Any document that does not exist today (DPA PDF, security overview, Art. 30
  records). The DPA row is a mailto, not a download.
- Org-level export or deletion for org admins. That is a real gap the audit
  surfaced, but building it is a separate piece of work.
