import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { CustomFieldType } from "@/lib/customFields";

export interface CustomFieldDefinition {
  id: string;
  org_id: string;
  entity: string;
  key: string;
  label: string;
  type: CustomFieldType;
  source: string;
  source_field: string;
  options: string[] | null;
  filterable: boolean;
  sortable: boolean;
}

/** All custom field definitions for an org (optionally one entity), oldest first. */
export async function fetchCustomFieldDefs(
  client: SupabaseClient<Database>,
  args: { orgId: string | null; entity?: string },
): Promise<CustomFieldDefinition[]> {
  if (!args.orgId) return [];
  let q = client
    .from("custom_field_definitions")
    .select("id, org_id, entity, key, label, type, source, source_field, options, filterable, sortable")
    .eq("org_id", args.orgId);
  if (args.entity) q = q.eq("entity", args.entity);
  const { data, error } = await q.order("created_at");
  if (error) throw error;
  return (data ?? []) as unknown as CustomFieldDefinition[];
}

/** Create or update a definition (admin-only via RLS). source is always 'airtable' this phase. */
export async function upsertCustomFieldDef(
  client: SupabaseClient<Database>,
  def: {
    org_id: string; entity: string; key: string; label: string;
    type: CustomFieldType; source_field: string;
    options?: string[] | null; filterable?: boolean; sortable?: boolean;
  },
): Promise<void> {
  const { error } = await client
    .from("custom_field_definitions")
    .upsert({ ...def, source: "airtable" } as never, { onConflict: "org_id,entity,key" });
  if (error) throw error;
}

/** Remove a definition by id (admin-only via RLS). */
export async function deleteCustomFieldDef(
  client: SupabaseClient<Database>,
  id: string,
): Promise<void> {
  const { error } = await client.from("custom_field_definitions").delete().eq("id", id);
  if (error) throw error;
}
