import { format } from "date-fns";
import { Copy, X, RefreshCw, Check, Settings as SettingsIcon } from "lucide-react";
import { type AppRole, roleLabel } from "@/config/app.config";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IconTooltip } from "@/components/common/IconTooltip";
import { cn } from "@/lib/utils";
import { ROLE_OPTIONS } from "./roleOptions";
import type { Person } from "./peopleMatch";

export interface PersonRowProps {
  person: Person;
  isSelf: boolean;
  onCopyLink: (token: string) => void;
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
  onSetRole: (v: { userId: string; role: AppRole; action: "add" | "remove" }) => void;
  onRequestRemove: (t: { user_id: string; email: string | null }) => void;
  resendPending?: boolean;
  revokePending?: boolean;
  setRolePending?: boolean;
}

/** One person in the merged directory: Invited (invite actions) or Active (role editor + remove). */
export function PersonRow({
  person, isSelf, onCopyLink, onResend, onRevoke, onSetRole, onRequestRemove,
  resendPending = false, revokePending = false, setRolePending = false,
}: PersonRowProps) {
  const invited = person.status === "invited";
  const inv = person.invitation;
  return (
    <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border">
      <div className="min-w-0">
        <p className={`font-medium text-sm truncate ${invited && !person.displayName ? "text-muted-foreground" : ""}`}>
          {person.displayName || person.email}
        </p>
        <p className="text-xs text-muted-foreground truncate">{person.email}</p>
        {!invited && (
          <p className="text-xs text-muted-foreground">
            {person.lastSignInAt ? `Last seen ${format(new Date(person.lastSignInAt), "dd/MM/yyyy HH:mm")}` : "Never signed in"}
          </p>
        )}
        <p className="text-xs text-muted-foreground">{person.roles.map(roleLabel).join(", ")}</p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Badge variant="outline" className={cn("text-xs", invited ? "border-warning text-warning" : "border-success text-success")}>
          {invited ? "Invited" : "Active"}
        </Badge>

        {invited && inv ? (
          <>
            <IconTooltip label="Copy invite link">
              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onCopyLink(inv.token)} aria-label="Copy invite link">
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </IconTooltip>
            <IconTooltip label="Resend invitation">
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={resendPending} onClick={() => onResend(inv.id)} aria-label="Resend invitation">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </IconTooltip>
            <IconTooltip label="Revoke invitation">
              <Button size="sm" variant="ghost" className="h-7 px-2" disabled={revokePending} onClick={() => onRevoke(inv.id)} aria-label="Revoke invitation">
                <X className="h-3.5 w-3.5" />
              </Button>
            </IconTooltip>
          </>
        ) : (
          <>
            {person.roles.map((r) => <Badge key={r} variant="secondary" className="text-xs">{roleLabel(r)}</Badge>)}
            {person.userId && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" aria-label={`Edit roles for ${person.email}`}>
                    <SettingsIcon className="h-3 w-3 mr-1" />Roles
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-1" align="end">
                  {ROLE_OPTIONS.map((r) => {
                    const has = person.roles.includes(r);
                    return (
                      <button
                        key={r}
                        disabled={setRolePending}
                        onClick={() => onSetRole({ userId: person.userId!, role: r, action: has ? "remove" : "add" })}
                        className="flex items-center w-full px-2 py-1.5 text-sm rounded hover:bg-muted text-left disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Check className={cn("h-4 w-4 mr-2", has ? "opacity-100" : "opacity-0")} />
                        {roleLabel(r)}
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>
            )}
            <Button
              size="sm" variant="ghost" className="h-7 px-2 text-xs"
              disabled={isSelf || !person.userId}
              onClick={() => onRequestRemove({ user_id: person.userId!, email: person.email })}
            >
              {isSelf ? "You" : "Remove"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
