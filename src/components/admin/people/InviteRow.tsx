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
}

/** One pending org invitation, with copy-link / resend / revoke actions. */
export function InviteRow({ invite, onCopyLink, onResend, onRevoke }: InviteRowProps) {
  return (
    <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border">
      <div className="min-w-0">
        <p className="font-medium text-sm truncate">{invite.email}</p>
        <p className="text-xs text-muted-foreground capitalize">{invite.role}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant="outline" className="text-xs border-warning text-warning">Pending</Badge>
        <IconTooltip label="Copy invite link">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onCopyLink(invite.token)} aria-label="Copy invite link">
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </IconTooltip>
        <IconTooltip label="Resend invitation">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onResend(invite.id)} aria-label="Resend invitation">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </IconTooltip>
        <IconTooltip label="Revoke invitation">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onRevoke(invite.id)} aria-label="Revoke invitation">
            <X className="h-3.5 w-3.5" />
          </Button>
        </IconTooltip>
      </div>
    </div>
  );
}
