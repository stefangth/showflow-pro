import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useAllCities } from "@/hooks/useAllCities";
import { createCast, fetchCasts, fetchCastMemberCounts, setCastCityPriority } from "@/data/casts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { LadderCoverageInputs } from "@/lib/bookings/setupStatus";
import { UnlocksNote } from "./UnlocksNote";
import { CastRosterList } from "./CastRosterList";

interface CastOption {
  id: string;
  name: string;
  memberCount: number;
}

/**
 * The `ladder` task's in-panel body (screen 01 "Cast priorities" editor, verbatim): one
 * row per city with a future date, its tier-1 cast shown as an accent chip or a dashed
 * "Pick tier 1" affordance that opens a cast picker, plus a secondary "Add tier 2"
 * affordance once a city already has a tier 1. Org-scope only — writes through
 * `setCastCityPriority` (`src/data/casts.ts`) against `cast_city_priority`, the exact
 * function + invalidation pair `CoveragePanel`'s org-scope path uses
 * (`src/components/settings/castsCoverage/CoveragePanel.tsx`, `TierCell.tsx`'s option
 * list). Per-show overrides remain Settings, Casts & coverage's job — this panel's only
 * job is to get every city with a future date a tier 1 so offers can flow at all.
 *
 * Replaces the read-only `LadderStep`, which only summarized coverage and linked out to
 * Settings. `coverage` is threaded straight from the registry's own
 * `useBookingSetupStatus` read (the same query `EligibilityStep` and the retired
 * `LadderStep` consumed) rather than re-fetched here — this component never touches the
 * `["eligibility", "ladder-coverage", ...]` query directly, only invalidates it on write
 * so the registry's own read refreshes.
 */
