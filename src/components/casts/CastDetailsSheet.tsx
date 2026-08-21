import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchCastMembers, fetchCastEligibility, updateCast as updateCastRow,
  addCastMember, removeCastMember, setCastEligibility, clearCastEligibility,
  fetchCastCityPriority,
} from '@/data/casts';
import { fetchArtists } from '@/data/artists';
import { fetchShowsForEligibility } from '@/data/shows';
import { fetchSkillsByArtist } from '@/data/skills';
import { fetchUpcomingConfirmedDateCounts } from '@/data/bookings';
import { useAuth } from '@/features/auth/AuthContext';
import { useCan } from '@/hooks/useCapabilities';
import { useEditorConfig } from '@/features/editor/EditorContext';
import { ROUTES } from '@/config/app.config';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { IconTooltip } from '@/components/common/IconTooltip';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Search, X, Plus, Pencil, Check } from 'lucide-react';
import type { Cast } from '@/types';
import { showIdentityLabel } from '@/types';
import { useAllCities } from '@/hooks/useAllCities';
import { getAvatarTone } from '@/lib/avatar';
import { formatTimestampDMY, toDateKey } from '@/lib/dates';

interface Props {
  cast: Cast | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArtistClick?: (artistId: string) => void;
}

/** Up-to-two-letter uppercase initials from a name. */
function initialsOf(name: string, fallback = 'C'): string {
  const parts = name.split(/\s+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((w) => w[0]).join('');
  return letters ? letters.toUpperCase() : fallback;
}

export function CastDetailsSheet({ cast, open, onOpenChange, onArtistClick }: Props) {
  const { t } = useTranslation('showsDetail');
  const { roles, currentOrg } = useAuth();
  const { isEditorMode } = useEditorConfig();
  const isRealAdmin = roles.includes('admin');
  const canManage = useCan('manage_casts');
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const updateCast = useMutation({
    mutationFn: ({ name, description }: { name: string; description: string }) =>
      updateCastRow(supabase, cast!.id, { name, description: description || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['casts'] });
      setEditMode(false);
      toast.success(t('castDetails.toast.castUpdated'));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function startEdit() {
    setEditName(cast?.name ?? '');
    setEditDescription(cast?.description ?? '');
    setEditMode(true);
  }

  function cancelEdit() {
    setEditMode(false);
  }

  function focusAddArtist() {
    searchRef.current?.scrollIntoView({ block: 'center' });
    searchRef.current?.focus();
  }

  // Members
  const { data: members } = useQuery({
    queryKey: ['cast-members', cast?.id],
    enabled: !!cast,
    queryFn: () => fetchCastMembers(supabase, cast?.id ?? null),
  });

  const { data: artists } = useQuery({
    queryKey: ['artists', 'list', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchArtists(supabase, currentOrg?.id ?? null),
  });

  // Primary skill chip per artist. Shares ArtistsPage's cache key: both fetch the same
  // org-wide artist_skills map, so opening a cast sheet after the Artists page (or vice
  // versa) reuses the cached result instead of re-fetching.
  const { data: skillsByArtist } = useQuery({
    queryKey: ['artist-skills', 'all', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchSkillsByArtist(supabase, currentOrg?.id ?? null),
  });

  const memberArtistIds = useMemo(() => (members ?? []).map((m) => m.artist_id), [members]);

  // Real "N dates" per member + the distinct-dates KPI: confirmed, upcoming bookings.
  // `today` is derived once at render; the query re-runs when the member set changes.
  const todayKey = toDateKey(new Date());
  const { data: upcomingDates } = useQuery({
    queryKey: ['bookings', 'upcoming-confirmed-dates', cast?.id, memberArtistIds, todayKey],
    enabled: !!currentOrg && memberArtistIds.length > 0,
    queryFn: () => fetchUpcomingConfirmedDateCounts(supabase, currentOrg?.id ?? null, memberArtistIds, todayKey),
  });
  const bookingCounts = upcomingDates?.perArtist;

  // Eligibility (cities × shows)
  const { data: cities } = useAllCities();

  const { data: shows } = useQuery({
    queryKey: ['shows', 'for-eligibility', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchShowsForEligibility(supabase, currentOrg?.id ?? null),
  });

  const { data: eligibility } = useQuery({
    queryKey: ['cast-eligibility', cast?.id],
    enabled: !!cast,
    queryFn: () => fetchCastEligibility(supabase, cast?.id ?? null),
  });

  // Offer order (org-default cast_city_priority). Read-only here: the same rows are
  // edited on Settings → Casts & coverage, which owns the UNIQUE(cast,city)/
  // UNIQUE(city,priority) swap semantics. This surface only reads where THIS cast lands
  // per city (the tier badge on each city-coverage row) and links out to change it.
  const { data: castCityPriorities } = useQuery({
    queryKey: ['cast-city-priority', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchCastCityPriority(supabase, currentOrg?.id ?? null),
  });

  // key: `${cityId}:${showId}` → row id
  const eligibilityMap = useMemo(() => {
    const map = new Map<string, string>();
    (eligibility ?? []).forEach((r) => map.set(`${r.city_id}:${r.show_id}`, r.id));
    return map;
  }, [eligibility]);

  const memberIds = useMemo(() => new Set((members ?? []).map((m) => m.artist_id)), [members]);

  // Tier (priority) this cast holds per city, org default.
  const tierByCity = useMemo(() => {
    const map = new Map<string, number>();
    (castCityPriorities ?? [])
      .filter((r) => r.cast_id === cast?.id)
      .forEach((r) => map.set(r.city_id, r.priority));
    return map;
  }, [castCityPriorities, cast?.id]);

  // Cities (in the org's list) this cast is eligible for at least one show in.
  const eligibleCityIds = useMemo(() => {
    const cityIdSet = new Set((cities ?? []).map((c) => c.id));
    const s = new Set<string>();
    (eligibility ?? []).forEach((r) => { if (cityIdSet.has(r.city_id)) s.add(r.city_id); });
    return s;
  }, [eligibility, cities]);

  const showsCovered = useMemo(() => new Set((eligibility ?? []).map((r) => r.show_id)).size, [eligibility]);

  // Coverage gaps: eligible somewhere but never placed in a tier → never offered there.
  const coverageGapCities = useMemo(
    // Wait for the priority query before reporting gaps: eligibility and
    // castCityPriorities are independent queries, so if eligibility lands first
    // tierByCity is momentarily empty and every eligible city would flash as a gap.
    () => (castCityPriorities === undefined
      ? []
      : (cities ?? []).filter((c) => eligibleCityIds.has(c.id) && !tierByCity.has(c.id))),
    [cities, eligibleCityIds, tierByCity, castCityPriorities],
  );

  const tier1Count = useMemo(
    () => Array.from(tierByCity.values()).filter((p) => p === 1).length,
    [tierByCity],
  );

  // Distinct upcoming dates the cast covers (deduped across members), not a per-member sum.
  const upcomingDatesTotal = upcomingDates?.distinctDates ?? 0;

  const memberCount = members?.length ?? 0;
  const cityCount = cities?.length ?? 0;

  const kpis = [
    { label: t('castDetails.kpi.members'), value: String(memberCount) },
    { label: t('castDetails.kpi.citiesEligible'), value: `${eligibleCityIds.size} / ${cityCount}` },
    { label: t('castDetails.kpi.tier1Cities'), value: String(tier1Count) },
    { label: t('castDetails.kpi.upcomingDates'), value: String(upcomingDatesTotal) },
  ];

  const facts = useMemo(() => {
    if (!cast) return [] as { label: string; value: string }[];
    return [
      { label: t('castDetails.fact.created'), value: formatTimestampDMY(cast.created_at) },
      { label: t('castDetails.fact.updated'), value: formatTimestampDMY(cast.updated_at) },
      { label: t('castDetails.fact.showsCovered'), value: String(showsCovered) },
      { label: t('castDetails.fact.coverageGaps'), value: String(coverageGapCities.length) },
    ];
  }, [cast, showsCovered, coverageGapCities.length, t]);

  // Activity feed derived from real timestamps (no synthetic events): cast created,
  // an optional "details updated" when updated_at meaningfully post-dates created_at,
  // and one entry per member added. Newest first, capped.
  const activity = useMemo(() => {
    if (!cast) return [] as { text: string; when: string }[];
    const evs: { text: string; whenIso: string }[] = [
      { text: t('castDetails.activity.castCreated'), whenIso: cast.created_at },
    ];
    if (cast.updated_at && new Date(cast.updated_at).getTime() - new Date(cast.created_at).getTime() > 60_000) {
      evs.push({ text: t('castDetails.activity.castUpdated'), whenIso: cast.updated_at });
    }
    (members ?? []).forEach((m) =>
      evs.push({ text: t('castDetails.activity.memberAdded', { name: m.artist.name }), whenIso: m.created_at }),
    );
    return evs
      .sort((a, b) => new Date(b.whenIso).getTime() - new Date(a.whenIso).getTime())
      .slice(0, 6)
      .map((e) => ({ text: e.text, when: formatTimestampDMY(e.whenIso) }));
  }, [cast, members, t]);

  const addMember = useMutation({
    mutationFn: (artistId: string) => {
      if (!currentOrg) throw new Error(t('castDetails.toast.noActiveOrg'));
      return addCastMember(supabase, currentOrg.id, { castId: cast!.id, artistId });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cast-members', cast?.id] });
      qc.invalidateQueries({ queryKey: ['cast-members-counts'] });
      qc.invalidateQueries({ queryKey: ['artist-casts'] });
      qc.invalidateQueries({ queryKey: ['eligible-artists'] });
      qc.invalidateQueries({ queryKey: ['artist-eligible-dates'] });
      toast.success(t('castDetails.toast.artistAddedToCast'));
    },
    onError: (e: Error) => toast.error(t('castDetails.toast.failedAddArtist'), { description: e.message }),
  });

  const removeMember = useMutation({
    mutationFn: (memberId: string) => removeCastMember(supabase, memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cast-members', cast?.id] });
      qc.invalidateQueries({ queryKey: ['cast-members-counts'] });
      qc.invalidateQueries({ queryKey: ['artist-casts'] });
      qc.invalidateQueries({ queryKey: ['eligible-artists'] });
      qc.invalidateQueries({ queryKey: ['artist-eligible-dates'] });
      toast.success(t('castDetails.toast.artistRemovedFromCast'));
    },
    onError: (e: Error) => toast.error(t('castDetails.toast.failedRemoveArtist'), { description: e.message }),
  });

  const toggleEligibility = useMutation({
    mutationFn: async ({ cityId, showId, on }: { cityId: string; showId: string; on: boolean }) => {
      if (!currentOrg) throw new Error(t('castDetails.toast.noActiveOrg'));
      if (on) {
        await setCastEligibility(supabase, currentOrg.id, { castId: cast!.id, showId, cityId });
        return;
      }
      const rowId = eligibilityMap.get(`${cityId}:${showId}`);
      if (!rowId) return;
      await clearCastEligibility(supabase, rowId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cast-eligibility', cast?.id] });
      qc.invalidateQueries({ queryKey: ['eligible-artists'] });
      qc.invalidateQueries({ queryKey: ['artist-eligible-dates'] });
      toast.success(t('castDetails.toast.eligibilityUpdated'));
    },
    onError: (e: Error) => toast.error(t('castDetails.toast.failedUpdateEligibility'), { description: e.message }),
  });

  const candidateQuery = search.trim().toLowerCase();
  const candidates = (artists ?? []).filter((a) =>
    !memberIds.has(a.id) &&
    (candidateQuery === '' || a.name.toLowerCase().includes(candidateQuery)),
  );

  const eyebrow = `${t('castDetails.eyebrow')} · ${currentOrg?.name ?? ''}`.replace(/ · $/, '');

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="flex h-full w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-[1040px] [&>button]:hidden"
      >
        {/* ── Header ── */}
        <SheetHeader className="shrink-0 space-y-0 border-b border-border p-6 text-left">
          {/* One row: identity (or edit form) on the left, actions on the right. The
              close control lives in this cluster and renders in BOTH modes, so editing
              never leaves the sheet without a visible way out. */}
          <div className="flex items-start gap-3.5">
            {editMode ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (editName.trim()) updateCast.mutate({ name: editName.trim(), description: editDescription.trim() });
                }}
                className="min-w-0 flex-1 space-y-2"
              >
                <SheetTitle className="sr-only">{cast?.name}</SheetTitle>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder={t('castDetails.castNamePlaceholder')}
                  required
                  autoFocus
                  className="font-display text-lg font-semibold"
                />
                <Textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder={t('castDetails.descriptionOptional')}
                  rows={2}
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm" disabled={updateCast.isPending || !editName.trim()}>
                    <Check className="mr-1 h-4 w-4" />{updateCast.isPending ? t('castDetails.saving') : t('castDetails.save')}
                  </Button>
                  <Button type="button" size="sm" variant="secondary" onClick={cancelEdit} disabled={updateCast.isPending}>
                    {t('castDetails.cancel')}
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <span
                  aria-hidden
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-l bg-accent-100 font-mono text-[15px] font-semibold text-accent-700"
                >
                  {initialsOf(cast?.name ?? '')}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold uppercase tracking-[1.6px] text-accent-600">{eyebrow}</p>
                  <SheetTitle className="mt-0.5 font-display text-[22px] font-semibold tracking-[-0.3px] text-foreground">
                    {cast?.name}
                  </SheetTitle>
                  <SheetDescription className="mt-1 text-sm leading-5 text-muted-foreground">
                    {cast?.description || t('castDetails.manageDefault')}
                  </SheetDescription>
                </div>
              </>
            )}
            <div className="flex shrink-0 items-center gap-2">
              {!editMode && canManage && (
                <Button size="sm" variant="outline" className="h-9 shadow-elev1" onClick={startEdit}>
                  <Pencil className="mr-1.5 h-4 w-4" />{t('castDetails.editCast')}
                </Button>
              )}
              {!editMode && canManage && (
                <Button size="sm" className="h-9 shadow-elev1" onClick={focusAddArtist}>
                  <Plus className="mr-1.5 h-4 w-4" />{t('castDetails.addArtists')}
                </Button>
              )}
              <SheetClose asChild>
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" aria-label={t('castDetails.close')}>
                  <X className="h-[18px] w-[18px]" />
                </Button>
              </SheetClose>
            </div>
          </div>

          {/* KPI rail */}
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {kpis.map((k) => (
              <div key={k.label} className="rounded-l border border-border bg-muted px-3.5 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">{k.label}</p>
                <p className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-foreground">{k.value}</p>
              </div>
            ))}
          </div>

          {isEditorMode && isRealAdmin && (
            <Badge variant="outline" className="mt-3 w-fit font-mono text-xs text-muted-foreground">
              CastDetailsSheet.tsx
            </Badge>
          )}
        </SheetHeader>

        {/* ── Body: main column + at-a-glance rail ── */}
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-5 lg:p-6">
            {/* Coverage-gap banner */}
            {coverageGapCities.length > 0 && (
              <div
                data-coverage-gap
                className="flex items-center gap-3 rounded-m border border-border bg-[var(--amber-100)] px-3 py-2.5"
              >
                <span className="inline-flex h-5 shrink-0 items-center rounded-xs bg-card px-1.5 text-[11px] font-medium text-[var(--amber-600)]">
                  {t('castDetails.coverageGap.badge')}
                </span>
                <p className="flex-1 text-[13px] text-[var(--amber-600)]">
                  {t('castDetails.coverageGap.text', { cities: coverageGapCities.map((c) => c.name).join(', ') })}
                </p>
                <Link
                  to={`${ROUTES.SETTINGS}?tab=casts-coverage`}
                  className="whitespace-nowrap text-[13px] font-medium text-accent-600 underline"
                >
                  {t('castDetails.coverageGap.setTier')}
                </Link>
              </div>
            )}

            {/* Roster */}
            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <h4 className="text-sm font-semibold text-foreground">{t('castDetails.roster.title')}</h4>
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {t('castDetails.roster.count', { count: memberCount })}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {(members ?? []).map((m) => {
                  const tone = getAvatarTone(m.artist_id || m.artist.name);
                  // Deterministic "primary" skill: alphabetically first, since
                  // fetchSkillsByArtist returns skills in unsorted DB row order.
                  const skill = (skillsByArtist?.get(m.artist_id) ?? [])
                    .map((s) => s.name)
                    .sort((a, b) => a.localeCompare(b))[0];
                  const dates = bookingCounts?.get(m.artist_id) ?? 0;
                  return (
                    <div key={m.id} className="flex h-10 items-center gap-2.5 rounded-m border border-border bg-card px-2">
                      <span
                        aria-hidden
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-[11px] font-semibold"
                        style={{ background: tone.bg, color: tone.text }}
                      >
                        {initialsOf(m.artist.name, '?').slice(0, 1)}
                      </span>
                      <button
                        type="button"
                        onClick={() => onArtistClick?.(m.artist_id)}
                        className="truncate text-left text-[13px] font-medium text-foreground hover:underline disabled:cursor-default disabled:no-underline"
                        disabled={!onArtistClick}
                      >
                        {m.artist.name}
                      </button>
                      {skill && (
                        <span className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-xs bg-accent-100 px-1.5 text-[11px] font-medium text-accent-700">
                          {skill}
                        </span>
                      )}
                      <span className="flex-1" />
                      <span className="whitespace-nowrap font-mono text-[11px] tabular-nums text-[color:var(--text-faint)]">
                        {t('castDetails.roster.dates', { count: dates })}
                      </span>
                      <IconTooltip label={t('castDetails.removeMember', { name: m.artist.name })}>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          aria-label={t('castDetails.removeMember', { name: m.artist.name })}
                          onClick={() => removeMember.mutate(m.id)}
                          disabled={!canManage}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </IconTooltip>
                    </div>
                  );
                })}
              </div>
              {memberCount === 0 && <p className="mt-1 text-xs text-muted-foreground">{t('castDetails.noMembers')}</p>}

              {/* Inline add: search reveals candidates; Enter adds the first. */}
              <div className="mt-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={searchRef}
                    className="h-9 pl-9"
                    placeholder={t('castDetails.roster.searchPlaceholder')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      // Gate on a non-empty query (same condition as the visible
                      // candidate dropdown): with an empty box every non-member is a
                      // "candidate", so a reflexive Enter would silently add an
                      // arbitrary artist — reachable via the "Add artists" button,
                      // which focuses this input while it is still empty.
                      if (e.key === 'Enter' && canManage && candidateQuery !== '' && candidates[0]) {
                        e.preventDefault();
                        addMember.mutate(candidates[0].id);
                        setSearch('');
                      }
                    }}
                  />
                </div>
                {search.trim() !== '' && (
                  <div className="mt-1.5 max-h-[30vh] space-y-1 overflow-y-auto">
                    {candidates.map((a) => (
                      <div
                        key={a.id}
                        data-candidate
                        className="flex items-center justify-between rounded-m px-2 py-1.5 hover:bg-muted"
                      >
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-foreground">{a.name}</p>
                          <Badge variant="outline" className="text-xs">{a.status}</Badge>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => { addMember.mutate(a.id); }}
                          disabled={!canManage}
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    {candidates.length === 0 && <p className="px-2 text-xs text-muted-foreground">{t('castDetails.noMatches')}</p>}
                  </div>
                )}
              </div>
            </section>

            {/* City coverage */}
            <section>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h4 className="text-sm font-semibold text-foreground">{t('castDetails.coverage.title')}</h4>
                <span className="text-xs text-muted-foreground">{t('castDetails.coverage.hint')}</span>
              </div>

              {cityCount === 0 && <p className="text-sm text-muted-foreground">{t('castDetails.addCitiesFirst')}</p>}
              {cityCount > 0 && (shows ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">{t('castDetails.noShows')}</p>
              )}

              {cityCount > 0 && (shows ?? []).length > 0 && (
                <div className="flex flex-col gap-1">
                  {(cities ?? []).map((city) => {
                    const tier = tierByCity.get(city.id) ?? null;
                    return (
                      <div
                        key={city.id}
                        data-city-row
                        className="flex flex-wrap items-center gap-3 rounded-m border border-border px-2.5 py-2"
                      >
                        <span className="w-24 shrink-0 text-[13px] font-medium text-foreground">{city.name}</span>
                        <span
                          className={cn(
                            'inline-flex h-5 shrink-0 items-center rounded-xs border px-1.5 text-[11px] font-medium',
                            tier === 1
                              ? 'border-accent-200 bg-accent-100 text-accent-700'
                              : 'border-border bg-muted text-muted-foreground',
                          )}
                        >
                          {tier != null ? t('castDetails.tierN', { tier }) : t('castDetails.coverage.noTier')}
                        </span>
                        <div className="flex flex-1 flex-wrap gap-1.5">
                          {(shows ?? []).map((s) => {
                            const on = eligibilityMap.has(`${city.id}:${s.id}`);
                            return (
                              <button
                                key={s.id}
                                type="button"
                                aria-pressed={on}
                                disabled={!canManage}
                                onClick={() => toggleEligibility.mutate({ cityId: city.id, showId: s.id, on: !on })}
                                className={cn(
                                  'inline-flex h-6 items-center gap-1.5 rounded-s border px-2 text-xs font-medium transition-colors',
                                  on
                                    ? 'border-accent-200 bg-accent-50 text-accent-700'
                                    : 'border-border bg-muted text-muted-foreground',
                                  canManage ? 'hover:border-accent-300' : 'cursor-default',
                                )}
                              >
                                {on && <Check className="h-3 w-3" />}
                                {showIdentityLabel(s)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <Link to={`${ROUTES.SETTINGS}?tab=casts-coverage`} className="mt-3 inline-block text-xs text-primary underline">
                {t('castDetails.manageOfferOrderLink')}
              </Link>
            </section>
          </div>

          {/* At-a-glance + Activity rail */}
          <aside className="flex shrink-0 flex-col gap-5 overflow-y-auto border-t border-border bg-muted p-5 lg:w-[264px] lg:border-l lg:border-t-0">
            <div>
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
                {t('castDetails.rail.atAGlance')}
              </h3>
              <div className="flex flex-col gap-3">
                {facts.map((f) => (
                  <div key={f.label} className="flex items-baseline justify-between gap-3">
                    <span className="text-[13px] text-muted-foreground">{f.label}</span>
                    <span className="text-right text-[13px] text-foreground">{f.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-border pt-4">
              <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[1.6px] text-muted-foreground">
                {t('castDetails.rail.activity')}
              </h3>
              {activity.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('castDetails.activity.empty')}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {activity.map((a, i) => (
                    <div key={`${a.text}-${i}`}>
                      <p className="text-[12.5px] leading-[17px] text-foreground">{a.text}</p>
                      <p className="mt-0.5 text-[11px] text-[color:var(--text-faint)]">{a.when}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>
      </SheetContent>
    </Sheet>
  );
}
