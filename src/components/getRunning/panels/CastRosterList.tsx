import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export interface RosterCast {
  id: string;
  name: string;
  memberCount: number;
}

/**
 * The shared "Your casts (N)" roster list for the ladder + eligibility board panels
 * (`LadderPanelBody` / `EligibilityPanelBody`). Its job is to make a cast created ANYWHERE
 * (this panel, /artists, Settings) visible on the board even when no city has a future date
 * — the case where the per-city pickers never render and a fresh cast used to vanish.
 *
 * `keyPrefix` selects the panel's own i18n block (`panel.body.ladder` |
 * `panel.body.eligibility`); both carry identical `yourCasts` / `castCountLabel` /
 * `memberCount` keys. `subline` optionally renders a per-cast standing line (the ladder
 * panel shows each cast's ranking; the eligibility panel omits it). Renders nothing when
 * the roster is empty, so callers can drop it in unguarded.
 */
export function CastRosterList({ casts, keyPrefix, subline }: {
  casts: RosterCast[];
  keyPrefix: "panel.body.ladder" | "panel.body.eligibility";
  subline?: (castId: string) => ReactNode;
}) {
  const { t } = useTranslation("getRunning");
  if (casts.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t(`${keyPrefix}.yourCasts`)}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {t(`${keyPrefix}.castCountLabel`, { count: casts.length })}
        </span>
      </div>
      <div className="divide-y divide-border rounded-[var(--radius-l)] border border-border">
        {casts.map((cast) => (
          <div key={cast.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{cast.name}</p>
              {subline && <p className="font-mono text-eyebrow text-muted-foreground">{subline(cast.id)}</p>}
            </div>
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {t(`${keyPrefix}.memberCount`, { count: cast.memberCount })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
