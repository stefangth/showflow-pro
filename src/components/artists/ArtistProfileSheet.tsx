import { useEffect, useMemo, useRef, useState } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { useSkills, useArtistSkills, useUpcomingDateCountsBySkill, type Skill } from '@/hooks/useSkills';
import { useOrgMembers } from '@/hooks/useOrgMembers';
import { usePendingInvitedArtists } from '@/hooks/usePendingInvitedArtists';
import { artistAccountState } from '@/lib/artistAccount';
import { inviteArtistToApp, resendInvitation, fetchOrgInvitations } from '@/data/invitations';
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
  const { data: upcomingDateCounts } = useUpcomingDateCountsBySkill();

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
      if (!currentOrg || !artist) throw new Error('No active organization');
      if (!artist.email) throw new Error('This artist has no email — add one before inviting.');
      await inviteArtistToApp(supabase, { orgId: currentOrg.id, artistId: artist.id, email: artist.email });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artists', 'pending-invites'] });
      qc.invalidateQueries({ queryKey: ['org-invitations'] });
      toast({ title: 'Invite sent' });
    },
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
  });

  const resend = useMutation({
    mutationFn: async () => {
      if (!currentOrg || !artist) throw new Error('No active organization');
      const invitations = await fetchOrgInvitations(supabase, currentOrg.id);
      const live = invitations.find(
        (i) => i.status === 'pending' && i.artist_id === artist.id,
      ) ?? invitations.find(
        (i) => i.status === 'pending' && !!artist.email && i.email.toLowerCase() === artist.email!.toLowerCase(),
      );
      if (!live) throw new Error('No pending invite to resend.');
      await resendInvitation(supabase, live.id);
    },
    onSuccess: () => toast({ title: 'Invite re-sent' }),
    onError: (e: Error) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
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
  const seededSkillsIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (artist && artistSkills && seededSkillsIdRef.current !== artist.id) {
      seededSkillsIdRef.current = artist.id;
      setSelectedSkills(artistSkills.map((s) => ({ id: s.id, name: s.name })));
    }
  }, [artist, artistSkills]);

  const initialSkillIds = useMemo(() => new Set((artistSkills ?? []).map((s) => s.id)), [artistSkills]);

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

      const nextIds = new Set(selectedSkills.map((s) => s.id));
      const toAdd = selectedSkills.filter((s) => !initialSkillIds.has(s.id));
      const toRemove = (artistSkills ?? []).filter((s) => !nextIds.has(s.id));

      if (toAdd.length) {
        const { error } = await supabase
          .from('artist_skills')
          .insert(toAdd.map((s) => ({ artist_id: artistId!, skill_id: s.id, org_id: currentOrg.id })));
        if (error) throw error;
      }
      if (toRemove.length) {
        const { error } = await supabase
          .from('artist_skills')
          .delete()
          .eq('artist_id', artistId!)
          .in('skill_id', toRemove.map((s) => s.id));
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artists'] });
      qc.invalidateQueries({ queryKey: ['skills'] });
      toast({ title: 'Artist updated' });
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
          <SheetTitle className="font-display">Artist profile</SheetTitle>
          <SheetDescription>
            {canEdit ? 'Edit artist details and skills.' : 'View artist details.'}
          </SheetDescription>
          {isEditorMode && isRealAdmin && (
            <Badge variant="outline" className="text-xs font-mono text-muted-foreground w-fit">
              ArtistProfileSheet.tsx
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
              <label className="text-sm font-medium">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
                disabled={!canEdit}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Booking / contact email</label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  disabled={!canEdit}
                />
                <p className="text-xs text-muted-foreground">Separate from the login account.</p>
                <p className="text-xs text-muted-foreground">Visible to admins and producers in this organization.</p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Phone</label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  disabled={!canEdit}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium">Status</label>
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
              <label className="text-sm font-medium">Bio</label>
              <Textarea
                value={form.bio}
                onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                rows={3}
                disabled={!canEdit}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-3">
                <label className="text-sm font-medium">Skills</label>
                <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {selectedSkills.length} of {catalogDenominator} in the catalog
                </p>
              </div>
              {canEdit && (
                <p className="text-xs leading-[17px] text-muted-foreground">
                  Skills decide which dates {artistFirstName || 'this artist'} can be offered.
                  Removing one takes them out of any offer that requires it.
                </p>
              )}

              <div className="flex flex-col gap-1">
                {selectedSkills.length === 0 && (
                  <p className="text-sm text-muted-foreground">No skills yet.</p>
                )}
                {selectedSkills.map((skill) => {
                  const count = upcomingDateCounts?.get(skill.id) ?? 0;
                  return (
                    <div
                      key={skill.id}
                      data-testid={`skill-row-${skill.id}`}
                      className="flex h-[34px] items-center gap-2.5 rounded-lg border border-accent-200 bg-accent-50 pl-2.5 pr-2"
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] bg-primary text-primary-foreground">
                        <Check className="h-[11px] w-[11px]" strokeWidth={3} />
                      </span>
                      <span className="flex-1 truncate text-sm font-medium text-accent-700">{skill.name}</span>
                      {showSkillCounts && (
                        <span className="font-mono text-[11px] tabular-nums text-accent-700">
                          {count > 0 ? `${count} upcoming dates` : 'Not required yet'}
                        </span>
                      )}
                      {canEdit && (
                        <button
                          type="button"
                          aria-label={`Remove ${skill.name}`}
                          onClick={() => setSelectedSkills((prev) => prev.filter((s) => s.id !== skill.id))}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-accent-700 hover:bg-destructive/10 hover:text-destructive"
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
                          className="inline-flex h-[26px] items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent-50"
                        >
                          <Plus className="h-3 w-3" />
                          {skill.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="text-xs leading-[17px] text-muted-foreground">
                    Need a skill that does not exist? An admin adds it in{' '}
                    <Link to={`${ROUTES.SETTINGS}?tab=casts-cities`} className="text-primary underline">
                      Settings, Casts &amp; Cities
                    </Link>
                    , so the catalog stays clean.
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
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            )}
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}
