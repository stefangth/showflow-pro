import {
  Calendar,
  ChevronDown,
  ChevronUp,
  MapPin,
  Theater,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Button } from "@/components/ui/button";
import type { HeldCause } from "./console";

/** Lucide name (as produced by `groupHeldCauses`) to component. */
const CAUSE_ICONS: Record<string, LucideIcon> = {
  theater: Theater,
  "map-pin": MapPin,
  calendar: Calendar,
};

/** The primary bulk-fix button label per cause. `missing_date` has no bulk fix. */
function fixLabel(category: HeldCause["category"], t: TFunction): string | null {
  if (category === "unlinked_program") return t('attentionPanel.fixLabelPrograms');
  if (category === "unlinked_city") return t('attentionPanel.fixLabelCities');
  return null;
}

interface AttentionPanelProps {
  causes: HeldCause[];
  heldCount: number;
  canWrite: boolean;
  /** Which cause is expanded (its `category`), or null. */
  openCategory: string | null;
  onToggle: (category: string) => void;
  /** Primary "Create ..." bulk fix (only for program/city causes). */
  onFix: (cause: HeldCause) => void;
  /** Deep-link to the Catalog links tab for granular linking. */
  onOpenCatalog: () => void;
  /** "Open the full run log". */
  onOpenActivity: () => void;
  /** Footer next-run label, e.g. "09:42". */
  nextRunLabel: string;
}

/**
 * "Needs your attention" card: held-record causes with a bulk fix per cause,
 * an expandable per-record list, and a footer that links to the run log.
 * Presentational: all data and callbacks arrive via props.
 */
export function AttentionPanel({
  causes,
  heldCount,
  canWrite,
  openCategory,
  onToggle,
  onFix,
  onOpenCatalog,
  onOpenActivity,
  nextRunLabel,
}: AttentionPanelProps) {
  const { t } = useTranslation('settingsAirtable');
  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h3 className="text-[17px] font-semibold tracking-[-0.1px] text-foreground">
            {t('attentionPanel.title')}
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t('attentionPanel.description', { count: heldCount })}
          </p>
        </div>
        <span
          className="inline-flex h-5 shrink-0 items-center rounded px-1.5 text-[11px] font-medium"
          style={{ background: "var(--amber-100)", color: "var(--amber-600)" }}
        >
          {t('attentionPanel.heldBadge', { count: heldCount })}
        </span>
      </div>

      {causes.map((cause) => {
        const Icon = CAUSE_ICONS[cause.icon] ?? AlertTriangle;
        const isOpen = openCategory === cause.category;
        const label = fixLabel(cause.category, t);
        return (
          <div key={cause.category} className="border-b border-border">
            <div className="flex items-center gap-3 p-4 py-3">
              <Icon className="h-4 w-4 shrink-0" style={{ color: "var(--amber-600)" }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">{cause.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{cause.detail}</p>
              </div>
              {canWrite && label && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-accent-200 bg-accent-50 text-accent-700 hover:bg-accent-100"
                  onClick={() => onFix(cause)}
                >
                  {label}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground"
                onClick={() => onToggle(cause.category)}
                aria-expanded={isOpen}
              >
                {isOpen ? t('attentionPanel.hide') : t('attentionPanel.review')}
                {isOpen ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>

            {isOpen && (
              <div className="border-t border-border bg-muted">
                {cause.records.map((record) => (
                  <div
                    key={record.id}
                    className="border-b border-border px-4 py-2.5"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {record.airtable_record_id ?? "record"}
                    </p>
                    {record.reason && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{record.reason}</p>
                    )}
                  </div>
                ))}
                <div className="px-4 py-2.5">
                  <button
                    type="button"
                    onClick={onOpenCatalog}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    {t('attentionPanel.linkIndividually')}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <p className="text-xs text-muted-foreground">
          {t('attentionPanel.footerNote', { nextRunLabel })}
        </p>
        <button
          type="button"
          onClick={onOpenActivity}
          className="text-xs font-medium text-primary hover:underline"
        >
          {t('attentionPanel.openRunLog')}
        </button>
      </div>
    </div>
  );
}
