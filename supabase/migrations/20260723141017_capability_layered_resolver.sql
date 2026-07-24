-- Registry-default twin of CAPABILITY_DEFS[*].defaultEnabled (src/lib/capabilities.ts).
create or replace function public.capability_default(_capability text)
returns boolean language sql immutable set search_path = public as $$
  select case _capability
    when 'producer_can_invite' then true
    when 'producer_can_manage_invitations' then true
    when 'producer_can_manage_productions' then true
    when 'producer_can_archive_productions' then true
    when 'producer_can_reorder_productions' then true
    when 'producer_can_hard_delete_productions' then false
    when 'producer_can_manage_show_dates' then true
    when 'producer_can_hard_delete_show_dates' then false
    when 'producer_can_manage_casts' then true
    when 'producer_can_run_offer_engine' then true
    when 'producer_can_confirm_bookings' then true
    when 'producer_can_edit_booking_settings' then false
    when 'producer_can_add_artists' then true
    when 'producer_can_edit_artists' then true
    when 'producer_can_view_linked_accounts' then true
    when 'producer_can_generate_hire_orders' then true
    when 'producer_can_issue_hire_orders' then true
    when 'producer_can_void_hire_orders' then true
    when 'producer_can_manage_countersign' then true
    when 'producer_can_edit_hire_order_settings' then false
    when 'producer_can_rename_org' then false
    when 'producer_can_manage_ownership' then true
    when 'producer_can_manage_cities' then true
    when 'producer_can_edit_filter_settings' then false
    when 'producer_can_edit_scheduling' then true
    when 'producer_can_configure_airtable' then false
    when 'producer_can_trigger_sync' then false
    else false
  end;
$$;

-- Layered resolver: lock -> org override -> platform default -> registry default.
create or replace function public.is_capability_enabled(_org uuid, _capability text)
returns boolean language sql stable security definer set search_path = public as $$
  with pol as (
    select enabled, locked from public.org_capability_policies
    where org_id = _org and capability = _capability
  ),
  org as (
    select enabled from public.org_capabilities
    where org_id = _org and capability = _capability
  )
  select case
    when (select locked from pol) then coalesce((select enabled from pol), public.capability_default(_capability))
    when exists (select 1 from org) then (select enabled from org)
    when (select enabled from pol) is not null then (select enabled from pol)
    else public.capability_default(_capability)
  end;
$$;

create or replace function public.is_capability_locked(_org uuid, _capability text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select locked from public.org_capability_policies where org_id = _org and capability = _capability),
    false
  );
$$;
