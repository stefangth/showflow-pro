import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { roleLabel } from "@/config/app.config";
import type { Invitation } from "@/data/invitations";

export interface InviteRowProps {
  invite: Invitation;
}

/** History status → a tonal DS badge variant (both clear WCAG AA on the card, unlike outline text). */
const STATUS_VARIANT: Record<string, "confirmed" | "neutral"> = {
  accepted: "confirmed",
  revoked: "neutral",
};

/**
 * One read-only invitation-history row (accepted / revoked), rendered as a listitem. It shares the
 * directory's grammar: a muted envelope avatar (an invitation record, not yet/never a member), the same
 * secondary role Badge, and the send date that anchors the chronology this card is named for. Actionable
 * pending-invite controls (copy / resend / revoke) live only in PersonRow — this is the history surface.
 */
export function InviteRow({ invite }: InviteRowProps) {
  const { t } = useTranslation("admin");
  const statusLabels: Record<string, string> = {
    accepted: t("inviteRow.statusAccepted"),
    revoked: t("inviteRow.statusRevoked"),
  };
  const status = {
    label: statusLabels[invite.status] ?? invite.status,
    variant: STATUS_VARIANT[invite.status] ?? ("neutral" as const),
  };
  return (
    <div role="listitem" className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar aria-hidden className="h-9 w-9">
          <AvatarFallback><Mail className="h-4 w-4 text-muted-foreground" /></AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-sm font-medium text-muted-foreground" title={invite.email}>{invite.email}</p>
          {invite.created_at && (
            <p className="truncate text-xs text-muted-foreground">{t("inviteRow.invited", { date: format(new Date(invite.created_at), "dd/MM/yyyy") })}</p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-12 sm:flex-nowrap sm:justify-end sm:pl-0">
        <Badge variant="secondary" className="border-border/60 font-normal">{roleLabel(invite.role)}</Badge>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
    </div>
  );
}
