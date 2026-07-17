-- Re-declare public.enforce_hire_order_transition() (originally defined in
-- 20260717102508_hire_orders_schema.sql) to close two review gaps:
--
-- 1. Freeze list omitted booking_id/artist_id/show_date_id, so an issued or
--    countersigned hire order could be re-pointed at a different
--    booking/artist/show_date after the PDF was generated (and possibly
--    signed), silently decoupling the document from what it claims to
--    represent. Add all three to the existing 'issued hire orders are
--    immutable' freeze condition. This restores the plan's Global
--    Constraint: "Issued and countersigned orders are immutable except
--    status fields (guarded in SQL, Task 1)."
-- 2. The function was created as plain `language plpgsql`, but its own
--    source comment says it mirrors enforce_booking_transition
--    (20260714104826_booking_flow_guard_and_reminder.sql) -- and that
--    precedent IS `SECURITY DEFINER SET search_path = public`. Add both
--    clauses to close the live `function_search_path_mutable` advisor WARN.
--    This does not change behavior: the function only compares OLD/NEW row
--    values and raises.
--
-- CREATE OR REPLACE updates the function in place; the existing
-- enforce_hire_order_transition trigger keeps calling it, so the trigger
-- binding is intentionally NOT re-created here (same move as
-- 20260714104826_booking_flow_guard_and_reminder.sql).
--
-- Transition legal-set logic is preserved exactly as-is; only the freeze
-- list and function attributes change.

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
  -- Issued documents are frozen: only status machinery and internal metadata
  -- may move. Document content and the entities the order claims to
  -- represent (booking/artist/show_date) are locked once issued.
  if old.status in ('issued','countersigned') and (
       new.data is distinct from old.data
    or new.fee_amount is distinct from old.fee_amount
    or new.fee_currency is distinct from old.fee_currency
    or new.terms_variant is distinct from old.terms_variant
    or new.order_no is distinct from old.order_no
    or new.pdf_path is distinct from old.pdf_path
    or new.booking_id is distinct from old.booking_id
    or new.artist_id is distinct from old.artist_id
    or new.show_date_id is distinct from old.show_date_id
  ) then
    raise exception 'issued hire orders are immutable';
  end if;
  return new;
end $$;
