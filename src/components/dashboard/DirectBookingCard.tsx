import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/config/app.config";
import { formatDateDMY } from "@/lib/dates";
import { referenceLabel, type BookingFlow } from "@/lib/bookingFlow";

const MAX_ROWS = 5;

export interface DirectBookingItem {
  id: string;
  date: string;
  program: string | null;
  subProgram: string | null;
  mainBooked: number;
  mainSlots: number;
}

/**
 * Producer-dashboard card for direct-booking orgs (no artist acceptance step):
 * upcoming dates whose confirmed main cast is still short. Pure presentational;
 * the page owns the query, derivation, and flow gating. Renders nothing without items.
 */
export function DirectBookingCard({ items, reference, customFieldKey }: {
  items: DirectBookingItem[];
  reference: BookingFlow["reference_field"];
  customFieldKey: string | null;
}) {
  const { t } = useTranslation("dashboard");
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-base">{t("directBooking.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.slice(0, MAX_ROWS).map((it) => (
          <Link
            key={it.id}
            to={ROUTES.BOOKINGS}
            className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors"
          >
            <div>
              <p className="text-sm font-medium">
                {referenceLabel({
                  reference,
                  show: { program: it.program, sub_program: it.subProgram },
                  custom: null,
                  customFieldKey,
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("directBooking.row", { date: formatDateDMY(it.date), booked: it.mainBooked, slots: it.mainSlots })}
              </p>
            </div>
          </Link>
        ))}
        {items.length > MAX_ROWS && (
          <p className="text-xs text-muted-foreground">
            {t("directBooking.more", { count: items.length - MAX_ROWS })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
