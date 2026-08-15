import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/app.config";
import { buildBookingOnboarding } from "@/lib/dashboard/moduleOnboarding";

/** The rail's "shows" panel: get shows into the catalog, which every downstream step reads.
 *  The primary CTA reads from the shared step registry so it cannot drift from the label/route
 *  the dashboard rail renders for the same step. */
export function ShowsStep() {
  const { t } = useTranslation("onboarding");
  const shows = buildBookingOnboarding(t).steps.shows;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Slots, cast priorities and eligibility all read from your shows, so get them in first.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to={shows.ctaRoute}>{shows.ctaLabel}</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to={`${ROUTES.SETTINGS}?tab=airtable`}>Set up Airtable sync</Link>
        </Button>
      </div>
    </div>
  );
}
