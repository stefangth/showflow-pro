import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAirtableKeyStatus } from "@/data/airtableKey";
import { fetchAirtableSettings } from "@/data/airtableSettings";

/**
 * Lightweight "is this org's Airtable dates source ready to import from" check: API-key
 * presence plus a chosen base and table. Backs the Shows & Bookings "New date" menu's
 * decision of where its Airtable item routes.
 *
 * Deliberately NOT `useAirtableConsole`, which mounts ~10 queries for the whole Settings
 * console (catalog linking, sync history, schema, custom fields). Shows & Bookings is a
 * high-traffic page, so it pays only for the two reads it needs. The query keys mirror
 * the console's exactly, so when the console is also open the cache is shared, not
 * doubled. Returns false while the queries load or when `orgId` is null.
 */
export function useAirtableDatesReady(orgId: string | null): boolean {
  const keyStatusQ = useQuery({
    queryKey: ["airtable", "key-status", orgId],
    enabled: !!orgId,
    queryFn: () => fetchAirtableKeyStatus(supabase, orgId!),
  });
  const settingsQ = useQuery({
    queryKey: ["airtable", "settings", orgId],
    enabled: !!orgId,
    queryFn: () => fetchAirtableSettings(supabase, orgId!),
  });
  return (
    !!keyStatusQ.data?.present &&
    !!settingsQ.data?.airtable_base_id &&
    !!settingsQ.data?.airtable_table_name
  );
}
