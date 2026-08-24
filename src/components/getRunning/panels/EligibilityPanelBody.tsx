import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useShows } from "@/hooks/useShows";
import { useAllCities } from "@/hooks/useAllCities";
import { fetchCasts, fetchCastMemberCounts } from "@/data/casts";
import { setShowCastPriority } from "@/data/eligibility";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { resolveCoverage, type LadderCoverageInputs } from "@/lib/bookings/setupStatus";
import { UnlocksNote } from "./UnlocksNote";
import { CastRosterList } from "./CastRosterList";

interface CastOption {
  id: string;
  name: string;
  memberCount: number;
}

/** One production's regrouped coverage: its future cities, which of them a tier-1
 *  cast already covers (and by which distinct casts), which are still gaps, and the
 *  aggregated date/city totals across the whole production. */
interface ProductionCoverage {
  showId: string;
  cityCount: number;
  dateTotal: number;
  uncoveredCityIds: string[];
  /** Uncovered cities that DO have a tier-1 cast, which simply has no members. A different
   *  gap from "nothing is ranked here", with a different fix, so it gets its own line
   *  instead of being described as "No cast in {{cities}} yet", which is false for it. */
  unstaffedCityIds: string[];
  coveringCastIds: string[];
}

/**
 * The `eligibility` task's in-panel body (screen 02 "list" shape): one card per
 * PRODUCTION (show), with the eligible casts listed as chips below each production.
 * A production with a future date in every city already covered by a tier-1 cast reads
 * "Fully covered"; a production with one or more uncovered cities reads "N gaps" and
 * offers a dashed "Link a cast" chip. Picking a cast FANS OUT the write, ranking that
 * cast tier 1 for the production across EVERY uncovered city via `setShowCastPriority`
 * (`src/data/eligibility.ts`) — the same call that both links the cast (creates the
 * eligibility gate row) and covers the pair, since a prioritized cast is by definition
 * eligible.
 *
 * Replaces the read-only `EligibilityStep`, which only listed the gaps and linked out
 * to Settings. `coverage` is threaded straight from the registry's own
 * `useBookingSetupStatus` read (the same query the retired `EligibilityStep` and
 * `LadderPanelBody` both consume) rather than re-fetched here.
 *
 * Distinct from `LadderPanelBody`: that panel ranks a cast for a WHOLE CITY (writes
 * `cast_city_priority`, the org-wide default every show falls back to); this one ranks
 * a cast for one SHOW in one city (writes `show_cast_eligibility`, a per-show override
 * that wins over the city default — see `resolveCoverage`'s scoped-then-fallback
 * lookup). Both close the same underlying gap; this is the show-specific escape hatch
 * for a city whose org-wide ladder does not fit a particular show.
 */
