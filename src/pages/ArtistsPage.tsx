import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, Star } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import type { Artist } from '@/types';
import { ProgramFilter } from '@/components/filters/ProgramFilter';
import { TimeframeFilter, type TimeframeValue } from '@/components/filters/TimeframeFilter';
import { SortControl, type SortValue } from '@/components/filters/SortControl';
import { ViewToggle, type ViewMode } from '@/components/filters/ViewToggle';
import { useFilterVisibility } from '@/components/filters/useFilterVisibility';
import { EntityCalendar } from '@/components/calendar/EntityCalendar';
import { applySort, inTimeframe } from '@/components/filters/filterUtils';

type BookingJoin = {
  id: string; artist_id: string; status: string;
  show_date: { date: string; show: { title: string; program: string | null } } | null;
};

export default function ArtistsPage() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canSee } = useFilterVisibility('artists');

  const [search, setSearch] = useState('');
  const [programs, setPrograms] = useState<string[]>([]);
  const [timeframe, setTimeframe] = useState<TimeframeValue>({ from: null, to: null });
  const [sort, setSort] = useState<SortValue>('alpha_asc');
  const [view, setView] = useState<ViewMode>('list');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', skills: '', priority_score: 50, bio: '' });

  const { data: artists, isLoading } = useQuery({
    queryKey: ['artists'],
    queryFn: async () => {
      const { data, error } = await supabase.from('artists').select('*').order('priority_score', { ascending: false });
      if (error) throw error;
      return data as Artist[];
    },
  });

  const { data: bookings } = useQuery({
    queryKey: ['artist-bookings-light'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('id, artist_id, status, show_date:show_dates(date, show:shows(title, program))')
        .neq('status', 'cancelled');
      if (error) throw error;
      return (data ?? []) as unknown as BookingJoin[];
    },
  });

  const createArtist = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('artists').insert({
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        skills: form.skills ? form.skills.split(',').map(s => s.trim()) : [],
        priority_score: form.priority_score,
        bio: form.bio || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists'] });
      setDialogOpen(false);
      setForm({ name: '', email: '', phone: '', skills: '', priority_score: 50, bio: '' });
      toast({ title: 'Artist added' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const programOptions = useMemo(() => {
    const set = new Set<string>();
    bookings?.forEach(b => b.show_date?.show?.program && set.add(b.show_date.show.program));
    return Array.from(set).sort();
  }, [bookings]);

  const bookingsByArtist = useMemo(() => {
    const map = new Map<string, BookingJoin[]>();
    bookings?.forEach(b => {
      const arr = map.get(b.artist_id) ?? [];
      arr.push(b);
      map.set(b.artist_id, arr);
    });
    return map;
  }, [bookings]);

  const nextBookingDate = (artistId: string): Date | null => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dates = (bookingsByArtist.get(artistId) ?? [])
      .map(b => b.show_date?.date ? new Date(b.show_date.date + 'T00:00:00') : null)
      .filter((d): d is Date => d !== null && d >= today)
      .sort((a, b) => a.getTime() - b.getTime());
    return dates[0] ?? null;
  };

  const filtered = useMemo(() => {
    if (!artists) return [];
    let list = artists.filter(a =>
      search === '' ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.skills?.some(s => s.toLowerCase().includes(search.toLowerCase()))
    );
    if (programs.length > 0) {
      list = list.filter(a => {
        const artistPrograms = (bookingsByArtist.get(a.id) ?? [])
          .map(b => b.show_date?.show?.program)
          .filter((p): p is string => !!p);
        return artistPrograms.some(p => programs.includes(p));
      });
    }
    if (timeframe.from || timeframe.to) {
      list = list.filter(a => (bookingsByArtist.get(a.id) ?? []).some(b =>
        inTimeframe(b.show_date?.date ? new Date(b.show_date.date + 'T00:00:00') : null, timeframe)
      ));
    }
    return applySort(list, sort, a => a.name, a => nextBookingDate(a.id));
  }, [artists, search, programs, timeframe, sort, bookingsByArtist]);

  const calendarItems = useMemo(() => {
    if (!bookings || !artists) return [];
    const filteredIds = new Set(filtered.map(a => a.id));
    const artistMap = new Map(artists.map(a => [a.id, a]));
    return bookings
      .filter(b => filteredIds.has(b.artist_id) && b.show_date?.date)
      .map(b => ({
        artist: artistMap.get(b.artist_id)!,
        date: new Date(b.show_date!.date + 'T00:00:00'),
        show: b.show_date!.show,
      }));
  }, [bookings, artists, filtered]);

  const statusColor: Record<string, string> = {
    active: 'bg-success/10 text-success',
    inactive: 'bg-muted text-muted-foreground',
    on_leave: 'bg-warning/10 text-warning',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Artists</h1>
          <p className="text-muted-foreground mt-1">Manage your artist roster</p>
        </div>
        {hasRole('admin') && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Artist</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-display">Add New Artist</DialogTitle></DialogHeader>
              <form onSubmit={e => { e.preventDefault(); createArtist.mutate(); }} className="space-y-4">
                <Input placeholder="Full name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
                <Input type="email" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                <Input placeholder="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                <Input placeholder="Skills (comma-separated)" value={form.skills} onChange={e => setForm(f => ({ ...f, skills: e.target.value }))} />
                <div className="space-y-1">
                  <label className="text-sm font-medium">Priority Score (1-100)</label>
                  <Input type="number" min={1} max={100} value={form.priority_score} onChange={e => setForm(f => ({ ...f, priority_score: parseInt(e.target.value) || 50 }))} />
                </div>
                <Textarea placeholder="Bio" value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} />
                <Button type="submit" className="w-full" disabled={createArtist.isPending}>
                  {createArtist.isPending ? 'Adding...' : 'Add Artist'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search artists or skills..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        {canSee('program') && <ProgramFilter options={programOptions} value={programs} onChange={setPrograms} />}
        {canSee('timeframe') && <TimeframeFilter value={timeframe} onChange={setTimeframe} />}
        {canSee('sort') && <SortControl value={sort} onChange={setSort} chronoLabel="Next booking" />}
        <div className="ml-auto"><ViewToggle value={view} onChange={setView} /></div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : view === 'list' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((artist, i) => (
            <motion.div key={artist.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}>
              <Card className="h-full">
                <CardContent className="pt-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-display font-bold">
                        {artist.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium">{artist.name}</p>
                        <p className="text-xs text-muted-foreground">{artist.email}</p>
                      </div>
                    </div>
                    <Badge variant="secondary" className={statusColor[artist.status] ?? ''}>{artist.status}</Badge>
                  </div>
                  <div className="flex items-center gap-1 mb-2">
                    <Star className="h-3 w-3 text-warning" />
                    <span className="text-xs text-muted-foreground">Priority: {artist.priority_score}</span>
                  </div>
                  {artist.skills && artist.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {artist.skills.map(s => (
                        <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
          {filtered.length === 0 && <p className="text-muted-foreground col-span-full text-center py-12">No artists found</p>}
        </div>
      ) : (
        <EntityCalendar
          items={calendarItems}
          getDate={(it) => it.date}
          emptyMessage="No artist bookings"
          renderItem={(it) => (
            <Card>
              <CardContent className="py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-display font-bold text-sm">
                    {it.artist?.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium truncate">{it.artist?.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{it.show?.title}{it.show?.program ? ` • ${it.show.program}` : ''}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        />
      )}
    </div>
  );
}
