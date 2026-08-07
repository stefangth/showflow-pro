import { Link } from "react-router-dom";
import { useAllCities } from "@/hooks/useAllCities";
import { useShows } from "@/hooks/useShows";
import { resolveCoverage, type LadderCoverageInputs } from "@/lib/bookings/setupStatus";
import { ROUTES } from "@/config/app.config";

/** Read-only: the (show, city) pairs with a future date but no tier-1 cast, plus a count
 *  of future dates that have no city. Both are why a tier would open to nobody. */
export function EligibilityStep({ coverage }: { coverage: LadderCoverageInputs | undefined }) {
  const cities = useAllCities();
  const shows = useShows();
  const cityName = (id: string) => (cities.data ?? []).find((c) => c.id === id)?.name ?? "Unknown city";
  const showName = (id: string) => {
    const s = (shows.data ?? []).find((x) => x.id === id);
    return s ? `${s.program}${s.sub_program ? ` · ${s.sub_program}` : ""}` : "Unknown show";
  };

  const result = coverage ? resolveCoverage(coverage) : { uncoveredPairs: [], hasNullCity: false };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Which casts can be offered a show in a city. Without a match the tier opens to nobody.
      </p>
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
      <Link to={ROUTES.SETTINGS} className="text-xs text-primary underline">
        Link casts in Settings, Casts and cities
      </Link>
    </div>
  );
}
