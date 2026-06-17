# Phase 5 — Identity / Contact Ownership — Design Spec

**Status:** Draft for review
**Date:** 2026-06-17
**Owner:** Stefan Schaal
**Implements:** [ADR-0001](../../adr/0001-airtable-system-of-record.md) item 6 (Phase 5); master spec
[§12 step 5](2026-06-16-airtable-sync-engine-design.md). **Records ADR-0011** (content in §5).

---

## 1. Summary (plain language)

A person's details live in two places: a **global `profiles` row** (their login account) and a
**per-org `artists` row** (their bookable talent record). The handoff framed Phase 5 as
"deduplicating" the two. Investigation softened that premise:

- Production currently holds **1 profile and 0 artists** — there is **no divergent data to
  reconcile**. This is a schema/behaviour design task, not a data cleanup, and migration risk is
  effectively zero.
- The two tables serve **different populations**. `profiles` is the identity of a *logged-in user*
  (chat author labels, member lists, producer dropdowns); `artists` is a *bookable talent entity in
  an org* that may have **no login at all** (`artists.user_id` is nullable — external artists). The
  contact fields on `artists` are therefore **load-bearing**, not accidental duplication: an
  unregistered artist has no profile, so their name/email/phone must live on the artist row.

So Phase 5 does **not** merge the tables and **does not** drop columns. It:

1. **Names the model** so future code doesn't "fix" the split by merging it (ADR-0011 + docs).
2. **Enforces one resolution rule** where it actually matters — the offer/confirmation **digests** —
   so a registered artist is addressed at the right email, and the long-standing
   "blank `artists.email` → the artist gets no email at all" gap is closed.
3. **Makes the link visible** to admins via a read-only "Linked account" panel on the artist sheet,
   so the (now login-first) digest routing is transparent rather than surprising.

## 2. Goals / Non-goals

**Goals**
- Record the identity-vs-booking-contact ownership model (ADR-0011) and update the docs.
- A single, **tested** resolver used by both the digests and the UI (one source of truth).
- Digests address registered artists per the chosen rule and stop silently dropping recipients.
- A read-only unified **"Linked account"** view on `ArtistProfileSheet`.

**Non-goals**
- **No merge** of `profiles`/`artists`; **no column drops** — `artists.cast_role` and
  `profiles.avatar_url` are intentionally retained as *reserved* (documented, not removed).
- No migration of contact data (there is none to migrate).
- **No new contact home for unregistered artists** — they keep `artists.*`.
- No change to how the link is *created* — `accept_invitation`'s email-claim stays as-is.
- **No ProfilePage talent panel** — ProfilePage is a *global* account page; a talent record is
  *org-scoped* and admin-managed, so mixing them is awkward and low-value.
- No two-way sync; no new identity/`venues` tables.

## 3. Current state (verified against the live schema + code)

- **`profiles`** (global, one per auth user): `user_id`, `display_name`, `phone`, `avatar_url`.
  Created on signup by the `handle_new_user` trigger
  (`display_name = raw_user_meta_data->>'display_name'`, falling back to the email).
- **`artists`** (per org): `id`, `user_id` (**nullable**), `name`, `email`, `phone`, `bio`,
  `cast_role`, `status`, `org_id`.
- **Linking is headless and by email.** `accept_invitation(token)` (SECURITY DEFINER) claims an
  unregistered artist row by `org_id` + `lower(email) = lower(invite.email)`, setting
  `artists.user_id`. Consequence: **at link time `artists.email == auth.users.email`**; they diverge
  only if someone later edits `artists.email` or the user changes their login email. The link is
  read today only by `useMyArtist` (find "my" artist row), `useChatParticipant` (chat gating), and —
  after this phase — the digests.
