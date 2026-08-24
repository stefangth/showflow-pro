import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import { useCan } from "@/hooks/useCapabilities";
import { useAllCities } from "@/hooks/useAllCities";
import {
  fetchCasts,
  fetchCastMemberCounts,
  fetchCastCityPriority,
  setCastCityPriority,
  clearCastCityPriority,
} from "@/data/casts";
import { fetchShowOptions } from "@/data/shows";
import { createCity, updateCity } from "@/data/cities";
import {
  fetchShowPriorityRows,
  setShowCastPriority,
  clearShowCastPriority,
  fetchLadderCoverageInputs,
} from "@/data/eligibility";
import { toDateKey } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { IconTooltip } from "@/components/common/IconTooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, ChevronRight, Plus, Pencil, Check, X } from "lucide-react";
import { CastDetailsSheet } from "@/components/casts/CastDetailsSheet";
import type { Cast } from "@/types";
import { TierCell } from "./TierCell";
import {
  COVERAGE_TIER_COUNT,
  coverageKpis,
  coverageStatus,
  buildCoverageRows,
  buildPerShowCoverageRows,
  showsCountByCity,
  castCityUsage,
  distinctShowOverrideCount,
  overriddenCityCountForShow,
  buildCityReferences,
  isCityReferenced,
  type CoverageCityRow,
  type CoverageCityRowWithSource,
} from "./coverageMatrix";

type CoverageScope = "org" | "show";

interface CoveragePanelProps {
  orgId: string;
  /** A later task wires this up to open the cast/artist detail sheet. */
  onOpenCast?: (castId: string) => void;
}

/** Settings → Casts & coverage → Coverage. Org-default offer order by city, with a
 *  per-show override view. Writes through `setCastCityPriority` / `clearCastCityPriority`
 *  (src/data/casts.ts) for the org default and the pre-existing `setShowCastPriority` /
 *  `clearShowCastPriority` (src/data/eligibility.ts) for per-show overrides. Unlike the
 *  legacy CastsCitiesTab's bare `.insert()` (which only ever adds a brand-new assignment),
 *  `setCastCityPriority` also resolves cast_city_priority's two UNIQUE constraints when a
 *  cell already has an occupant — moving/bumping rows as needed — so the two write paths
 *  are not interchangeable. */
