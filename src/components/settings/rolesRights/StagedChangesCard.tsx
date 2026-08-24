import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/utils";

export interface StagedChange {
  label: string;
  transition: string;
  on: boolean;
}

interface StagedChangesCardProps {
  count: number;
  scopeLine: string;
  changes: StagedChange[];
  deltaSentence: string;
  canApply: boolean;
  onDiscard: () => void;
  onApply: () => void;
}

/** Right-rail card for the Roles & rights redesign: shows the staged
 *  (not-yet-applied) capability changes with a plain-language delta, and
 *  the Discard/Apply actions. Purely presentational. */
export function StagedChangesCard({
  count,
  scopeLine,
  changes,
  deltaSentence,
  canApply,
  onDiscard,
  onApply,
}: StagedChangesCardProps) {
  const { t } = useTranslation("settingsRolesRights");
  return (
    <div className="rounded-card border border-border shadow-elev2 bg-card">
      <div className="px-4 pt-4">
        <Eyebrow>{t("stagedChangesCard.heading")}</Eyebrow>
        <p className="mt-1 font-mono tabular-nums text-title font-medium text-foreground">
          {count}
        </p>
        <p className="text-caption text-muted-foreground">{scopeLine}</p>
      </div>

      <div className="px-4 pt-3 pb-4">
        {count === 0 ? (
          <p className="text-control text-muted-foreground">
            {t("stagedChangesCard.emptyState")}
          </p>
        ) : (
          <>
            <div className="space-y-2.5">
              {changes.map((change) => (
                <div
                  key={change.label}
                  className="flex items-start gap-2.5"
                >
                  <span
                    className={cn(
                      "mt-1.5 h-[6px] w-[6px] shrink-0 rounded-chip",
                      change.on ? "bg-[var(--green-600)]" : "bg-[var(--red-600)]",
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-control font-medium text-foreground">
                      {change.label}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      {change.transition}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            {deltaSentence && (
              <p className="mt-3 border-t border-[var(--line)] pt-3 text-caption text-muted-foreground">
                {deltaSentence}
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--line)] px-4 py-3">
        <Button
          type="button"
          variant="outline"
          disabled={!canApply}
          onClick={onDiscard}
          className={cn(!canApply && "opacity-50")}
        >
          {t("stagedChangesCard.discard")}
        </Button>
        <Button
          type="button"
          variant="default"
          disabled={!canApply}
          onClick={onApply}
          className={cn("flex-1", !canApply && "opacity-50")}
        >
          {t("stagedChangesCard.apply")}
        </Button>
      </div>
    </div>
  );
}
