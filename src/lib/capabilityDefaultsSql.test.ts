import { describe, expect, it } from "vitest";
import { readEffectiveCaseMap } from "@/test/sqlMigrationParser";

const EXPECTED_CAPABILITY_DEFAULTS = {
  producer_can_invite: true,
  producer_can_manage_invitations: true,
  producer_can_manage_productions: true,
  producer_can_archive_productions: true,
  producer_can_reorder_productions: true,
  producer_can_hard_delete_productions: false,
  producer_can_manage_show_dates: true,
  producer_can_hard_delete_show_dates: false,
  producer_can_manage_casts: true,
  producer_can_run_offer_engine: true,
  producer_can_confirm_bookings: true,
  producer_can_edit_booking_settings: false,
  producer_can_add_artists: true,
  producer_can_edit_artists: true,
  producer_can_view_linked_accounts: true,
  producer_can_generate_hire_orders: true,
  producer_can_issue_hire_orders: true,
  producer_can_void_hire_orders: true,
  producer_can_manage_countersign: true,
  producer_can_edit_hire_order_settings: false,
  producer_can_rename_org: false,
  producer_can_manage_ownership: true,
  producer_can_manage_cities: true,
  producer_can_edit_filter_settings: false,
  producer_can_edit_scheduling: true,
  producer_can_configure_airtable: false,
  producer_can_trigger_sync: false,
  producer_can_edit_email_templates: false,
};

describe("effective capability_default SQL twin", () => {
  it("has exactly the 28 approved defaults and fails closed for unknown keys", () => {
    const effective = readEffectiveCaseMap("capability_default");

    expect(effective.mapping).toEqual(EXPECTED_CAPABILITY_DEFAULTS);
    expect(effective.fallback).toBe(false);
  });
});
