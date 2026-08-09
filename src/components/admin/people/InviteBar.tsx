// src/components/admin/people/InviteBar.tsx
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { useAuth } from "@/features/auth/AuthContext";
import { type Invitation } from "@/data/invitations";
import type { OrgMember } from "@/data/members";
import type { AppRole } from "@/config/app.config";
import { useInvitationMutations } from "@/hooks/useInvitationMutations";
import { isValidEmail, matchContact } from "./peopleMatch";
import { ROLE_OPTIONS } from "./roleOptions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface InviteBarProps {
  members: OrgMember[];
  invites: Invitation[];
  onOpenBulk: () => void;
  /** Resend a pending invite. Owned by the parent so the bar hint and the Pending
   *  list share one mutation (a resend in flight disables both affordances). */
  onResend: (id: string) => void;
  /** Id of the invite whose resend is currently in flight, or null. */
  resendPendingId?: string | null;
  /**
   * Duplicate detection can't be trusted until BOTH the members and invites
   * queries have settled successfully; hold sends until then so an already-a-member
   * or already-invited address can't slip through an empty list.
   */
  dedupeUnready?: boolean;
}

/** Inline single invite with live duplicate detection + a bulk-invite entry point. */
export function InviteBar({ members, invites, onOpenBulk, onResend, resendPendingId = null, dedupeUnready = false }: InviteBarProps) {
  const { currentOrg } = useAuth();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("artist");
  const { create } = useInvitationMutations(currentOrg?.id);

  const trimmed = email.trim();
  const match = useMemo(
    () => (isValidEmail(trimmed) ? matchContact(trimmed, members, invites) : "none"),
    [trimmed, members, invites],
  );
  const pendingInvite = match === "pending"
    ? invites.find((i) => i.status === "pending" && i.email.toLowerCase() === trimmed.toLowerCase())
    : undefined;

  const canInvite = !!currentOrg && isValidEmail(trimmed) && match === "none" && !create.isPending && !dedupeUnready;

  return (
    <div className="space-y-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!currentOrg) return;
          if (!isValidEmail(trimmed)) { toast.error("Enter a valid email address"); return; }
          if (dedupeUnready || match !== "none") return;
          create.mutate({ email: trimmed, role }, { onSuccess: () => setEmail("") });
        }}
        className="flex flex-col sm:flex-row gap-2"
      >
        <Input type="email" placeholder="invitee@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={!canInvite}>Invite</Button>
        <Button type="button" variant="ghost" onClick={onOpenBulk}>
          <UserPlus className="h-4 w-4 mr-1" />Bulk invite
        </Button>
      </form>
      {match === "member" && (
        <p className="text-xs text-muted-foreground">Already a member of this organization.</p>
      )}
      {match === "pending" && pendingInvite && (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          Already invited (pending).
          <Button size="sm" variant="link" className="h-auto p-0 text-xs" disabled={resendPendingId === pendingInvite.id} onClick={() => onResend(pendingInvite.id)}>
            Resend
          </Button>
        </p>
      )}
    </div>
  );
}
