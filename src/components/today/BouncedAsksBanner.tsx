import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dfLocale } from "@/lib/dates";
import type { BouncedAsk } from "@/lib/autopilot/today";
import { joinNames } from "./joinNames";

interface BouncedAsksBannerProps {
  bounced: BouncedAsk[];
  onFix: () => void;
  onDismiss: () => void;
}

/**
 * "Two asks did not arrive" banner (prototype lines 159-166). Rendered by
 * the caller only when `bounced.length > 0`.
 */
export function BouncedAsksBanner({ bounced, onFix, onDismiss }: BouncedAsksBannerProps) {
  const { t, i18n } = useTranslation("today");
  if (bounced.length === 0) return null;

  const first = bounced[0];
  const names = joinNames(
    Array.from(new Set(bounced.map((b) => b.artistName))),
    i18n.language,
  );
  const when = format(new Date(first.bouncedAt), "EEEE 'at' HH:mm", { locale: dfLocale() });

  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-border bg-[var(--red-100)] p-4">
      <span className="flex shrink-0 text-[var(--red-600)]">
        <TriangleAlert className="h-4 w-4" />
      </span>
      <p className="m-0 flex-1 text-[13px] leading-[19px] text-foreground">
        {t("bounced.title", { count: bounced.length })}
        {". "}
        {t("bounced.body", { names, when, show: first.dateLabel })}
      </p>
      <Button size="sm" onClick={onFix} className="shrink-0">
        {t("bounced.fix")}
      </Button>
      <Button size="sm" variant="secondary" onClick={onDismiss} className="shrink-0">
        {t("bounced.later")}
      </Button>
    </div>
  );
}
