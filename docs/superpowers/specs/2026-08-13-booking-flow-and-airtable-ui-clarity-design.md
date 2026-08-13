# Booking Flow and Airtable UI Clarity

## Goal

Make four existing settings and date-creation behaviors clearer and safer without changing the booking engine's at-risk calculation or adding new persisted settings.

## Approved scope

1. In Settings → Booking Engine, replace the vague at-risk-alert label with:

   **Alert the production team when the open tier cannot fill the remaining primary slots**

   Add this supporting text directly beneath it:

   **Checked hourly. An alert is sent when accepted bookings plus live pending offers are fewer than the required primary slots.**

   The server behavior remains unchanged: the watcher runs hourly, uses the existing capacity calculation, and has no configurable time gate.

2. In the booking-flow preset row, give the non-interactive Custom tile the same disabled/greyed appearance as preset buttons when the caller cannot edit booking settings. It remains a status indicator rather than a clickable preset.

3. In the New date dialog, initialize “Open Tier 1 offers after creating” as unchecked every time the create dialog opens. The checkbox remains available for an authorized user to opt in. Editing an existing date keeps the existing automatic-open behavior driven by the organization booking-flow policy.

4. In Settings → Airtable, whenever the selected sync frequency is below 60 minutes, show a warning:

   **Frequent syncs can hit Airtable limits**

   **Only select a frequency under one hour if your Airtable workspace is on a paid plan. Airtable may rate-limit frequent requests, which can cause sync runs to fail or updates to arrive late.**

   The warning is informational: it does not block selection or saving and appears for the existing 5-, 15-, and 30-minute options.

## Implementation boundaries

- Keep the at-risk watcher, cron schedule, booking-flow schema, defaults, presets, and persistence unchanged.
- Keep the existing Airtable polling intervals and server-side interval enforcement unchanged.
- Limit changes to the relevant React components, styles, and focused tests.
- Preserve existing permission enforcement; this work only makes the Custom tile visually consistent with the already-disabled controls.

## Testing

- Booking-flow component tests verify the revised label/helper copy and the Custom tile's disabled presentation in read-only mode while remaining normal for editors.
- New-date dialog tests verify Tier 1 opening is unchecked by default even when the organization flow enables automatic Tier 1 opening, and verify the user can still opt in.
- Airtable settings tests verify the warning appears for intervals below 60 minutes and is absent at 60 minutes or above.
- Run the focused Vitest files, TypeScript checks, and the repository's fast verification suite before completion.

