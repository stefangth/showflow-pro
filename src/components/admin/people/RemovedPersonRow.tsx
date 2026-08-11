import { format } from "date-fns";
import { Undo2, UserMinus } from "lucide-react";
import { roleLabel } from "@/config/app.config";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { IconTooltip } from "@/components/common/IconTooltip";
import type { RemovedMember } from "@/data/members";

export interface RemovedPersonRowProps {
  member: RemovedMember;
  onUndo: (userId: string) => void;
  onClear: (m: RemovedMember) => void;
  onDelete: (m: RemovedMember) => void;
  undoPending?: boolean;
}

/**
 * A dimmed tombstone row for the "Recently removed" subgroup. The trailing action is
 * adaptive: Clear from list (dismiss) when the user still belongs to other orgs, else
 * Delete account (a full, safe-scoped erase). Undo restores the membership + roles.
 */
export function RemovedPersonRow({ member, onUndo, onClear, onDelete, undoPending = false }: RemovedPersonRowProps) {
  const who = member.display_name || member.email || member.user_id;
  const removed = format(new Date(member.removed_at), "dd/MM/yyyy");
  const by = member.removed_by_name ? ` by ${member.removed_by_name}` : "";
  return (
    <div role="listitem" className="flex flex-col gap-3 py-3 opacity-90 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar aria-hidden className="h-9 w-9">
          <AvatarFallback className="border border-dashed border-border bg-transparent text-muted-foreground">
            <UserMinus className="h-4 w-4" />
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-sm font-medium text-muted-foreground" title={who}>{who}</p>
          <p className="truncate text-xs text-muted-foreground">
            {member.email ? `${member.email} · ` : ""}Removed {removed}{by}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-12 sm:flex-nowrap sm:justify-end sm:pl-0">
        <div className="hidden sm:flex sm:w-44 sm:justify-end">
          {member.roles.map((r) => (
            <Badge key={r} variant="outline" className="border-border/60 font-normal text-muted-foreground">
              was {roleLabel(r)}
            </Badge>
          ))}
        </div>
        <div className="flex items-center justify-end gap-1 sm:w-40">
          <IconTooltip label="Undo removal">
            <Button
              size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs"
              disabled={undoPending} onClick={() => onUndo(member.user_id)}
              aria-label={`Undo removal of ${who}`}
            >
              <Undo2 className={`h-4 w-4 ${undoPending ? "animate-pulse" : ""}`} />Undo
            </Button>
          </IconTooltip>
          {member.deletable ? (
            <Button
              size="sm" variant="ghost"
              className="h-8 px-2.5 text-xs text-[var(--red-600)] hover:bg-[var(--red-100)]"
              onClick={() => onDelete(member)} aria-label={`Delete account of ${who}`}
            >
              Delete account
            </Button>
          ) : (
            <Button
              size="sm" variant="ghost" className="h-8 px-2.5 text-xs text-muted-foreground"
              onClick={() => onClear(member)} aria-label={`Clear ${who} from list`}
            >
              Clear from list
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
