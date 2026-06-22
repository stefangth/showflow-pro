import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchOrgMembers, removeOrgMember, setOrgMemberRole } from "@/data/members";
import type { AppRole } from "@/config/app.config";

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

/** Add/remove a member role, then refresh that org's member list. */
export function useSetOrgMemberRole(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { userId: string; role: AppRole; action: "add" | "remove" }) =>
      setOrgMemberRole(supabase, orgId, vars.userId, vars.role, vars.action),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", orgId] }),
  });
}
