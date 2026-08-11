-- Add the producer_can_manage_skills capability default (true) for the new
-- Settings -> Casts & Cities -> Skills catalog card. Unknown capability keys
-- remain admin-only through the false fallback.
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
    when 'producer_can_manage_skills' then true
    when 'producer_can_edit_filter_settings' then false
    when 'producer_can_edit_scheduling' then true
    when 'producer_can_configure_airtable' then false
    when 'producer_can_trigger_sync' then false
    when 'producer_can_edit_email_templates' then false
    else false
  end;
$$;
