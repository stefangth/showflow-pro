import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { slotMeterTones } from "@/lib/bookingCockpit";
import { SlotMeter } from "./SlotMeter";

export type CockpitTab = "cast" | "offers" | "order" | "chat" | "setup";
export interface CockpitTabDef {
  id: CockpitTab;
  label: string;
  badge?: string;
  hidden?: boolean;
}

export interface CockpitHeaderProps {
  title: string; // referenceLabel(...) result
  dateLine: string; // "Thursday, 12 March 2026"
  metaLine: string; // "14:00 / 19:30 · Volksbühne, Berlin"
  slots: { main_cast: number; understudies: number } | null;
  confirmedCount: number;
  acceptedCount: number;
  statusText: string;
  statusTone: "green" | "amber" | "accent" | "muted";
  /** Booking-engine status (slot meter + status line) is gated by booking_flow.
   *  Defaults to shown; the sheet passes the module gate through here. */
  showEngineStatus?: boolean;
  workflowCta: { kind: string; label: string } | null; // null => hidden
  workflowCtaDisabled?: boolean;
  onWorkflowCta: () => void;
  showGenerateHireOrder: boolean;
  generateDisabled: boolean;
  generateTitle?: string;
  onGenerate: () => void;
  flowLabel: string; // "Classic offers" | "Direct booking"
  onEditFlow?: () => void; // present only when canEditBookingSettings
  tabs: CockpitTabDef[];
  activeTab: CockpitTab;
  onTab: (t: CockpitTab) => void;
  devBadge?: boolean; // isEditorMode && isRealAdmin
}

const STATUS_DOT: Record<CockpitHeaderProps["statusTone"], string> = {
  green: "bg-[var(--green-600)]",
  amber: "bg-[var(--amber-600)]",
  accent: "bg-accent-500",
  muted: "bg-[var(--text-muted)]",
};

/** Anchored cockpit header: title, slot meter + status, the primary booking
 *  workflow CTA, the (separate) hire-order terminal button, a read-only flow
 *  indicator, and the tab bar. Purely presentational; all data + handlers come
 *  from ShowDateDetailSheet. */
export function CockpitHeader({
  title, dateLine, metaLine, slots, confirmedCount, acceptedCount,
  statusText, statusTone, showEngineStatus = true,
  workflowCta, workflowCtaDisabled, onWorkflowCta,
  showGenerateHireOrder, generateDisabled, generateTitle, onGenerate,
  flowLabel, onEditFlow, tabs, activeTab, onTab, devBadge,
}: CockpitHeaderProps) {
  const total = slots ? slots.main_cast + slots.understudies : 0;

  return (
    <div className="px-6 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-base font-semibold tracking-tight truncate">{title}</p>
          {devBadge && (
            <Badge variant="outline" className="mt-1 text-xs font-mono text-muted-foreground w-fit">
              ShowDateDetailSheet.tsx
            </Badge>
          )}
          <p className="font-display text-[22px] font-semibold tracking-tight mt-1">{dateLine}</p>
          <p className="text-sm text-muted-foreground mt-0.5">{metaLine}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {workflowCta && (
            <Button size="sm" onClick={onWorkflowCta} disabled={workflowCtaDisabled}>
              {workflowCta.label}
            </Button>
          )}
          {showGenerateHireOrder && (
            <Button
              size="sm"
              variant={workflowCta ? "outline" : "default"}
              onClick={onGenerate}
              disabled={generateDisabled}
              title={generateTitle}
            >
              Generate hire order
            </Button>
          )}
        </div>
      </div>

      {/* Slot meter + status line: pure booking-engine status, gated by booking_flow. */}
      {showEngineStatus && slots && (
        <div className="mt-3 flex items-center gap-4">
          <SlotMeter
            tones={slotMeterTones(confirmedCount, acceptedCount, total)}
            className="flex-1"
            testId="cockpit-slot-meter"
            ariaLabel="Slot fill"
          />
          {statusText && (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("h-2 w-2 rounded-full", STATUS_DOT[statusTone])} />
              {statusText}
            </span>
          )}
        </div>
      )}

      {/* Read-only flow indicator; a Settings link only for those who may edit it. */}
      <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>Flow:</span>
        {onEditFlow ? (
          <button
            type="button"
            onClick={onEditFlow}
            className="inline-flex items-center gap-1 font-medium text-accent-600 hover:underline"
          >
            <Settings2 className="h-3 w-3" />
            {flowLabel}
          </button>
        ) : (
          <span className="font-medium text-foreground">{flowLabel}</span>
        )}
      </div>

      {/* Tab bar */}
      <div className="mt-3 flex gap-1 border-b border-border">
        {tabs.filter((t) => !t.hidden).map((t) => {
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                active
                  ? "border-accent-500 text-foreground font-semibold"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {t.badge && (
                <span className="ml-1.5 rounded-full bg-accent-100 px-1.5 py-0.5 text-[11px] text-accent-700">
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
