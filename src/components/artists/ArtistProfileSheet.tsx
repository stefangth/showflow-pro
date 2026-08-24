import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, Plus, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { useEditorConfig } from '@/features/editor/EditorContext';
import { useCapability, useCan } from '@/hooks/useCapabilities';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Token } from '@/components/ui/token';
import { Metric } from '@/components/ui/metric';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useSkills, useArtistSkills, useUpcomingDateCountsBySkill, type Skill } from '@/hooks/useSkills';
import { useOrgMembers } from '@/hooks/useOrgMembers';
import { usePendingInvitedArtists } from '@/hooks/usePendingInvitedArtists';
import { artistAccountState } from '@/lib/artistAccount';
import { inviteArtistToApp, resendInvitation, fetchOrgInvitations } from '@/data/invitations';
import { setArtistSkills } from '@/data/skills';
import { LinkedAccountPanel } from './LinkedAccountPanel';
import { ROUTES } from '@/config/app.config';
import type { Artist, ArtistStatus } from '@/types';

interface Props {
  artistId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_OPTIONS: ArtistStatus[] = ['active', 'inactive', 'on_leave'];

export function ArtistProfileSheet({ artistId, open, onOpenChange }: Props) {
  const { t } = useTranslation('artists');
  const { hasRole, roles, currentOrg } = useAuth();
  const { isEditorMode } = useEditorConfig();
  const isRealAdmin = roles.includes('admin');
  const { toast } = useToast();
  const qc = useQueryClient();
  const canEdit = useCan('edit_artists');
  const isAdmin = hasRole('admin');
  const isProducer = hasRole('producer');
  const producerCanInvite = useCapability('producer_can_invite');
  const canInvite = isAdmin || (isProducer && producerCanInvite);
  const canResendAccountInvite = useCan('resend_account_invite');
  // Reuse the admin-only member list (list_org_members) to resolve the linked account.
  // Only enabled for admins — producers get the badge only (no PII), per ADR-0011.
  const { data: orgMembers, isLoading: membersLoading } = useOrgMembers(
    isAdmin ? currentOrg?.id : null,
  );

  const { data: artist, isLoading } = useQuery({
    queryKey: ['artists', 'detail', artistId],
    enabled: !!artistId,
    queryFn: async (): Promise<Artist> => {
      const { data, error } = await supabase.from('artists').select('*').eq('id', artistId!).single();
      if (error) throw error;
      return data as Artist;
    },
  });

  const { data: allSkills } = useSkills();
  const { data: artistSkills } = useArtistSkills(artistId);
  // Gated on `open`: this sheet stays mounted at all times on the Artists page
  // (`open={!!profileArtistId}`), so an unconditional query would fire the count
  // read on every roster load, not just when the sheet is actually visible.
  const { data: upcomingDateCounts } = useUpcomingDateCountsBySkill({ enabled: open });

  // Resolve the linked login account for the LinkedAccountPanel (admin-only).
  const linkedMember = artist?.user_id && orgMembers
    ? orgMembers.find((m) => m.user_id === artist.user_id)
    : undefined;

  // Three-state account status (Active / Invited / No account), shared vocabulary.
  const { data: pendingIds } = usePendingInvitedArtists(currentOrg?.id);
  const pendingSet = useMemo(() => new Set(pendingIds ?? []), [pendingIds]);
  const accountState = artist ? artistAccountState(artist, pendingSet) : 'none';

  const invite = useMutation({
    mutationFn: async () => {
      if (!currentOrg || !artist) throw new Error(t('common.noOrg'));
      if (!artist.email) throw new Error(t('common.noEmail'));
      await inviteArtistToApp(supabase, { orgId: currentOrg.id, artistId: artist.id, email: artist.email });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artists', 'pending-invites'] });
      qc.invalidateQueries({ queryKey: ['org-invitations'] });
      toast({ title: t('common.inviteSent') });
    },
    onError: (e: Error) => toast({ title: t('common.error'), description: e.message, variant: 'destructive' }),
  });

  const resend = useMutation({
    mutationFn: async () => {
      if (!currentOrg || !artist) throw new Error(t('common.noOrg'));
      const invitations = await fetchOrgInvitations(supabase, currentOrg.id);
      const live = invitations.find(
        (i) => i.status === 'pending' && i.artist_id === artist.id,
      ) ?? invitations.find(
        (i) => i.status === 'pending' && !!artist.email && i.email.toLowerCase() === artist.email!.toLowerCase(),
      );
      if (!live) throw new Error(t('sheet.noPendingInvite'));
      await resendInvitation(supabase, live.id);
    },
    onSuccess: () => toast({ title: t('common.inviteResent') }),
    onError: (e: Error) => toast({ title: t('common.error'), description: e.message, variant: 'destructive' }),
  });

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    bio: '',
    status: 'active' as ArtistStatus,
  });
  const [selectedSkills, setSelectedSkills] = useState<Skill[]>([]);

  // Seed the editable form only when the artist IDENTITY changes, not on every
  // refetch. A `['artists']` prefix invalidation (any artists write, incl. bulk
  // import) re-fetches the same row and would otherwise wipe in-progress edits.
  // Opening a different artist (new id) still re-seeds.
  const seededArtistIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (artist && seededArtistIdRef.current !== artist.id) {
      seededArtistIdRef.current = artist.id;
      setForm({
        name: artist.name,
        email: artist.email ?? '',
        phone: artist.phone ?? '',
        bio: artist.bio ?? '',
        status: artist.status,
      });
    }
  }, [artist]);

  // Skills load on a separate query and can resolve after the artist row; seed them
  // once per artist identity so a later ['skills'] invalidation for the same artist
  // doesn't clobber in-progress selections. A different artist (new id) re-seeds.
  // The baseline used to diff on save is captured at the SAME moment (seed time),
  // not re-derived from the live `artistSkills` query — otherwise a background
  // refetch mid-edit (e.g. another admin's change landing via realtime) would
  // silently move the save diff's goalposts on both the add and remove sides.
  const seededSkillsIdRef = useRef<string | null>(null);
  const initialSkillIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (artist && artistSkills && seededSkillsIdRef.current !== artist.id) {
      seededSkillsIdRef.current = artist.id;
      setSelectedSkills(artistSkills.map((s) => ({ id: s.id, name: s.name })));
      initialSkillIdsRef.current = new Set(artistSkills.map((s) => s.id));
    }
  }, [artist, artistSkills]);

  const save = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error('No active organization');
      const { error: updateErr } = await supabase
        .from('artists')
        .update({
          name: form.name,
          email: form.email || null,
          phone: form.phone || null,
          bio: form.bio || null,
          status: form.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', artistId!);
      if (updateErr) throw updateErr;

      const initial = initialSkillIdsRef.current;
      const nextIds = new Set(selectedSkills.map((s) => s.id));
      const toAdd = selectedSkills.filter((s) => !initial.has(s.id));
      const removeIds = [...initial].filter((id) => !nextIds.has(id));

      // Shared with the get-running skills panel (src/data/skills.ts) so the join's
      // insert shape, including the org_id RLS checks, exists in exactly one place.
      await setArtistSkills(supabase, {
        artistId: artistId!,
        orgId: currentOrg.id,
        add: toAdd.map((s) => s.id),
        remove: removeIds,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artists'] });
      qc.invalidateQueries({ queryKey: ['skills'] });
      qc.invalidateQueries({ queryKey: ['artist-skills'] });
      toast({ title: t('sheet.toastUpdated') });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  // Design 1i: held skills as catalog-governed rows, remaining catalog skills
  // as add-chips. Free-text creation is gone: an admin adds new skills from
  // Settings -> Casts & Cities now (SkillsCard).
  const skillCatalog = allSkills ?? [];
  const heldSkillIds = new Set(selectedSkills.map((s) => s.id));
  const addableSkills = skillCatalog.filter((s) => !heldSkillIds.has(s.id));
  // useSkills() only returns ACTIVE skills, so a held skill that was later
  // archived is not in skillCatalog. Union the two id sets for the denominator
  // so the header can never read e.g. "3 of 2" when a held skill is archived.
  const catalogDenominator = new Set([...skillCatalog.map((s) => s.id), ...heldSkillIds]).size;
  // Never surface the per-skill "N upcoming dates" count to an artist role,
  // this sheet is admin/producer-only today, but gate it defensively anyway.
  const showSkillCounts = !hasRole('artist');
  const artistFirstName = artist?.name?.trim().split(/\s+/)[0];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-display">{t('sheet.title')}</SheetTitle>
          <SheetDescription>
            {canEdit ? t('sheet.descEdit') : t('sheet.descView')}
          </SheetDescription>
          {isEditorMode && isRealAdmin && (
            <Badge variant="outline" className="text-xs text-muted-foreground w-fit">
              <Token>ArtistProfileSheet.tsx</Token>
            </Badge>
          )}
        </SheetHeader>

        {isLoading || !artist ? (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-24" />
          </div>
        ) : (
          <form
            className="mt-6 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canEdit) save.mutate();
            }}
          >
            <div className="space-y-1">
              <label className="text-sm font-medium">{t('sheet.name')}</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                disabled={!canEdit}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">{t('sheet.emailLabel')}</label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  disabled={!canEdit}
                />
                <p className="text-xs text-muted-foreground">{t('sheet.emailHint1')}</p>
                <p className="text-xs text-muted-foreground">{t('sheet.emailHint2')}</p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">{t('page.dialog.phonePlaceholder')}</label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  disabled={!canEdit}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">{t('sheet.statusLabel')}</label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v as ArtistStatus }))}
                disabled={!canEdit}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => (
                    <SelectItem key={s} value={s}>{s.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">{t('sheet.bioLabel')}</label>
              <Textarea
                value={form.bio}
                onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                rows={3}
                disabled={!canEdit}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <label className="text-sm font-medium">{t('sheet.skillsLabel')}</label>
                <Metric className="text-eyebrow text-muted-foreground">
                  {t('sheet.catalogCount', { held: selectedSkills.length, total: catalogDenominator })}
                </Metric>
              </div>
              {canEdit && (
                <p className="text-xs leading-[17px] text-muted-foreground">
                  {t('sheet.skillsHint', { name: artistFirstName || t('sheet.thisArtist') })}
                </p>
              )}

              <div className="flex flex-col gap-1">
                {selectedSkills.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('sheet.noSkills')}</p>
                )}
                {selectedSkills.map((skill) => {
                  const count = upcomingDateCounts?.get(skill.id) ?? 0;
                  return (
                    <div
                      key={skill.id}
                      data-testid={`skill-row-${skill.id}`}
                      className="flex h-[34px] items-center gap-2.5 rounded-card border border-accent-200 bg-accent-tint pl-2.5 pr-2"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-chip bg-primary text-primary-foreground">
                        <Check className="h-[11px] w-[11px]" strokeWidth={3} />
                      </span>
                      <span className="flex-1 truncate text-sm font-medium text-accent-text">{skill.name}</span>
                      {/* Render only once the counts query has data — while it's still
                          loading, upcomingDateCounts is undefined and every row would
                          otherwise flash the false "Not required yet" default. */}
                      {showSkillCounts && upcomingDateCounts && (
                        <Metric className="text-eyebrow text-accent-text">
                          {count > 0 ? t('sheet.upcomingDates', { count }) : t('sheet.notRequiredYet')}
                        </Metric>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={t('sheet.removeSkill', { name: skill.name })}
                          onClick={() => setSelectedSkills((prev) => prev.filter((s) => s.id !== skill.id))}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-accent-text hover:bg-destructive/10 hover:text-destructive"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {canEdit && (
                <>
                  {addableSkills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-0.5">
                      {addableSkills.map((skill) => (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => setSelectedSkills((prev) => [...prev, skill])}
                          className="inline-flex h-[26px] items-center gap-1.5 rounded-control border border-input bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent-tint"
                        >
                          <Plus className="h-3 w-3" />
                          {skill.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="text-xs leading-[17px] text-muted-foreground">
                    {t('sheet.catalogHintPrefix')}{' '}
                    <Link to={`${ROUTES.SETTINGS}?tab=casts-coverage`} className="text-primary underline">
                      {t('sheet.catalogHintLink')}
                    </Link>
                    {t('sheet.catalogHintSuffix')}
                  </p>
                </>
              )}
            </div>

            <LinkedAccountPanel
              state={accountState}
              userId={artist.user_id}
              bookingEmail={artist.email}
              account={linkedMember ? { email: linkedMember.email, display_name: linkedMember.display_name } : undefined}
              accountLoading={isAdmin && !!artist.user_id && membersLoading}
              canSeeAccount={canResendAccountInvite}
              canInvite={canInvite}
              canResend={canResendAccountInvite}
              onInvite={() => invite.mutate()}
              onResend={() => resend.mutate()}
              inviteBusy={invite.isPending || resend.isPending}
            />

            {canEdit && (
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                  {t('sheet.cancel')}
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? t('sheet.saving') : t('sheet.save')}
                </Button>
              </div>
            )}
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
