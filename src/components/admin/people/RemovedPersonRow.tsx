import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { Undo2, UserMinus } from "lucide-react";
import { roleLabel } from "@/config/app.config";
import { useOrgKind } from "@/hooks/useOrgKind";
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
  const { t } = useTranslation("admin");
  const kind = useOrgKind();
  const who = member.display_name || member.email || member.user_id;
  const removed = format(new Date(member.removed_at), "dd/MM/yyyy");
  const by = member.removed_by_name ? t("removedRow.by", { name: member.removed_by_name }) : "";
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
            {member.email ? `${member.email} · ` : ""}{t("removedRow.removed", { date: removed })}{by}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-12 sm:flex-nowrap sm:justify-end sm:pl-0">
        <div className="hidden sm:flex sm:w-44 sm:justify-end">
          {member.roles.map((r) => (
            <Badge key={r} variant="outline" className="border-border/60 font-normal text-muted-foreground">
              {t("removedRow.was", { role: roleLabel(r, kind) })}
            </Badge>
          ))}
        </div>
        <div className="flex items-center justify-end gap-1 sm:w-40">
          <IconTooltip label={t("removedRow.undoRemoval")}>
            <Button
              size="sm" variant="secondary" className="h-8 gap-1.5 px-2.5 text-xs"
              disabled={undoPending} onClick={() => onUndo(member.user_id)}
              aria-label={t("removedRow.undoRemovalOf", { who })}
            >
              <Undo2 className={`h-4 w-4 ${undoPending ? "animate-pulse" : ""}`} />{t("removedRow.undo")}
            </Button>
          </IconTooltip>
          {member.deletable ? (
            <Button
              size="sm" variant="destructive"
              className="h-8 px-2.5 text-xs"
              onClick={() => onDelete(member)} aria-label={t("removedRow.deleteAccountOf", { who })}
            >
              {t("removedRow.deleteAccount")}
            </Button>
          ) : (
            <Button
              size="sm" variant="secondary" className="h-8 px-2.5 text-xs text-muted-foreground"
              onClick={() => onClear(member)} aria-label={t("removedRow.clearAria", { who })}
            >
              {t("removedRow.clearFromList")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
