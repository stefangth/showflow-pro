import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchDatesSource, saveDatesSource, type DatesSource } from "@/data/datesSource";

/** The org's chosen get-running dates source (airtable/sheet/manual), plus a
 *  mutation to save it. Thin wrapper over datesSource.ts's data-access functions,
 *  keyed under the "getrunning" query domain so it can be invalidated independently
 *  of the "bookings"/"blocked-dates" domains. */
export function useDatesSource(orgId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["getrunning", "dates-source", orgId],
    queryFn: () => fetchDatesSource(supabase, orgId as string),
    enabled: !!orgId,
  });

  const mutation = useMutation({
    mutationFn: (source: Exclude<DatesSource, null>) => saveDatesSource(supabase, orgId as string, source),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["getrunning", "dates-source", orgId] });
    },
  });

  return {
    source: query.data ?? null,
    isLoading: query.isLoading,
    save: mutation.mutate,
    saving: mutation.isPending,
  };
}
