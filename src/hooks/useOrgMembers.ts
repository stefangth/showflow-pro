import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchOrgMembers, removeOrgMember } from "@/data/members";

/** Members of an org (admin surface). */
export function useOrgMembers(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["members", orgId],
    enabled: !!orgId,
    queryFn: () => fetchOrgMembers(supabase, orgId!),
  });
}

/** Remove a member, then refresh that org's member list. */
export function useRemoveOrgMember(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeOrgMember(supabase, orgId, userId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", orgId] }),
  });
}