- **Consumer sweep (the fields in scope):**
  - `profiles.display_name` → `ProfilePage` (self-edit), chat author labels (`ChatPanel`), member
    lists (`list_org_members` RPC → `MembersTab`, `OrgMembersPopover`), producer dropdowns
    (`fetchOrgProducers`).
  - `artists.{name,email,phone,bio,status}` → `ArtistProfileSheet`, `ArtistsPage`,
    `CastDetailsSheet`, `AdminPage` (audit log), and the **two digests**
    (`send-offer-digest`, `send-confirmation-digest`): recipient = `artists.email`, greeting =
    `artists.name`, and **`if (!recipientEmail) continue`** silently skips a null-email artist.
  - `artists.cast_role` → unused (a test fixture only). `profiles.avatar_url` → fetched in
    `fetchMyProfile`, never rendered or written. **Both retained as reserved per the decision below.**
  - **No surface currently reads both an artist row and its profile for the same person.**

## 4. Decisions (locked this phase)

1. **Direction:** formalize the split + clean up; **keep** the dead columns (`cast_role`,
   `avatar_url`) — mark reserved, do **not** drop.
2. **Build scope:** docs + a tested resolver + **enforce in behaviour** (the digests).
3. **Digest recipient for a registered artist:** `coalesce(auth.users.email, artists.email)` —
   **login email first**, booking email as fallback. Unregistered artist → `artists.email`.
4. **Frontend:** a **unified "Linked account" panel** on `ArtistProfileSheet` (the "medium" option).
   ProfilePage is excluded.
5. **Privacy:** the panel does **not** surface the personal `profiles.phone`; **producers** see only
   the Registered/Unregistered badge (no PII), admins see the account identity — keeping login-email
   exposure at exactly today's admin-only `list_org_members` boundary.

## 5. The ownership model → **ADR-0011** (to be created at `docs/adr/0011-identity-contact-ownership.md`)

**Decision:** `profiles` owns **login-user identity**; `artists` owns the **org-scoped bookable
talent record and its booking contact**. The overlap is not duplication to be merged — it is two
different real-world contacts (account vs. booking) that happen to coincide at link time.

| Concern | Home (source of truth) | Notes |
|---|---|---|
| Account display name | `profiles.display_name` | The person *as a logged-in user* (chat, member lists). |
| Login / account email | `auth.users.email` | Canonical for a registered user. |
| Personal phone | `profiles.phone` | Registered users only. |
| Avatar | `profiles.avatar_url` | **Reserved** — fetched but unrendered today. |
| Talent label | `artists.name` | The booking/stage name; may legitimately differ from `display_name`. |
| Booking contact email | `artists.email` | Present for *every* artist (the only email an **unregistered** artist has). |
| Booking contact phone | `artists.phone` | Present for every artist. |
| Org role data | `artists.{bio,status}`, `artists.cast_role` (**reserved**) | Org-specific. |

**Seam rule (registered artist, `user_id` set):** account identity wins for *the person* (digest
recipient + greeting → §7/§8); the talent label (`artists.name`) stays for *talent surfaces*
(ArtistProfileSheet/ArtistsPage/casts). Booking vs. personal contact are distinct by design and are
never merged. **Unregistered artists are unaffected** — `artists.*` is their only contact.

## 6. DB change — one function

The digests run under the **cron / service-role** path (`requireCronOrRole`) and have no user JWT, so
they cannot use the admin-gated `list_org_members`. They need a service-role-only, batched lookup of
login email + display name by `user_id`. Mirrors the existing `list_org_members` `auth.users` join.

```sql
-- migration: <recorded-version>_resolve_user_contacts.sql
create or replace function public.resolve_user_contacts(p_user_ids uuid[])
returns table (user_id uuid, email text, display_name text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.email::text, p.display_name
  from auth.users u
  left join public.profiles p on p.user_id = u.id
  where u.id = any(p_user_ids);
$$;

-- It can read any user's auth email, so it is service-role only.
revoke all on function public.resolve_user_contacts(uuid[]) from public, anon, authenticated;
grant execute on function public.resolve_user_contacts(uuid[]) to service_role;
```

This is the **only** new DB object in Phase 5. No table, column, RLS, or trigger changes. The
frontend panel does **not** use it (§9 reuses `list_org_members`).

## 7. Shared resolver — `supabase/functions/_shared/identity.ts` (+ re-export `src/lib/identity.ts`)

