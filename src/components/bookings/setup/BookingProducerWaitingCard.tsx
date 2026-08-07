import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { BookingSetupStep } from "@/lib/bookings/setupStatus";

const LABELS: Record<string, string> = {
  flow: "Booking flow",
  slots: "Slots per show",
  ladder: "Cast priorities per city",
  eligibility: "Who is eligible",
  timing: "Response window and digests",
};

/** Shown instead of the rail when the viewer lacks `edit_booking_settings`. Lists only
 *  steps that actually block something. Does not name the admin (list_org_members is
 *  admin-guarded). Adding dates and sessions is unaffected, which is the point. */
export function BookingProducerWaitingCard({ steps }: { steps: BookingSetupStep[] }) {
  const outstanding = steps.filter((s) => !s.done && s.block !== null);
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--amber-600)]">
            Waiting on your admin
          </p>
          <p className="mt-1.5 font-display text-base font-semibold">Plan dates now, offer later</p>
          <p className="mt-1 text-xs leading-[19px] text-muted-foreground">
            Nothing stops you adding dates and sessions. An admin has to finish setup before a tier can open.
          </p>
        </div>
        <div className="space-y-2">
          {outstanding.map((s) => (
            <div key={s.key} className="flex items-center gap-2 rounded-md border border-border p-2.5">
              <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{LABELS[s.key] ?? s.key}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
