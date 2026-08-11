import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { TEAM_STEP_META } from "@/lib/dashboard/moduleOnboarding";

/** The rail's admin-only "production team" panel: invite producers from the People page.
 *  Label + route come from TEAM_STEP_META so this CTA cannot drift from the step's registry. */
export function TeamStep() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Producers plan dates, run offers and confirm bookings. Invite them from the People page.
      </p>
      <Button asChild size="sm">
        <Link to={TEAM_STEP_META.ctaRoute}>{TEAM_STEP_META.ctaLabel}</Link>
      </Button>
    </div>
  );
}
