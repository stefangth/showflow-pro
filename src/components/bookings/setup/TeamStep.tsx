import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { teamStepMeta } from "@/lib/dashboard/moduleOnboarding";

/** The rail's admin-only "production team" panel: invite producers from the People page.
 *  Label + route come from teamStepMeta so this CTA cannot drift from the step's registry. */
export function TeamStep() {
  const { t } = useTranslation("onboarding");
  const meta = teamStepMeta(t);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Producers plan dates, run offers and confirm bookings. Invite them from the People page.
      </p>
      <Button asChild size="sm">
        <Link to={meta.ctaRoute}>{meta.ctaLabel}</Link>
      </Button>
    </div>
  );
}
