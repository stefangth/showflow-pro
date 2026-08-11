import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchShowSlots, type SlotDraft, type SlotKind } from "@/data/slots";

export type { SlotDraft, SlotKind };

/** A production's named slot rows (role name, count, main/understudy, per-slot
 *  required skills) for the ShowFormDialog slot-row repeater. */
export function useShowSlots(showId: string | null | undefined) {
  return useQuery({
    queryKey: ["show-slots", showId],
    enabled: !!showId,
    queryFn: () => fetchShowSlots(supabase, showId!),
  });
}
