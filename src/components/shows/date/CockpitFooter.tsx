import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface CockpitFooterProps {
  /** "READY" or "N LEFT". */
  badgeLabel: string;
  /** Green when the date is ready to draft, amber while slots are outstanding. */
  ready: boolean;
  /** "All slots confirmed — drafts one order per artist" / "Waiting on N of M slots". */
  detail: string;
  ctaLabel: string;
  ctaDisabled?: boolean;
  onCta: () => void;
}

/**
 * The persistent hire-order footer pinned to the bottom of the cockpit work
 * column (prototype's footer bar). Always visible so the terminal step of the
 * flow — generating the order — is one glance away regardless of the open tab.
 * Purely presentational; the sheet decides whether to render it (hire_orders
 * module + role gates).
 */
export function CockpitFooter({ badgeLabel, ready, detail, ctaLabel, ctaDisabled, onCta }: CockpitFooterProps) {
  const { t } = useTranslation("showsDetail");
  return (
    <div className="sticky bottom-0 z-10 flex items-center justify-between gap-4 border-t-[0.5px] border-[var(--line)] bg-[var(--surface)] px-5 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <p className="text-sm font-medium leading-[18px] text-foreground">{t("cockpitFooter.hireOrder")}</p>
        <span
          className={cn(
            "ml-1.5 rounded-chip px-[5px] py-px font-mono text-eyebrow font-semibold leading-[14px]",
            ready
              ? "bg-[var(--green-100)] text-[var(--green-600)]"
              : "bg-[var(--amber-100)] text-[var(--amber-600)]",
          )}
        >
          {badgeLabel}
        </span>
        <p className="truncate text-xs leading-4 text-muted-foreground">{detail}</p>
      </div>
      <Button
        type="button"
        onClick={onCta}
        disabled={ctaDisabled}
        variant="secondary"
        className={cn(
          "h-[34px] shrink-0 rounded-control",
          // Solid brand-accent only when the action is actually available; a ready-but-
          // disabled CTA (draft generating, or no generate permission) falls back to the
          // muted `secondary` disabled look rather than a faded accent.
          ready && !ctaDisabled
            ? "border-0 bg-accent-500 px-[14px] text-sm text-white hover:bg-accent-600 active:bg-accent-600"
            : "px-3 text-control",
        )}
      >
        {ctaLabel}
      </Button>
    </div>
  );
}
