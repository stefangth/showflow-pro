import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useAllCities } from "@/hooks/useAllCities";
import { useShows } from "@/hooks/useShows";
import { useBookingFlow } from "@/hooks/useBookingFlow";
import { eligibilityScopeNote } from "@/lib/bookings/coverageCopy";
import { resolveCoverage, type LadderCoverageInputs } from "@/lib/bookings/setupStatus";
import { ROUTES } from "@/config/app.config";

/** Read-only: the (show, city) pairs with a future date but no tier-1 cast, plus a count
 *  of future dates that have no city.
 *
 *  What that gap COSTS is opposite under the two flows, so the opening line reads the org's
 *  own: an offers org opens a tier to nobody, while a direct-book org falls back to its
 *  whole active roster (useEligibleArtists resolves artistIds to null, and
 *  deriveDirectBookList treats null as "no restriction"). `orgId` is the rail's org, not
 *  the shell's, matching LadderStep and TimingStep. */
export function EligibilityStep({ coverage, orgId }: { coverage: LadderCoverageInputs | undefined; orgId: string | null }) {
  const cities = useAllCities();
  const shows = useShows();
  // Gated on the org, not just on the query: `useBookingFlow` has no `enabled`, so a null
  // org still resolves the PLATFORM DEFAULT row into a truthy, offers-shaped flow that would
  // state the wrong consequence for an org this panel has not identified.
  const flowQ = useBookingFlow(orgId);
  const flow = orgId ? flowQ.data : null;
  const cityName = (id: string) => (cities.data ?? []).find((c) => c.id === id)?.name ?? "Unknown city";
  const showName = (id: string) => {
    const s = (shows.data ?? []).find((x) => x.id === id);
    return s ? `${s.program}${s.sub_program ? ` · ${s.sub_program}` : ""}` : "Unknown show";
  };

  // Memoized so the coverage rule runs only when the inputs change, not on every render.
  const result = useMemo(
    () => (coverage ? resolveCoverage(coverage) : { uncoveredPairs: [], hasNullCity: false }),
    [coverage],
  );

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{eligibilityScopeNote(flow)}</p>
      {result.uncoveredPairs.length === 0 && !result.hasNullCity ? (
        <p className="text-xs text-muted-foreground">Every scheduled show and city has a cast at tier 1.</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          {result.uncoveredPairs.map((p) => (
            <div key={`${p.showId}|${p.cityId}`} className="flex items-center gap-2.5 border-b border-border p-2 text-xs last:border-b-0">
              <span className="min-w-0 flex-1 truncate">{showName(p.showId)} · {cityName(p.cityId)}</span>
              <span className="text-muted-foreground">no tier-1 cast</span>
            </div>
          ))}
          {result.hasNullCity && (
            <div className="p-2 text-xs text-muted-foreground">One or more future dates have no city assigned.</div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link to={ROUTES.SETTINGS} className="text-xs text-primary underline">
          Link casts in Settings, Casts and cities
        </Link>
        {/* Same house vocabulary as LadderStep, same escape hatch into the docs, same
            destination named in the label. */}
        <Link to={`${ROUTES.SETTINGS}?tab=docs`} className="text-xs text-primary underline">
          How casts and tiers work, in the App Logic Guide
        </Link>
      </div>
    </div>
  );
}
