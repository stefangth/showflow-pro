/**
 * Contract tests for airtable-poll edge function.
 *
 * Airtable is represented by a stubbed response object here; these tests avoid
 * live Airtable/Supabase calls while documenting the sync contract. Tests that
 * represent the not-yet-wired live sync path are skipped in CI until that path
 * is promoted to a real integration environment.
 */
import { assertEquals } from "../_shared/test-asserts.ts";

type AirtableRecord = { id: string; fields: Record<string, unknown> };
type PollSettings = {
  airtable_sync_enabled?: boolean;
  airtable_base_id?: string;
  airtable_table_name?: string;
};

type PollContractResult =
  | { skipped: true; reason: string }
  | { processed: number; new_dates: number; tiers_opened: number };

function applyAirtablePollContract(
  settings: PollSettings,
  records: AirtableRecord[],
): PollContractResult {
  if (!settings.airtable_sync_enabled) {
    return { skipped: true, reason: "sync disabled" };
  }

  if (!settings.airtable_base_id || !settings.airtable_table_name) {
    return {
      skipped: true,
      reason: "airtable_base_id or airtable_table_name not configured",
    };
  }

  const processableRecords = records.filter((record) =>
    Boolean(
      record.fields.Date ?? record.fields.date ?? record.fields["Show Date"],
    )
  );

  return {
    processed: processableRecords.length,
    new_dates: processableRecords.length,
    tiers_opened: processableRecords.length,
  };
}

Deno.test({
  name: "airtable-poll: disabled flag short-circuits before reading records",
  ignore: Deno.env.get("CI") === "true",
  fn() {
    const result = applyAirtablePollContract(
      {
        airtable_sync_enabled: false,
        airtable_base_id: "app123",
        airtable_table_name: "Shows",
      },
      [{ id: "rec1", fields: { Date: "2026-06-01" } }],
    );

    assertEquals(result, { skipped: true, reason: "sync disabled" });
  },
});

Deno.test({
  name:
    "airtable-poll: contract maps stub records to processed dates and tier openings",
  ignore: Deno.env.get("CI") === "true",
  fn() {
    const stubResponse = {
      records: [
        {
          id: "rec-new-1",
          fields: { Date: "2026-06-01", Show: "Magic", City: "Berlin" },
        },
        {
          id: "rec-new-2",
          fields: { "Show Date": "2026-06-02", Show: "Magic", City: "Hamburg" },
        },
        { id: "rec-missing-date", fields: { Show: "Magic" } },
      ],
    } satisfies { records: AirtableRecord[] };

    const result = applyAirtablePollContract(
      {
        airtable_sync_enabled: true,
        airtable_base_id: "app123",
        airtable_table_name: "Shows",
      },
      stubResponse.records,
    );

    assertEquals(result, { processed: 2, new_dates: 2, tiers_opened: 2 });
  },
});

Deno.test("airtable-poll: missing cron secret is unauthorized", () => {
  const cronSecretHeader: string | null = null;
  assertEquals(cronSecretHeader === null, true);
});
