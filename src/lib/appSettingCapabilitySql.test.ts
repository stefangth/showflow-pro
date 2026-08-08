import { describe, expect, it } from "vitest";
import { readEffectiveCaseMap } from "@/test/sqlMigrationParser";

const EXPECTED_APP_SETTING_CAPABILITIES = {
  offer_response_window_hours: "producer_can_edit_booking_settings",
  offer_digest_hour_berlin: "producer_can_edit_booking_settings",
  confirmation_digest_hour_berlin: "producer_can_edit_booking_settings",
  email_template_overrides: "producer_can_edit_booking_settings",
  resend_from_address: "producer_can_edit_booking_settings",
  booking_flow: "producer_can_edit_booking_settings",
  hire_order_defaults: "producer_can_edit_hire_order_settings",
  hire_order_letterhead: "producer_can_edit_hire_order_settings",
  hire_order_terms: "producer_can_edit_hire_order_settings",
  hire_order_countersign: "producer_can_edit_hire_order_settings",
  hire_order_numbering: "producer_can_edit_hire_order_settings",
  hire_order_terms_variants: "producer_can_edit_hire_order_settings",
  hire_order_copy: "producer_can_edit_hire_order_settings",
  hire_order_theme: "producer_can_edit_hire_order_settings",
  filter_mappings: "producer_can_edit_filter_settings",
  filters_visibility: "producer_can_edit_filter_settings",
  notifications_enabled: "producer_can_edit_filter_settings",
  airtable_base_id: "producer_can_configure_airtable",
  airtable_table_name: "producer_can_configure_airtable",
  airtable_field_map: "producer_can_configure_airtable",
  airtable_view: "producer_can_configure_airtable",
  airtable_sync_enabled: "producer_can_configure_airtable",
  airtable_poll_interval_minutes: "producer_can_configure_airtable",
  email_copy: "producer_can_edit_email_templates",
  email_theme: "producer_can_edit_email_templates",
};

describe("effective app_setting_capability SQL twin", () => {
  it("has exactly the 25 approved setting mappings and leaves unknown keys admin-only", () => {
    const effective = readEffectiveCaseMap("app_setting_capability");

    expect(effective.mapping).toEqual(EXPECTED_APP_SETTING_CAPABILITIES);
    expect(effective.fallback).toBeNull();
  });
});
