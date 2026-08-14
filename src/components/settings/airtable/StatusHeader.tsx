import type { CSSProperties } from "react";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { Kpi, StatusView } from "./console";

interface StatusHeaderProps {
  eyebrow: string;
  status: StatusView;
  kpis: Kpi[];
  saved?: boolean;
  canSyncNow: boolean;
  syncing: boolean;
  onSyncNow: () => void;
}

/** Class for the status dot by tone. Red uses the semantic destructive token;
 *  green/amber are painted from the design-system CSS vars via `dotStyle`. */
function dotClass(tone: StatusView["tone"]): string {
  return tone === "red" ? "bg-destructive" : "";
}

/** Inline colour for green/amber tones (the DS hex vars are not wired as
 *  Tailwind utilities, so this keeps the exact hue and stays dark-mode aware). */
function dotStyle(tone: StatusView["tone"]): CSSProperties | undefined {
  if (tone === "green") return { background: "var(--green-500)" };
  if (tone === "amber") return { background: "var(--amber-500)" };
  return undefined;
}

/** Value colour for a KPI by tone. */
function kpiStyle(tone: Kpi["tone"]): CSSProperties | undefined {
  if (tone === "green") return { color: "var(--green-600)" };
  if (tone === "amber") return { color: "var(--amber-600)" };
  return undefined;
}

function kpiClass(tone: Kpi["tone"]): string {
  if (tone === "red") return "text-destructive";
  if (tone === "default") return "text-foreground";
  return "";
}

const EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.1em]";

/** The console's headline card: eyebrow + status dot + headline + one line of
 *  detail, a Saved indicator and a "Sync now" action, over a four-up KPI row. */
export function StatusHeader({
  eyebrow,
  status,
  kpis,
  saved,
  canSyncNow,
  syncing,
  onSyncNow,
}: StatusHeaderProps) {
  const { t } = useTranslation('settingsAirtable');
  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-start justify-between gap-4 p-4">
        <div className="min-w-0">
          <p className={cn(EYEBROW, "text-accent-600")}>{eyebrow}</p>
          <div className="mt-1.5 flex items-center gap-2.5">
            <span
              className={cn("h-2 w-2 shrink-0 rounded-sm", dotClass(status.tone))}
              style={dotStyle(status.tone)}
            />
            <h2 className="font-display text-[22px] font-semibold tracking-tight">
              {status.headline}
            </h2>
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">{status.line}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {saved && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3 w-3 text-primary" />
              {t('statusHeader.saved')}
            </span>
          )}
          <Button onClick={onSyncNow} disabled={!canSyncNow || syncing}>
            <RefreshCw className="h-3.5 w-3.5" />
            {syncing ? t('statusHeader.syncing') : t('statusHeader.syncNow')}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 border-t border-border sm:grid-cols-4">
        {kpis.map((kpi, i) => (
          <div
            key={`${kpi.label}-${i}`}
            className="border-r border-border p-3 last:border-r-0"
          >
            <p className={cn(EYEBROW, "text-muted-foreground")}>{kpi.label}</p>
            <p
              className={cn(
                "mt-1.5 font-mono text-[17px] font-medium tabular-nums",
                kpiClass(kpi.tone),
              )}
              style={kpiStyle(kpi.tone)}
            >
              {kpi.value}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">{kpi.sub}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
