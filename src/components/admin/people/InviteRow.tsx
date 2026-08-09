import { Copy, X, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconTooltip } from "@/components/common/IconTooltip";
import type { Invitation } from "@/data/invitations";

export interface InviteRowProps {
  invite: Invitation;
  onCopyLink: (token: string) => void;
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
  /** True while this row's resend/revoke is in flight, so a double-click can't fire twice. */
  resendPending?: boolean;
  revokePending?: boolean;
}

/** Status pill styling. Pending is actionable (warning); accepted/revoked are history. */
const STATUS_PILL: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "border-warning text-warning" },
  accepted: { label: "Accepted", className: "border-success text-success" },
  revoked: { label: "Revoked", className: "text-muted-foreground" },
};

/**
 * One org invitation. Pending invites are actionable (copy link / resend / revoke);
 * accepted and revoked invites are shown as read-only history with a status pill.
 */
export function InviteRow({ invite, onCopyLink, onResend, onRevoke, resendPending = false, revokePending = false }: InviteRowProps) {
  const pill = STATUS_PILL[invite.status] ?? { label: invite.status, className: "text-muted-foreground" };
  const isPending = invite.status === "pending";
  return (
    <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border">
      <div className="min-w-0">
        <p className={`font-medium text-sm truncate ${isPending ? "" : "text-muted-foreground"}`}>{invite.email}</p>
        <p className="text-xs text-muted-foreground capitalize">{invite.role}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant="outline" className={`text-xs ${pill.className}`}>{pill.label}</Badge>
        {isPending && (
          <>
            <IconTooltip label="Copy invite link">
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onCopyLink(invite.token)} aria-label="Copy invite link">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </IconTooltip>
            <IconTooltip label="Resend invitation">
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={resendPending} onClick={() => onResend(invite.id)} aria-label="Resend invitation">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </IconTooltip>
            <IconTooltip label="Revoke invitation">
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={revokePending} onClick={() => onRevoke(invite.id)} aria-label="Revoke invitation">
                <X className="h-3.5 w-3.5" />
              </Button>
            </IconTooltip>
          </>
        )}
      </div>
    </div>
  );
}
