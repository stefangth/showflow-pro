import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, Calendar as CalendarIcon, MapPin } from 'lucide-react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { ProgramFilter } from '@/components/filters/ProgramFilter';
import { TimeframeFilter, type TimeframeValue } from '@/components/filters/TimeframeFilter';
import { SortControl, type SortValue } from '@/components/filters/SortControl';
import { ViewToggle, type ViewMode } from '@/components/filters/ViewToggle';
import { useFilterVisibility } from '@/components/filters/useFilterVisibility';
import { EntityCalendar } from '@/components/calendar/EntityCalendar';
import { applySort, inTimeframe } from '@/components/filters/filterUtils';

type ShowRow = {
  id: string; title: string; description: string | null; venue: string | null; category: string | null;
  program: string | null; status: 'active' | 'archived' | 'draft'; slots_per_date: number; created_at: string;
  show_dates: { date: string }[];
};

export default function ShowsPage() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canSee } = useFilterVisibility('shows');

  const [search, setSearch] = useState('');
  const [programs, setPrograms] = useState<string[]>([]);
  const [timeframe, setTimeframe] = useState<TimeframeValue>({ from: null, to: null });
  const [sort, setSort] = useState<SortValue>('chrono_asc');
  const [view, setView] = useState<ViewMode>('list');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', venue: '', category: '', program: '', slots_per_date: 1 });

  const { data: shows, isLoading } = useQuery({
    queryKey: ['shows-with-dates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shows')
        .select('*, show_dates(date)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as ShowRow[];
    },
  });

  const createShow = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('shows').insert({
        title: form.title,
        description: form.description || null,
        venue: form.venue || null,
        category: form.category || null,
        program: form.program || null,
        slots_per_date: form.slots_per_date,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shows-with-dates'] });
      setDialogOpen(false);
      setForm({ title: '', description: '', venue: '', category: '', program: '', slots_per_date: 1 });
      toast({ title: 'Show created' });
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const programOptions = useMemo(() => {
    const set = new Set<string>();
    shows?.forEach(s => s.program && set.add(s.program));
    return Array.from(set).sort();
  }, [shows]);

  const earliestUpcoming = (s: ShowRow): Date | null => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const upcoming = s.show_dates
      .map(d => new Date(d.date + 'T00:00:00'))
      .filter(d => d >= today)
      .sort((a, b) => a.getTime() - b.getTime());
    return upcoming[0] ?? null;
  };

  const filtered = useMemo(() => {
    if (!shows) return [];
    let list = shows.filter(s =>
      (search === '' ||
        s.title.toLowerCase().includes(search.toLowerCase()) ||
        s.venue?.toLowerCase().includes(search.toLowerCase()) ||
        s.category?.toLowerCase().includes(search.toLowerCase())) &&
      (programs.length === 0 || (s.program && programs.includes(s.program)))
    );
    if (timeframe.from || timeframe.to) {
      list = list.filter(s => s.show_dates.some(d => inTimeframe(new Date(d.date + 'T00:00:00'), timeframe)));
    }
    return applySort(list, sort, s => s.title, s => earliestUpcoming(s));
  }, [shows, search, programs, timeframe, sort]);

  const calendarItems = useMemo(() => {
    return filtered.flatMap(s => s.show_dates.map(d => ({ show: s, date: new Date(d.date + 'T00:00:00') })));
  }, [filtered]);

  const statusColor: Record<string, string> = {
    active: 'bg-success/10 text-success',
    draft: 'bg-muted text-muted-foreground',
    archived: 'bg-destructive/10 text-destructive',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold">Shows</h1>
          <p className="text-muted-foreground mt-1">Manage your show productions</p>
        </div>
        {(hasRole('admin') || hasRole('producer')) && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />New Show</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="font-display">Create New Show</DialogTitle>
              </DialogHeader>
              <form onSubmit={e => { e.preventDefault(); createShow.mutate(); }} className="space-y-4">
                <Input placeholder="Show title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required />
                <Textarea placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
                <Input placeholder="Venue" value={form.venue} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))} />
                <Input placeholder="Category (concert, theater, dance...)" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
                <Input placeholder="Program / IP (e.g. Candlelight)" value={form.program} onChange={e => setForm(f => ({ ...f, program: e.target.value }))} />
                <div className="space-y-1">
                  <label className="text-sm font-medium">Slots per date</label>
                  <Input type="number" min={1} value={form.slots_per_date} onChange={e => setForm(f => ({ ...f, slots_per_date: parseInt(e.target.value) || 1 }))} />
                </div>
                <Button type="submit" className="w-full" disabled={createShow.isPending}>
                  {createShow.isPending ? 'Creating...' : 'Create Show'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search shows..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        {canSee('program') && <ProgramFilter options={programOptions} value={programs} onChange={setPrograms} />}
        {canSee('timeframe') && <TimeframeFilter value={timeframe} onChange={setTimeframe} />}
        {canSee('sort') && <SortControl value={sort} onChange={setSort} chronoLabel="Next show" />}
        <div className="ml-auto"><ViewToggle value={view} onChange={setView} /></div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-48 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : view === 'list' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((show, i) => (
            <motion.div key={show.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}>
              <Link to={`/shows/${show.id}`}>
                <Card className="hover:shadow-lg transition-shadow cursor-pointer h-full">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="font-display text-lg leading-tight">{show.title}</CardTitle>
                      <Badge variant="secondary" className={statusColor[show.status] ?? ''}>{show.status}</Badge>
                    </div>
                    {show.program && <Badge variant="outline" className="w-fit text-xs mt-1">{show.program}</Badge>}
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {show.description && <p className="text-sm text-muted-foreground line-clamp-2">{show.description}</p>}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {show.venue && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{show.venue}</span>}
                      {show.category && <span className="flex items-center gap-1"><CalendarIcon className="h-3 w-3" />{show.category}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">{show.slots_per_date} slot{show.slots_per_date > 1 ? 's' : ''} per date</p>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          ))}
          {filtered.length === 0 && <p className="text-muted-foreground col-span-full text-center py-12">No shows found</p>}
        </div>
      ) : (
        <EntityCalendar
          items={calendarItems}
          getDate={(it) => it.date}
          emptyMessage="No shows scheduled"
          renderItem={(it) => (
            <Link to={`/shows/${it.show.id}`}>
              <Card className="hover:shadow-md transition-shadow">
                <CardContent className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{it.show.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {format(it.date, 'p') !== '12:00 AM' ? '' : ''}{it.show.venue ?? ''}{it.show.program ? ` • ${it.show.program}` : ''}
                    </p>
                  </div>
                  <Badge variant="secondary" className={statusColor[it.show.status] ?? ''}>{it.show.status}</Badge>
                </CardContent>
              </Card>
            </Link>
          )}
        />
      )}
    </div>
  );
}
