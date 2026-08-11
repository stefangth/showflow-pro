import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchOrgMembers, removeOrgMember, setOrgMemberRole,
  fetchRemovedMembers, restoreOrgMember, clearRemovedMember, purgeRemovedUser,
} from "@/data/members";
import type { AppRole } from "@/config/app.config";

/** Members of an org (admin surface). */
export function useOrgMembers(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["members", orgId],
    enabled: !!orgId,
    queryFn: () => fetchOrgMembers(supabase, orgId!),
  });
}

/** Tombstones for an org's recently-removed members. */
export function useRemovedMembers(orgId: string | null | undefined) {
  return useQuery({
    queryKey: ["removed-members", orgId],
    enabled: !!orgId,
    queryFn: () => fetchRemovedMembers(supabase, orgId!),
  });
}

// Every member mutation busts BOTH the `members` domain (roster + derived producer-count
// that backs the team nudge) and `removed-members` (a removal now creates a tombstone,
// an undo/purge removes one) — prefix match, per CLAUDE.md, regardless of key shape.
function useMembersMutation<TVars, TData = unknown>(fn: (vars: TVars) => Promise<TData>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members"] });
      qc.invalidateQueries({ queryKey: ["removed-members"] });
    },
  });
}

/** Remove a member (soft-remove: hard-deletes the membership, writes a tombstone). */
export function useRemoveOrgMember(orgId: string) {
  return useMembersMutation((userId: string) => removeOrgMember(supabase, orgId, userId));
}

/** Add/remove a member role, then refresh that org's member list. */
export function useSetOrgMemberRole(orgId: string) {
  return useMembersMutation((vars: { userId: string; role: AppRole; action: "add" | "remove" }) =>
    setOrgMemberRole(supabase, orgId, vars.userId, vars.role, vars.action));
}

/** Undo a removal (restore membership + roles). */
export function useRestoreOrgMember(orgId: string) {
  return useMembersMutation((userId: string) => restoreOrgMember(supabase, orgId, userId));
}

/** Dismiss a tombstone from the list (account untouched). */
export function useClearRemovedMember(orgId: string) {
  return useMembersMutation((userId: string) => clearRemovedMember(supabase, orgId, userId));
}

/** Full account delete for a removed user (safe-scoped to their last org). */
export function usePurgeRemovedUser(orgId: string) {
  return useMembersMutation((userId: string) => purgeRemovedUser(supabase, orgId, userId));
}
