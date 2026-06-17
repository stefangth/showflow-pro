import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface AirtableBase { id: string; name: string }
export interface AirtableField { id: string; name: string; type: string; options?: Record<string, unknown> }
export interface AirtableTable { id: string; name: string; fields: AirtableField[] }

export interface BasesResult { schemaAccessible: boolean; bases?: AirtableBase[] }
export interface TablesResult { schemaAccessible: boolean; tables?: AirtableTable[] }

/** List the org's accessible Airtable bases via the airtable-schema edge fn (no baseId mode). */
export async function fetchAirtableBases(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<BasesResult> {
  const { data, error } = await client.functions.invoke("airtable-schema", { body: { org_id: orgId } });
  if (error) throw error;
  const payload = data as { error?: string; schemaAccessible?: boolean; bases?: AirtableBase[] };
  if (payload?.error) throw new Error(payload.error);
  return { schemaAccessible: !!payload?.schemaAccessible, bases: payload?.bases };
}

/** Describe one base's tables + fields via the airtable-schema edge fn (baseId mode). */
export async function fetchAirtableTables(
  client: SupabaseClient<Database>,
  orgId: string,
  baseId: string,
): Promise<TablesResult> {
  const { data, error } = await client.functions.invoke("airtable-schema", { body: { org_id: orgId, baseId } });
  if (error) throw error;
  const payload = data as { error?: string; schemaAccessible?: boolean; tables?: AirtableTable[] };
  if (payload?.error) throw new Error(payload.error);
  return { schemaAccessible: !!payload?.schemaAccessible, tables: payload?.tables };
}
