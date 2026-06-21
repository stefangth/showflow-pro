# Edge-function org-scope audit (issue #110 / SFP-168)

**Date:** 2026-06-21

**Scope.** Sweep every Supabase edge function for the cross-org authorization gap
first identified in #109: a function that (1) accepts a caller-supplied **entity
id**, (2) authorizes with any-org `requireRole`, and (3) reads/writes through the
**service-role admin client** (which bypasses RLS). That combination lets an
admin/producer of org A act on org B's data by supplying org B's id.

**Reference fix (already merged, #109, commit `73816f2`).** `open-offer-tier` and
`close-offer-tier` now resolve the target `show_date`'s `org_id` and gate with
`requireOrgRole(org_id, ['admin','producer'])` (service-role bypass retained;
super-admins accepted), each with a wrong-org → 403 test.

## Result

The **write-path** sweep is clean: no edge function other than the two offer-tier
functions had the RLS-bypassing cross-org *write* gap. One read-path instance of
the same shape was found and fixed in this change: **`admin-list-users`**.

### Every edge function, classified

| Function | Caller entity id | Authorization | RLS-bypass write? | Verdict |
|---|---|---|---|---|
| `open-offer-tier` | `show_date_id` | coarse `requireRole` → `requireOrgRole(org_id)` | yes | ✅ Fixed in #109 |
| `close-offer-tier` | `show_date_id` | coarse `requireRole` → `requireOrgRole(org_id)` | yes | ✅ Fixed in #109 |
| **`admin-list-users`** | `org_id` (param/body) | was any-org `requireRole(['admin'])` | no (read) | ⚠️ **Fixed here** → `requireOrgRole(org_id,['admin'])` |
| `admin-set-role` | `org_id` (body) | `requireOrgRole(org_id,['admin'])` | yes | ✅ Already org-scoped |
| `create-invitation` | `org_id` (body) | `requireOrgRole(org_id,['admin'])` | yes | ✅ Already org-scoped |
| `resend-invitation` | invitation id | resolves `invite.org_id` → `requireOrgRole` | yes | ✅ Already org-scoped |
| `airtable-schema` | `org_id` (body) | `requireOrgRole(org_id,['admin'])` | reads Vault PAT | ✅ Already org-scoped |
| `provision-org` | — (creates org) | `requireSuperAdmin` | yes | ✅ Super-admin only |
| `expire-offers` | none (global batch) | `requireCronOrRole` | yes | ✅ No entity-id targeting; per-row `org_id` resolved + correct |
| `tier-at-risk-watcher` | none (global batch) | `requireCronOrRole` | yes | ✅ Same as above |
| `send-offer-digest` | none (per-org batch) | `requireCronOrRole` | yes | ✅ Iterates active orgs; resolves per-org |
| `send-confirmation-digest` | none (per-org batch) | `requireCronOrRole` | yes | ✅ Same as above |
| `airtable-poll` | none | cron-secret only (no user-JWT path) | yes | ✅ Cron-only |
| `preview-transactional-email` | none | `requireRole(['admin','producer'])` | no (render-only) | ✅ No entity, no write |
| `send-transactional-email` | recipient + template (not an org entity) | none in-handler (platform JWT) | yes (global logs) | ➖ See note 2 |
| `handle-email-suppression` | none | Resend HMAC webhook signature | yes (global) | ✅ Signature-authed |
| `handle-email-unsubscribe` | unsubscribe token | unguessable token capability | yes (global) | ✅ Token-authed |

## Fix applied: `admin-list-users`

**Gap.** It authorized with any-org `requireRole(['admin'])`, then reported
`org_memberships` roles for a caller-supplied `org_id`. An admin of org A could
pass `org_id=<org B>` and read org B's full role roster (who is admin / producer /
artist) — an org-isolation breach. It is read-only (no RLS-bypassing write), so it
sits just outside the literal #109 *write* gap, but it is the same shape:
entity id (`org_id`) + any-org `requireRole` + admin client.

**Fix.** Gate with `requireOrgRole(org_id, ['admin'])` (super-admins still pass,
mirroring the offer-tier fix). The app now passes the caller's active org
(`AdminPage`, `EditorToolbar`); the handler reads it from `?org_id` or the request
body (query param wins), defaulting to the bootstrap org. Tests added: cross-org
admin → 403; super-admin with no org role → 200 (platform_admins fallback); the
POST-body transport is honored over the bootstrap default.

## Notes / follow-ups (flagged, out of scope for #110)

1. **`admin-list-users` still returns the global auth-user list.** Independent of
   `org_id`, the function lists every platform auth user (id, email, timestamps) to
   any org admin. This is a pre-existing, equal-for-all-admins exposure (not a
   cross-org escalation via the param), tied to the invite/assign UX. Only the
   **role roster** was org-scoped here; narrowing the user list itself needs product
   input — recommend a separate ticket.
2. **`send-transactional-email` has no in-handler role check.** It relies on
   platform JWT verification and is intended for internal `sendEmail` invocation; it
   is not entity/org-scoped (writes only to global email-log tables). Recommend
   confirming `verify_jwt` is enabled for it, or adding an explicit service-role
   guard — separate ticket.
3. **Cron functions accept a user-JWT trigger (`requireCronOrRole`).** Any
   admin/producer of any org can manually trigger the global maintenance passes
   (`expire-offers`, the digests, `tier-at-risk-watcher`). Effects are idempotent and
   resolved per-org, so the blast radius is "runs the legitimate cron early."
   Acceptable; noted for completeness.
