import { Check, Lock, LockOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconTooltip } from "@/components/common/IconTooltip";
import { roleLabel } from "@/config/app.config";
import type { CapabilityMatrixCell } from "@/hooks/useCapabilities";

interface Props {
  cell: CapabilityMatrixCell;
  mode: "org" | "platform";
  onToggleOverride: (enabled: boolean) => void;
  onToggleLock?: (locked: boolean) => void;
  onSetPlatformDefault?: (enabled: boolean) => void;
}

/** One matrix row: capability label + description, a read-only admin grant, and the
 *  producer control (org-mode override switch, or platform-mode default + lock toggle). */
export function PermissionRow({ cell, mode, onToggleOverride, onToggleLock, onSetPlatformDefault }: Props) {
  const { t } = useTranslation("settings");
  const { def, effective, locked, policyLocked } = cell;
  const lockLabel = policyLocked ? t("permissions.row.unlock") : t("permissions.row.lock");
  return (
    <div
      data-testid={`cap-row-${def.key}`}
      className="flex items-start justify-between gap-4 py-3 border-b border-border last:border-0"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">{def.label}</p>
          {def.risk === "sensitive" && <Badge variant="outline" className="text-xs">{t("permissions.row.sensitive")}</Badge>}
        </div>
        <p className="text-xs text-muted-foreground">{def.description}</p>
        {mode === "org" && locked && (
          <p className="text-xs text-muted-foreground mt-1">{t("permissions.row.managedByShowflow")}</p>
        )}
      </div>
      <div className="flex items-center gap-4 shrink-0">
        {/* Admin column: always granted, read-only */}
        <div className="flex flex-col items-center gap-1 w-16">
          <span className="text-[11px] text-muted-foreground">{t("permissions.row.admin")}</span>
          <Check className="h-4 w-4 text-muted-foreground" role="img" aria-label={t("permissions.row.adminAlwaysHasRight")} />
        </div>
        {/* Production Team control */}
        <div className="flex flex-col items-center gap-1 w-24">
          <span className="text-[11px] text-muted-foreground">{roleLabel("producer")}</span>
          {mode === "org" ? (
            <Switch
              checked={effective}
              disabled={locked}
              onCheckedChange={(v) => onToggleOverride(v)}
              aria-label={t("permissions.row.roleRight", { role: roleLabel("producer"), label: def.label })}
            />
          ) : (
            <div className="flex items-center gap-2">
              <Switch
                checked={cell.policyEnabled ?? def.defaultEnabled}
                onCheckedChange={(v) => onSetPlatformDefault?.(v)}
                aria-label={t("permissions.row.platformDefault", { label: def.label })}
              />
              <IconTooltip label={lockLabel}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={lockLabel}
                  onClick={() => onToggleLock?.(!policyLocked)}
                >
                  {policyLocked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4 text-muted-foreground" />}
                </Button>
              </IconTooltip>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
