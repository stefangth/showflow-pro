import { useTranslation } from "react-i18next";
import type { ReactNode } from "react";

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
    <div className="flex flex-col gap-1 rounded-[var(--radius-l)] border border-accent-200 bg-accent-50 p-3">
      <span className="text-[11px] font-semibold uppercase tracking-[1.6px] text-accent-700">
        {t("panel.unlocksLabel")}
      </span>
      <p className="text-[13px] leading-[19px] text-muted-foreground">{children}</p>
    </div>
  );
}
