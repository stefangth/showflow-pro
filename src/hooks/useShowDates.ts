import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  createShowDate, updateShowDate, cancelShowDate, deleteShowDate,
  type CreateShowDateArgs, type UpdateShowDatePatch,
} from "@/data/showDates";

function useDateInvalidation(alsoBookings: boolean) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["show-dates"] });
    if (alsoBookings) qc.invalidateQueries({ queryKey: ["bookings"] });
  };
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
