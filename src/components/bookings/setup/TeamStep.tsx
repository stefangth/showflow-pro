import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/app.config";

/** The rail's admin-only "production team" panel: invite producers from the People page. */
export function TeamStep() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Producers plan dates, run offers and confirm bookings. Invite them from the People page.
      </p>
      <Button asChild size="sm">
        <Link to={`${ROUTES.ADMIN}?tab=people`}>Invite your team</Link>
      </Button>
    </div>
  );
}
