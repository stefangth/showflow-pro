import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TRUST_CENTER_URL } from "@/config/app.config";
import { OrgDataCard } from "./OrgDataCard";
import { VisibilityMatrix } from "./VisibilityMatrix";
import { RetentionCard } from "./RetentionCard";
import { YourDataCard } from "./YourDataCard";
import { DocumentsCard } from "./DocumentsCard";
import { CapabilitiesCard } from "./CapabilitiesCard";

/** Settings > Trust & data.
 *
 *  The in-app half of the Trust Center: the same controls the public page
 *  states, narrowed to the organisation you are signed in to, so an admin can
 *  answer "who can see our fees" without leaving the app or reading a policy.
 *  Every claim here is asserted against the code or the privacy policy — see
 *  src/lib/trust/facts.ts for the rule and the tests that hold it. */
export function TrustDataTab() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="font-display text-lg font-semibold">Trust &amp; data</h2>
          <p className="text-sm text-muted-foreground">
            What we hold, who can read it, and how long we keep it.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={TRUST_CENTER_URL} target="_blank" rel="noreferrer">
            Open the public trust center
            <ArrowRight className="ml-2 h-3.5 w-3.5" />
          </a>
        </Button>
      </div>

      <OrgDataCard />

      <Card>
        <CardContent className="p-5">
          <VisibilityMatrix />
        </CardContent>
      </Card>

      {/* `xl:`, not `lg:` — same viewport-vs-container trap as the tile grid in
       *  `OrgDataCard`. At a 1024px viewport this tab's content column is 504px
       *  wide, so `lg:grid-cols-2` split it into 246px halves and the
       *  "Request an organisation export" button in `YourDataCard` overflowed
       *  its own Card by 21px (measured in the running app). At `xl` the column
       *  is 760px, giving 374px halves, which the widest control in either
       *  card fits inside. */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <RetentionCard />
        <div className="space-y-4">
          <YourDataCard />
          <DocumentsCard />
        </div>
      </div>

      <CapabilitiesCard />
    </div>
  );
}
