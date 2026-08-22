import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface HireOrderReadyBannerProps {
  /** Bold headline (e.g. "This date is fully filled. Ready for a hire order."). */
  title: string;
  /** One line of supporting copy, often naming the artist. */
  description: string;
  /** Primary button label ("Generate hire order" / "Generate hire orders"). */
  ctaLabel: string;
  onCta: () => void;
  /** Disables the CTA (feature off / no capability / pending). */
  disabled?: boolean;
  /** Native tooltip on the CTA, e.g. a reason the disabled button can't be used. */
  ctaTitle?: string;
  /** Overrides the default Sparkles glyph in the icon tile. */
  icon?: ReactNode;
}

/**
 * The shared "ready for a hire order" banner used on the Shows & Bookings page
 * (aggregate) and inside the show-date detail sheet (single date). Icon tile +
 * title/description on the left, one primary CTA on the right. There is
 * deliberately no "Preview terms" affordance. Uses the accent-50/200/700 tokens
 * (the numbered accent stops take no opacity modifier).
 */
export function HireOrderReadyBanner({
  title,
  description,
  ctaLabel,
  onCta,
  disabled,
  ctaTitle,
  icon,
}: HireOrderReadyBannerProps) {
  return (
    <div className="flex items-center gap-4 rounded-l border border-accent-200 bg-accent-tint p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-m bg-accent-tint text-accent-text">
        {icon ?? <Sparkles className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-accent-text">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      <Button size="sm" onClick={onCta} disabled={disabled} title={ctaTitle} className="shrink-0">
        {ctaLabel}
      </Button>
    </div>
  );
}
