import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import type { SheetColumnMap, SheetDateRaw } from "@/lib/sheetImport/mapRows";
import { resolveOrgSetting, upsertOrgSetting } from "@/data/settings";
import { fetchPublicSheetCsv } from "@/data/remoteSheet";
import { parseSheet, type ParsedSheet } from "@/lib/artistImport/parseSheet";

const SHEET_IMPORT_SETTINGS_KEY = "sheet_import_settings";

/** The org's saved sheet-import configuration: the published-CSV URL and the user's
 *  chosen column mapping. Both start empty until the org sets up the importer. */
export interface SheetImportSettings {
  url: string;
  map: Partial<SheetColumnMap>;
}

const DEFAULT_SHEET_IMPORT_SETTINGS: SheetImportSettings = { url: "", map: {} };

/** Result of running the `import-sheet-dates` edge function against a batch of rows. */
export interface SheetImportResult {
  processed: number;
  new_dates: number;
  updated: number;
  held: number;
  tiers_opened: number;
}

/** The org's saved sheet-import settings, defaulting to an empty URL and mapping. */
export async function fetchSheetImportSettings(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<SheetImportSettings> {
  return resolveOrgSetting<SheetImportSettings>(client, orgId, SHEET_IMPORT_SETTINGS_KEY, DEFAULT_SHEET_IMPORT_SETTINGS);
}

/** Save the org's sheet-import URL + column mapping. */
export async function saveSheetImportSettings(
  client: SupabaseClient<Database>,
  orgId: string,
  settings: SheetImportSettings,
): Promise<void> {
  await upsertOrgSetting(client, orgId, SHEET_IMPORT_SETTINGS_KEY, settings as unknown as Json);
}

/**
 * Fetch and parse the sheet: pulls the CSV through the SSRF-guarded proxy and parses it
 * client-side into `{ headers, rows }`. The mapping UI only needs the headers, but running
 * the import needs the parsed rows too (fed through `mapSheetRows`) — this is the one fetch
 * both share, so the wizard's Cities step can reuse a Connect-step load instead of hitting
 * the proxy a second time.
 */
export async function fetchSheetParsed(
  client: SupabaseClient<Database>,
  orgId: string,
  url: string,
): Promise<ParsedSheet> {
  const csv = await fetchPublicSheetCsv(client, url, orgId);
  return parseSheet(csv, "csv");
}

/** Fetch the sheet's header row (for the column-mapping UI). Thin wrapper over
 *  `fetchSheetParsed` that discards the row data. */
export async function fetchSheetHeaders(
  client: SupabaseClient<Database>,
  orgId: string,
  url: string,
): Promise<string[]> {
  const parsed = await fetchSheetParsed(client, orgId, url);
  return parsed.headers;
}

/**
 * Trigger the `import-sheet-dates` edge function with the mapped rows. Mirrors
 * `triggerAirtableSyncNow`'s invoke + error-unwrap idiom.
 */
export async function importSheetDates(
  client: SupabaseClient<Database>,
  orgId: string,
  rows: SheetDateRaw[],
): Promise<SheetImportResult> {
  const { data, error } = await client.functions.invoke("import-sheet-dates", {
    body: { org_id: orgId, rows },
  });
  if (error) throw error;
  return data as SheetImportResult;
}
