import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { ProgramPair } from "./airtableMapping";

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

export interface AirtableLinkedRecord { id: string; name: string }
export interface LinkedRecordsResult { schemaAccessible: boolean; records?: AirtableLinkedRecord[] }

/** List a linked table's records (id + primary-field name) via the airtable-schema edge fn
 *  (linkedTableId mode). Used to enumerate link-field options for catalog linking. */
export async function fetchAirtableLinkedRecords(
  client: SupabaseClient<Database>,
  orgId: string,
  baseId: string,
  linkedTableId: string,
): Promise<LinkedRecordsResult> {
  const { data, error } = await client.functions.invoke("airtable-schema", { body: { org_id: orgId, baseId, linkedTableId } });
  if (error) throw error;
  const payload = data as { error?: string; schemaAccessible?: boolean; records?: AirtableLinkedRecord[] };
  if (payload?.error) throw new Error(payload.error);
  return { schemaAccessible: !!payload?.schemaAccessible, records: payload?.records };
}

export interface ProgramPairsResult { schemaAccessible: boolean; pairs?: ProgramPair[] }

/** Distinct (program, sub_program) pairs from the mapped table's records, via airtable-schema
 *  Mode D. Used by the mapping UI to link at the composite grain (ADR-0010 parity with the poll). */
export async function fetchAirtableProgramPairs(
  client: SupabaseClient<Database>,
  orgId: string,
  baseId: string,
  tableName: string,
  subProgramField: string,
  programField?: string,
): Promise<ProgramPairsResult> {
  const { data, error } = await client.functions.invoke("airtable-schema", {
    body: { org_id: orgId, baseId, tableName, subProgramField, ...(programField ? { programField } : {}) },
  });
  if (error) throw error;
  const payload = data as { error?: string; schemaAccessible?: boolean; pairs?: ProgramPair[] };
  if (payload?.error) throw new Error(payload.error);
  return { schemaAccessible: !!payload?.schemaAccessible, pairs: payload?.pairs };
}
