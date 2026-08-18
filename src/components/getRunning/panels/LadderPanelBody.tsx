import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAllCities } from "@/hooks/useAllCities";
import { fetchCasts, fetchCastMemberCounts, setCastCityPriority } from "@/data/casts";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { LadderCoverageInputs } from "@/lib/bookings/setupStatus";
import { UnlocksNote } from "./UnlocksNote";

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
}: {
  orgId: string | null;
  coverage: LadderCoverageInputs | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation("getRunning");
  const qc = useQueryClient();

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
  const unrankedCityIds = useMemo(
    () => cityIds.filter((id) => !(tiersByCity.get(id) ?? []).some((r) => r.priority === 1)),
    [cityIds, tiersByCity],
  );

  const setPriority = useMutation({
    mutationFn: (args: { orgId: string; cityId: string; castId: string; priority: number }) =>
      setCastCityPriority(supabase, args),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ["cast-city-priority"] });
      qc.invalidateQueries({ queryKey: ["eligibility"] });
      toast.success(t("panel.body.ladder.tierUpdated"));
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
    onError: (e: Error) => toast.error(e.message ?? t("panel.body.ladder.tierUpdateFailed")),
  });

  const firstUnrankedId = unrankedCityIds[0];
  const firstUnrankedName = firstUnrankedId ? cityNameById.get(firstUnrankedId) ?? "" : "";
  const firstUnrankedCount = firstUnrankedId ? dateCountByCity[firstUnrankedId] ?? 0 : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{t("panel.body.ladder.citiesWithDates")}</span>
        <span className="font-mono text-xs text-[var(--amber-600)]">
          {t("panel.body.ladder.unrankedCount", { count: unrankedCityIds.length })}
        </span>
      </div>

      <div className="divide-y divide-border rounded-[var(--radius-l)] border border-border">
        {cityIds.map((cityId) => {
          const tiers = tiersByCity.get(cityId) ?? [];
          const tier1 = tiers.find((r) => r.priority === 1);
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
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {tier1 ? (
                  <>
                    <Badge variant="accent">{castNameById.get(tier1.castId) ?? ""}</Badge>
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

      <UnlocksNote>
        {firstUnrankedId
          ? t("panel.body.ladder.unlocks", { count: firstUnrankedCount, city: firstUnrankedName })
          : t("panel.body.ladder.unlocksDone")}
      </UnlocksNote>
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
          className="shrink-0 rounded-[var(--radius-s)] border border-dashed border-accent-200 px-2.5 py-1 text-xs font-medium text-accent-700 hover:bg-accent"
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
                onClick={() => {
                  onSelect(opt.id);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-[var(--radius-s)] px-2 py-1.5 text-left text-sm hover:bg-[var(--surface-3)]"
              >
                <span>{opt.name}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {t("panel.body.ladder.memberCount", { count: opt.memberCount })}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
