import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { Search, X, Plus, Users, Layers, Pencil, Check } from 'lucide-react';
import type { Artist, Cast, City, Show } from '@/types';
import { showLabel } from '@/types';

interface Props {
  cast: Cast | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onArtistClick?: (artistId: string) => void;
}

export function CastDetailsSheet({ cast, open, onOpenChange, onArtistClick }: Props) {
  const { hasRole } = useAuth();
  const canManage = hasRole('admin') || hasRole('producer');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editMode, setEditMode] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const updateCast = useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      const { error } = await supabase
        .from('casts')
        .update({ name, description: description || null, updated_at: new Date().toISOString() })
        .eq('id', cast!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['casts'] });
      setEditMode(false);
      toast({ title: 'Cast updated' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cast_members')
        .select('id, artist_id, role, artist:artists(*)')
        .eq('cast_id', cast!.id);
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; artist_id: string; role: string | null; artist: Artist }[];
    },
  });

  const { data: artists } = useQuery({
    queryKey: ['artists'],
    queryFn: async () => {
      const { data, error } = await supabase.from('artists').select('*').order('name');
      if (error) throw error;
      return data as Artist[];
    },
  });

  // Eligibility (cities × shows)
  const { data: cities } = useQuery({
    queryKey: ['cities'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cities').select('*').order('name');
      if (error) throw error;
      return data as City[];
    },
  });

  const { data: shows } = useQuery({
    queryKey: ['shows-for-eligibility'],
    queryFn: async () => {
      const { data, error } = await supabase.from('shows').select('id, program, sub_program').order('program');
      if (error) throw error;
      return data as Pick<Show, 'id' | 'program' | 'sub_program'>[];
    },
  });

  const { data: eligibility } = useQuery({
    queryKey: ['cast-eligibility', cast?.id],
    enabled: !!cast,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('show_cast_eligibility')
        .select('id, city_id, show_id')
        .eq('cast_id', cast!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const eligibilityMap = useMemo(() => {
    // key: `${cityId}:${showId}` → row id
    const map = new Map<string, string>();
    (eligibility ?? []).forEach(r => map.set(`${r.city_id}:${r.show_id}`, r.id));
    return map;
  }, [eligibility]);

  const memberIds = useMemo(() => new Set((members ?? []).map(m => m.artist_id)), [members]);

  const addMember = useMutation({
    mutationFn: async (artistId: string) => {
      const { error } = await supabase.from('cast_members').insert({ cast_id: cast!.id, artist_id: artistId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cast-members', cast?.id] });
      qc.invalidateQueries({ queryKey: ['cast-members-counts'] });
      qc.invalidateQueries({ queryKey: ['artist-casts'] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from('cast_members').delete().eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cast-members', cast?.id] });
      qc.invalidateQueries({ queryKey: ['cast-members-counts'] });
      qc.invalidateQueries({ queryKey: ['artist-casts'] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const toggleEligibility = useMutation({
    mutationFn: async ({ cityId, showId, on }: { cityId: string; showId: string; on: boolean }) => {
      if (on) {
        const { error } = await supabase
          .from('show_cast_eligibility')
          .insert({ show_id: showId, city_id: cityId, cast_id: cast!.id });
        if (error) throw error;
      } else {
        const rowId = eligibilityMap.get(`${cityId}:${showId}`);
        if (!rowId) return;
        const { error } = await supabase.from('show_cast_eligibility').delete().eq('id', rowId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cast-eligibility', cast?.id] });
      qc.invalidateQueries({ queryKey: ['eligible-artists'] });
    },
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
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
                placeholder="Cast name"
                required
                autoFocus
                className="text-lg font-display font-semibold"
              />
              <Textarea
                value={editDescription}
                onChange={e => setEditDescription(e.target.value)}
                placeholder="Description (optional)"
                rows={2}
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={updateCast.isPending || !editName.trim()}>
                  <Check className="h-4 w-4 mr-1" />{updateCast.isPending ? 'Saving…' : 'Save'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={cancelEdit} disabled={updateCast.isPending}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <div className="flex items-start justify-between gap-2">
              <div>
                <SheetTitle className="font-display">{cast?.name}</SheetTitle>
                <SheetDescription>{cast?.description || 'Manage cast members and city eligibility'}</SheetDescription>
              </div>
              {canManage && (
                <Button size="icon" variant="ghost" className="shrink-0 mt-0.5" onClick={startEdit} title="Edit cast">
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
            </div>
          )}
        </SheetHeader>

        <Tabs defaultValue="members" className="mt-6">
          <TabsList>
            <TabsTrigger value="members"><Users className="h-4 w-4 mr-2" />Members</TabsTrigger>
            <TabsTrigger value="eligibility"><Layers className="h-4 w-4 mr-2" />City eligibility</TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="space-y-6 mt-4">
            <div>
              <h4 className="text-sm font-medium mb-2">Members ({members?.length ?? 0})</h4>
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
                      {m.role && <p className="text-xs text-muted-foreground">{m.role}</p>}
                    </button>
                    <Button size="icon" variant="ghost" onClick={() => removeMember.mutate(m.id)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {(members?.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground">No members yet.</p>
                )}
              </div>
            </div>

            <div>
              <h4 className="text-sm font-medium mb-2">Add artists</h4>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input className="pl-10" placeholder="Search artists…" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div className="space-y-1 max-h-[40vh] overflow-y-auto">
                {candidates.map(a => (
                  <div key={a.id} className="flex items-center justify-between p-2 rounded-md hover:bg-muted">
                    <div className="flex items-center gap-2">
                      <p className="text-sm">{a.name}</p>
                      <Badge variant="outline" className="text-xs">{a.status}</Badge>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => addMember.mutate(a.id)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                {candidates.length === 0 && <p className="text-xs text-muted-foreground">No matches.</p>}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="eligibility" className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Tick the cells where this cast is eligible. New show dates synced from Airtable will inherit these settings; per-date overrides are configured on each show date.
            </p>
            {(cities ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">Add cities first in Settings → Casts & Cities.</p>
            )}
            {(shows ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground">No shows available.</p>
            )}
            {(cities ?? []).length > 0 && (shows ?? []).length > 0 && (
              <div className="border border-border rounded-lg overflow-auto max-h-[55vh]">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr>
                      <th className="text-left p-2 font-medium sticky left-0 bg-muted/50">City \ Show</th>
                      {(shows ?? []).map(s => (
                        <th key={s.id} className="text-left p-2 font-medium whitespace-nowrap">{showLabel(s)}</th>
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
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
