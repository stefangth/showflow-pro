import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { useEditorConfig } from '@/features/editor/EditorContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TagInput, type TagOption } from '@/components/ui/tag-input';
import { useToast } from '@/hooks/use-toast';
import { useSkills, useArtistSkills, useCreateSkill, type Skill } from '@/hooks/useSkills';
import { useOrgMembers } from '@/hooks/useOrgMembers';
import { usePendingInvitedArtists } from '@/hooks/usePendingInvitedArtists';
import { artistAccountState } from '@/lib/artistAccount';
import { inviteArtistToApp, resendInvitation, fetchOrgInvitations } from '@/data/invitations';
import { LinkedAccountPanel } from './LinkedAccountPanel';
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
  const canEdit = hasRole('admin') || hasRole('producer');
  const isAdmin = hasRole('admin');
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
  const createSkill = useCreateSkill();

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
  const [selectedSkills, setSelectedSkills] = useState<TagOption[]>([]);

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

  async function handleCreateSkill(name: string): Promise<TagOption> {
    const created: Skill = await createSkill.mutateAsync(name);
    return { id: created.id, name: created.name };
  }

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
                <label className="text-sm font-medium">Email</label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  disabled={!canEdit}
                />
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

            <div className="space-y-1">
              <label className="text-sm font-medium">Skills</label>
              {canEdit ? (
                <TagInput
                  options={(allSkills ?? []).map((s) => ({ id: s.id, name: s.name }))}
                  value={selectedSkills}
                  onChange={setSelectedSkills}
                  onCreate={handleCreateSkill}
                  placeholder="Add skills…"
                />
              ) : (
                <div className="flex flex-wrap gap-1">
                  {selectedSkills.length === 0 && <span className="text-sm text-muted-foreground">—</span>}
                  {selectedSkills.map((s) => (
                    <Badge key={s.id} variant="secondary">{s.name}</Badge>
                  ))}
                </div>
              )}
            </div>

            <LinkedAccountPanel
              state={accountState}
              userId={artist.user_id}
              bookingEmail={artist.email}
              account={linkedMember ? { email: linkedMember.email, display_name: linkedMember.display_name } : undefined}
              accountLoading={isAdmin && !!artist.user_id && membersLoading}
              canSeeAccount={isAdmin}
              canInvite={isAdmin}
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
