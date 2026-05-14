import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
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
import type { Artist, ArtistStatus } from '@/types';

interface Props {
  artistId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_OPTIONS: ArtistStatus[] = ['active', 'inactive', 'on_leave'];

export function ArtistProfileSheet({ artistId, open, onOpenChange }: Props) {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canEdit = hasRole('admin') || hasRole('producer');

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

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    bio: '',
    priority_score: 50,
    status: 'active' as ArtistStatus,
  });
  const [selectedSkills, setSelectedSkills] = useState<TagOption[]>([]);

  useEffect(() => {
    if (artist) {
      setForm({
        name: artist.name,
        email: artist.email ?? '',
        phone: artist.phone ?? '',
        bio: artist.bio ?? '',
        priority_score: artist.priority_score,
        status: artist.status,
      });
    }
  }, [artist]);

  useEffect(() => {
    if (artistSkills) setSelectedSkills(artistSkills.map((s) => ({ id: s.id, name: s.name })));
  }, [artistSkills]);

  const initialSkillIds = useMemo(() => new Set((artistSkills ?? []).map((s) => s.id)), [artistSkills]);

  const save = useMutation({
    mutationFn: async () => {
      const { error: updateErr } = await supabase
        .from('artists')
        .update({
          name: form.name,
          email: form.email || null,
          phone: form.phone || null,
          bio: form.bio || null,
          priority_score: form.priority_score,
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
          .insert(toAdd.map((s) => ({ artist_id: artistId!, skill_id: s.id })));
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
    onError: (e: any) => toast({ title: 'Error', description: e.message, variant: 'destructive' }),
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

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Priority score</label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={form.priority_score}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, priority_score: parseInt(e.target.value) || 0 }))
                  }
                  disabled={!canEdit}
                />
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
