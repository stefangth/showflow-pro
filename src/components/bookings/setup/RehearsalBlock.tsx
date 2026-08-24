import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBookingFlow, useFlowTimes } from "@/hooks/useBookingFlow";
import { useCan } from "@/hooks/useCapabilities";
import { dryRunOfferTier, type DryRunResult } from "@/data/bookings";
import { fetchNextRehearsalDate } from "@/data/showDates";
import { DEFAULT_FLOW_TIMES } from "@/data/settings";
import { hh } from "@/lib/bookingFlow";
import { toDateKey, formatDateWithWeekday } from "@/lib/dates";
import { Button } from "@/components/ui/button";

/** The rail's rehearsal: resolves the soonest future date with a city, dry-runs tier 1
 *  (creating nothing, sending nothing), and shows who would be offered and when. Hidden
 *  under Direct book (no offers to rehearse) and when no date qualifies. */
export function RehearsalBlock({ orgId }: { orgId: string | null }) {
  // The org this block was HANDED, not whichever org the shell happens to be on. The gate
  // below ("is this a direct-book org?") and the send times in the footer would otherwise
  // come from two independent sources: `useBookingFlow()` resolves its own org out of
  // AuthContext while `useFlowTimes` keys on the prop. The org switcher lives in the app
  // shell and does not unmount this block, so that window is real, and it is the worst
  // possible one: gate on org A's artist_acceptance, narrate org B's hours, and a
  // direct-book org gets shown a full offer rehearsal. Same rule as TimingStep.
  //
  // `orgId ? ... : null` is not defensive noise: `useBookingFlow` has no `enabled` gate, so
  // a null org still runs fetchBookingFlow(client, null), which reads the PLATFORM DEFAULT
  // settings row and normalizes a missing one to BOOKING_FLOW_DEFAULTS. The result is a
  // truthy, offers-shaped flow belonging to no org, which would walk straight past the
  // unknown-flow guard below. No org, no flow to rehearse.
  const flowQ = useBookingFlow(orgId);
  const flow = orgId ? flowQ.data : null;
  const { data: times } = useFlowTimes(orgId);
  const canRun = useCan("run_offer_engine");
  // Fold the date cutoff into the key so a tab left open past midnight refetches instead of
  // serving a coverage/next-date result computed against yesterday's "today".
  const today = toDateKey(new Date());
  const next = useQuery({
    queryKey: ["show-dates", "next-rehearsal", orgId, today],
    enabled: !!orgId,
    queryFn: () => fetchNextRehearsalDate(supabase, { orgId: orgId!, today }),
  });

  const run = useMutation({
    mutationFn: (): Promise<DryRunResult> => {
      const id = next.data?.id;
      if (!id) throw new Error("No date to rehearse");
      return dryRunOfferTier(supabase, { showDateId: id, tier: 1 });
    },
    onError: (e: Error) => toast.error(`Could not run the rehearsal. ${e.message}`),
  });

  // No default while the flow is unread: BOOKING_FLOW_DEFAULTS has acceptance on, so a
  // direct-book org with its next date already cached would get a whole offer rehearsal
  // flashed at it until the settings read lands. Same rule as TimingStep's narrative.
  if (!flow) return null;
  if (!flow.artist_acceptance) return null;  // Direct book: nothing to rehearse.
  if (next.isLoading) return null;
  if (!next.data) return null;           // No future date with a city.

  const delivery = flow.offer_delivery;
  const t = times ?? DEFAULT_FLOW_TIMES;
  const foot = delivery === "immediate"
    ? `Would email immediately, window closes +${t.windowHours} h`
    : `Would email in the ${hh(t.offerDigestHour)} digest, window closes +${t.windowHours} h`;
  const when = formatDateWithWeekday(next.data.date);

  return (
    <div className="bg-accent-tint p-3.5">
      {/* eslint-disable-next-line no-restricted-syntax -- eyebrow label paired with a headline, primitive adoption deferred */}
      <p className="text-eyebrow font-semibold uppercase tracking-wider text-accent-text">Rehearsal</p>
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
        <div className="mt-2.5 overflow-hidden rounded-control border border-border bg-card">
          <div className="border-b border-border p-2.5 text-xs text-muted-foreground">
            {run.data.message ?? `Tier 1, ${run.data.candidates.length} artist${run.data.candidates.length === 1 ? "" : "s"} would be offered`}
          </div>
          {run.data.candidates.map((c) => (
            <div key={c.id} className="border-b border-border p-2 text-sm last:border-b-0">{c.name}</div>
          ))}
          <div className="p-2.5 font-mono text-eyebrow text-muted-foreground">{foot}</div>
        </div>
      )}
    </div>
  );
}