Pure functions, the single home for the rule. Lives in `_shared` so Deno edge functions import it
directly; the frontend re-exports it across the `supabase/` dir exactly as Phase 3 does for
`_shared/airtableKey.ts` (`src/data/airtableMapping.ts` re-export; `moduleResolution: "bundler"` +
`allowImportingTsExtensions` make the cross-`.ts` import typecheck — CI-validated).

```ts
// supabase/functions/_shared/identity.ts

/** The address to reach a person. Registered → login (auth) email wins; booking email is fallback.
 *  Unregistered → only the booking email exists. Whitespace-only values are treated as absent. */
export function resolveContactEmail(opts: {
  authEmail?: string | null;
  bookingEmail?: string | null;
}): string | null {
  const auth = opts.authEmail?.trim();
  const booking = opts.bookingEmail?.trim();
  return auth || booking || null;
}

/** The name to address a person by in account/identity contexts (e.g. a digest greeting).
 *  Account display name wins; the talent label is the fallback. */
export function resolveAccountDisplayName(opts: {
  displayName?: string | null;
  artistName?: string | null;
}): string {
  return (opts.displayName?.trim() || opts.artistName?.trim() || "");
}
```

```ts
// src/lib/identity.ts  (frontend re-export — single source of truth)
export { resolveContactEmail, resolveAccountDisplayName } from
  "../../supabase/functions/_shared/identity.ts";
```

## 8. Edge function changes — `send-offer-digest` + `send-confirmation-digest`

Both follow the identical shape. Change, per org:

1. Add `user_id` to the joined `artists(...)` select: `artists ( id, name, email, user_id )`.
2. After grouping by artist, collect the distinct **registered** `user_id`s and resolve them in one
   call: `const { data } = await admin.rpc("resolve_user_contacts", { p_user_ids })`; build a
   `Map<user_id, { email, display_name }>`.
3. Per artist, resolve recipient + greeting via the shared resolver:

```ts
const acct = artist.user_id ? byUser.get(artist.user_id) : undefined;
const recipientEmail = resolveContactEmail({ authEmail: acct?.email, bookingEmail: artist.email });
const displayName    = resolveAccountDisplayName({ displayName: acct?.display_name, artistName: artist.name });
if (!recipientEmail) continue; // truly no address anywhere — unchanged guard, now rarely hit
```

- **Gap closed:** a *registered* artist with a blank `artists.email` previously matched
  `if (!recipientEmail) continue` and received **nothing**; now they receive at their login email.
- **Idempotency unchanged:** the `idempotency_key` and `digest_sent_at`/`offer_expires_at` stamping
  are untouched; only recipient/greeting derivation changes.
- DI/test seam unchanged: `deps.admin.rpc(...)` is exercised via `makeFakeDeps` (§11).

## 9. Frontend — "Linked account" panel on `ArtistProfileSheet`

A **read-only** section added to the existing sheet (which today shows name/email/phone/status/bio/
skills, keyed on `['artists','detail',artistId]`). It answers "is this talent a registered user, who,
and where do their digests actually go?"

- **Registered badge (everyone who can open the sheet):** derived from `artist.user_id` alone (no
  PII) — `Registered` vs `Unregistered / external`.
- **Account details (admins only):** account `display_name`, login email, and the **effective digest
  recipient** (`resolveContactEmail({ authEmail: account.email, bookingEmail: artist.email })`). This
  is the transparency win for the login-first routing.
- **Data source:** reuse the existing admin-only `list_org_members` via `useOrgMembers()` and match
  on `artist.user_id` — **no new frontend RPC**, and login-email PII stays at today's admin-only
  boundary. `useOrgMembers` is only enabled when the viewer is an admin (the RPC is admin-gated;
  producers would 403), so producers fall through to the badge-only view.
- **States:** loading (Skeleton row); unregistered (`artist.user_id` null → "Not linked — external
  artist; digests go to the booking email"); registered-but-not-found (membership removed while the
  artist row stays linked → show Registered badge, "account details unavailable", and fall back to
  showing `artists.email` as the effective recipient).
- **Privacy:** personal `profiles.phone` is **not** shown.

## 10. Error handling & edge cases

