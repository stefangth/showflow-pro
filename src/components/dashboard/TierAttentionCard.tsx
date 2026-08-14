import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ROUTES } from "@/config/app.config";
import { formatDateDMY } from "@/lib/dates";
import { referenceLabel, type BookingFlow } from "@/lib/bookingFlow";
import type { TierAttentionItem } from "@/lib/bookingCockpit";

const MAX_ROWS = 5;

/**
 * Producer-dashboard card for offer orgs: open tiers that are under-filled or
 * have offers expiring within 24h. Pure presentational; the page owns the
 * query, derivation, and flow gating. Renders nothing without items.
 */
export function TierAttentionCard({ items, hint, reference, customFieldKey }: {
  items: TierAttentionItem[];
  hint: string;
  reference: BookingFlow["reference_field"];
  customFieldKey: string | null;
}) {
  const { t } = useTranslation("dashboard");
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">{t("tierAttention.title")}</CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
      <CardContent className="space-y-2">
        {items.slice(0, MAX_ROWS).map((it) => (
          <Link
            key={`${it.showDateId}-${it.tier}`}
            to={ROUTES.BOOKINGS}
            className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors"
          >
            <div>
              <p className="text-sm font-medium">
                {referenceLabel({
                  reference,
                  show: { program: it.program, sub_program: it.subProgram },
                  custom: it.custom,
                  customFieldKey,
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("tierAttention.row", { date: formatDateDMY(it.date), tier: it.tier, filled: it.filled, required: it.required })}
              </p>
            </div>
            <div className="flex gap-1.5">
              {it.atRisk && (
                <Badge variant="secondary" className="bg-warning/10 text-warning">{t("tierAttention.atRisk")}</Badge>
              )}
              {it.expiresSoon && (
                <Badge variant="secondary" className="bg-info/10 text-info">{t("tierAttention.expiresSoon")}</Badge>
              )}
            </div>
          </Link>
        ))}
        {items.length > MAX_ROWS && (
          <p className="text-xs text-muted-foreground">
            {t("tierAttention.more", { count: items.length - MAX_ROWS })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
