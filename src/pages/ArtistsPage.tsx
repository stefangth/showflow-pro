import { useState, useMemo, useCallback } from 'react';
import { getAvatarTone } from '@/lib/avatar';
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
import { Plus, Search, Upload } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Artist } from '@/types';
import { ProgramFilter } from '@/components/filters/ProgramFilter';
import { TimeframeFilter, type TimeframeValue } from '@/components/filters/TimeframeFilter';
import { SortControl, type SortValue } from '@/components/filters/SortControl';
import { useFilterVisibility } from '@/components/filters/useFilterVisibility';
import { applySort, inTimeframe } from '@/components/filters/filterUtils';
import { CastsSection } from '@/components/casts/CastsSection';
import { ArtistProfileSheet } from '@/components/artists/ArtistProfileSheet';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { usePendingInvitedArtists } from '@/hooks/usePendingInvitedArtists';
import { artistAccountState } from '@/lib/artistAccount';
import { parseDateOnly } from '@/lib/dates';
import { AccountStatusChip } from '@/components/artists/AccountStatusChip';
import { ArtistImportDialog } from '@/components/artists/ArtistImportDialog';
import { inviteArtistToApp } from '@/data/invitations';

type BookingJoin = {
  id: string; artist_id: string; status: string;
  show_date: { date: string; show: { program: string | null; sub_program: string | null } } | null;
};

type SkillJoin = { artist_id: string; skill: { id: string; name: string } | null };

