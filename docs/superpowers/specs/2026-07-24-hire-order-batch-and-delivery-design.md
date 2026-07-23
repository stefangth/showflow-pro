# Hire-order batching and delivery improvements — Design

## Goal

Make hire orders easier to track, sign, resend, and create in batches while preserving the issued document as the audit record.

## Scope

This design covers four connected hire-order changes:

1. Existing-order drawer delivery metadata and actions.
2. Drawing-first, dark-mode-safe electronic signatures.
3. Batch creation of one aggregated hire order per artist across one or more dates.
4. Signing-first issued-email CTA ordering.

## Data model

### Aggregated dates

New aggregated orders use a normalized `hire_order_dates` relation. Each row links an order to one selected `show_dates` row and stores its deterministic display position. The link must belong to the same organisation as the order.

`hire_orders.show_date_id` remains untouched for all legacy and new single-date orders. It is the compatibility link and is populated for a single-date order only. Aggregated orders are identified by their child `hire_order_dates` rows; consumers must read those rows when present and otherwise fall back to the legacy `show_date_id`.

The order's resolved `data` snapshot gains a structured, frozen list of selected engagement dates for aggregated orders. Each list item includes the date and the display data needed in the document. The familiar top-level `date`, venue, city, duration, and sessions fields remain the values used by existing single-date experiences and validation. For an aggregate, `date` is the earliest selected date so legacy ordering and order-number formatting remain deterministic; the PDF and email use the new list instead.

The database prevents an active order from covering the same artist and show date more than once, including when either order is aggregated. Voiding an order releases its date links for a new order.

### Delivery history

`hire_orders.last_sent_at` records the successful initial issue email and every successful resend. It is nullable until delivery succeeds. `created_at` remains the creation timestamp and `issued_at` remains the state transition timestamp. No resend may change the issued PDF, signature audit, terms, or issue snapshot.

## Batch wizard

The existing new-order wizard becomes a batch flow for linked engagements. Manual/no-linked-date orders remain a single-artist path.

1. Select one or more artists.
2. Select common show dates, then show a compact artist × date matrix. “Apply selected dates to all” provides the fast common-date path; each cell can then be toggled for artist-specific exceptions.
3. Collect one fee, currency, duration, and running order for the batch. These values apply unchanged to every generated order.
4. Review one row per artist, showing that artist’s selected dates and the total number of orders. A person with several selected dates produces exactly one aggregated order.

The batch draft endpoint accepts one artist/date-set payload and produces one result per artist. It isolates invalid artists or duplicate date assignments so valid orders are still created; the response lists each skipped/error outcome. Initial issue then sends every successfully created order independently.

## Existing-order drawer

The existing order slide-over remains the quick-action surface.

- It shows **Created** and **Last sent** with localised date/time values; “Not sent yet” is shown before a successful delivery.
- **View** opens the complete hire-order detail page.
- **Resend** is available on issued and countersigned orders, disabled during the request, and refreshes `last_sent_at` only after successful email dispatch.
- Download remains available as a secondary file action.

## Electronic signing

The signature control initially selects **Draw**. Moving between type and draw clears the incomplete signature exactly as it does today.

The drawing canvas chooses ink from the current application theme: dark-mode canvas uses white ink, while light mode uses the existing dark ink. The exported PNG therefore remains visible when rendered and stored.

## Email template

For electronic or Documenso signing, the email's first button is **Review and sign**. The document-view/download button and plain URL follow it as secondary access. Manual-signing orders retain **View and download** as their primary action and retain the current reply/sign-return guidance.

Resends use the same template and the issued PDF attachment, but have a distinct idempotency key from the original issue email.

## Errors and state safety

- Only producer/admin users in the order's organisation can resend or create a batch.
- Resend rejects any order that is not issued or countersigned, has no recipient, or has no stored PDF.
- A failed resend does not update `last_sent_at`.
- Issued and countersigned documents remain immutable; resend reuses their stored PDF rather than rendering a new one.
- Batch validation requires at least one date per selected artist and reports duplicates before or alongside creation results.

## Tests

- Migration/RPC tests cover aggregate-date ownership, duplicate detection, and void/recreate behavior.
- Edge-function tests cover batch response isolation, a single order per artist, per-order email issuing, and resend success/failure timestamp behavior.
- Template tests cover signing CTA before the view/download CTA.
- Component tests cover multi-artist selection, the date matrix, grouping in review, drawer timestamps/actions, default drawing mode, and dark-mode white ink.
- Existing single-date/manual wizard, signing, issue, download, and PDF tests remain green.

## Out of scope

- Per-artist fees or running orders within the same batch.
- Changing an issued order's selected dates.
- Bulk resending from the list view.
- Reworking imported hire orders into aggregate orders.
