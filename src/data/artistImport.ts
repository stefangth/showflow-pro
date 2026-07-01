import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";

export interface BulkImportRowInput {
  index: number;
  name: string;
  email: string | null;
  phone: string | null;
  bio: string | null;
}
export interface BulkImportResult {
  index: number;
  status: "created" | "skipped_existing" | "error";
  artist_id?: string;
  error?: string;
}

/** Bulk-create artists via the producer/admin-guarded, server-side-dedup RPC. */
export async function bulkImportArtists(
  client: SupabaseClient<Database>,
  args: { orgId: string; rows: BulkImportRowInput[] },
): Promise<BulkImportResult[]> {
  const { data, error } = await client.rpc("bulk_import_artists", {
    p_org: args.orgId,
    p_rows: args.rows as unknown as Json,
  });
  if (error) throw error;
  return (data ?? []) as unknown as BulkImportResult[];
}
