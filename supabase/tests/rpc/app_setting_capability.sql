-- pgTAP: public.app_setting_capability(key) — the app_settings key -> capability map.
-- Pure immutable function; no role switch needed.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

-- Representative key per arm resolves to the right capability.
SELECT is(public.app_setting_capability('offer_response_window_hours'), 'producer_can_edit_booking_settings', 'booking key -> edit_booking_settings');
SELECT is(public.app_setting_capability('booking_flow'), 'producer_can_edit_booking_settings', 'booking_flow -> edit_booking_settings');
SELECT is(public.app_setting_capability('hire_order_letterhead'), 'producer_can_edit_hire_order_settings', 'hire-order key -> edit_hire_order_settings');
SELECT is(public.app_setting_capability('hire_order_countersign'), 'producer_can_edit_hire_order_settings', 'countersign key -> edit_hire_order_settings');
SELECT is(public.app_setting_capability('filters_visibility'), 'producer_can_edit_filter_settings', 'filter key -> edit_filter_settings');
SELECT is(public.app_setting_capability('airtable_view'), 'producer_can_configure_airtable', 'airtable_view -> configure_airtable');
SELECT is(public.app_setting_capability('airtable_base_id'), 'producer_can_configure_airtable', 'airtable key -> configure_airtable');

-- Admin-only / unknown keys return null (fail-safe: producer denied).
SELECT is(public.app_setting_capability('editor_column_templates'), NULL, 'editor key -> null (admin-only)');
SELECT is(public.app_setting_capability('some_future_unmapped_key'), NULL, 'unknown key -> null (fail-safe)');

SELECT * FROM finish();
ROLLBACK;
