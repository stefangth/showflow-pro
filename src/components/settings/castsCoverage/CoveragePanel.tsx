import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { IconTooltip } from "@/components/common/IconTooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Trash2, ChevronRight } from "lucide-react";
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

const TIER_LABELS = Array.from({ length: COVERAGE_TIER_COUNT }, (_, i) => `Tier ${i + 1}`);

const SCOPE_OPTIONS: SegmentedControlOption<CoverageScope>[] = [
  { value: "org", label: "Organization default" },
  { value: "show", label: "Per show" },
];

/** Settings → Casts & coverage → Coverage. Org-default offer order by city, with a
 *  per-show override view. Writes through `setCastCityPriority` / `clearCastCityPriority`
 *  (src/data/casts.ts) for the org default and the pre-existing `setShowCastPriority` /
 *  `clearShowCastPriority` (src/data/eligibility.ts) for per-show overrides. Unlike the
 *  legacy CastsCitiesTab's bare `.insert()` (which only ever adds a brand-new assignment),
 *  `setCastCityPriority` also resolves cast_city_priority's two UNIQUE constraints when a
 *  cell already has an occupant — moving/bumping rows as needed — so the two write paths
 *  are not interchangeable. */
export function CoveragePanel({ orgId, onOpenCast }: CoveragePanelProps) {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const canManage = useCan("manage_cities");
  const canDeleteCity = hasRole("admin");

  const [scope, setScope] = useState<CoverageScope>("org");
  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);

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
      toast.success("Tier updated");
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to update tier"),
  });
  const clearOrgPriority = useMutation({
    mutationFn: (rowId: string) => clearCastCityPriority(supabase, rowId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cast-city-priority"] });
      qc.invalidateQueries({ queryKey: ["eligibility"] });
      toast.success("Tier cleared");
    },
    onError: (e: Error) => toast.error(e.message ?? "Failed to clear tier"),
  });

  const setShowPriority = useMutation({
    mutationFn: (args: { cityId: string; castId: string; priority: number }) => {
      if (!effectiveShowId) throw new Error("No show selected");
      return setShowCastPriority(supabase, { showId: effectiveShowId, orgId, ...args });
    },
    onSuccess: () => { invalidateShowConsumers(); toast.success("Tier updated"); },
    onError: (e: Error) => toast.error("Failed to update tier", { description: e.message }),
  });
  const clearShowPriority = useMutation({
    mutationFn: (rowId: string) => clearShowCastPriority(supabase, rowId),
    onSuccess: () => { invalidateShowConsumers(); toast.success("Tier cleared"); },
    onError: (e: Error) => toast.error("Failed to clear tier", { description: e.message }),
  });
  const clearAllOverrides = useMutation({
    mutationFn: async () => {
      for (const row of showPriorityRows) await clearShowCastPriority(supabase, row.id);
    },
    onSuccess: () => { invalidateShowConsumers(); toast.success("Overrides cleared"); },
    onError: (e: Error) => toast.error("Failed to clear overrides", { description: e.message }),
  });

  const deleteCity = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cities").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cities"] }); toast.success("City removed"); },
    onError: (e: Error) => toast.error(e.message ?? "Failed to remove city"),
  });

  const castOptions = useMemo(
    () => casts.map((c) => ({ id: c.id, name: c.name, memberCount: castCounts[c.id] ?? 0 })),
    [casts, castCounts],
  );

  const overriddenCount = effectiveShowId
    ? overriddenCityCountForShow(effectiveShowId, coverageInputsQ.data?.showPriorities ?? [])
    : 0;
  const showName = selectedShow
    ? [selectedShow.program, selectedShow.sub_program].filter(Boolean).join(" / ")
    : "This show";

  const isLoading =
    citiesQ.isLoading || castsQ.isLoading || castCountsQ.isLoading || orgPriorityQ.isLoading || coverageInputsQ.isLoading;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <SegmentedControl value={scope} onChange={(v) => setScope(v)} options={SCOPE_OPTIONS} />
        <p className="text-xs text-muted-foreground">
          {scope === "org"
            ? "Every show follows this order unless it has an override."
            : "Overrides replace the org order for one show only."}
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : scope === "org" ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="CITIES" value={kpis.cities} note="in this organization" />
            <KpiCard
              label="OFFERS BLOCKED"
              value={kpis.offersBlocked}
              note="no Tier 1 assigned"
              tone={kpis.offersBlocked > 0 ? "red" : undefined}
            />
            <KpiCard
              label="SINGLE TIER"
              value={kpis.singleTier}
              note="no fallback cast"
              tone={kpis.singleTier > 0 ? "amber" : undefined}
            />
            <KpiCard label="SHOW OVERRIDES" value={kpis.showOverrides} note="shows with an override" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="font-display">Offer order by city</CardTitle>
              <CardDescription>Pick a cast per slot. An empty slot stops the walk.</CardDescription>
            </CardHeader>
            <CardContent>
              {cities.length === 0 ? (
                <p className="text-sm text-muted-foreground">Add a city below to configure coverage.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-separate border-spacing-y-1.5">
                    <thead>
                      <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <th className="w-40 px-2 py-1">City</th>
                        {TIER_LABELS.map((label) => (
                          <th key={label} className="px-2 py-1">{label}</th>
                        ))}
                        <th className="w-32 px-2 py-1">Coverage</th>
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
                                {row.showsCount} show{row.showsCount === 1 ? "" : "s"}
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
                <CardTitle className="font-display">Casts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {casts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No casts yet.</p>
                ) : (
                  casts.map((c) => {
                    const usage = castUsage.get(c.id) ?? 0;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => onOpenCast?.(c.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-[var(--radius-s)] px-2 py-2 text-left text-sm hover:bg-[var(--surface-3)]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">{c.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {castCounts[c.id] ?? 0} member{(castCounts[c.id] ?? 0) === 1 ? "" : "s"} ·{" "}
                            {usage === 0 ? "not in any city" : `${usage} cit${usage === 1 ? "y" : "ies"}`}
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
                <CardTitle className="font-display">Cities</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {cities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No cities yet.</p>
                ) : (
                  cities.map((c) => {
                    const ref = cityReferences.get(c.id) ?? { showsCount: 0, orgTierCount: 0, overrideCount: 0 };
                    const referenced = isCityReferenced(ref);
                    const usageText =
                      ref.showsCount > 0
                        ? `${ref.showsCount} show${ref.showsCount === 1 ? "" : "s"}`
                        : ref.orgTierCount > 0
                          ? "used in the offer order"
                          : ref.overrideCount > 0
                            ? "used in a show override"
                            : "not used yet";
                    return (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-2 rounded-[var(--radius-s)] px-2 py-2 text-sm"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">{c.name}</span>
                          <span className="block text-xs text-muted-foreground">{usageText}</span>
                        </span>
                        <IconTooltip label={referenced ? "Still referenced — remove its tiers first" : `Remove ${c.name}`}>
                          <button
                            type="button"
                            onClick={() => deleteCity.mutate(c.id)}
                            disabled={!canDeleteCity || referenced}
                            aria-label={`Remove ${c.name}`}
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50 disabled:pointer-events-none"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </IconTooltip>
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
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Shows
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {shows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No shows yet.</p>
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
                        "flex w-full items-center justify-between gap-2 rounded-[var(--radius-s)] px-2 py-2 text-left text-sm",
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
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-l)] border border-border bg-card p-3">
                <p className="text-sm text-muted-foreground">
                  {overriddenCount === 0
                    ? `${showName} follows the organization default in all ${cities.length} cities.`
                    : `${showName} overrides ${overriddenCount} of ${cities.length} cities. The rest follow the organization default.`}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canManage || overriddenCount === 0 || clearAllOverrides.isPending}
                  onClick={() => clearAllOverrides.mutate()}
                >
                  Clear all overrides
                </Button>
              </div>
            )}

            <Card>
              <CardContent className="pt-4">
                {!effectiveShowId ? (
                  <p className="text-sm text-muted-foreground">Select a show to view its coverage.</p>
                ) : cities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Add cities in the organization-default view first.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] border-separate border-spacing-y-1.5">
                      <thead>
                        <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          <th className="w-40 px-2 py-1">City</th>
                          {TIER_LABELS.map((label) => (
                            <th key={label} className="px-2 py-1">{label}</th>
                          ))}
                          <th className="w-28 px-2 py-1">Source</th>
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
                                {row.source === "override" ? "Override" : "Org default"}
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
    </div>
  );
}

function KpiCard({ label, value, note, tone }: { label: string; value: number; note: string; tone?: "red" | "amber" }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-muted-foreground">{label}</p>
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
  if (status === "blocked") return <Badge variant="destructive">Offers blocked</Badge>;
  if (status === "single") return <Badge variant="risk">Single tier</Badge>;
  return <Badge variant="confirmed">{filledCount} tiers ready</Badge>;
}