export default function ArtistsPage() {
  const { hasRole, currentOrg } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canSee } = useFilterVisibility('artists');

  const [search, setSearch] = useState('');
  const [programs, setPrograms] = useState<string[]>([]);
  const [timeframe, setTimeframe] = useState<TimeframeValue>({ from: null, to: null });
  const [sort, setSort] = useState<SortValue>('alpha_asc');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', bio: '' });
  const [alsoInvite, setAlsoInvite] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [profileArtistId, setProfileArtistId] = useState<string | null>(null);

  const { data: artists, isLoading } = useQuery({
    queryKey: ['artists'],
    queryFn: async () => {
      const { data, error } = await supabase.from('artists').select('*').order('name', { ascending: true });
      if (error) throw error;
      return data as Artist[];
    },
  });

  const { data: pendingIds } = usePendingInvitedArtists(currentOrg?.id);
  const pendingSet = useMemo(() => new Set(pendingIds ?? []), [pendingIds]);
  const existingEmails = useMemo(
    () => (artists ?? []).map((a) => a.email).filter((e): e is string => !!e),
    [artists],
  );

  const { data: bookings } = useQuery({
    queryKey: ['bookings', 'light'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bookings')
        .select('id, artist_id, status, show_date:show_dates(date, show:shows(program, sub_program))')
        .neq('status', 'cancelled');
      if (error) throw error;
      return (data ?? []) as unknown as BookingJoin[];
    },
  });

  const { data: skillsByArtist } = useQuery({
    queryKey: ['artist-skills', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('artist_skills')
        .select('artist_id, skill:skills(id, name)');
      if (error) throw error;
      const map = new Map<string, { id: string; name: string }[]>();
      ((data ?? []) as unknown as SkillJoin[]).forEach((r) => {
        if (!r.skill) return;
        const arr = map.get(r.artist_id) ?? [];
        arr.push(r.skill);
        map.set(r.artist_id, arr);
      });
      return map;
    },
  });

  const { data: artistCasts } = useQuery({
    queryKey: ['artist-casts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cast_members')
        .select('artist_id, cast:casts(id, name)');
      if (error) throw error;
      const map = new Map<string, { id: string; name: string }[]>();
      (data ?? []).forEach((r: any) => {
        const arr = map.get(r.artist_id) ?? [];
        if (r.cast) arr.push(r.cast);
        map.set(r.artist_id, arr);
      });
      return map;
    },
  });

  const createArtist = useMutation({
    mutationFn: async (): Promise<{ inviteFailed: boolean }> => {
      if (!currentOrg) throw new Error('No active organization');
      if (alsoInvite && !form.email.trim()) throw new Error('Email is required to send an invite');
      const { data: inserted, error } = await supabase.from('artists').insert({
        name: form.name,
        email: form.email || null,
        phone: form.phone || null,
        bio: form.bio || null,
        org_id: currentOrg.id,
      }).select('id').single();
      if (error) throw error;
      if (alsoInvite && inserted) {
        try {
          await inviteArtistToApp(supabase, { orgId: currentOrg.id, artistId: inserted.id, email: form.email });
        } catch (e) {
          console.error('Artist created but invite failed', e);
          return { inviteFailed: true }; // keep the artist; warn below
        }
      }
      return { inviteFailed: false };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['artists'] }); // prefix also busts ['artists','pending-invites']
      const invited = alsoInvite;
      setDialogOpen(false);
      setForm({ name: '', email: '', phone: '', bio: '' });
      setAlsoInvite(false);
      if (res?.inviteFailed) {
        toast({ title: 'Artist created', description: "The invite couldn't be sent — retry from the artist.", variant: 'destructive' });
      } else {
        toast({ title: invited ? 'Artist added and invited' : 'Artist added' });
      }
    },
    onError: (err: any) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  const inviteExisting = useMutation({
    mutationFn: async (artist: Artist) => {
      if (!currentOrg) throw new Error('No active organization');
      if (!artist.email) throw new Error('This artist has no email — add one before inviting.');
      await inviteArtistToApp(supabase, { orgId: currentOrg.id, artistId: artist.id, email: artist.email });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists', 'pending-invites'] });
      queryClient.invalidateQueries({ queryKey: ['org-invitations'] });
      toast({ title: 'Invite sent' });
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

  const nextBookingDate = useCallback((artistId: string): Date | null => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dates = (bookingsByArtist.get(artistId) ?? [])
      .map(b => b.show_date?.date ? parseDateOnly(b.show_date.date) : null)
      .filter((d): d is Date => d !== null && d >= today)
      .sort((a, b) => a.getTime() - b.getTime());
    return dates[0] ?? null;
  }, [bookingsByArtist]);

  const filtered = useMemo(() => {
    if (!artists) return [];
    const q = search.toLowerCase();
    let list = artists.filter(a => {
      if (q === '') return true;
      if (a.name.toLowerCase().includes(q)) return true;
      const skills = skillsByArtist?.get(a.id) ?? [];
      return skills.some(s => s.name.toLowerCase().includes(q));
    });
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
        inTimeframe(b.show_date?.date ? parseDateOnly(b.show_date.date) : null, timeframe)
      ));
    }
    return applySort(list, sort, a => a.name, a => nextBookingDate(a.id));
  }, [artists, search, programs, timeframe, sort, bookingsByArtist, skillsByArtist, nextBookingDate]);

  const statusColor: Record<string, string> = {
    active: 'bg-success/10 text-success',
    inactive: 'bg-muted text-muted-foreground',
    on_leave: 'bg-warning/10 text-warning',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-display text-[32px] font-semibold tracking-tight">Artists</h1>
          <p className="text-muted-foreground mt-1">Manage your artist roster</p>
        </div>
        <div className="flex items-center gap-2">
        {(hasRole('producer') || hasRole('admin')) && (
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />Import from sheet
          </Button>
        )}
        {hasRole('admin') && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />Add Artist</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-display">Add New Artist</DialogTitle></DialogHeader>
              <form onSubmit={e => { e.preventDefault(); createArtist.mutate(); }} className="space-y-4">
                <Input placeholder="Full name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
                <Input type="email" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required={alsoInvite} />
                <Input placeholder="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                <Textarea placeholder="Bio" value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} />
                <div className="flex items-start gap-2 rounded-md border border-border p-3">
                  <Checkbox id="also-invite" checked={alsoInvite} onCheckedChange={(v) => setAlsoInvite(!!v)} className="mt-0.5" />
                  <div className="space-y-1">
                    <label htmlFor="also-invite" className="text-sm font-medium leading-none">Also send an app-login invite</label>
                    {alsoInvite && (
                      <p className="text-xs text-muted-foreground">They'll get an email to set a password and join as an artist. Email is required.</p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Skills can be added after creation via the artist's profile.</p>
                <Button type="submit" className="w-full" disabled={createArtist.isPending}>
                  {createArtist.isPending ? 'Adding...' : 'Add Artist'}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search artists or skills..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        {canSee('program') && <ProgramFilter options={programOptions} value={programs} onChange={setPrograms} />}
        {canSee('timeframe') && <TimeframeFilter value={timeframe} onChange={setTimeframe} />}
        {canSee('sort') && <SortControl value={sort} onChange={setSort} chronoLabel="Next booking" />}
      </div>

      <CastsSection onArtistClick={(id) => setProfileArtistId(id)} />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-40 rounded-lg" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((artist, i) => {
            const skills = skillsByArtist?.get(artist.id) ?? [];
            return (
              <motion.div key={artist.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }}>
                <Card
                  className="h-full cursor-pointer hover:shadow-elev2 transition-shadow"
                  onClick={() => setProfileArtistId(artist.id)}
                >
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
                          style={{ backgroundColor: getAvatarTone(artist.id).bg, color: getAvatarTone(artist.id).text }}
                        >
                          {artist.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium">{artist.name}</p>
                          <p className="text-xs text-muted-foreground">{artist.email}</p>
                        </div>
                      </div>
                      {(() => {
                        const accountState = artistAccountState(artist, pendingSet);
                        return (
                          <div className="flex flex-col items-end gap-2">
                            <Badge variant="secondary" className={statusColor[artist.status] ?? ''}>{artist.status}</Badge>
                            <AccountStatusChip state={accountState} />
                            {accountState === 'none' && hasRole('admin') && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-xs"
                                onClick={(e) => { e.stopPropagation(); inviteExisting.mutate(artist); }}
                                disabled={inviteExisting.isPending}
                              >
                                Invite
                              </Button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    {skills.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-2">
                        {skills.map(s => (
                          <Badge key={s.id} variant="outline" className="text-xs">{s.name}</Badge>
                        ))}
                      </div>
                    )}
                    {artistCasts?.get(artist.id) && artistCasts.get(artist.id)!.length > 0 && (
                      <div className="flex flex-wrap gap-1 pt-2 border-t border-border mt-2">
                        {artistCasts.get(artist.id)!.map(c => (
                          <Badge key={c.id} variant="secondary" className="text-xs">{c.name}</Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
          {filtered.length === 0 && <p className="text-muted-foreground col-span-full text-center py-12">No artists found</p>}
        </div>
      )}

      <ArtistProfileSheet
        artistId={profileArtistId}
        open={!!profileArtistId}
        onOpenChange={(o) => { if (!o) setProfileArtistId(null); }}
      />

      {currentOrg && (
        <ArtistImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          orgId={currentOrg.id}
          existingEmails={existingEmails}
          canInvite={hasRole('admin')}
        />
      )}
    </div>
  );
}
