-- Re-declare public.enforce_hire_order_transition() (last declared in
-- 20260717104220_hire_order_transition_freeze_assignment_fields.sql) to fix a
-- regression that migration introduced.
--
-- The regression: booking_id/artist_id/show_date_id all have ON DELETE SET NULL
-- FKs. Postgres implements SET NULL as an internal
-- `UPDATE hire_orders SET <col> = NULL`, which fires this BEFORE UPDATE trigger.
-- The absolute freeze added in 20260717104220 therefore rejected the referential
-- action itself, so deleting a booking/artist/show_date -- or hard-deleting a show,
-- which cascades to show_dates -- raised
-- 'issued hire orders are immutable' (P0001) for any org that had ever issued a
-- hire order. Worst impact: the super-admin GDPR RPC delete_org deletes
-- bookings/show_dates/artists before organizations and predates hire_orders, so
-- org deletion hard-failed outright. canHardDeleteShow/canHardDeleteDate
-- (src/lib/catalog.ts) hit the same wall with a misleading message.
--
-- The fix: allow nulling, block re-pointing. Each of the three assignment clauses
-- gains `and new.<col> is not null`, so the guard only rejects a move to a
-- different NON-NULL value. Truth table on an issued/countersigned row:
--   old=B1, new=B1   -> pass (no-op)
--   old=B1, new=NULL -> pass (referential SET NULL works; delete_org restored)
--   old=B1, new=B2   -> reject (the actual threat: silently re-pointing an issued
--                      document at a different booking/artist/show_date)
--   old=NULL, new=B2 -> reject (cannot re-attach after nulling)
--
-- Nulling is safe to permit: it only ever happens when the referenced row is being
-- destroyed, and it removes the link rather than making the document claim to
-- represent something it does not. The document's own content (data, fee_amount,
-- fee_currency, terms_variant, order_no, pdf_path) stays an ABSOLUTE freeze --
-- those six clauses are deliberately unchanged, as is the transition legal-set
-- logic.
--
-- FK delete actions are intentionally NOT changed, and delete_org is not touched.
--
-- CREATE OR REPLACE updates the function in place; the existing
-- enforce_hire_order_transition trigger keeps calling it, so the trigger binding is
-- intentionally NOT re-created here (same move as
-- 20260714104826_booking_flow_guard_and_reminder.sql).

CREATE OR REPLACE FUNCTION public.enforce_hire_order_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
begin
  if old.status = new.status then null;
  elsif old.status = 'draft'         and new.status in ('ready','void') then null;
  elsif old.status = 'ready'         and new.status in ('draft','issued','void') then null;
  elsif old.status = 'issued'        and new.status in ('countersigned','void') then null;
  elsif old.status = 'countersigned' and new.status = 'void' then null;
  else raise exception 'invalid hire order transition % -> %', old.status, new.status;
  end if;
  -- Issued documents are frozen. The document's own content is an absolute freeze.
  -- The assignment links (booking/artist/show_date) may only be CLEARED -- which is
  -- what an ON DELETE SET NULL referential action does when the referenced row is
  -- destroyed -- never re-pointed at a different non-null row.
  if old.status in ('issued','countersigned') and (
       new.data is distinct from old.data
    or new.fee_amount is distinct from old.fee_amount
    or new.fee_currency is distinct from old.fee_currency
    or new.terms_variant is distinct from old.terms_variant
    or new.order_no is distinct from old.order_no
    or new.pdf_path is distinct from old.pdf_path
    or (new.booking_id   is distinct from old.booking_id   and new.booking_id   is not null)
    or (new.artist_id    is distinct from old.artist_id    and new.artist_id    is not null)
    or (new.show_date_id is distinct from old.show_date_id and new.show_date_id is not null)
  ) then
    raise exception 'issued hire orders are immutable';
  end if;
  return new;
end $$;
