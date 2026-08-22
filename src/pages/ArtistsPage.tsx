import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getAvatarTone } from '@/lib/avatar';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchArtists } from '@/data/artists';
import { fetchBookingsLight } from '@/data/bookings';
import { fetchSkillsByArtist } from '@/data/skills';
import { fetchCastsByArtist } from '@/data/casts';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { IconTooltip } from '@/components/common/IconTooltip';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus, Search, Upload, RefreshCw, X } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Artist } from '@/types';
import { ProgramFilter } from '@/components/filters/ProgramFilter';
import { TimeframeFilter, type TimeframeValue } from '@/components/filters/TimeframeFilter';
import { SortControl, type SortValue } from '@/components/filters/SortControl';
import { applySort, inTimeframe } from '@/components/filters/filterUtils';
import { CastsSection } from '@/components/casts/CastsSection';
import { ArtistProfileSheet } from '@/components/artists/ArtistProfileSheet';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { usePendingInvitedArtists } from '@/hooks/usePendingInvitedArtists';
import { usePendingArtistInvitations } from '@/hooks/usePendingArtistInvitations';
import { artistAccountState } from '@/lib/artistAccount';
import { parseDateOnly } from '@/lib/dates';
import { AccountStatusChip } from '@/components/artists/AccountStatusChip';
import { ArtistImportDialog } from '@/components/artists/ArtistImportDialog';
import { inviteArtistToApp, revokeInvitation, resendInvitation } from '@/data/invitations';
import { useCan } from '@/hooks/useCapabilities';
import { PageMini } from '@/components/minis/PageMini';

type BookingJoin = {
  id: string; artist_id: string; status: string;
  show_date: { date: string; show: { program: string | null; sub_program: string | null } } | null;
};


