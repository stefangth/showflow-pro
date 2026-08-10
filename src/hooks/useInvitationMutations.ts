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
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["org-invitations"] });
    qc.invalidateQueries({ queryKey: ["members"] });
  };

  // The single network call, in one place. `create` wraps it with the single-invite
  // toast + invalidation; batch callers (bulk dialog) reuse `createOne` directly and
  // do their own aggregate toast + one end-of-run `invalidate`, so the actual create
  // args never drift between the two surfaces.
  const createOne = (vars: { email: string; role: AppRole }) =>
    createInvitation(supabase, { orgId: orgId!, email: vars.email, role: vars.role });

  const create = useMutation({
    mutationFn: createOne,
    onSuccess: () => { invalidate(); toast.success("Invitation sent"); },
    onError: (e: Error) => toast.error(e?.message ?? "Could not send invitation"),
  });

  const resend = useMutation({
    mutationFn: (id: string) => resendInvitation(supabase, id),
    // Invalidate like create/revoke: the resend stamps last_resent_at/resent_count
    // server-side, and the People row reads those from ['org-invitations']. Without
    // this, the "Resent …" meta stays stale in-session — the exact coordination gap
    // this is meant to close.
    onSuccess: () => { invalidate(); toast.success("Invitation re-sent"); },
    onError: (e: Error) => toast.error(e?.message ?? "Could not resend invitation"),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeInvitation(supabase, id),
    onSuccess: () => { invalidate(); toast.success("Invitation revoked"); },
    onError: (e: Error) => toast.error(e?.message ?? "Could not revoke invitation"),
  });

  return { create, createOne, resend, revoke, invalidateInvitations: invalidate };
}
