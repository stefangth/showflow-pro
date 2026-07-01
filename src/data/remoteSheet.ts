import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * Fetch a public Google Sheets CSV through the SSRF-guarded fetch-remote-sheet proxy.
 * Returns the raw CSV text (parse it client-side with parseSheet).
 */
export async function fetchPublicSheetCsv(
  client: SupabaseClient<Database>,
  url: string,
  orgId: string,
): Promise<string> {
  const { data, error } = await client.functions.invoke("fetch-remote-sheet", { body: { org_id: orgId, url } });
  if (error) throw error;
  const payload = data as { error?: string; csv?: string };
  if (payload?.error) throw new Error(payload.error);
  if (typeof payload?.csv !== "string") throw new Error("The sheet could not be read");
  return payload.csv;
}
