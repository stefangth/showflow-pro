import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCan } from '@/hooks/useCapabilities';
import { useAuth } from '@/features/auth/AuthContext';
import { useAllCities } from '@/hooks/useAllCities';
import { ROUTES } from '@/config/app.config';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { fetchShowPriorityRows, setShowCastPriority, clearShowCastPriority } from '@/data/eligibility';
import { fetchCasts, fetchCastMemberCounts, fetchCastCityPriority } from '@/data/casts';
import { fetchShowOptions } from '@/data/shows';


/**
 * Settings → Casts & Cities. Self-contained: owns its own cities/casts/priority
 * queries, realtime subscription, and add/remove form state. Does not touch the
 * page-level settings draft.
 */
export function CastsCitiesTab({ currentOrgId, canEnter }: { currentOrgId: string | undefined; canEnter: boolean }) {
  const qc = useQueryClient();
  const { hasRole } = useAuth();
  const orgId = currentOrgId ?? null;
  // canEnter (role: admin/producer, set by the Settings nav) keeps gating READ — the
  // queries below and their `enabled` flags are unchanged. canManage is the new
  // capability gate for the write controls only (read-only floor).
  const canManage = useCan('manage_cities');
  // Deleting a city stays admin-only server-side (cities DELETE RLS is not
  // capability-gated), so gate the remove-city control on admin to avoid a
  // producer clicking an enabled button that RLS silently rejects.
  const canDeleteCity = hasRole('admin');

  const { data: cities } = useAllCities(canEnter);
  const [newCity, setNewCity] = useState('');
  const addCity = useMutation({
    mutationFn: async (name: string) => {
      if (!orgId) throw new Error('No active organization');
      const { error } = await supabase.from('cities').insert({ name, org_id: orgId });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cities'] }); setNewCity(''); toast.success('City added'); },
    onError: (e: Error) => toast.error(e.message ?? 'Failed to add'),
  });
  const removeCity = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cities').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cities'] }); toast.success('City removed'); },
    onError: (e: Error) => toast.error(e.message ?? 'Failed to remove'),
  });

  const { data: casts } = useQuery({
    queryKey: ['casts', currentOrgId],
    enabled: canEnter && !!orgId,
    queryFn: () => fetchCasts(supabase, orgId),
  });
  const { data: castCounts } = useQuery({
    queryKey: ['cast-members-counts', currentOrgId],
    enabled: canEnter && !!orgId,
    queryFn: () => fetchCastMemberCounts(supabase, orgId),
  });

  const { data: castCityPriorities } = useQuery({
    queryKey: ['cast-city-priority', currentOrgId],
    enabled: canEnter && !!orgId,
    queryFn: () => fetchCastCityPriority(supabase, orgId),
  });

  useEffect(() => {
    if (!canEnter) return;
    const channel = supabase
      .channel('cast_city_priority_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cast_city_priority' }, () => {
        qc.invalidateQueries({ queryKey: ['cast-city-priority'] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [canEnter, qc]);

  const [newPriorityCityId, setNewPriorityCityId] = useState('');
  const [newPriorityCastId, setNewPriorityCastId] = useState('');
  const [newPriorityValue, setNewPriorityValue] = useState(1);

  const addCastPriority = useMutation({
    mutationFn: async () => {
      if (!orgId) throw new Error('No active organization');
      const { error } = await supabase.from('cast_city_priority').insert({
        city_id: newPriorityCityId,
        cast_id: newPriorityCastId,
        priority: newPriorityValue,
        org_id: orgId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cast-city-priority'] });
      // Same-client refresh for the setup rail's coverage query (realtime handles cross-client).
      qc.invalidateQueries({ queryKey: ['eligibility'] });
      setNewPriorityCityId('');
      setNewPriorityCastId('');
      setNewPriorityValue(1);
      toast.success('Priority assigned');
    },
    onError: (e: Error) => toast.error(e.message ?? 'Failed to assign priority'),
  });

  const deleteCastPriority = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cast_city_priority').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cast-city-priority'] });
      // Same-client refresh for the setup rail's coverage query (realtime handles cross-client).
      qc.invalidateQueries({ queryKey: ['eligibility'] });
      toast.success('Assignment removed');
    },
    onError: (e: Error) => toast.error(e.message ?? 'Failed to remove'),
  });

  // Show-scoped priority ladder: 'org' renders the org-wide editor above unchanged;
  // any other value is a show id and switches to that show's override ladder.
  const [priorityScope, setPriorityScope] = useState<string>('org');
  const handlePriorityScopeChange = (v: string) => {
    setPriorityScope(v);
    // Stale cast ids from another scope must not survive the switch.
    setNewPriorityCastId('');
  };

  const { data: allShows } = useQuery({
    queryKey: ['shows', 'for-priority-scope', orgId],
    enabled: canEnter && !!orgId,
    queryFn: () => fetchShowOptions(supabase, orgId),
  });

  const showPrioritiesQ = useQuery({
    queryKey: ['eligibility', 'show-priorities', priorityScope],
    enabled: canEnter && priorityScope !== 'org',
    queryFn: () => fetchShowPriorityRows(supabase, priorityScope),
  });

  const invalidatePriorityConsumers = () => {
    qc.invalidateQueries({ queryKey: ['eligibility'] });
    qc.invalidateQueries({ queryKey: ['eligible-artists'] });
    qc.invalidateQueries({ queryKey: ['artist-eligible-dates'] });
    qc.invalidateQueries({ queryKey: ['offer-tiers'] });
  };

  const assignShowPriority = useMutation({
    mutationFn: () => {
      if (!orgId) throw new Error('No active organization');
      return setShowCastPriority(supabase, {
        showId: priorityScope, cityId: newPriorityCityId, castId: newPriorityCastId,
        priority: newPriorityValue, orgId,
      });
    },
    onSuccess: () => {
      invalidatePriorityConsumers();
      setNewPriorityCityId('');
      setNewPriorityCastId('');
      setNewPriorityValue(1);
      toast.success('Priority assigned');
    },
    onError: (e: Error) => toast.error('Failed to assign priority', { description: e.message }),
  });

  const clearShowPriority = useMutation({
    mutationFn: (rowId: string) => clearShowCastPriority(supabase, rowId),
    onSuccess: () => { invalidatePriorityConsumers(); toast.success('Priority cleared'); },
    onError: (e: Error) => toast.error('Failed to clear priority', { description: e.message }),
  });

  return (
    <div className="mt-4 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Cities</CardTitle>
          <CardDescription>
            Cities are used to scope cast eligibility per show.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); if (newCity.trim()) addCity.mutate(newCity.trim()); }}
          >
            <Input placeholder="New city name" value={newCity} onChange={e => setNewCity(e.target.value)} />
            <Button type="submit" disabled={!canManage || !newCity.trim() || addCity.isPending}>
              <Plus className="h-4 w-4 mr-1" />Add
            </Button>
          </form>
          <div className="flex flex-wrap gap-2 pt-2">
            {(cities ?? []).map(c => (
              <Badge key={c.id} variant="secondary" className="gap-2 py-1.5 pl-3 pr-1">
                {c.name}
                <button
                  onClick={() => removeCity.mutate(c.id)}
                  className="rounded hover:bg-background/40 p-0.5 disabled:opacity-50 disabled:pointer-events-none"
                  aria-label={`Remove ${c.name}`}
                  disabled={!canDeleteCity}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
            {(cities?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">No cities yet.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Casts</CardTitle>
          <CardDescription>
            Manage casts and their members on the <Link className="text-primary underline" to={ROUTES.ARTISTS}>Artists page</Link>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(casts?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No casts yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {casts!.map(c => (
                <div key={c.id} className="p-3 rounded-lg border border-border">
                  <p className="font-medium text-sm">{c.name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {castCounts?.[c.id] ?? 0} member{(castCounts?.[c.id] ?? 0) === 1 ? '' : 's'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Cast Priority by City</CardTitle>
          <CardDescription>
            Configure which cast is offered first (Tier 1), second (Tier 2), etc. for each city.
            The offer engine follows this order when creating booking offers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Select value={priorityScope} onValueChange={handlePriorityScopeChange}>
              <SelectTrigger className="w-72" aria-label="Priority scope"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="org">Organization default</SelectItem>
                {(allShows ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {[s.program, s.sub_program].filter(Boolean).join(' / ')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {priorityScope !== 'org' && (
              <p className="text-xs text-muted-foreground">
                Overrides the organization default for this show only. Cities without show priorities keep the organization default.
              </p>
            )}
          </div>

          {priorityScope === 'org' && (
            <>
              {/* Existing assignments grouped by city */}
              {(cities ?? []).map(city => {
                const assignments = (castCityPriorities ?? [])
                  .filter(r => r.city_id === city.id)
                  .sort((a, b) => a.priority - b.priority);
                if (assignments.length === 0) return null;
                return (
                  <div key={city.id}>
                    <p className="text-sm font-medium mb-2">{city.name}</p>
                    <div className="space-y-1.5">
                      {assignments.map(a => {
                        const cast = casts?.find(c => c.id === a.cast_id);
                        return (
                          <div key={a.id} className="flex items-center gap-3 p-2 rounded-md border border-border">
                            <Badge variant="outline" className="text-xs w-16 justify-center shrink-0">
                              Tier {a.priority}
                            </Badge>
                            <span className="text-sm flex-1">{cast?.name ?? '–'}</span>
                            <button
                              onClick={() => deleteCastPriority.mutate(a.id)}
                              className="rounded hover:bg-muted p-0.5 text-muted-foreground hover:text-destructive disabled:opacity-50 disabled:pointer-events-none"
                              aria-label="Remove assignment"
                              disabled={!canManage}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {(cities?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">Add cities above to configure priorities.</p>
              )}

              {/* Add assignment form */}
              <div className="pt-4 border-t border-border space-y-3">
                <p className="text-sm font-medium">Add assignment</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Select
                    value={newPriorityCityId}
                    onValueChange={v => { setNewPriorityCityId(v); setNewPriorityCastId(''); }}
                  >
                    <SelectTrigger><SelectValue placeholder="City…" /></SelectTrigger>
                    <SelectContent>
                      {(cities ?? []).map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={newPriorityCastId}
                    onValueChange={setNewPriorityCastId}
                    disabled={!newPriorityCityId}
                  >
                    <SelectTrigger><SelectValue placeholder="Cast…" /></SelectTrigger>
                    <SelectContent>
                      {(casts ?? [])
                        .filter(c =>
                          !(castCityPriorities ?? []).some(
                            p => p.city_id === newPriorityCityId && p.cast_id === c.id
                          )
                        )
                        .map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(newPriorityValue)}
                    onValueChange={v => setNewPriorityValue(Number(v))}
                  >
                    <SelectTrigger><SelectValue placeholder="Tier…" /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map(n => (
                        <SelectItem key={n} value={String(n)}>Tier {n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  disabled={!canManage || !newPriorityCityId || !newPriorityCastId || addCastPriority.isPending}
                  onClick={() => addCastPriority.mutate()}
                >
                  <Plus className="h-4 w-4 mr-1" />Assign
                </Button>
              </div>
            </>
          )}

          {priorityScope !== 'org' && (
            <>
              {/* Show ladder grouped by city */}
              {(cities ?? []).map(city => {
                const assignments = (showPrioritiesQ.data ?? [])
                  .filter(r => r.cityId === city.id)
                  .sort((a, b) => a.priority - b.priority);
                if (assignments.length === 0) return null;
                return (
                  <div key={city.id}>
                    <p className="text-sm font-medium mb-2">{city.name}</p>
                    <div className="space-y-1.5">
                      {assignments.map(a => {
                        const cast = casts?.find(c => c.id === a.castId);
                        return (
                          <div key={a.id} className="flex items-center gap-3 p-2 rounded-md border border-border">
                            <Badge variant="outline" className="text-xs w-16 justify-center shrink-0">
                              Tier {a.priority}
                            </Badge>
                            <span className="text-sm flex-1">{cast?.name ?? 'Unknown cast'}</span>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!canManage || clearShowPriority.isPending}
                              onClick={() => clearShowPriority.mutate(a.id)}
                            >
                              Clear tier
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {(showPrioritiesQ.data?.length ?? 0) === 0 && (
                <p className="text-sm text-muted-foreground">No priorities set for this show yet.</p>
              )}

              {/* Add assignment form (show scope) */}
              <div className="pt-4 border-t border-border space-y-3">
                <p className="text-sm font-medium">Add assignment</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Select
                    value={newPriorityCityId}
                    onValueChange={v => { setNewPriorityCityId(v); setNewPriorityCastId(''); }}
                  >
                    <SelectTrigger aria-label="City"><SelectValue placeholder="City…" /></SelectTrigger>
                    <SelectContent>
                      {(cities ?? []).map(c => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={newPriorityCastId}
                    onValueChange={setNewPriorityCastId}
                    disabled={!newPriorityCityId}
                  >
                    <SelectTrigger aria-label="Cast"><SelectValue placeholder="Cast…" /></SelectTrigger>
                    <SelectContent>
                      {(casts ?? [])
                        .filter(c =>
                          !(showPrioritiesQ.data ?? []).some(
                            p => p.cityId === newPriorityCityId && p.castId === c.id
                          )
                        )
                        .map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(newPriorityValue)}
                    onValueChange={v => setNewPriorityValue(Number(v))}
                  >
                    <SelectTrigger aria-label="Tier"><SelectValue placeholder="Tier…" /></SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map(n => (
                        <SelectItem key={n} value={String(n)}>Tier {n}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  size="sm"
                  disabled={!canManage || !newPriorityCityId || !newPriorityCastId || assignShowPriority.isPending}
                  onClick={() => assignShowPriority.mutate()}
                >
                  <Plus className="h-4 w-4 mr-1" />Assign
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
