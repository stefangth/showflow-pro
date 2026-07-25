-- Add hire_order_copy + hire_order_theme to the producer hire-order arm.
--
-- WHY: the PDF template editor (Settings > Hire orders > PDF template) derives
-- its read-only state from the `edit_hire_order_settings` capability, which an
-- admin can grant to producers. Neither key was mapped here, so both fell into
-- the admin-only arm of the app_settings write policies: a capability-enabled
-- producer got a fully live editor whose "Save template" then failed with an
-- RLS error. UI and DB now agree.
--
-- Both keys are presentation-only settings for the hire-order document, the
-- same class as hire_order_letterhead and hire_order_terms, which this arm
-- already covers.
--
-- Full corrected function (CREATE OR REPLACE follow-up to
-- 20260723183042_app_setting_capability_add_keys.sql).
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
    else null  -- editor_*, email_log_retention_days, starter_catalog_template: admin-only, never producer
  end;
$$;
