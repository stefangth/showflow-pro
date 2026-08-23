import { useContext, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useCan } from "@/hooks/useCapabilities";
import { useDatesSource } from "@/hooks/useDatesSource";
import type { DatesSource } from "@/data/datesSource";
import { WizardFooterContext } from "@/components/getRunning/v3/WizardFooterContext";
import { Card } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SelectableSource = Exclude<DatesSource, null>;

const SOURCES: SelectableSource[] = ["airtable", "sheet", "manual"];
// All three sources are real choices as of Wireflow v3 Phase 4 (Task A5): Airtable
// (Phase 2), Google Sheet (Phase 4), and By hand (Phase 2).
const CHOOSABLE: ReadonlySet<SelectableSource> = new Set(["airtable", "sheet", "manual"]);

/**
 * The `source` step's body (Wireflow v3 Phase 2, Task 6; Sheet enabled Phase 4, Task A5):
 * pick where dates come from. All three sources are real choices (see CHOOSABLE above).
 * Preselects the org's already-stored choice (`useDatesSource`'s `source`) until the
 * viewer picks something else, then persists via `save` and calls `onDone` so the wizard
 * can advance / mark the step done.
 *
 * Portals its primary action into `WizardFooterContext`'s slot once `WizardShell` has
 * mounted it (mirrors `FlowStep`'s `TaskPanelFooterContext` pattern from the v1 in-panel
 * editors), falling back to an inline button when the context is null — e.g. rendered
 * outside `WizardShell`, as in this component's own tests.
 *
 * Read-only viewers (no `manage_productions` capability) see the org's current choice
 * but every card renders disabled and there is no Continue button, only a short note to
 * ask an admin — mirroring the wizard shell's own adminOnly/waitsOnAdmin chips instead
 * of silently letting a read action look like a no-op write attempt.
 */
export function SourceStep({ orgId, onDone }: { orgId: string | null; onDone: () => void }): JSX.Element {
  const { t } = useTranslation("getRunningV3");
  const footerSlot = useContext(WizardFooterContext);
  const canChoose = useCan("manage_productions");
  const { source, save, saving } = useDatesSource(orgId);
  const [selected, setSelected] = useState<SelectableSource | null>(null);
  const active = selected ?? source;

  const canSave = !!orgId && !!active && CHOOSABLE.has(active) && !saving;

  const handleContinue = () => {
    if (!canSave || !active) return;
    save(active, { onSuccess: onDone });
  };

  const continueButton = (
    <Button type="button" size="sm" disabled={!canSave} onClick={handleContinue}>
      {t("body.source.continue")}
    </Button>
  );

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="text-title-sm font-semibold tracking-[-0.2px] text-foreground">
          {t("body.source.heading")}
        </div>
        <p className="text-xs text-muted-foreground">{t("body.source.sub")}</p>
      </div>

      <RadioGroup
        value={active ?? ""}
        onValueChange={(value) => setSelected(value as SelectableSource)}
        aria-label={t("body.source.heading")}
        className="gap-2"
      >
        {SOURCES.map((src) => {
          const disabled = !canChoose || !CHOOSABLE.has(src);
          return (
            <Card
              key={src}
              className={cn(
                "px-3 py-2.5",
                active === src && "border-primary ring-1 ring-primary",
                disabled && "opacity-60",
              )}
            >
              <label
                htmlFor={`source-${src}`}
                className={cn("flex items-start gap-2.5", disabled ? "cursor-not-allowed" : "cursor-pointer")}
              >
                <RadioGroupItem id={`source-${src}`} value={src} disabled={disabled} className="mt-0.5" />
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-control font-medium text-foreground">
                    {t(`body.source.${src}.title`)}
                  </span>
                  <span className="text-xs text-muted-foreground">{t(`body.source.${src}.desc`)}</span>
                </span>
              </label>
            </Card>
          );
        })}
      </RadioGroup>

      {canChoose ? (
        footerSlot ? (
          createPortal(continueButton, footerSlot)
        ) : (
          continueButton
        )
      ) : (
        <p className="text-xs text-muted-foreground">{t("body.source.readOnly")}</p>
      )}
    </div>
  );
}