export function EligibilityPanelBody({
  orgId,
  coverage,
  onDone,
  showCastList = true,
}: {
  orgId: string | null;
  coverage: LadderCoverageInputs | undefined;
  onDone: () => void;
  /** See `LadderPanelBody`'s prop of the same name: the v3 `coverage` step stacks both
   *  bodies, and only one of them should print the org cast roster. Default `true` so
   *  every other host is unchanged. */
  showCastList?: boolean;
}) {
  const { t } = useTranslation("getRunning");
  const qc = useQueryClient();

  const showsQ = useShows();
  const citiesQ = useAllCities();
  const castsQ = useQuery({
    queryKey: ["casts", orgId],
    enabled: !!orgId,
    queryFn: () => fetchCasts(supabase, orgId),
  });
  const castCountsQ = useQuery({
    queryKey: ["cast-members-counts", orgId],
    enabled: !!orgId,
    queryFn: () => fetchCastMemberCounts(supabase, orgId),
  });

  const shows = useMemo(() => showsQ.data ?? [], [showsQ.data]);
  const cities = useMemo(() => citiesQ.data ?? [], [citiesQ.data]);
  const casts = useMemo(() => castsQ.data ?? [], [castsQ.data]);
  const castCounts = useMemo(() => castCountsQ.data ?? {}, [castCountsQ.data]);

  const showNameById = useMemo(
    () => new Map(shows.map((s) => [s.id, [s.program, s.sub_program].filter(Boolean).join(" · ")])),
    [shows],
  );
  const cityNameById = useMemo(() => new Map(cities.map((c) => [c.id, c.name])), [cities]);
  const castNameById = useMemo(() => new Map(casts.map((c) => [c.id, c.name])), [casts]);
  const castOptions: CastOption[] = useMemo(
    () => casts.map((c) => ({ id: c.id, name: c.name, memberCount: castCounts[c.id] ?? 0 })),
    [casts, castCounts],
  );

  const result = useMemo(
    () => (coverage ? resolveCoverage(coverage) : { uncoveredPairs: [], hasNullCity: false }),
    [coverage],
  );
  const futurePairs = useMemo(() => coverage?.futurePairs ?? [], [coverage]);

  const dateCountByPair = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of futurePairs) {
      if (!p.cityId) continue;
      const key = `${p.showId}|${p.cityId}`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [futurePairs]);

  const uncoveredKeys = useMemo(
    () => new Set(result.uncoveredPairs.map((p) => `${p.showId}|${p.cityId}`)),
    [result],
  );

  // Regroup the flat (show, city) coverage into one entry per PRODUCTION, in stable
  // first-appearance order of shows. A null-city future date carries no pair to rank a
  // cast against, so it surfaces only through the `hasNullCity` footnote below, never
  // as a production city here. The covering cast of a covered city mirrors
  // resolveCoverage's own scoped-then-fallback ladder lookup, so the chip we show is
  // exactly the cast the engine would resolve to.
  const productions = useMemo<ProductionCoverage[]>(() => {
    const showPriorities = coverage?.showPriorities ?? [];
    const cityPriorities = coverage?.cityPriorities ?? [];
    const coveringCastId = (showId: string, cityId: string): string | null => {
      const scoped = showPriorities.filter((r) => r.showId === showId && r.cityId === cityId);
      const ladder = scoped.length > 0 ? scoped : cityPriorities.filter((r) => r.cityId === cityId);
      return ladder.find((r) => r.priority === 1)?.castId ?? null;
    };

    const order: string[] = [];
    const cityIdsByShow = new Map<string, string[]>();
    const seenCity = new Map<string, Set<string>>();
    for (const p of futurePairs) {
      if (!p.cityId) continue;
      if (!cityIdsByShow.has(p.showId)) {
        cityIdsByShow.set(p.showId, []);
        seenCity.set(p.showId, new Set());
        order.push(p.showId);
      }
      const seen = seenCity.get(p.showId)!;
      if (!seen.has(p.cityId)) {
        seen.add(p.cityId);
        cityIdsByShow.get(p.showId)!.push(p.cityId);
      }
    }

    return order.map((showId) => {
      const cityIds = cityIdsByShow.get(showId)!;
      const uncoveredCityIds: string[] = [];
      const unstaffedCityIds: string[] = [];
      const coveringCastIds: string[] = [];
      const seenCast = new Set<string>();
      let dateTotal = 0;
      for (const cityId of cityIds) {
        dateTotal += dateCountByPair[`${showId}|${cityId}`] ?? 0;
        if (uncoveredKeys.has(`${showId}|${cityId}`)) {
          uncoveredCityIds.push(cityId);
          // Uncovered WITH a tier-1 cast can only mean that cast has no members
          // (`resolveCoverage` requires a staffed tier 1), which is the state the old
          // single "No cast yet" line described wrongly.
          if (coveringCastId(showId, cityId) !== null) unstaffedCityIds.push(cityId);
          continue;
        }
        const castId = coveringCastId(showId, cityId);
        if (castId && !seenCast.has(castId)) {
          seenCast.add(castId);
          coveringCastIds.push(castId);
        }
      }
      return { showId, cityCount: cityIds.length, dateTotal, uncoveredCityIds, unstaffedCityIds, coveringCastIds };
    });
  }, [futurePairs, coverage, dateCountByPair, uncoveredKeys]);

  // The fan-out below owns invalidation and the toast: one batch of writes is a single
  // user action, so it refreshes the queries once (not once per city) and surfaces one
  // toast, rather than N of each.
  const linkCast = useMutation({
    mutationFn: (args: { showId: string; cityId: string; castId: string; orgId: string }) =>
      setShowCastPriority(supabase, {
        showId: args.showId, cityId: args.cityId, castId: args.castId, orgId: args.orgId, priority: 1,
      }),
  });

  // Fan the chosen cast across EVERY uncovered city of the production. onDone fires only
  // on the gap→covered TRANSITION this batch causes: the batch must close the LAST
  // remaining gaps (nothing still uncovered once this production's cities are excluded)
  // AND there must be no null-city date left, matching the board's OWN eligibility.done
  // rule (computeBookingSetupStatus: `uncoveredPairs.length === 0 && !hasNullCity`). A
  // future date with no city keeps the task outstanding — the nullCityNote below renders
  // for exactly that case — so advancing on the last city link while the board still
  // flags eligibility would just make the admin reopen it.
  const linkCastToProduction = async (showId: string, uncoveredCityIds: string[], castId: string) => {
    if (!orgId || uncoveredCityIds.length === 0) return;
    const closing = new Set(uncoveredCityIds.map((cityId) => `${showId}|${cityId}`));
    const remaining = [...uncoveredKeys].filter((k) => !closing.has(k));
    const willComplete = remaining.length === 0 && !result.hasNullCity;
    try {
      await Promise.all(
        uncoveredCityIds.map((cityId) => linkCast.mutateAsync({ showId, cityId, castId, orgId })),
      );
      toast.success(t("panel.body.eligibility.castLinked"));
      if (willComplete) onDone();
    } catch (e) {
      toast.error((e as Error).message ?? t("panel.body.eligibility.castLinkFailed"));
    } finally {
      // Once per batch, and in `finally` so a partial success (some cities written before
      // another rejected) still refreshes the affected queries.
      qc.invalidateQueries({ queryKey: ["eligibility"] });
      qc.invalidateQueries({ queryKey: ["eligible-artists"] });
      qc.invalidateQueries({ queryKey: ["artist-eligible-dates"] });
      qc.invalidateQueries({ queryKey: ["offer-tiers"] });
    }
  };

  const firstGap = productions.find((p) => p.uncoveredCityIds.length > 0);
  const firstGapShowName = firstGap ? showNameById.get(firstGap.showId) ?? "" : "";
  const firstGapCount = firstGap
    ? firstGap.uncoveredCityIds.reduce((sum, c) => sum + (dateCountByPair[`${firstGap.showId}|${c}`] ?? 0), 0)
    : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t("panel.body.eligibility.byProduction")}</span>
        <span className="font-mono text-xs text-[var(--amber-600)]">
          {t("panel.body.eligibility.gapCount", { count: result.uncoveredPairs.length })}
        </span>
      </div>

      {showCastList && <CastRosterList casts={castOptions} keyPrefix="panel.body.eligibility" />}

      {productions.length === 0 && (
        <p className="rounded-[var(--radius-l)] border border-border bg-accent-tint px-3 py-2.5 text-xs leading-[17px] text-muted-foreground">
          {/* Distinguish "no future dates at all" from "dates exist but all lack a city":
              with a null-city-only backlog, futurePairs is non-empty but productions is [] */}
          {t(futurePairs.length > 0 ? "panel.body.eligibility.datesNeedCity" : "panel.body.eligibility.noProductionsYet")}
        </p>
      )}

      <div className="space-y-2">
        {productions.map((prod) => {
          const hasGap = prod.uncoveredCityIds.length > 0;
          const unstaffedSet = new Set(prod.unstaffedCityIds);
          const cityNames = (ids: string[]) => ids.map((id) => cityNameById.get(id) ?? id).join(", ");
          const unrankedCityNames = cityNames(prod.uncoveredCityIds.filter((id) => !unstaffedSet.has(id)));
          const unstaffedCityNames = cityNames(prod.unstaffedCityIds);

          return (
            <div
              key={prod.showId}
              className={cn(
                "rounded-[var(--radius-l)] border p-3",
                hasGap ? "border-accent-200" : "border-border",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 truncate text-control font-medium text-foreground">
                  {showNameById.get(prod.showId) ?? prod.showId}
                </span>
                {hasGap ? (
                  <Badge variant="risk" className="shrink-0">
                    {t("panel.body.eligibility.gapCount", { count: prod.uncoveredCityIds.length })}
                  </Badge>
                ) : (
                  <Badge variant="confirmed" className="shrink-0">
                    {t("panel.body.eligibility.fullyCovered")}
                  </Badge>
                )}
              </div>

              <p className="mt-1 font-mono text-eyebrow text-muted-foreground">
                {t("panel.body.eligibility.dateCount", { count: prod.dateTotal })}
                {" · "}
                {t("panel.body.eligibility.cityCount", { count: prod.cityCount })}
              </p>

              <div className="mt-2 flex flex-wrap gap-1.5">
                {prod.coveringCastIds.map((castId) => (
                  <span
                    key={castId}
                    className="inline-flex h-6 items-center gap-1.5 rounded-[var(--radius-s)] border border-accent-200 bg-accent-tint px-2 text-xs font-medium text-accent-text"
                  >
                    <Users className="h-3 w-3" />
                    {castNameById.get(castId) ?? castId}
                  </span>
                ))}
                {hasGap && (
                  <CastPicker
                    options={castOptions}
                    onSelect={(castId) => linkCastToProduction(prod.showId, prod.uncoveredCityIds, castId)}
                  />
                )}
              </div>

              {/* Two different gaps, said separately: nothing ranked here, and a ranked cast
                  with nobody in it. A production can be in both states at once (different
                  cities), so these are not exclusive. */}
              {hasGap && unrankedCityNames !== "" && (
                <p className="mt-2 text-eyebrow text-muted-foreground">
                  {t("panel.body.eligibility.noCastYet", { cities: unrankedCityNames })}
                </p>
              )}
              {hasGap && unstaffedCityNames !== "" && (
                <p className="mt-2 text-eyebrow text-muted-foreground">
                  {t("panel.body.eligibility.castEmpty", { cities: unstaffedCityNames })}
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Suppress this footnote when there are no productions to show: the datesNeedCity
          empty-state above already says the same thing (dates exist but have no city), and
          showing both reads as the point made twice. It still renders in the mixed case
          (some productions covered, plus a stray null-city date). */}
      {result.hasNullCity && productions.length > 0 && (
        <p className="text-xs text-[var(--text-faint)]">{t("panel.body.eligibility.nullCityNote")}</p>
      )}

      {/* Only speak to coverage when there is a production with a city-bearing date to
          cover. With none, the datesNeedCity/noProductionsYet empty-state above already
          explains the state; the "Every show and city has a cast" reassurance would
          contradict it. */}
      {productions.length > 0 && (
        <UnlocksNote>
          {firstGap
            ? t("panel.body.eligibility.unlocks", { count: firstGapCount, show: firstGapShowName })
            : t("panel.body.eligibility.unlocksDone")}
        </UnlocksNote>
      )}
    </div>
  );
}

/** A gap card's cast picker: a dashed accent chip that opens a popover list of the
 *  org's casts (name + member count), the same option-list shape as `LadderPanelBody`'s
 *  `CastPicker` / `TierCell`'s option list — minus any clear action, since this panel
 *  only ever links a cast, it never unlinks one.
 *
 *  A cast with NO members is offered but not selectable: linking it writes cleanly and
 *  toasts "Cast linked" while the gap stays exactly where it was, because `resolveCoverage`
 *  requires a STAFFED tier 1. Showing it greyed out with its member count says why the fix
 *  is elsewhere; hiding it would leave an admin hunting for a cast they can see in the
 *  roster above. */
function CastPicker({
  options,
  onSelect,
}: {
  options: CastOption[];
  onSelect: (castId: string) => void;
}) {
  const { t } = useTranslation("getRunning");
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-6 shrink-0 items-center rounded-[var(--radius-s)] border border-dashed border-accent-200 px-2.5 text-xs font-medium text-accent-text hover:bg-accent"
        >
          {t("panel.body.eligibility.linkACast")}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("panel.body.eligibility.noCastsAvailable")}
            </p>
          ) : (
            options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={opt.memberCount === 0}
                onClick={() => {
                  onSelect(opt.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-[var(--radius-s)] px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-3)] disabled:pointer-events-none disabled:opacity-50"
              >
                <span>{opt.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {t("panel.body.eligibility.memberCount", { count: opt.memberCount })}
                </span>
              </button>
            ))
          )}
        </div>
        {options.some((o) => o.memberCount === 0) && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("panel.body.eligibility.emptyCastHint")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
