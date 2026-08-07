-- Add the email-template producer capability and keep both SQL twins complete.
-- Unknown app_settings keys remain admin-only through the null fallback.
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
    when 'producer_can_edit_email_templates' then false
    else false
  end;
$$;

create or replace function public.app_setting_capability(_key text)
returns text language sql immutable set search_path = public as $$
  select case
    when _key in ('offer_response_window_hours','offer_digest_hour_berlin','confirmation_digest_hour_berlin',
                  'email_template_overrides','resend_from_address','booking_flow')
      then 'producer_can_edit_booking_settings'
    when _key in ('hire_order_defaults','hire_order_letterhead','hire_order_terms','hire_order_countersign',
                  'hire_order_numbering','hire_order_terms_variants','hire_order_copy','hire_order_theme')
      then 'producer_can_edit_hire_order_settings'
    when _key in ('filter_mappings','filters_visibility','notifications_enabled')
      then 'producer_can_edit_filter_settings'
    when _key in ('airtable_base_id','airtable_table_name','airtable_field_map','airtable_view',
                  'airtable_sync_enabled','airtable_poll_interval_minutes')
      then 'producer_can_configure_airtable'
    when _key in ('email_copy','email_theme')
      then 'producer_can_edit_email_templates'
    else null
  end;
$$;
