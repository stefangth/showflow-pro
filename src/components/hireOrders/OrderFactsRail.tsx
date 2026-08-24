import { useTranslation } from "react-i18next";

interface Fact {
  label: string;
  value: string;
}

interface Props {
  /** Formatted engagement fee (e.g. "€4,500.00"), or null when unset. */
  fee: string | null;
  /** Engagement duration (e.g. "90 min"), or null. */
  duration: string | null;
  /** Session times (e.g. "Doors 20:00 · Set 21:00 to 22:30"), or null. */
  sessions: string | null;
}

/**
 * "At a glance" facts for a hire order. v1 is FEE-ONLY: the engagement fee, the
 * duration, and (when present) the session times. No deposit or balance line —
 * that is deliberately out of scope for v1.
 */
export function OrderFactsRail({ fee, duration, sessions }: Props) {
  const { t } = useTranslation("hireOrdersPages");
  const facts: Fact[] = [
    { label: t("factsRail.fee"), value: fee ?? t("common.notSet") },
    { label: t("factsRail.duration"), value: duration ?? t("common.notSet") },
  ];
  if (sessions) facts.push({ label: t("factsRail.sessions"), value: sessions });

  return (
    <div>
      {/* eslint-disable-next-line no-restricted-syntax -- section subheading, not a standard eyebrow (12px/tracking-wide, font-medium not font-semibold) */}
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("factsRail.atAGlance")}</h3>
      <dl className="mt-3 space-y-3">
        {facts.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-muted-foreground">{f.label}</dt>
            <dd className="text-sm tabular-nums text-foreground text-right">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