export function CoveragePanel({ orgId, onOpenCast }: CoveragePanelProps) {
  const { t } = useTranslation('settingsCastsCoverage');
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canManage = useCan("manage_cities");
  const canDeleteCity = hasRole("admin");

  const TIER_LABELS = Array.from({ length: COVERAGE_TIER_COUNT }, (_, i) => t('coverage.tierLabel', { n: i + 1 }));

  const SCOPE_OPTIONS: SegmentedControlOption<CoverageScope>[] = [
    { value: "org", label: t('coverage.scopeOrg') },
    { value: "show", label: t('coverage.scopeShow') },
  ];

  const [scope, setScope] = useState<CoverageScope>("org");
  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);
  const [newCity, setNewCity] = useState("");
  const [editingCityId, setEditingCityId] = useState<string | null>(null);
  const [editingCityName, setEditingCityName] = useState("");
  const [activeCast, setActiveCast] = useState<Cast | null>(null);

  // Same query key/behavior as CastsCitiesTab's own city read (["cities","all",orgId] via
  // fetchCities) — useAllCities resolves orgId from useAuth's currentOrg, so caching and
  // invalidation are unchanged from a direct fetchCities(supabase, orgId) query here.
  const citiesQ = useAllCities(true);
  const castsQ = useQuery({
    queryKey: ["casts", orgId],
    queryFn: () => fetchCasts(supabase, orgId),
  });
  const castCountsQ = useQuery({
    queryKey: ["cast-members-counts", orgId],
    queryFn: () => fetchCastMemberCounts(supabase, orgId),
  });
  const orgPriorityQ = useQuery({
    queryKey: ["cast-city-priority", orgId],
    queryFn: () => fetchCastCityPriority(supabase, orgId),
  });
  const showsQ = useQuery({
    queryKey: ["shows", "for-priority-scope", orgId],
    queryFn: () => fetchShowOptions(supabase, orgId),
  });
  const today = toDateKey(new Date());
  const coverageInputsQ = useQuery({
    queryKey: ["eligibility", "ladder-coverage", orgId, today],
    queryFn: () => fetchLadderCoverageInputs(supabase, { orgId, today }),
  });

  useEffect(() => {
    const channel = supabase
      .channel("casts_coverage_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "cast_city_priority" }, () => {
        qc.invalidateQueries({ queryKey: ["cast-city-priority"] });
        qc.invalidateQueries({ queryKey: ["eligibility"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "show_cast_eligibility" }, () => {
        qc.invalidateQueries({ queryKey: ["eligibility"] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc]);

  const cities = useMemo(() => citiesQ.data ?? [], [citiesQ.data]);
  const casts = useMemo(() => castsQ.data ?? [], [castsQ.data]);
  const castCounts = useMemo(() => castCountsQ.data ?? {}, [castCountsQ.data]);
  const castsById = useMemo(() => new Map(casts.map((c) => [c.id, { id: c.id, name: c.name }])), [casts]);

  const orgPriorityRows = useMemo(() => orgPriorityQ.data ?? [], [orgPriorityQ.data]);
  const orgPriorities = useMemo(
    () => orgPriorityRows.map((r) => ({ cityId: r.city_id, castId: r.cast_id, priority: r.priority })),
    [orgPriorityRows],
  );

  const showsCountMap = useMemo(
    () => showsCountByCity(coverageInputsQ.data?.futurePairs ?? []),
    [coverageInputsQ.data],
  );
  const showOverrideCount = useMemo(
    () => distinctShowOverrideCount(coverageInputsQ.data?.showPriorities ?? []),
    [coverageInputsQ.data],
  );
  const castUsage = useMemo(() => castCityUsage(orgPriorities), [orgPriorities]);

  // Every show's override rows (not just the currently-selected one) — needed so a city's
  // delete guard also blocks on a per-show override that lives on a DIFFERENT show than
  // whichever is selected in the Per-show scope right now.
  const allShowPriorityRows = useMemo(
    () => coverageInputsQ.data?.showPriorities ?? [],
    [coverageInputsQ.data],
  );
  const cityReferences = useMemo(
    () =>
      buildCityReferences({
        cities,
        showsCountByCity: showsCountMap,
        orgPriorities,
        showPriorities: allShowPriorityRows,
      }),
    [cities, showsCountMap, orgPriorities, allShowPriorityRows],
  );

  const orgRows: CoverageCityRow[] = useMemo(
    () => buildCoverageRows({ cities, castsById, castCounts, priorities: orgPriorities, showsCountByCity: showsCountMap }),
    [cities, castsById, castCounts, orgPriorities, showsCountMap],
  );
  const kpis = useMemo(() => coverageKpis(orgRows, showOverrideCount), [orgRows, showOverrideCount]);

  const shows = showsQ.data ?? [];
  const effectiveShowId = selectedShowId ?? shows[0]?.id ?? null;
  const selectedShow = shows.find((s) => s.id === effectiveShowId) ?? null;

  const showPrioritiesQ = useQuery({
    queryKey: ["eligibility", "show-priorities", effectiveShowId],
    enabled: scope === "show" && !!effectiveShowId,
    queryFn: () => fetchShowPriorityRows(supabase, effectiveShowId!),
  });
  const showPriorityRows = useMemo(() => showPrioritiesQ.data ?? [], [showPrioritiesQ.data]);
  const showRows: CoverageCityRowWithSource[] = useMemo(
    () =>
      buildPerShowCoverageRows({
        cities,
        castsById,
        castCounts,
        orgPriorities,
        showPriorities: showPriorityRows.map((r) => ({ cityId: r.cityId, castId: r.castId, priority: r.priority })),
        showsCountByCity: showsCountMap,
      }),
    [cities, castsById, castCounts, orgPriorities, showPriorityRows, showsCountMap],
  );

  const invalidateShowConsumers = () => {
    qc.invalidateQueries({ queryKey: ["eligibility"] });
    qc.invalidateQueries({ queryKey: ["eligible-artists"] });
    qc.invalidateQueries({ queryKey: ["artist-eligible-dates"] });
    qc.invalidateQueries({ queryKey: ["offer-tiers"] });
  };

  const setOrgPriority = useMutation({
    mutationFn: (args: { cityId: string; castId: string; priority: number }) =>
      setCastCityPriority(supabase, { orgId, ...args }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cast-city-priority"] });
      qc.invalidateQueries({ queryKey: ["eligibility"] });
      toast.success(t('coverage.tierUpdated'));
    },
    onError: (e: Error) => toast.error(e.message ?? t('coverage.tierUpdateFailed')),
  });
  const clearOrgPriority = useMutation({
    mutationFn: (rowId: string) => clearCastCityPriority(supabase, rowId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cast-city-priority"] });
      qc.invalidateQueries({ queryKey: ["eligibility"] });
      toast.success(t('coverage.tierCleared'));
    },
    onError: (e: Error) => toast.error(e.message ?? t('coverage.tierClearFailed')),
  });

  const setShowPriority = useMutation({
    mutationFn: (args: { cityId: string; castId: string; priority: number }) => {
      if (!effectiveShowId) throw new Error(t('coverage.noShowSelected'));
      return setShowCastPriority(supabase, { showId: effectiveShowId, orgId, ...args });
    },
    onSuccess: () => { invalidateShowConsumers(); toast.success(t('coverage.tierUpdated')); },
    onError: (e: Error) => toast.error(t('coverage.tierUpdateFailed'), { description: e.message }),
  });
  const clearShowPriority = useMutation({
    mutationFn: (rowId: string) => clearShowCastPriority(supabase, rowId),
    onSuccess: () => { invalidateShowConsumers(); toast.success(t('coverage.tierCleared')); },
    onError: (e: Error) => toast.error(t('coverage.tierClearFailed'), { description: e.message }),
  });
  const clearAllOverrides = useMutation({
    mutationFn: async () => {
      // Independent deletes: run them concurrently and settle as a unit (Promise.all
      // rejects on the first failure) rather than one dependent round-trip at a time.
      await Promise.all(showPriorityRows.map((row) => clearShowCastPriority(supabase, row.id)));
    },
    onSuccess: () => { invalidateShowConsumers(); toast.success(t('coverage.overridesCleared')); },
    onError: (e: Error) => toast.error(t('coverage.overridesClearFailed'), { description: e.message }),
  });

  const addCity = useMutation({
    mutationFn: (name: string) => createCity(supabase, { name, orgId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cities"] });
      setNewCity("");
      toast.success(t('coverage.cityAdded'));
    },
    onError: (e: Error) => toast.error(e.message ?? t('coverage.cityAddFailed')),
  });

  const deleteCity = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cities").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cities"] }); toast.success(t('coverage.cityRemoved')); },
    onError: (e: Error) => toast.error(e.message ?? t('coverage.cityRemoveFailed')),
  });

  const renameCity = useMutation({
    mutationFn: (args: { id: string; name: string }) => updateCity(supabase, args.id, args.name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cities"] });
      setEditingCityId(null);
      setEditingCityName("");
      toast.success(t('coverage.cityRenamed'));
    },
    onError: (e: unknown) => {
      const err = e as { code?: string; message?: string };
      const isDuplicate =
        err.code === "23505" || /duplicate|unique/i.test(err.message ?? "");
      toast.error(isDuplicate ? t('coverage.cityRenameDuplicate') : (err.message ?? t('coverage.cityRenameFailed')));
    },
  });

  const startEditCity = (id: string, name: string) => {
    setEditingCityId(id);
    setEditingCityName(name);
  };
  const cancelEditCity = () => {
    setEditingCityId(null);
    setEditingCityName("");
  };
  const saveEditCity = (id: string, currentName: string) => {
    // Guard the Enter path (the Save button is already disabled while pending) so a fast
    // double Enter can't fire a second write before onSuccess closes the editor.
    if (renameCity.isPending) return;
    const next = editingCityName.trim();
    if (!next || next === currentName) {
      cancelEditCity();
      return;
    }
    renameCity.mutate({ id, name: next });
  };

  const castOptions = useMemo(
    () => casts.map((c) => ({ id: c.id, name: c.name, memberCount: castCounts[c.id] ?? 0 })),
    [casts, castCounts],
  );

  const overriddenCount = effectiveShowId
    ? overriddenCityCountForShow(effectiveShowId, coverageInputsQ.data?.showPriorities ?? [])
    : 0;
  const showName = selectedShow
    ? [selectedShow.program, selectedShow.sub_program].filter(Boolean).join(" / ")
    : t('coverage.thisShow');

  const isLoading =
    citiesQ.isLoading || castsQ.isLoading || castCountsQ.isLoading || orgPriorityQ.isLoading || coverageInputsQ.isLoading;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <SegmentedControl value={scope} onChange={(v) => setScope(v)} options={SCOPE_OPTIONS} />
        <p className="text-xs text-muted-foreground">
          {scope === "org"
            ? t('coverage.scopeHintOrg')
            : t('coverage.scopeHintShow')}
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : scope === "org" ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label={t('coverage.kpiCities')} value={kpis.cities} note={t('coverage.kpiCitiesNote')} />
            <KpiCard
              label={t('coverage.kpiOffersBlocked')}
              value={kpis.offersBlocked}
              note={t('coverage.kpiOffersBlockedNote')}
              tone={kpis.offersBlocked > 0 ? "red" : undefined}
            />
            <KpiCard
              label={t('coverage.kpiSingleTier')}
              value={kpis.singleTier}
              note={t('coverage.kpiSingleTierNote')}
              tone={kpis.singleTier > 0 ? "amber" : undefined}
            />
            <KpiCard label={t('coverage.kpiShowOverrides')} value={kpis.showOverrides} note={t('coverage.kpiShowOverridesNote')} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="font-display">{t('coverage.offerOrderTitle')}</CardTitle>
              <CardDescription>{t('coverage.offerOrderDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              {cities.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('coverage.addCityHint')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-separate border-spacing-y-1.5">
                    <thead>
                      {/* eslint-disable-next-line no-restricted-syntax -- table header row, non-standard tracking */}
                      <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <th className="w-40 px-2 py-1">{t('coverage.cityHeader')}</th>
                        {TIER_LABELS.map((label) => (
                          <th key={label} className="px-2 py-1">{label}</th>
                        ))}
                        <th className="w-32 px-2 py-1">{t('coverage.coverageHeader')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orgRows.map((row) => {
                        const { status, filledCount } = coverageStatus(row.tiers);
                        return (
                          <tr key={row.cityId}>
                            <td className="px-2 py-1 align-top">
                              <p className="text-sm font-medium text-foreground">{row.cityName}</p>
                              <p className="text-xs text-muted-foreground">
                                {t('coverage.showsCount', { count: row.showsCount })}
                              </p>
                            </td>
                            {row.tiers.map((slot, idx) => (
                              <td key={idx} className="px-2 py-1 align-top">
                                <TierCell
                                  tier={idx + 1}
                                  slot={slot}
                                  options={castOptions}
                                  disabled={!canManage}
                                  onSelect={(castId) => setOrgPriority.mutate({ cityId: row.cityId, castId, priority: idx + 1 })}
                                  onClear={() => {
                                    const existing = orgPriorityRows.find(
                                      (r) => r.city_id === row.cityId && r.priority === idx + 1,
                                    );
                                    if (existing) clearOrgPriority.mutate(existing.id);
                                  }}
                                />
                              </td>
                            ))}
                            <td className="px-2 py-1 align-top">
                              <CoverageStatusBadge status={status} filledCount={filledCount} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="font-display">{t('coverage.castsTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {casts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('coverage.noCastsYet')}</p>
                ) : (
                  casts.map((c) => {
                    const usage = castUsage.get(c.id) ?? 0;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => (onOpenCast ? onOpenCast(c.id) : setActiveCast(c))}
                        className="flex w-full items-center justify-between gap-2 rounded-field px-2 py-2 text-left text-sm hover:bg-[var(--surface-3)]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">{c.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {t('coverage.castMemberSummary', { count: castCounts[c.id] ?? 0 })} ·{" "}
                            {usage === 0 ? t('coverage.castUsageNone') : t('coverage.castUsage', { count: usage })}
                          </span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="font-display">{t('coverage.citiesTitle')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <form
                  className="mb-2 flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const name = newCity.trim();
                    if (name) addCity.mutate(name);
                  }}
                >
                  <Input
                    value={newCity}
                    onChange={(e) => setNewCity(e.target.value)}
                    placeholder={t('coverage.addCityPlaceholder')}
                    disabled={!canManage}
                    aria-label={t('coverage.addCityPlaceholder')}
                  />
                  <Button type="submit" size="sm" disabled={!canManage || !newCity.trim() || addCity.isPending}>
                    <Plus className="mr-1 h-4 w-4" />
                    {t('coverage.addCityButton')}
                  </Button>
                </form>
                {cities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('coverage.noCitiesYet')}</p>
                ) : (
                  cities.map((c) => {
                    const ref = cityReferences.get(c.id) ?? { showsCount: 0, orgTierCount: 0, overrideCount: 0 };
                    const referenced = isCityReferenced(ref);
                    const usageText =
                      ref.showsCount > 0
                        ? t('coverage.cityUsageShows', { count: ref.showsCount })
                        : ref.orgTierCount > 0
                          ? t('coverage.cityUsageOrder')
                          : ref.overrideCount > 0
                            ? t('coverage.cityUsageOverride')
                            : t('coverage.cityUsageNone');
                    const isEditing = editingCityId === c.id;
                    return (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 rounded-field px-2 py-2 text-sm"
                      >
                        {isEditing ? (
                          <>
                            <Input
                              value={editingCityName}
                              onChange={(e) => setEditingCityName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); saveEditCity(c.id, c.name); }
                                if (e.key === "Escape") { e.preventDefault(); cancelEditCity(); }
                              }}
                              autoFocus
                              className="h-8 flex-1"
                              aria-label={t('coverage.renameCity', { name: c.name })}
                            />
                            <IconTooltip label={t('coverage.saveCityName')}>
                              <button
                                type="button"
                                onClick={() => saveEditCity(c.id, c.name)}
                                disabled={renameCity.isPending}
                                aria-label={t('coverage.saveCityName')}
                                className="rounded p-1 text-muted-foreground hover:bg-hover-tint hover:text-foreground disabled:opacity-50 disabled:pointer-events-none"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                            </IconTooltip>
                            <IconTooltip label={t('coverage.cancelRename')}>
                              <button
                                type="button"
                                onClick={cancelEditCity}
                                aria-label={t('coverage.cancelRename')}
                                className="rounded p-1 text-muted-foreground hover:bg-hover-tint hover:text-foreground"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </IconTooltip>
                          </>
                        ) : (
                          <>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-foreground">{c.name}</span>
                              <span className="block text-xs text-muted-foreground">{usageText}</span>
                            </span>
                            {canManage && (
                              <IconTooltip label={t('coverage.renameCity', { name: c.name })}>
                                <button
                                  type="button"
                                  onClick={() => startEditCity(c.id, c.name)}
                                  aria-label={t('coverage.renameCity', { name: c.name })}
                                  className="rounded p-1 text-muted-foreground hover:bg-hover-tint hover:text-foreground"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                              </IconTooltip>
                            )}
                            <IconTooltip label={referenced ? t('coverage.removeCityReferenced') : t('coverage.removeCity', { name: c.name })}>
                              <button
                                type="button"
                                onClick={() => deleteCity.mutate(c.id)}
                                disabled={!canDeleteCity || referenced}
                                aria-label={t('coverage.removeCity', { name: c.name })}
                                className="rounded p-1 text-muted-foreground hover:bg-hover-tint hover:text-destructive disabled:opacity-50 disabled:pointer-events-none"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </IconTooltip>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[220px_1fr]">
          <Card>
            <CardHeader>
              {/* eslint-disable-next-line no-restricted-syntax -- CardTitle label, non-standard tracking */}
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('coverage.showsTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {shows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('coverage.noShowsYet')}</p>
              ) : (
                shows.map((s) => {
                  const name = [s.program, s.sub_program].filter(Boolean).join(" / ");
                  const overrides = overriddenCityCountForShow(s.id, coverageInputsQ.data?.showPriorities ?? []);
                  const selected = s.id === effectiveShowId;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSelectedShowId(s.id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-field px-2 py-2 text-left text-sm",
                        selected ? "bg-[var(--surface-3)] font-medium text-foreground" : "text-muted-foreground hover:bg-[var(--surface-3)]",
                      )}
                    >
                      <span className="truncate">{name}</span>
                      {overrides > 0 && (
                        <Badge variant="accent" className="shrink-0">{overrides}</Badge>
                      )}
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>

          <div className="space-y-4">
            {effectiveShowId && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-card p-3">
                <p className="text-sm text-muted-foreground">
                  {overriddenCount === 0
                    ? t('coverage.followsDefault', { show: showName, count: cities.length })
                    : t('coverage.overridesSummary', { show: showName, overrides: overriddenCount, total: cities.length })}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canManage || overriddenCount === 0 || clearAllOverrides.isPending}
                  onClick={() => clearAllOverrides.mutate()}
                >
                  {t('coverage.clearAllOverrides')}
                </Button>
              </div>
            )}

            <Card>
              <CardContent>
                {!effectiveShowId ? (
                  <p className="text-sm text-muted-foreground">{t('coverage.selectShowHint')}</p>
                ) : cities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('coverage.addCitiesFirstHint')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] border-separate border-spacing-y-1.5">
                      <thead>
                        {/* eslint-disable-next-line no-restricted-syntax -- table header row, non-standard tracking */}
                        <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <th className="w-40 px-2 py-1">{t('coverage.cityHeader')}</th>
                          {TIER_LABELS.map((label) => (
                            <th key={label} className="px-2 py-1">{label}</th>
                          ))}
                          <th className="w-28 px-2 py-1">{t('coverage.sourceHeader')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {showRows.map((row) => (
                          <tr key={row.cityId}>
                            <td className="px-2 py-1 align-top">
                              <p className="text-sm font-medium text-foreground">{row.cityName}</p>
                            </td>
                            {row.tiers.map((slot, idx) => {
                              const overrideRow = showPriorityRows.find(
                                (r) => r.cityId === row.cityId && r.priority === idx + 1,
                              );
                              return (
                                <td key={idx} className="px-2 py-1 align-top">
                                  <TierCell
                                    tier={idx + 1}
                                    slot={slot}
                                    options={castOptions}
                                    disabled={!canManage}
                                    onSelect={(castId) => setShowPriority.mutate({ cityId: row.cityId, castId, priority: idx + 1 })}
                                    onClear={overrideRow ? () => clearShowPriority.mutate(overrideRow.id) : undefined}
                                  />
                                </td>
                              );
                            })}
                            <td className="px-2 py-1 align-top">
                              <Badge variant={row.source === "override" ? "accent" : "neutral"}>
                                {row.source === "override" ? t('coverage.sourceOverride') : t('coverage.sourceOrgDefault')}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {!onOpenCast && activeCast && (
        <CastDetailsSheet
          cast={activeCast}
          open
          onOpenChange={(open) => { if (!open) setActiveCast(null); }}
        />
      )}
    </div>
  );
}

function KpiCard({ label, value, note, tone }: { label: string; value: number; note: string; tone?: "red" | "amber" }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        {/* eslint-disable-next-line no-restricted-syntax -- non-standard tracking (1.2px) */}
        <p className="text-eyebrow font-semibold uppercase tracking-[1.2px] text-muted-foreground">{label}</p>
        <p
          className={cn(
            "font-mono text-2xl font-semibold tabular-nums",
            tone === "red" ? "text-[var(--red-600)]" : tone === "amber" ? "text-[var(--amber-600)]" : "text-foreground",
          )}
        >
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{note}</p>
      </CardContent>
    </Card>
  );
}

function CoverageStatusBadge({ status, filledCount }: { status: "blocked" | "single" | "ready"; filledCount: number }) {
  const { t } = useTranslation('settingsCastsCoverage');
  if (status === "blocked") return <Badge variant="destructive">{t('coverage.statusBlocked')}</Badge>;
  if (status === "single") return <Badge variant="risk">{t('coverage.statusSingle')}</Badge>;
  return <Badge variant="confirmed">{t('coverage.statusReady', { count: filledCount })}</Badge>;
}
