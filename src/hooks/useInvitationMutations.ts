import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { createInvitation, resendInvitation, revokeInvitation } from "@/data/invitations";
import type { AppRole } from "@/config/app.config";

/**
 * Shared create/resend/revoke invitation mutations for the admin People pane.
 * Centralizes the toast copy and the `['org-invitations']` invalidation so the
 * invite bar, pending list, and bulk dialog can't drift apart.
 */
export function useInvitationMutations(orgId: string | null | undefined) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["org-invitations"] });

  const create = useMutation({
    mutationFn: (vars: { email: string; role: AppRole }) =>
      createInvitation(supabase, { orgId: orgId!, email: vars.email, role: vars.role }),
    onSuccess: () => { invalidate(); toast.success("Invitation sent"); },
    onError: (e: Error) => toast.error(e?.message ?? "Could not send invitation"),
  });

  const resend = useMutation({
    mutationFn: (id: string) => resendInvitation(supabase, id),
    onSuccess: () => toast.success("Invitation re-sent"),
    onError: (e: Error) => toast.error(e?.message ?? "Could not resend invitation"),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(supabase, id),
    onSuccess: () => { invalidate(); toast.success("Invitation revoked"); },
    onError: (e: Error) => toast.error(e?.message ?? "Could not revoke invitation"),
  });

  return { create, resend, revoke };
}
