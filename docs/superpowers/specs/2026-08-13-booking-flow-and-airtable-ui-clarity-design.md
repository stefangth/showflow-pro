# Booking Templates and Airtable UI Clarity

## Goal

Turn the existing hard-coded booking-flow presets into super-admin-managed platform templates, seed new organizations safely from the Off template, make per-organization customization visible, and clarify two existing operational behaviors.

## Platform booking templates

Platform → Defaults will expose editable definitions for Classic, Fast-track, Direct book, and Off. Each template contains:

- the complete normalized booking-flow policy, including its active state and reference-field choice;
- offer response-window hours;
- offer digest hour; and
- confirmation digest hour.

The Resend sender address remains a separate platform-wide default because it configures email transport rather than a booking-flow template.

The code-level template definitions remain the fallback when a platform template has not yet been saved. Super-admin saves materialize all four definitions as an explicit platform setting.

## Organization seeding and template identity

New organizations continue to start safely on Off. During provisioning, the current platform Off template is copied into organization-owned booking-flow and timing settings. Provisioning also records `off` as the organization's selected booking template.

Platform template edits never overwrite organization settings after creation. Existing organizations without a recorded template identity will infer it from their current effective values when those values exactly match one platform template; otherwise they will use Classic as their remembered base and display it as customized. This compatibility rule avoids rewriting production booking behavior during rollout.

Selecting a template in Settings → Booking Engine copies that platform template's current flow and timing values into the organization draft and records its template identity. Saving persists the values and identity together.

## Preset row and Custom state

Remove the standalone Custom tile. The four template tiles remain configuration shortcuts and status indicators.

The selected template stays highlighted. If the organization's current flow or timing settings differ from the current definition of its selected platform template, a design-system `Custom` badge appears alongside that template's name—for example, `Classic  Custom`.

This comparison intentionally uses the current platform template definition. Therefore either of these changes produces the Custom badge without modifying the organization automatically:

- an organization changes one of its booking-engine values after selecting a template; or
- a super-admin changes the selected platform template after that organization was seeded or last selected it.

For callers without permission to edit booking settings, all template tiles use the existing disabled/greyed treatment. The selected tile and Custom badge remain visible, but no tile is interactive.

## At-risk alert copy

Keep the existing watcher behavior and configuration. In Settings → Booking Engine, replace the vague label with:

**Alert the production team when the open tier cannot fill the remaining primary slots**

Add supporting text directly beneath it:

**Checked hourly. An alert is sent when accepted bookings plus live pending offers are fewer than the required primary slots.**

No lead-time threshold, new watcher rule, or new at-risk setting is added.

## New-date Tier 1 opt-in

In the New date dialog, initialize “Open Tier 1 offers after creating” as unchecked every time the create dialog opens, regardless of the organization's `auto_open_tier1` setting. The user can explicitly opt in before creating the date.

Editing an existing date keeps the current automatic-open behavior driven by the organization booking flow. Airtable-created dates also retain their existing server-side behavior; this change is scoped to the in-app New date dialog.

## Airtable rate-limit warning

In Settings → Airtable, whenever the selected sync frequency is below 60 minutes, show an informational warning:

**Frequent syncs can hit Airtable limits**

**Only select a frequency under one hour if your Airtable workspace is on a paid plan. Airtable may rate-limit frequent requests, which can cause sync runs to fail or updates to arrive late.**

The warning does not block selection or saving. It appears for the existing 5-, 15-, and 30-minute options and disappears at 60 minutes or above.

## Data and security boundaries

- Store platform template definitions in the existing `app_settings` model under a platform-only row (`org_id IS NULL`). Existing super-admin-only RLS continues to protect platform writes.
- Store the selected template identity as an organization-owned app setting, covered by the same booking-settings capability enforcement as the rest of the booking configuration.
- Provisioning reads the platform templates with the service-role client and writes organization-owned copies only during organization creation.
- Keep the at-risk watcher, cron schedule, capacity calculation, Airtable polling intervals, and server-side interval enforcement unchanged.
- Keep browser and edge-runtime booking-flow normalization aligned.

## Testing

- Pure tests cover platform-template fallback parsing, normalization, template comparison, selected-template inference, and Custom detection.
- Platform Defaults tests cover loading and saving all four template definitions while keeping sender configuration separate.
- Provisioning dependency-injection tests verify a new organization receives the current platform Off flow, timing values, and selected-template identity, including safe fallback behavior when the platform setting is absent.
- Booking Engine component tests verify selection applies the platform definition, divergence places the Custom badge on the selected tile, platform-definition divergence also displays Custom, and read-only styling disables every tile.
- New-date dialog tests verify Tier 1 opening is unchecked by default and remains an explicit opt-in.
- Airtable settings tests verify the warning below 60 minutes and its absence at 60 minutes or above.
- Run focused Vitest and Deno tests, all TypeScript projects, and the repository's fast verification suite before completion.
