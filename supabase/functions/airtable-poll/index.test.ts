/**
 * Stub tests for airtable-poll edge function.
 *
 * The Airtable integration makes live external HTTP calls and requires
 * real API credentials, so full integration tests are out of scope for unit
 * testing. These stubs document the expected behaviour and serve as
 * placeholders for future integration tests.
 */
import {
  assertEquals,
} from "https://deno.land/std@0.224.0/testing/asserts.ts";

Deno.test(
  {
    name: "airtable-poll: skips when airtable_sync_enabled is false",
    ignore: true,
  },
  async () => {
    // Would verify: when app_settings.airtable_sync_enabled = false,
    // the function returns { skipped: true, reason: 'sync disabled' }
  },
);

Deno.test(
  {
    name: "airtable-poll: returns 401 when X-Cron-Secret is missing",
    ignore: true,
  },
  async () => {
    // Would verify: request without X-Cron-Secret header → 401 Unauthorized
  },
);

Deno.test(
  {
    name: "airtable-poll: returns 401 when X-Cron-Secret is wrong",
    ignore: true,
  },
  async () => {
    // Would verify: request with wrong cron secret → 401 Unauthorized
  },
);

Deno.test(
  {
    name: "airtable-poll: upserts new show_date for each Airtable record",
    ignore: true,
  },
  async () => {
    // Would verify: new Airtable records create show_dates rows and call
    // open-offer-tier with tier=1 for each newly created date.
  },
);

Deno.test(
  {
    name: "airtable-poll: updates existing show_date date/city (no duplicate insert)",
    ignore: true,
  },
  async () => {
    // Would verify: records with matching airtable_record_id update
    // existing show_dates rows (date, city_id) rather than inserting duplicates.
  },
);

// Non-ignored sanity test to confirm this file loads correctly.
Deno.test("airtable-poll stub file loads without errors", () => {
  assertEquals(true, true);
});