export function LadderPanelBody({
  orgId,
  coverage,
  onDone,
  showCastList = true,
  showUnlocks = true,
}: {
  orgId: string | null;
  coverage: LadderCoverageInputs | undefined;
  onDone: () => void;
  /** The v3 wizard stacks this body with `EligibilityPanelBody` under one `coverage`
   *  step, and both render the same org cast roster and the same style of unlocks
   *  callout. Left on, the merged step shows each of them twice in a single scroll.
   *  Default `true` so v1's TaskPanel and the setup rails are unchanged. */
  showCastList?: boolean;
  showUnlocks?: boolean;
}) {
  const { t } = useTranslation("getRunning");
  const qc = useQueryClient();
  const { user } = useAuth();
  const canManageCasts = useCan("manage_casts");
  const [newCastName, setNewCastName] = useState("");

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

  const cities = useMemo(() => citiesQ.data ?? [], [citiesQ.data]);
  const casts = useMemo(() => castsQ.data ?? [], [castsQ.data]);
  const castCounts = useMemo(() => castCountsQ.data ?? {}, [castCountsQ.data]);

  const cityNameById = useMemo(() => new Map(cities.map((c) => [c.id, c.name])), [cities]);
  const castNameById = useMemo(() => new Map(casts.map((c) => [c.id, c.name])), [casts]);
  const castOptions: CastOption[] = useMemo(
    () => casts.map((c) => ({ id: c.id, name: c.name, memberCount: castCounts[c.id] ?? 0 })),
    [casts, castCounts],
  );

  const futurePairs = useMemo(() => coverage?.futurePairs ?? [], [coverage]);
  const cityPriorities = useMemo(() => coverage?.cityPriorities ?? [], [coverage]);

  // Cities that have at least one future date — the row list. Order follows first
  // appearance in futurePairs, same convention the retired LadderStep used.
  const cityIds = useMemo(
    () => [...new Set(futurePairs.map((p) => p.cityId).filter((id): id is string => !!id))],
    [futurePairs],
  );
  const dateCountByCity = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of futurePairs) {
      if (!p.cityId) continue;
      counts[p.cityId] = (counts[p.cityId] ?? 0) + 1;
    }
    return counts;
  }, [futurePairs]);
  const tiersByCity = useMemo(() => {
    const map = new Map<string, { castId: string; priority: number }[]>();
    for (const row of cityPriorities) {
      const arr = map.get(row.cityId) ?? [];
      arr.push({ castId: row.castId, priority: row.priority });
      map.set(row.cityId, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.priority - b.priority);
    return map;
  }, [cityPriorities]);
  // The staffing rule, read from the SAME field `resolveCoverage` reads
  // (`LadderCoverageInputs.nonEmptyCastIds`). A cast with no members cannot be asked, so a
  // city whose first group is empty is not covered however the ladder reads: the board's
  // `coverage` step goes red for it. This panel used to test `priority === 1` alone, so on
  // an org with an empty cast ranked first it printed "0 unranked" and "Every city with
  // dates has a first group" inside a step the board was blocking on, and `onDone` could
  // never fire. One rule, one place.
  const staffedCastIds = useMemo(() => new Set(coverage?.nonEmptyCastIds ?? []), [coverage]);
  const isStaffedTier1 = (row: { castId: string; priority: number }) =>
    row.priority === 1 && staffedCastIds.has(row.castId);
  const unrankedCityIds = useMemo(
    () =>
      cityIds.filter(
        (id) => !(tiersByCity.get(id) ?? []).some((r) => r.priority === 1 && staffedCastIds.has(r.castId)),
      ),
    [cityIds, tiersByCity, staffedCastIds],
  );

  const setPriority = useMutation({
    mutationFn: (args: { orgId: string; cityId: string; castId: string; priority: number }) =>
      setCastCityPriority(supabase, args),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["cast-city-priority"] });
      qc.invalidateQueries({ queryKey: ["eligibility"] });
      toast.success(t("panel.body.ladder.tierUpdated", { tier: variables.priority }));
      // Fire onDone only on the unranked→ranked TRANSITION this exact write caused: the
      // written city must itself have been unranked BEFORE this write (an "Add tier 2"
      // on an already-tier-1'd city is not that), and it must have been the last gap
      // (nothing else still unranked once it's excluded). Checking `remaining.length
      // === 0` alone is wrong once the whole set is already ranked: unrankedCityIds is
      // then `[]`, so every subsequent write (e.g. every later "Add tier 2" click)
      // would trivially satisfy it and re-fire onDone, re-closing/advancing the panel.
      const wasUnranked = unrankedCityIds.includes(variables.cityId);
      const remaining = unrankedCityIds.filter((id) => id !== variables.cityId);
      if (wasUnranked && remaining.length === 0) onDone();
    },
    onError: (e: Error, variables) =>
      toast.error(e.message ?? t("panel.body.ladder.tierUpdateFailed", { tier: variables.priority })),
  });

  const createCastMut = useMutation({
    mutationFn: (args: { orgId: string; name: string }) =>
      createCast(supabase, args.orgId, { name: args.name, description: "", createdBy: user?.id ?? null }),
    onSuccess: () => {
      // Matches castOptions' ["casts", orgId] query key, so the picker list refreshes.
      qc.invalidateQueries({ queryKey: ["casts"] });
      toast.success(t("panel.body.ladder.castCreated"));
      // Stays open on purpose: seeding casts is a several-in-a-row task, so only clear
      // the field and let the ["casts"] invalidation surface the new cast in the pickers.
      setNewCastName("");
    },
    onError: (e: Error) => toast.error(e.message ?? t("panel.body.ladder.castCreateFailed")),
  });

  const trimmedCastName = newCastName.trim();
  const canSubmitCast = !!orgId && trimmedCastName.length > 0 && !createCastMut.isPending;

  const handleCreateCast = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmitCast) return;
    createCastMut.mutate({ orgId: orgId!, name: trimmedCastName });
  };

  const firstUnrankedId = unrankedCityIds[0];
  const firstUnrankedName = firstUnrankedId ? cityNameById.get(firstUnrankedId) ?? "" : "";
  const firstUnrankedCount = firstUnrankedId ? dateCountByCity[firstUnrankedId] ?? 0 : 0;
  // "Rank {{city}} too" is false for a city that IS ranked and whose first group is simply
  // empty. Same gap, different fix, so it gets its own sentence.
  const firstUnrankedIsUnstaffed =
    !!firstUnrankedId && (tiersByCity.get(firstUnrankedId) ?? []).some((r) => r.priority === 1);

  // Where each cast is ranked across the org's city ladders, so a cast made ANYWHERE (this
  // panel, /artists, Settings) is visible here with its standing — not only as an option
  // hidden inside a per-city picker that never renders when no city has a future date. This
  // is the fix for question (3): a cast that isn't tied to a city-with-a-date used to vanish
  // from the board entirely. Reads the same `cityPriorities` the pickers do.
  const rankByCast = useMemo(() => {
    const map = new Map<string, { cityId: string; priority: number }[]>();
    for (const row of cityPriorities) {
      const arr = map.get(row.castId) ?? [];
      arr.push({ cityId: row.cityId, priority: row.priority });
      map.set(row.castId, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.priority - b.priority);
    return map;
  }, [cityPriorities]);

  const rankLabel = (castId: string): string => {
    const ranks = rankByCast.get(castId) ?? [];
    if (ranks.length === 0) return t("panel.body.ladder.castNotRanked");
    // Count distinct CITIES, not priority rows: a cast ranked at two tiers in one city is
    // "ranked in 1 city", not 2.
    const distinctCities = new Set(ranks.map((r) => r.cityId));
    if (distinctCities.size > 1) return t("panel.body.ladder.castRankMulti", { count: distinctCities.size });
    const only = ranks[0];
    const cityName = cityNameById.get(only.cityId) ?? only.cityId;
    return only.priority === 1
      ? t("panel.body.ladder.castRankFirst", { city: cityName })
      : t("panel.body.ladder.castRankGroup", { n: only.priority, city: cityName });
  };

  return (
    <div className="space-y-3">
      {canManageCasts && (
        <form onSubmit={handleCreateCast} className="space-y-2">
          <Label
            htmlFor="ladder-add-cast"
            // eslint-disable-next-line no-restricted-syntax -- form <Label>, not a block eyebrow: <Eyebrow> renders a <p> and would drop the htmlFor association
            className="text-eyebrow uppercase tracking-wider text-muted-foreground"
          >
            {t("panel.body.ladder.createLabel")}
          </Label>
          <div className="flex gap-2">
            <Input
              id="ladder-add-cast"
              className="h-8 flex-1"
              placeholder={t("panel.body.ladder.namePlaceholder")}
              value={newCastName}
              onChange={(e) => setNewCastName(e.target.value)}
            />
            <Button type="submit" size="sm" disabled={!canSubmitCast}>
              {t("panel.body.ladder.create")}
            </Button>
          </div>
        </form>
      )}

      {showCastList && <CastRosterList casts={castOptions} keyPrefix="panel.body.ladder" subline={rankLabel} />}

      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t("panel.body.ladder.citiesWithDates")}</span>
        <span className="font-mono text-xs text-[var(--amber-600)]">
          {t("panel.body.ladder.unrankedCount", { count: unrankedCityIds.length })}
        </span>
      </div>

      {cityIds.length === 0 ? (
        <p className="rounded-[var(--radius-l)] border border-border bg-accent-tint px-3 py-2.5 text-xs leading-[17px] text-muted-foreground">
          {/* "No future dates at all" vs "dates exist but all lack a city": with a
              null-city-only backlog, futurePairs is non-empty but cityIds is []. */}
          {t(futurePairs.length > 0 ? "panel.body.ladder.datesNeedCity" : "panel.body.ladder.noCitiesYet")}
        </p>
      ) : (
      <div className="divide-y divide-border rounded-[var(--radius-l)] border border-border">
        {cityIds.map((cityId) => {
          const tiers = tiersByCity.get(cityId) ?? [];
          const tier1 = tiers.find((r) => r.priority === 1);
          // Ranked but unstaffed is its own state, and it is a blocking one: say which of
          // the two it is rather than showing the cast chip as though the city were covered.
          const tier1Unstaffed = !!tier1 && !isStaffedTier1(tier1);
          const maxPriority = tiers.reduce((max, r) => Math.max(max, r.priority), 0);
          const dateCount = dateCountByCity[cityId] ?? 0;

          return (
            <div key={cityId} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">
                  {cityNameById.get(cityId) ?? cityId}
                </p>
                <p className="font-mono text-xs text-muted-foreground">
                  {t("panel.body.ladder.dateCount", { count: dateCount })}
                  {!tier1 && ` · ${t("panel.body.ladder.noTier1")}`}
                  {tier1Unstaffed && ` · ${t("panel.body.ladder.tier1Empty")}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {tier1 ? (
                  <>
                    <Badge variant={tier1Unstaffed ? "risk" : "accent"}>{castNameById.get(tier1.castId) ?? ""}</Badge>
                    <CastPicker
                      label={t("panel.body.ladder.addTierN", { n: maxPriority + 1 })}
                      options={castOptions}
                      onSelect={(castId) => {
                        if (!orgId) return;
                        setPriority.mutate({ orgId, cityId, castId, priority: maxPriority + 1 });
                      }}
                    />
                  </>
                ) : (
                  <CastPicker
                    label={t("panel.body.ladder.pickTier1")}
                    options={castOptions}
                    onSelect={(castId) => {
                      if (!orgId) return;
                      setPriority.mutate({ orgId, cityId, castId, priority: 1 });
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {/* Only speak to ranking when there is actually a city with a date to rank. With no
          such city the datesNeedCity/noCitiesYet empty-state above already explains the
          state; the "Every city with dates has a first group" reassurance would contradict
          it. */}
      {showUnlocks && cityIds.length > 0 && (
        <UnlocksNote>
          {firstUnrankedId
            ? t(
                firstUnrankedIsUnstaffed ? "panel.body.ladder.unlocksStaff" : "panel.body.ladder.unlocks",
                { count: firstUnrankedCount, city: firstUnrankedName },
              )
            : t("panel.body.ladder.unlocksDone")}
        </UnlocksNote>
      )}
    </div>
  );
}

/** One tier's cast picker: a dashed accent affordance that opens a popover list of the
 *  org's casts (name + member count), mirroring `TierCell`'s option list
 *  (`src/components/settings/castsCoverage/TierCell.tsx`) minus its clear-slot action —
 *  this panel only ever adds a tier, it never clears one (see task scope: org-scope
 *  ranking only, no per-show overrides, no removal affordance here). */
function CastPicker({
  label,
  options,
  onSelect,
}: {
  label: string;
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
          className="shrink-0 rounded-[var(--radius-s)] border border-dashed border-accent-200 px-2.5 py-1 text-xs font-medium text-accent-text hover:bg-accent"
        >
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {t("panel.body.ladder.noCastsAvailable")}
            </p>
          ) : (
            options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                // A cast with no members cannot cover the city (`resolveCoverage` requires a
                // STAFFED tier 1), so ranking it here would write cleanly, toast, and leave
                // the gap standing. Greyed out with its member count rather than hidden, so
                // the reason is on screen.
                disabled={opt.memberCount === 0}
                onClick={() => {
                  onSelect(opt.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-[var(--radius-s)] px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-3)] disabled:pointer-events-none disabled:opacity-50"
              >
                <span>{opt.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {t("panel.body.ladder.memberCount", { count: opt.memberCount })}
                </span>
              </button>
            ))
          )}
        </div>
        {options.some((o) => o.memberCount === 0) && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            {t("panel.body.ladder.emptyCastHint")}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
