import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Metric } from "@/components/ui/metric";
import { cn } from "@/lib/utils";

interface RightGroupCardProps {
  group: string;
  summary: string;
  allOn: boolean;
  onToggleAll: () => void;
  children: ReactNode;
}

/** Card grouping the `RightRow`s for one capability group, with a header
 *  showing the group title, an "N of M on" summary, and a bulk toggle link. */
export function RightGroupCard({
  group,
  summary,
  allOn,
  onToggleAll,
  children,
}: RightGroupCardProps) {
  const { t } = useTranslation("settingsRolesRights");
  return (
    <div className="rounded-card border border-border shadow-elev2 bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b border-[var(--line)]">
        <p className="text-sm font-medium text-foreground">{group}</p>
        <div className="flex items-center gap-3 shrink-0">
          <Metric className="text-caption text-muted-foreground">
            {summary}
          </Metric>
          <button
            type="button"
            onClick={onToggleAll}
            className={cn(
              "text-caption font-medium text-accent-text hover:underline",
            )}
          >
            {allOn ? t("groupCard.turnAllOff") : t("groupCard.turnAllOn")}
          </button>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}
