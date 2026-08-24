import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettingsAudit } from "@/hooks/useSettingsAudit";
import { CAPABILITY_KEYS } from "@/lib/capabilities";
import { formatDateWithWeekday } from "@/lib/dates";

interface ChangeLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Render a raw audit old/new value as a short human word, defaulting the
 *  capability on/off shape (booleans) to "on"/"off" and falling back to a
 *  plain string for anything else (e.g. a policy object). */
function humanizeValue(value: unknown, t: (key: string) => string): string {
  if (typeof value === "boolean") return value ? t("changeLog.valueOn") : t("changeLog.valueOff");
  if (value === null || value === undefined) return t("changeLog.valueOff");
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** Roles & rights redesign: a dialog showing the capability-change audit
 *  history for the current org (both direct grants, `capability:<key>`, and
 *  policy-level overrides, `capability_policy:<key>`), newest first. Purely
 *  a viewer over the existing settings-audit infrastructure. */
export function ChangeLogDialog({ open, onOpenChange }: ChangeLogDialogProps) {
  const { t } = useTranslation("settingsRolesRights");
  const keys = useMemo(
    () => CAPABILITY_KEYS.flatMap((key) => [`capability:${key}`, `capability_policy:${key}`]),
    [],
  );
  const { data: entries, isLoading } = useSettingsAudit(keys);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("changeLog.title")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2" data-testid="change-log-loading">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : !entries || entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("changeLog.empty")}</p>
          ) : (
            entries.map((entry) => (
              <div
                key={entry.id}
                className="rounded-control border border-border px-3 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {entry.actorName ?? t("changeLog.unknownActor")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateWithWeekday(new Date(entry.created_at))}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("changeLog.transition", {
                    from: humanizeValue(entry.old_value, t),
                    to: humanizeValue(entry.new_value, t),
                  })}
                </p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
