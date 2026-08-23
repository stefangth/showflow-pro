# Wireflow v3: Settings deprecation map

Source: `docs/superpowers/specs/2026-08-23-wireflow-v3-get-running-settings-design.md` §8
("Settings mirror, retirement, deep-linking, deprecation").

The v3 "Get running" wizard (`GetRunningBoardV3`) now covers editing surfaces that
already exist as their own Settings tabs. This table is the initial read on what to do
about that overlap, tab by tab.

> **No tab is removed in this initiative without separate owner approval. This document
> is a recommendation, not an action.** Every tab below stays exactly as it is today
> until an owner signs off on a follow-up change.

## Overlap table

| Settings tab (`?tab=` value) | Component | Overlaps with wizard | Recommendation | Reason |
|---|---|---|---|---|
| Booking engine (`booking`) | `BookingFlowTab` | Flow + timing steps (response window, digest hours, flow presets) | Redirect into board (later) | Same settings, same org, edited in two places today; once the board is the default entry point, this tab should deep-link into the wizard step instead of duplicating the form |
| Casts & coverage (`casts-coverage`) | `CastsCitiesTab` (folded) | Coverage step | Redirect into board (later) | The wizard's coverage step already walks required-skill / cast-per-date setup; the tab is the same data, no longer the primary path once the board ships |
| Skills (`skills`) | `SkillsTab` | Skills step | Redirect into board (later) | Same skills catalog editor the wizard step already exposes inline |
| Contracts settings (`hire-orders`) | `HireOrdersTab` (Letterhead, Numbering, Order defaults, Terms variants, Countersign) | Contracts phase (letterhead/fee/terms/document/countersign) | Redirect into board (later) | The Contracts phase is a guided version of this exact card set; kept as a full tab for now because hire orders ship dark and the tab is also the only entry point for orgs that haven't reached the wizard's Contracts phase yet |

None of the four rows above are being redirected or retired in this PR. The
recommendation is "later, and only into the board" — never delete the underlying form,
since each tab remains the canonical editor even after a redirect.

## Kept untouched

These tabs have no wizard-step equivalent, or intentionally keep their standalone
editing surface. No change proposed, now or later, unless usage data says otherwise.

| Settings tab (`?tab=` value) | Component | Why it stays |
|---|---|---|
| Sources (`airtable`) | `AirtableSyncTab` | Ongoing sync observability (Airtable + Sheet), not a one-time setup step; the wizard's `get_dates` step only points here, it doesn't duplicate the console |
| People (`people`) | `PeopleTab` | Ongoing member/invite management, not part of first-run setup |
| Roles & rights (`permissions`) | `RolesRightsTab` | Org-admin capability matrix; no wizard step edits capabilities |
| Activity (`activity`) | admin activity log | Audit trail, not editable setup |
| Trust & data (`trust`, embedded) | `TrustDataTab` | Compliance reference surface, not setup |
| Documentation (`docs`) | `DocumentationTab` | Super-admin-only reference (system map), unrelated to org onboarding |
| Organization (`organization`) | `OrganizationTab` | Org identity/profile fields the wizard doesn't touch |
| Notifications (`notifications`) | notification preferences | Per-user preference, not org setup |
| Email templates (`email-templates`) | `EmailTemplatesTab` | Ongoing template authoring, not a wizard step |

## What "redirect into board" would mean, if approved later

For the four redundant-editing rows: replace the tab's own form with a summary card plus
a "Continue in Get running" link to the matching wizard step (`stepFeature.ts` +
`?step=<key>` deep-linking, per spec §8), rather than deleting the tab. The tab stays a
valid `?tab=` deep-link target; it just stops being a second copy of the same form. This
document does not authorize that change; it only records the recommendation so an owner
can approve it as a separate, scoped follow-up.
