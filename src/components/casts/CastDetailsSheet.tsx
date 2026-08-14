import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  fetchCastMembers, fetchCastEligibility, updateCast as updateCastRow,
  addCastMember, removeCastMember, setCastEligibility, clearCastEligibility,
  fetchCasts, fetchCastCityPriority,
} from '@/data/casts';
import { fetchArtists } from '@/data/artists';
import { fetchShowsForEligibility } from '@/data/shows';
import { useAuth } from '@/features/auth/AuthContext';
import { useCan } from '@/hooks/useCapabilities';
import { useEditorConfig } from '@/features/editor/EditorContext';
import { ROUTES } from '@/config/app.config';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { IconTooltip } from '@/components/common/IconTooltip';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Search, X, Plus, Users, Layers, Pencil, Check, ListOrdered } from 'lucide-react';
import type { Cast } from '@/types';
import { showIdentityLabel } from '@/types';
import { useAllCities } from '@/hooks/useAllCities';

interface Props {
  cast: Cast | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArtistClick?: (artistId: string) => void;
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
  // edited on Settings → Casts & Cities ("Cast Priority by City"), which also owns the
  // UNIQUE(cast,city)/UNIQUE(city,priority) swap semantics — this tab just shows where
  // THIS cast lands per city, with a link out to make a change. Reuses that tab's query
  // keys (['casts', orgId], ['cast-city-priority', orgId]) so the cache is shared.
  const { data: allCasts } = useQuery({
    queryKey: ['casts', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchCasts(supabase, currentOrg?.id ?? null),
  });

  const { data: castCityPriorities } = useQuery({
    queryKey: ['cast-city-priority', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchCastCityPriority(supabase, currentOrg?.id ?? null),
  });

  const eligibilityMap = useMemo(() => {
    // key: `${cityId}:${showId}` → row id
    const map = new Map<string, string>();
    (eligibility ?? []).forEach(r => map.set(`${r.city_id}:${r.show_id}`, r.id));
    return map;
  }, [eligibility]);

  const memberIds = useMemo(() => new Set((members ?? []).map(m => m.artist_id)), [members]);

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

  const candidates = (artists ?? []).filter(a =>
    !memberIds.has(a.id) &&
    (search === '' || a.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          {editMode ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (editName.trim()) updateCast.mutate({ name: editName.trim(), description: editDescription.trim() });
              }}
              className="space-y-2"
            >
              <Input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder={t('castDetails.castNamePlaceholder')}
                required
                autoFocus
                className="text-lg font-display font-semibold"
              />
              <Textarea
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                placeholder={t('castDetails.descriptionOptional')}
                rows={2}
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={updateCast.isPending || !editName.trim()}>
                  <Check className="h-4 w-4 mr-1" />{updateCast.isPending ? t('castDetails.saving') : t('castDetails.save')}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={cancelEdit} disabled={updateCast.isPending}>
                  {t('castDetails.cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <div>
                <SheetTitle className="font-display">{cast?.name}</SheetTitle>
                <SheetDescription>{cast?.description || t('castDetails.manageDefault')}</SheetDescription>
              </div>
              {canManage && (
                <IconTooltip label={t('castDetails.editCast')}>
                  <Button size="icon" variant="ghost" className="shrink-0 mt-0.5" onClick={startEdit} aria-label={t('castDetails.editCast')}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                </IconTooltip>
              )}
            </div>
          )}
          {isEditorMode && isRealAdmin && (
            <Badge variant="outline" className="text-xs font-mono text-muted-foreground w-fit">
              CastDetailsSheet.tsx
            </Badge>
          )}
        </SheetHeader>

        <Tabs defaultValue="members" className="mt-6">
          <TabsList>
            <TabsTrigger value="members"><Users className="h-4 w-4 mr-2" />{t('castDetails.tabs.members')}</TabsTrigger>
            <TabsTrigger value="eligibility"><Layers className="h-4 w-4 mr-2" />{t('castDetails.tabs.cityEligibility')}</TabsTrigger>
            <TabsTrigger value="offer-order"><ListOrdered className="h-4 w-4 mr-2" />{t('castDetails.tabs.offerOrder')}</TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="space-y-6 mt-4">
            <div>
              <h4 className="text-sm font-medium mb-2">{t('castDetails.membersCount', { count: members?.length ?? 0 })}</h4>
              <div className="space-y-2">
                {(members ?? []).map(m => (
                  <div key={m.id} className="flex items-center justify-between p-2 rounded-md border border-border">
                    <button
                      type="button"
                      onClick={() => onArtistClick?.(m.artist_id)}
                      className="text-left flex-1 hover:underline disabled:cursor-default disabled:no-underline"
                      disabled={!onArtistClick}
                    >
                      <p className="text-sm font-medium">{m.artist.name}</p>
                    </button>
                    <IconTooltip label={t('castDetails.removeMember', { name: m.artist.name })}>
                      <Button size="icon" variant="ghost" aria-label={t('castDetails.removeMember', { name: m.artist.name })} onClick={() => removeMember.mutate(m.id)} disabled={!canManage}>
                        <X className="h-4 w-4" />
                      </Button>
                    </IconTooltip>
                  </div>
                ))}
                {(members?.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground">{t('castDetails.noMembers')}</p>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-2">{t('castDetails.addArtists')}</h4>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-10" placeholder={t('castDetails.searchArtists')} value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div className="space-y-1 max-h-[40vh] overflow-y-auto">
                {candidates.map(a => (
                  <div key={a.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                    <div className="flex items-center gap-2">
                      <p className="text-sm">{a.name}</p>
                      <Badge variant="outline" className="text-xs">{a.status}</Badge>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => addMember.mutate(a.id)} disabled={!canManage}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {candidates.length === 0 && <p className="text-xs text-muted-foreground">{t('castDetails.noMatches')}</p>}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="eligibility" className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('castDetails.eligibilityNote')}
            </p>
            {(cities ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">{t('castDetails.addCitiesFirst')}</p>
            )}
            {(shows ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">{t('castDetails.noShows')}</p>
            )}
            {(cities ?? []).length > 0 && (shows ?? []).length > 0 && (
              <div className="border border-border rounded-lg overflow-auto max-h-[55vh]">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2 font-medium sticky left-0 bg-muted/50">{t('castDetails.cityShowHeader')}</th>
                      {(shows ?? []).map(s => (
                        <th key={s.id} className="text-left p-2 font-medium whitespace-nowrap">{showIdentityLabel(s)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(cities ?? []).map(city => (
                      <tr key={city.id} className="border-t border-border">
                        <td className="p-2 font-medium sticky left-0 bg-background whitespace-nowrap">{city.name}</td>
                        {(shows ?? []).map(s => {
                          const on = eligibilityMap.has(`${city.id}:${s.id}`);
                          return (
                            <td key={s.id} className="p-2 text-center">
                              <Checkbox
                                checked={on}
                                onCheckedChange={(v) => toggleEligibility.mutate({ cityId: city.id, showId: s.id, on: !!v })}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="offer-order" className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              {t('castDetails.offerOrderNote')}
            </p>
            {(cities ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('castDetails.addCitiesFirst')}</p>
            ) : (
              <div className="space-y-2">
                {(cities ?? []).map((city) => {
                  const row = (castCityPriorities ?? []).find(
                    (r) => r.city_id === city.id && r.cast_id === cast?.id
                  );
                  const tier = row?.priority ?? null;
                  const previousRow = tier != null && tier > 1
                    ? (castCityPriorities ?? []).find((r) => r.city_id === city.id && r.priority === tier - 1)
                    : undefined;
                  const previousCastName = previousRow
                    ? (allCasts ?? []).find((c) => c.id === previousRow.cast_id)?.name ?? t('castDetails.previousTier')
                    : null;
                  const note = tier == null
                    ? t('castDetails.neverOffered')
                    : tier === 1
                      ? t('castDetails.offeredFirst')
                      : t('castDetails.offeredAfter', { cast: previousCastName });
                  return (
                    <div
                      key={city.id}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-md border border-border"
                    >
                      <div>
                        <p className="text-sm font-medium">{city.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{note}</p>
                      </div>
                      <Badge variant={tier === 1 ? 'accent' : 'neutral'} className="shrink-0">
                        {tier != null ? t('castDetails.tierN', { tier }) : t('castDetails.notInOrder')}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
            <Link to={`${ROUTES.SETTINGS}?tab=casts-coverage`} className="text-xs text-primary underline">
              {t('castDetails.manageOfferOrderLink')}
            </Link>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
