-- The electronic-countersign gate must key off the mode the order was ISSUED under,
-- not the org's current setting, so switching an org from electronic to manual cannot
-- retroactively let a producer manually countersign an in-flight electronic order
-- (bypassing the signature/audit trail). The mode is read from the FROZEN issue_snapshot;
-- legacy orders (null snapshot, none exist yet) fall back to the live org setting.
create or replace function public.enforce_hire_order_transition()
returns trigger language plpgsql security definer set search_path to 'public'
as $tr$
begin
  if old.status = new.status then null;
  elsif old.status = 'draft'         and new.status in ('ready','void') then null;
  elsif old.status = 'ready'         and new.status in ('draft','issued','void') then null;
  elsif old.status = 'issued'        and new.status in ('countersigned','void') then null;
  elsif old.status = 'countersigned' and new.status = 'void' then null;
  else raise exception 'invalid hire order transition % -> %', old.status, new.status;
  end if;

  if old.status = 'issued' and new.status = 'countersigned'
     and new.signed_pdf_path is null
     and coalesce(new.issue_snapshot->>'countersign_mode',
                  public.get_org_setting(new.org_id, 'hire_order_countersign')->>'mode',
                  'manual') = 'electronic' then
    raise exception 'electronic hire orders must be countersigned through the signature flow';
  end if;

  if old.status in ('issued','countersigned') and (
       new.data is distinct from old.data
    or new.fee_amount is distinct from old.fee_amount
    or new.fee_currency is distinct from old.fee_currency
    or new.terms_variant is distinct from old.terms_variant
    or new.order_no is distinct from old.order_no
    or new.pdf_path is distinct from old.pdf_path
    or new.issue_snapshot is distinct from old.issue_snapshot
    or (new.booking_id   is distinct from old.booking_id   and new.booking_id   is not null)
    or (new.artist_id    is distinct from old.artist_id    and new.artist_id    is not null)
    or (new.show_date_id is distinct from old.show_date_id and new.show_date_id is not null)
  ) then
    raise exception 'issued hire orders are immutable';
  end if;
  return new;
end $tr$;
