import { Link } from "react-router-dom";
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
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">Needs attention</CardTitle>
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
                {formatDateDMY(it.date)} · Tier {it.tier} · {it.filled} of {it.required}
              </p>
            </div>
            <div className="flex gap-1.5">
              {it.atRisk && <Badge variant="secondary" className="bg-warning/10 text-warning">At risk</Badge>}
              {it.expiresSoon && <Badge variant="secondary" className="bg-info/10 text-info">Expires soon</Badge>}
            </div>
          </Link>
        ))}
        {items.length > MAX_ROWS && (
          <p className="text-xs text-muted-foreground">And {items.length - MAX_ROWS} more. See Bookings.</p>
        )}
      </CardContent>
    </Card>
  );
}
