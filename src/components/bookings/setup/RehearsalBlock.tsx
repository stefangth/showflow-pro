import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useBookingFlow, useFlowTimes } from "@/hooks/useBookingFlow";
import { useCan } from "@/hooks/useCapabilities";
import { dryRunOfferTier, type DryRunResult } from "@/data/bookings";
import { fetchNextRehearsalDate } from "@/data/showDates";
import { hh, BOOKING_FLOW_DEFAULTS } from "@/lib/bookingFlow";
import { toDateKey, formatDateWithWeekday } from "@/lib/dates";
import { Button } from "@/components/ui/button";

/** The rail's rehearsal: resolves the soonest future date with a city, dry-runs tier 1
 *  (creating nothing, sending nothing), and shows who would be offered and when. Hidden
 *  under Direct book (no offers to rehearse) and when no date qualifies. */
export function RehearsalBlock({ orgId }: { orgId: string | null }) {
  const { data: flow } = useBookingFlow();
  const { data: times } = useFlowTimes(orgId);
  const canRun = useCan("run_offer_engine");
  const next = useQuery({
    queryKey: ["show-dates", "next-rehearsal", orgId],
    enabled: !!orgId,
    queryFn: () => fetchNextRehearsalDate(supabase, { orgId: orgId!, today: toDateKey(new Date()) }),
  });

  const run = useMutation({
    mutationFn: (): Promise<DryRunResult> => {
      const id = next.data?.id;
      if (!id) throw new Error("No date to rehearse");
      return dryRunOfferTier(supabase, { showDateId: id, tier: 1 });
    },
  });

  const acceptance = (flow ?? BOOKING_FLOW_DEFAULTS).artist_acceptance;
  if (!acceptance) return null;          // Direct book: nothing to rehearse.
  if (next.isLoading) return null;
  if (!next.data) return null;           // No future date with a city.

  const delivery = (flow ?? BOOKING_FLOW_DEFAULTS).offer_delivery;
  const foot = delivery === "immediate"
    ? `Would email immediately, window closes +${times?.windowHours ?? 48} h`
    : `Would email in the ${hh(times?.offerDigestHour ?? 19)} digest, window closes +${times?.windowHours ?? 48} h`;
  const when = formatDateWithWeekday(next.data.date);

  return (
    <div className="bg-accent-50 p-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-accent-700">Rehearsal</p>
      <p className="mt-1 text-sm font-semibold">See it run before it runs</p>
      <p className="mt-0.5 text-xs leading-[18px] text-muted-foreground">
        A dry run on {when}. Resolves the real tier, the real artists, the real send time. Nothing is created and no email leaves.
      </p>
      {canRun && !run.data && (
        <Button variant="outline" size="sm" className="mt-2.5" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Resolving..." : "Run the rehearsal"}
        </Button>
      )}
      {run.data && (
        <div className="mt-2.5 overflow-hidden rounded-md border border-border bg-card">
          <div className="border-b border-border p-2.5 text-xs text-muted-foreground">
            {run.data.message ?? `Tier 1, ${run.data.candidates.length} artist${run.data.candidates.length === 1 ? "" : "s"} would be offered`}
          </div>
          {run.data.candidates.map((c) => (
            <div key={c.id} className="border-b border-border p-2 text-sm last:border-b-0">{c.name}</div>
          ))}
          <div className="p-2.5 font-mono text-[11px] text-muted-foreground">{foot}</div>
        </div>
      )}
    </div>
  );
}
