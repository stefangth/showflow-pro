import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";
import { Eyebrow } from "@/components/ui/eyebrow";

/**
 * Shared accent callout used by in-panel editors to say what a task's change unlocks
 * downstream (e.g. "Producers can take confirmations off your plate..."). Pure and
 * presentational — the body copy is owned by whichever panel renders it, this only
 * supplies the label + the accent-50 well. Reused by every in-panel editor task
 * (team here; letterhead/terms/countersign/slots follow in later tasks).
 */
export function UnlocksNote({ children }: { children: ReactNode }) {
  const { t } = useTranslation("getRunning");
  return (
    <div className="flex flex-col gap-1 rounded-control border border-accent-200 bg-accent p-3">
      <Eyebrow className="text-accent-foreground">
        {t("panel.unlocksLabel")}
      </Eyebrow>
      <p className="text-control leading-[19px] text-foreground">{children}</p>
    </div>
  );
}
