import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAllCities } from "@/hooks/useAllCities";
import { useBookingFlow } from "@/hooks/useBookingFlow";
import { ladderScopeNote } from "@/lib/bookings/coverageCopy";
import { ROUTES } from "@/config/app.config";
import type { LadderCoverageInputs } from "@/lib/bookings/setupStatus";

/** Read-only: the cities that have a future date, and whether each has a tier-1 cast.
 *  A city counts as covered when EITHER the org-wide priority list has a tier-1 row OR a
 *  show-scoped `show_cast_eligibility` row does, matching resolveCoverage/resolveTierLadder
 *  (show scope wins outright when present) so this panel never contradicts EligibilityStep.
 *
 *  Coverage is really per (show, city): a show-scoped override wins outright for that show,
 *  even without a tier 1, so one show in a city can be uncovered while the city's org ladder
 *  looks fine. This city-level summary cannot see that, so whenever a city has any
 *  show-scoped rows it appends a caveat pointing at the per-pair gap list ("Who is
 *  eligible") rather than implying the city summary is the whole story. Deep edits happen
 *  in Settings.
 *
 *  The opening line is flow-aware (`ladderScopeNote`) because this is the one setup step
 *  whose consequence is not shared between the two flows: nothing a direct-book org runs
 *  reads a ranking at all. `orgId` is the org the RAIL was handed rather than the shell's
 *  active org, for the same reason TimingStep takes one. */
export function LadderStep({ coverage, orgId }: { coverage: LadderCoverageInputs | undefined; orgId: string | null }) {
  const { t } = useTranslation("onboarding");
  const cities = useAllCities();
  // Gated on the org, not just on the query: `useBookingFlow` has no `enabled`, so a null
  // org still resolves the PLATFORM DEFAULT row into a truthy, offers-shaped flow. Same
  // reasoning (and same one-liner) as TimingStep and EligibilityStep.
  const flowQ = useBookingFlow(orgId);
  const flow = orgId ? flowQ.data : null;
  const nameOf = (id: string) => (cities.data ?? []).find((c) => c.id === id)?.name ?? "Unknown city";

  const cityIds = [...new Set((coverage?.futurePairs ?? []).map((p) => p.cityId).filter((x): x is string => !!x))];

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{ladderScopeNote(flow, t)}</p>
      <div className="space-y-2">
        {cityIds.map((cid) => {
          const tiers = (coverage?.cityPriorities ?? [])
            .filter((r) => r.cityId === cid)
            .sort((a, b) => a.priority - b.priority);
          const hasOrgTier1 = tiers.some((r) => r.priority === 1);
          const cityShowScoped = (coverage?.showPriorities ?? []).filter((r) => r.cityId === cid);
          const showScopedTier1 = cityShowScoped.some((r) => r.priority === 1);
          const hasShowScoped = cityShowScoped.length > 0;
          return (
            <div key={cid} className="rounded-md border border-border bg-card p-2.5">
              <p className="text-xs font-semibold">{nameOf(cid)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {hasOrgTier1
                  ? `${tiers.length} tier${tiers.length === 1 ? "" : "s"} ranked.`
                  : showScopedTier1
                    ? "Ranked per show."
                    : tiers.length === 0
                      ? "No casts ranked."
                      : "Ranked, but nothing at tier 1."}
              </p>
              {hasShowScoped && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Some shows here use their own cast list. See Who is eligible for gaps.
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {/* Deep-linked, because the label names the section: bare /settings opens
            Organization for an admin and Scheduling for a producer, so the one link here
            that promised a destination was the one that missed it. */}
        <Link to={`${ROUTES.SETTINGS}?tab=casts-coverage`} className="text-xs text-primary underline">
          Rank casts in Settings, Casts & coverage
        </Link>
        {/* The panel talks in casts and tiers before anyone has been told what they are.
            Deep-links to the Help center (Settings, Documentation is super-admin-only now).
            The label names the destination so a bare "How casts and tiers work" doesn't
            promise a section and land the reader on a broader page. */}
        <Link to={ROUTES.HELP} className="text-xs text-primary underline">
          How casts and tiers work, in the Help center
        </Link>
      </div>
    </div>
  );
}
