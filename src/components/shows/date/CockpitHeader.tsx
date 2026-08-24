import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Settings2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { slotMeterTones } from "@/lib/bookingCockpit";
import { SlotMeter } from "./SlotMeter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface CockpitOverflowAction {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

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
  /** Shown in place of the slot meter when the date has no slot config, so the
   *  warning lives where the meter would be rather than as a full-width strip. */
  slotWarning?: string;
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
  /** Actions for the ⋯ overflow menu. When empty/absent, the ⋯ button is hidden
   *  (no dead affordance — e.g. artists get no overflow actions). */
  overflowActions?: CockpitOverflowAction[];
}

const STATUS_DOT: Record<CockpitHeaderProps["statusTone"], string> = {
  green: "bg-[var(--green-600)]",
  amber: "bg-[var(--amber-600)]",
  accent: "bg-accent-500",
  muted: "bg-[var(--text-muted)]",
};

const STATUS_TEXT: Record<CockpitHeaderProps["statusTone"], string> = {
  green: "text-[var(--green-600)]",
  amber: "text-[var(--amber-600)]",
  accent: "text-accent-600",
  muted: "text-muted-foreground",
};

/** Anchored cockpit header: title, slot meter + status, the primary booking
 *  workflow CTA, the (separate) hire-order terminal button, a read-only flow
 *  indicator, and the tab bar. Purely presentational; all data + handlers come
 *  from ShowDateDetailSheet. */
export function CockpitHeader({
  title, dateLine, metaLine, slots, slotWarning, confirmedCount, acceptedCount,
  statusText, statusTone, showEngineStatus = true,
  workflowCta, workflowCtaDisabled, onWorkflowCta,
  showGenerateHireOrder, generateDisabled, generateTitle, onGenerate,
  flowLabel, onEditFlow, tabs, activeTab, onTab, devBadge, overflowActions = [],
}: CockpitHeaderProps) {
  const { t } = useTranslation("showsDetail");
  const total = slots ? slots.main_cast + slots.understudies : 0;

  return (
    <div className="px-6 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* eslint-disable-next-line no-restricted-syntax -- truncating title eyebrow, primitive adoption deferred */}
          <p className="truncate text-eyebrow font-semibold uppercase leading-[14px] tracking-[1.6px] text-accent-600">{title}</p>
          {devBadge && (
            <Badge variant="outline" className="mt-1 text-xs font-mono text-muted-foreground w-fit">
              ShowDateDetailSheet.tsx
            </Badge>
          )}
          <p className="mt-[5px] font-display text-title font-semibold leading-7 tracking-[-0.3px]">{dateLine}</p>
          <p className="mt-1 text-control leading-[18px] text-muted-foreground">{metaLine}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {workflowCta && (
            <Button size="default" className="text-sm" onClick={onWorkflowCta} disabled={workflowCtaDisabled}>
              {workflowCta.label}
            </Button>
          )}
          {showGenerateHireOrder && (
            <Button
              size="default"
              variant={workflowCta ? "outline" : "default"}
              onClick={onGenerate}
              disabled={generateDisabled}
              title={generateTitle}
            >
              {t("cockpitHeader.generateHireOrder")}
            </Button>
          )}
          {overflowActions.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("cockpitHeader.moreActions")}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-m)] border border-[var(--line-strong)] bg-[var(--surface)] text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)]"
                >
                  <MoreHorizontal className="h-[18px] w-[18px]" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {overflowActions.map((a) => (
                  <DropdownMenuItem
                    key={a.label}
                    onSelect={a.onSelect}
                    className={cn(a.destructive && "text-destructive focus:text-destructive")}
                  >
                    {a.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Status row: slot meter + booking-engine status (gated by booking_flow) on
       *  the left; the app-only, low-prominence flow indicator sits at the right so
       *  it does not add a row and the tab bar keeps the reference rhythm. */}
      <div className="mt-3.5 flex flex-wrap items-center justify-between gap-x-3.5 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          {showEngineStatus && slots && (
            <>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-medium text-foreground">{t("cockpitHeader.slotsCount", { confirmed: confirmedCount, total })}</span>
                <SlotMeter
                  fixed
                  tones={slotMeterTones(confirmedCount, acceptedCount, total)}
                  testId="cockpit-slot-meter"
                  ariaLabel={t("cockpitHeader.slotFill")}
                />
              </div>
              {statusText && (
                <>
                  <span className="h-3.5 w-px bg-[var(--line)]" />
                  <span className={cn("inline-flex items-center gap-1.5 text-xs", STATUS_TEXT[statusTone])}>
                    <span className={cn("h-1.5 w-1.5 rounded-chip", STATUS_DOT[statusTone])} />
                    {statusText}
                  </span>
                </>
              )}
            </>
          )}
          {/* No slot config: the meter can't render, so its warning takes the
              meter's place rather than a full-width banner strip below the tabs. */}
          {!slots && slotWarning && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--amber-600)]">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              {slotWarning}
            </span>
          )}
        </div>

        {/* Read-only flow indicator; a subtle Settings affordance only for those who may edit it. */}
        <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{t("cockpitHeader.flow")}</span>
          {onEditFlow ? (
            <button
              type="button"
              onClick={onEditFlow}
              className="inline-flex items-center gap-1 text-control font-medium text-accent-text hover:underline"
            >
              {/* Inline size wins over the button's default svg sizing deterministically,
                  without relying on tailwind-merge to collapse two arbitrary-variant classes. */}
              <Settings2 style={{ width: 12, height: 12 }} />
              {flowLabel}
            </button>
          ) : (
            <span className="font-medium text-foreground">{flowLabel}</span>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="mt-3.5 flex gap-0.5 border-b border-border">
        {tabs.filter((t) => !t.hidden).map((t) => {
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              className={cn(
                "-mb-px border-b-2 px-3 py-[9px] text-control leading-4 transition-colors",
                active
                  ? "border-accent-500 text-foreground font-semibold"
                  : "border-transparent font-medium text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {t.badge && (
                <span
                  className={cn(
                    "ml-1.5 rounded-[var(--radius-xs)] px-[5px] py-px font-mono text-eyebrow font-semibold leading-[14px]",
                    t.id === "order"
                      ? t.badge === "READY"
                        ? "bg-[var(--green-100)] text-[var(--green-600)]"
                        : "bg-[var(--amber-100)] text-[var(--amber-600)]"
                      : "bg-[var(--surface-3)] text-muted-foreground",
                  )}
                >
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
