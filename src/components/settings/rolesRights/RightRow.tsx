import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface RightRowData {
  key: string;
  label: string;
  description: string;
  risk: "standard" | "sensitive";
  effective: boolean;
  locked: boolean;
}

interface RightRowProps {
  row: RightRowData;
  changed: boolean;
  desired: boolean;
  onToggle: () => void;
}

/** One capability toggle row inside a `RightGroupCard`: label, description,
 *  risk/lock badges, and a switch reflecting the pending `desired` value. */
export function RightRow({ row, changed, desired, onToggle }: RightRowProps) {
  const { t } = useTranslation("settingsRolesRights");
  const { label, description, risk, locked } = row;
  return (
    <div
      data-testid={`right-row-${row.key}`}
      className={cn(
        "flex items-center gap-[14px] px-4 py-[11px] border-b border-[var(--line)] last:border-0",
        locked && "opacity-50",
        changed && "bg-[var(--surface-2)]",
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-[13.5px] font-medium text-foreground">{label}</p>
          {risk === "sensitive" && (
            <Badge variant="hold">{t("rightRow.sensitiveBadge")}</Badge>
          )}
          {locked && (
            <Badge variant="neutral">
              <Lock className="h-3 w-3" aria-hidden="true" />
              {t("rightRow.managedBadge")}
            </Badge>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {changed && (
          <Badge variant="accent">{desired ? t("rightRow.granting") : t("rightRow.removing")}</Badge>
        )}
        <Switch
          checked={desired}
          disabled={locked}
          onCheckedChange={() => {
            if (!locked) onToggle();
          }}
          aria-label={label}
        />
      </div>
    </div>
  );
}