- **Unregistered artist (`user_id` null):** panel shows "external"; digest uses `artists.email`.
- **Registered, `auth` email null** (phone-only auth — not used here): resolver falls back to the
  booking email; never throws.
- **`resolve_user_contacts` returns a subset** (a `user_id` with no `auth.users` row — shouldn't
  happen, but): that artist is treated as unregistered → booking email.
- **Login email changed after link:** the digest now follows the login email (intended); the panel
  surfaces it, so the divergence from `artists.email` is visible rather than silent.
- **Multiple artist rows per user across orgs:** the panel is scoped to the sheet's single artist
  row, so cross-org multiplicity is irrelevant here.
- **Membership removed but artist row still linked:** `remove_org_member` deletes the membership but
  does **not** unclaim the artist (`artists.user_id` stays set). Handled by the
  "registered-but-not-found" state above. **Known accepted divergence:** in this corner the *digest*
  (service-role `resolve_user_contacts`, which reads `auth.users` directly) still resolves the login
  email, while the *panel* (admin-scoped `list_org_members`, which requires an active membership)
  cannot display it. The panel's "effective digest email" is therefore a **best-effort mirror**, not
  a guaranteed-identical recomputation of the digest — the price of reusing the admin-only member
  data instead of widening `resolve_user_contacts` to the frontend. Acceptable: the case is rare and
  the digest still delivers correctly.

## 11. Testing strategy (five layers)

- **Unit — resolver (Deno local + vitest CI):** `resolveContactEmail` (login-first; booking
  fallback; whitespace-only treated as absent; both null → null) and `resolveAccountDisplayName`
  (display-name-first; fallback; empty handling).
- **Edge — Deno DI (local), both digests:** via `makeFakeDeps` with a fake `admin.rpc`:
  (a) registered with a distinct login email → login email wins;
  (b) unregistered → booking email; greeting uses `artists.name`;
  (c) **registered with blank `artists.email`** → delivers at login email (**regression** for the
  silent-skip gap);
  (d) registered greeting prefers `display_name` over `artists.name`.
- **DB — pgTAP (CI):** `resolve_user_contacts` exists and returns `email`+`display_name` for a seeded
  user; **`authenticated` cannot execute it** (privilege locked down).
- **Component — vitest + RTL (CI):** `ArtistProfileSheet` renders the Registered badge + the
  effective digest email for an admin; renders badge-only for a producer (no login email).

(Frontend vitest + pgTAP run in CI only here; Deno tests run locally.)

## 12. Sequencing within Phase 5 (for `writing-plans` to expand)

Independent-ish tasks; natural order. Task 4 depends on 2 + 3; task 5 depends on 2.

1. **Docs/ADR:** write ADR-0011 (§5); update ADR-0001 item 6 + master spec §12 step 5 to the refined
   no-merge scope; CLAUDE.md (data-model + digest notes); `docs/app-logic.md`.
2. **Shared resolver:** `_shared/identity.ts` + `src/lib/identity.ts` re-export + unit tests.
3. **DB:** `resolve_user_contacts` migration + pgTAP (apply via MCP; name the file to the recorded
   version; regen `types.ts`).
4. **Edge:** rewire both digests to the resolver + RPC; Deno DI tests incl. the gap regression.
5. **Frontend:** `ArtistProfileSheet` "Linked account" panel + `useOrgMembers` wiring + component
   test.

## 13. Open questions (resolved — recorded for traceability)

- **Show personal `profiles.phone` in the panel?** No (privacy; not needed). Revisit if admins ask.
- **Producers see the login email?** No — badge only; keeps PII at the `list_org_members` boundary.
- **Batched RPC vs per-user `auth.admin.getUserById`?** Batched RPC — one query, pgTAP-testable,
  matches the `list_org_members` precedent.

## 14. Rollout / risk

- **Migration-light:** one service-role function; no data touched; reversible (drop the function,
  revert the edge/UI changes).
- **No behaviour change for unregistered artists** and **no frontend behaviour change outside the new
  read-only panel** — the only live-path change is the digest recipient/greeting derivation.
- Branch off fresh `main` (incl. #104 `4cdc5cd`) — **done**. Validate frontend + pgTAP via CI; run
  Deno tests locally.
