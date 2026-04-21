import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Search, X, Plus } from 'lucide-react';
import type { Artist, Cast } from '@/types';

interface Props {
  cast: Cast | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CastMembersSheet({ cast, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const { data: members } = useQuery({
    queryKey: ['cast-members', cast?.id],
    enabled: !!cast,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cast_members')
        .select('id, artist_id, artist:artists(*)')
        .eq('cast_id', cast!.id);
      if (error) throw error;
      return (data ?? []) as unknown as { id: string; artist_id: string; artist: Artist }[];
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

  const candidates = (artists ?? []).filter(a =>
    !memberIds.has(a.id) &&
    (search === '' || a.name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display">{cast?.name}</SheetTitle>
          <SheetDescription>{cast?.description || 'Manage cast members'}</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <div>
            <h4 className="text-sm font-medium mb-2">Members ({members?.length ?? 0})</h4>
            <div className="space-y-2">
              {(members ?? []).map(m => (
                <div key={m.id} className="flex items-center justify-between p-2 rounded-md border border-border">
                  <div>
                    <p className="text-sm font-medium">{m.artist.name}</p>
                    {m.artist.cast_role && <p className="text-xs text-muted-foreground">{m.artist.cast_role}</p>}
                  </div>
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
        </div>
      </SheetContent>
    </Sheet>
  );
}
