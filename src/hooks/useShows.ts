import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import {
  fetchShowsWithStats, createShow, updateShow, archiveShow, deleteShow, reorderShows,
  type CreateShowArgs, type UpdateShowPatch, type ShowWithStats,
} from "@/data/shows";

export type { ShowWithStats };

export function useShows() {
  const { currentOrg } = useAuth();
  return useQuery({
    queryKey: ["shows", "list", currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchShowsWithStats(supabase, currentOrg?.id ?? null),
  });
}

/** Invalidate both domains: show fields are joined into the bookings/date list. */
function useShowInvalidation() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["shows"] });
    qc.invalidateQueries({ queryKey: ["show-dates"] });
  };
}

export function useCreateShow() {
  const invalidate = useShowInvalidation();
  return useMutation({
    mutationFn: (a: CreateShowArgs) => createShow(supabase, a),
    onSuccess: invalidate,
  });
}

export function useUpdateShow() {
  const invalidate = useShowInvalidation();
  return useMutation({
    mutationFn: (v: { id: string; patch: UpdateShowPatch }) => updateShow(supabase, v.id, v.patch),
    onSuccess: invalidate,
  });
}

export function useArchiveShow() {
  const invalidate = useShowInvalidation();
  return useMutation({
    mutationFn: (v: { id: string; archived: boolean }) => archiveShow(supabase, v.id, v.archived),
    onSuccess: invalidate,
  });
}

export function useDeleteShow() {
  const invalidate = useShowInvalidation();
  return useMutation({
    mutationFn: (id: string) => deleteShow(supabase, id),
    onSuccess: invalidate,
  });
}

export function useReorderShows() {
  const invalidate = useShowInvalidation();
  return useMutation({
    mutationFn: (orderedIds: string[]) => reorderShows(supabase, orderedIds),
    onSuccess: invalidate,
  });
}
