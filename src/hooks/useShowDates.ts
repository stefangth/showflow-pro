import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toDateKey } from "@/lib/dates";
import {
  createShowDate, updateShowDate, cancelShowDate, deleteShowDate,
  fetchUpcomingDatesWithoutCity,
  type CreateShowDateArgs, type UpdateShowDatePatch,
} from "@/data/showDates";

function useDateInvalidation(alsoBookings: boolean) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["show-dates"] });
    if (alsoBookings) qc.invalidateQueries({ queryKey: ["bookings"] });
  };
}

/** The org's future, non-cancelled dates that still have no city. Keyed under the
 *  `["show-dates", ...]` domain so every date mutation's prefix invalidation refreshes it,
 *  and folded with the date cutoff so a tab left open past midnight refetches (same
 *  convention as `useBookingSetupStatus`'s coverage read). */
export function useDatesMissingCity(orgId: string | null) {
  const today = toDateKey(new Date());
  return useQuery({
    queryKey: ["show-dates", "missing-city", orgId, today],
    enabled: !!orgId,
    queryFn: () => fetchUpcomingDatesWithoutCity(supabase, orgId, today),
  });
}

export function useCreateShowDate() {
  const invalidate = useDateInvalidation(true);
  return useMutation({ mutationFn: (a: CreateShowDateArgs) => createShowDate(supabase, a), onSuccess: invalidate });
}
export function useUpdateShowDate() {
  const invalidate = useDateInvalidation(false);
  return useMutation({
    mutationFn: (v: { id: string; patch: UpdateShowDatePatch }) => updateShowDate(supabase, v.id, v.patch),
    onSuccess: invalidate,
  });
}
export function useCancelShowDate() {
  const invalidate = useDateInvalidation(true);
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) => cancelShowDate(supabase, v.id, v.reason),
    onSuccess: invalidate,
  });
}
export function useDeleteShowDate() {
  const invalidate = useDateInvalidation(true);
  return useMutation({ mutationFn: (id: string) => deleteShowDate(supabase, id), onSuccess: invalidate });
}