export default function ArtistsPage() {
  const { currentOrg } = useAuth();
  const { t } = useTranslation('artists');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canAddArtists = useCan('add_artists');
  const canInviteArtists = useCan('invite_artists');
  const canResendArtistInvite = useCan('resend_account_invite');
  const canManageArtistInvitations = useCan('manage_artist_invitations');

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
    queryKey: ['artists', 'list', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchArtists(supabase, currentOrg?.id ?? null),
  });

  const { data: pendingIds } = usePendingInvitedArtists(currentOrg?.id);
  const pendingSet = useMemo(() => new Set(pendingIds ?? []), [pendingIds]);
  const existingEmails = useMemo(
    () => (artists ?? []).map((a) => a.email).filter((e): e is string => !!e),
    [artists],
  );

  const { data: pendingArtistInvitations } = usePendingArtistInvitations(currentOrg?.id);
  const pendingInvitesByArtist = useMemo(() => {
    const map = new Map<string, { id: string; email: string }>();
    (pendingArtistInvitations ?? []).forEach((inv) => {
      if (inv.artistId) map.set(inv.artistId, { id: inv.id, email: inv.email });
    });
    return map;
  }, [pendingArtistInvitations]);

  const { data: bookings } = useQuery({
    queryKey: ['bookings', 'light', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchBookingsLight(supabase, currentOrg?.id ?? null),
  });

  const { data: skillsByArtist } = useQuery({
    queryKey: ['artist-skills', 'all', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchSkillsByArtist(supabase, currentOrg?.id ?? null),
  });

  const { data: artistCasts } = useQuery({
    queryKey: ['artist-casts', currentOrg?.id],
    enabled: !!currentOrg,
    queryFn: () => fetchCastsByArtist(supabase, currentOrg?.id ?? null),
  });

  const createArtist = useMutation({
    mutationFn: async (): Promise<{ inviteFailed: boolean }> => {
      if (!currentOrg) throw new Error(t('common.noOrg'));
      if (alsoInvite && !form.email.trim()) throw new Error(t('page.errors.emailRequiredInvite'));
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
        toast({ title: t('page.toast.created'), description: t('page.toast.createdInviteFailed'), variant: 'destructive' });
      } else {
        toast({ title: invited ? t('page.toast.addedAndInvited') : t('page.toast.added') });
      }
    },
    onError: (err: Error) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
  });

  const inviteExisting = useMutation({
    mutationFn: async (artist: Artist) => {
      if (!currentOrg) throw new Error(t('common.noOrg'));
      if (!artist.email) throw new Error(t('common.noEmail'));
      await inviteArtistToApp(supabase, { orgId: currentOrg.id, artistId: artist.id, email: artist.email });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists', 'pending-invites'] });
      queryClient.invalidateQueries({ queryKey: ['org-invitations'] });
      toast({ title: t('common.inviteSent') });
    },
    onError: (err: Error) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
  });

  const revokeInvite = useMutation({
    mutationFn: (invitationId: string) => revokeInvitation(supabase, invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['artists'] }); // prefix also busts ['artists','pending-invitations']
      toast({ title: t('page.toast.inviteRevoked') });
    },
    onError: (err: Error) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
  });

  const resendInvite = useMutation({
    mutationFn: (invitationId: string) => resendInvitation(supabase, invitationId),
    onSuccess: () => toast({ title: t('common.inviteResent') }),
    onError: (err: Error) => toast({ title: t('common.error'), description: err.message, variant: 'destructive' }),
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
          <h1 className="font-display text-display-sm font-semibold tracking-tight">{t('page.title')}</h1>
          <p className="text-muted-foreground mt-1">{t('page.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
        {canAddArtists && (
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" />{t('page.importFromSheet')}
          </Button>
        )}
        {canAddArtists && (
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="h-4 w-4 mr-2" />{t('page.addArtist')}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-display">{t('page.dialog.title')}</DialogTitle></DialogHeader>
              <form onSubmit={e => { e.preventDefault(); createArtist.mutate(); }} className="space-y-4">
                <Input placeholder={t('page.dialog.namePlaceholder')} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
                <Input type="email" placeholder={t('page.dialog.emailPlaceholder')} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required={alsoInvite} />
                <Input placeholder={t('page.dialog.phonePlaceholder')} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                <Textarea placeholder={t('page.dialog.bioPlaceholder')} value={form.bio} onChange={e => setForm(f => ({ ...f, bio: e.target.value }))} />
                <div className="flex items-start gap-2 rounded-m border border-border p-3">
                  <Checkbox id="also-invite" checked={alsoInvite} onCheckedChange={(v) => setAlsoInvite(!!v)} className="mt-0.5" />
                  <div className="space-y-1">
                    <label htmlFor="also-invite" className="text-sm font-medium leading-none">{t('page.dialog.alsoInvite')}</label>
                    {alsoInvite && (
                      <p className="text-xs text-muted-foreground">{t('page.dialog.alsoInviteHint')}</p>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">{t('page.skillsHint')}</p>
                <Button type="submit" className="w-full" disabled={createArtist.isPending}>
                  {createArtist.isPending ? t('page.dialog.adding') : t('page.addArtist')}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
        </div>
      </div>

      <PageMini page="artists" />

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t('page.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
        </div>
        <ProgramFilter options={programOptions} value={programs} onChange={setPrograms} />
        <TimeframeFilter value={timeframe} onChange={setTimeframe} />
        <SortControl value={sort} onChange={setSort} chronoLabel={t('page.nextBooking')} />
      </div>

      <CastsSection onArtistClick={(id) => setProfileArtistId(id)} />

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-40 rounded-l" />)}
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
                  <CardContent>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-caption font-semibold"
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
                        const pendingInvite = pendingInvitesByArtist.get(artist.id);
                        return (
                          <div className="flex flex-col items-end gap-2">
                            <Badge variant="secondary" className={statusColor[artist.status] ?? ''}>{artist.status}</Badge>
                            <AccountStatusChip state={accountState} />
                            {accountState === 'none' && canInviteArtists && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-xs"
                                onClick={(e) => { e.stopPropagation(); inviteExisting.mutate(artist); }}
                                disabled={inviteExisting.isPending}
                              >
                                {t('page.invite')}
                              </Button>
                            )}
                            {pendingInvite && (canResendArtistInvite || canManageArtistInvitations) && (
                              <div className="flex items-center gap-1">
                                {canResendArtistInvite && (
                                  <IconTooltip label={t('page.resendInvite')}>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6"
                                      aria-label={t('page.resendInvite')}
                                      onClick={(e) => { e.stopPropagation(); resendInvite.mutate(pendingInvite.id); }}
                                      disabled={resendInvite.isPending}
                                    >
                                      <RefreshCw className="h-3.5 w-3.5" />
                                    </Button>
                                  </IconTooltip>
                                )}
                                {canManageArtistInvitations && (
                                  <IconTooltip label={t('page.revokeInvite')}>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-6 w-6"
                                      aria-label={t('page.revokeInvite')}
                                      onClick={(e) => { e.stopPropagation(); revokeInvite.mutate(pendingInvite.id); }}
                                      disabled={revokeInvite.isPending}
                                    >
                                      <X className="h-3.5 w-3.5" />
                                    </Button>
                                  </IconTooltip>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    {skills.length > 0 && (
                      <div className="grid grid-cols-[52px_1fr] items-start gap-2 mb-2.5">
                        {/* eslint-disable-next-line no-restricted-syntax -- keeps explicit leading-5 (behavior-preserving); not a straight Eyebrow swap */}
                        <p className="text-eyebrow font-semibold uppercase leading-5 tracking-[1.6px] text-muted-foreground">{t('page.skillsLabel')}</p>
                        <div className="flex flex-wrap gap-1">
                          {skills.slice(0, 3).map(s => (
                            <span
                              key={s.id}
                              className="inline-flex h-5 items-center rounded-xs bg-accent-100 px-1.5 text-eyebrow font-medium text-accent-text"
                            >
                              {s.name}
                            </span>
                          ))}
                          {skills.length > 3 && (
                            <span className="inline-flex h-5 items-center rounded-xs px-1.5 font-mono text-eyebrow font-medium text-muted-foreground">
                              +{skills.length - 3}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    {artistCasts?.get(artist.id) && artistCasts.get(artist.id)!.length > 0 && (
                      <div className="grid grid-cols-[52px_1fr] items-start gap-2 border-t border-border pt-2.5 mt-2.5">
                        {/* eslint-disable-next-line no-restricted-syntax -- keeps explicit leading-5 (behavior-preserving); not a straight Eyebrow swap */}
                        <p className="text-eyebrow font-semibold uppercase leading-5 tracking-[1.6px] text-muted-foreground">{t('page.castsLabel')}</p>
                        <div className="flex flex-wrap gap-1">
                          {artistCasts.get(artist.id)!.map(c => (
                            <span
                              key={c.id}
                              className="inline-flex h-5 items-center rounded-xs border-[0.5px] border-[var(--line-strong)] px-1.5 text-eyebrow font-medium text-muted-foreground"
                            >
                              {c.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
          {filtered.length === 0 && <p className="text-muted-foreground col-span-full text-center py-12">{t('page.empty')}</p>}
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
          canInvite={canInviteArtists}
        />
      )}
    </div>
  );
}
