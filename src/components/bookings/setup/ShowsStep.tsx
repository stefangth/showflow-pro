import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/config/app.config";

/** The rail's "shows" panel: get shows into the catalog, which every downstream step reads. */
export function ShowsStep() {
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Slots, cast priorities and eligibility all read from your shows, so get them in first.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to={ROUTES.PRODUCTIONS}>Add a show</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to={`${ROUTES.SETTINGS}?tab=airtable`}>Set up Airtable sync</Link>
        </Button>
      </div>
    </div>
  );
}
