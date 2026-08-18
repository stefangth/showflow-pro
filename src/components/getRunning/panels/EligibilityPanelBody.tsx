import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useShows } from "@/hooks/useShows";
import { useAllCities } from "@/hooks/useAllCities";
import { fetchCasts, fetchCastMemberCounts } from "@/data/casts";
import { setShowCastPriority } from "@/data/eligibility";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { resolveCoverage, type LadderCoverageInputs } from "@/lib/bookings/setupStatus";
import { UnlocksNote } from "./UnlocksNote";

interface CastOption {
  id: string;
  name: string;
  memberCount: number;
}

/**
 * The `eligibility` task's in-panel body (screen 02 "list" shape): one row per
 * (show, city) pair with a future date, covered pairs shown as a confirmed badge, gaps
 * shown as a dashed accent "Link a cast" affordance opening a cast picker. Picking a
 * cast writes tier 1 for that exact (show, city, cast) via `setShowCastPriority`
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
}: {
  orgId: string | null;
  coverage: LadderCoverageInputs | undefined;
  onDone: () => void;
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
  const castOptions: CastOption[] = useMemo(
    () => casts.map((c) => ({ id: c.id, name: c.name, memberCount: castCounts[c.id] ?? 0 })),
    [casts, castCounts],
  );

  const result = useMemo(
    () => (coverage ? resolveCoverage(coverage) : { uncoveredPairs: [], hasNullCity: false }),
    [coverage],
  );
  const futurePairs = useMemo(() => coverage?.futurePairs ?? [], [coverage]);

  // Unique (show, city) pairs that have a real city, in first-appearance order — the
  // row list. A null-city future date carries no pair to rank a cast against, so it
  // surfaces only through the `hasNullCity` footnote below, never as a row here.
  const pairs = useMemo(() => {
    const seen = new Set<string>();
    const out: { showId: string; cityId: string }[] = [];
    for (const p of futurePairs) {
      if (!p.cityId) continue;
      const key = `${p.showId}|${p.cityId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ showId: p.showId, cityId: p.cityId });
    }
    return out;
  }, [futurePairs]);

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

  const linkCast = useMutation({
    mutationFn: (args: { showId: string; cityId: string; castId: string; orgId: string }) =>
      setShowCastPriority(supabase, {
        showId: args.showId, cityId: args.cityId, castId: args.castId, orgId: args.orgId, priority: 1,
      }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["eligibility"] });
      qc.invalidateQueries({ queryKey: ["eligible-artists"] });
      qc.invalidateQueries({ queryKey: ["artist-eligible-dates"] });
      qc.invalidateQueries({ queryKey: ["offer-tiers"] });
      toast.success(t("panel.body.eligibility.castLinked"));
      // Fire onDone only on the gap→covered TRANSITION this exact write caused: the
      // written pair must itself have been uncovered BEFORE this write, and it must
      // have been the last one (nothing else still uncovered once it's excluded).
      // Checking `uncoveredKeys.size === 0` alone is wrong once every pair is already
      // covered: it would then be trivially true and re-fire onDone on any later write
      // to this mutation. See LadderPanelBody's identical guard for the bug this fixes.
      //
      // Also require !hasNullCity, matching the board's OWN eligibility.done rule
      // (computeBookingSetupStatus: `uncoveredPairs.length === 0 && !hasNullCity`). A
      // future date with no city set keeps the task outstanding — the nullCityNote below
      // renders for exactly that case — so advancing/closing the panel on the last
      // city-scoped link, while the board still flags eligibility, would just make the
      // admin reopen it. (Ladder has no such dependency, hence no equivalent clause there.)
      const key = `${variables.showId}|${variables.cityId}`;
      const wasUncovered = uncoveredKeys.has(key);
      const remaining = [...uncoveredKeys].filter((k) => k !== key);
      if (wasUncovered && remaining.length === 0 && !result.hasNullCity) onDone();
    },
    onError: (e: Error) => toast.error(e.message ?? t("panel.body.eligibility.castLinkFailed")),
  });

  const firstGap = pairs.find((p) => uncoveredKeys.has(`${p.showId}|${p.cityId}`));
  const firstGapShowName = firstGap ? showNameById.get(firstGap.showId) ?? "" : "";
  const firstGapCount = firstGap ? dateCountByPair[`${firstGap.showId}|${firstGap.cityId}`] ?? 0 : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t("panel.body.eligibility.showsWithDates")}</span>
        <span className="font-mono text-xs text-[var(--amber-600)]">
          {t("panel.body.eligibility.gapCount", { count: result.uncoveredPairs.length })}
        </span>
      </div>

      <div className="divide-y divide-border rounded-[var(--radius-l)] border border-border">
        {pairs.map((p) => {
          const key = `${p.showId}|${p.cityId}`;
          const covered = !uncoveredKeys.has(key);
          const dateCount = dateCountByPair[key] ?? 0;

          return (
            <div key={key} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {showNameById.get(p.showId) ?? p.showId} · {cityNameById.get(p.cityId) ?? p.cityId}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {t("panel.body.eligibility.dateCount", { count: dateCount })}
                </p>
              </div>
              <div className="shrink-0">
                {covered ? (
                  <Badge variant="confirmed">{t("panel.body.eligibility.covered")}</Badge>
                ) : (
                  <CastPicker
                    options={castOptions}
                    onSelect={(castId) => {
                      if (!orgId) return;
                      linkCast.mutate({ showId: p.showId, cityId: p.cityId, castId, orgId });
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {result.hasNullCity && (
        <p className="text-xs text-[var(--text-faint)]">{t("panel.body.eligibility.nullCityNote")}</p>
      )}

      <UnlocksNote>
        {firstGap
          ? t("panel.body.eligibility.unlocks", { count: firstGapCount, show: firstGapShowName })
          : t("panel.body.eligibility.unlocksDone")}
      </UnlocksNote>
    </div>
  );
}

/** A gap row's cast picker: a dashed accent affordance that opens a popover list of
 *  the org's casts (name + member count), the same option-list shape as
 *  `LadderPanelBody`'s `CastPicker` / `TierCell`'s option list — minus any clear
 *  action, since this panel only ever links a cast, it never unlinks one. */
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
          className="shrink-0 rounded-[var(--radius-s)] border border-dashed border-accent-200 px-2.5 py-1 text-xs font-medium text-accent-700 hover:bg-accent"
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
                onClick={() => {
                  onSelect(opt.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-[var(--radius-s)] px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-3)]"
              >
                <span>{opt.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {t("panel.body.eligibility.memberCount", { count: opt.memberCount })}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
