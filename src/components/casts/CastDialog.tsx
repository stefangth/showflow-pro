import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { createCast } from '@/data/casts';
import { useAuth } from '@/features/auth/AuthContext';
import { useEditorConfig } from '@/features/editor/EditorContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Token } from '@/components/ui/token';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus } from 'lucide-react';

export function CastDialog() {
  const { t } = useTranslation('showsDetail');
  const { user, roles, currentOrg } = useAuth();
  const { isEditorMode } = useEditorConfig();
  const isRealAdmin = roles.includes('admin');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: () => {
      if (!currentOrg) throw new Error('No active organization');
      return createCast(supabase, currentOrg.id, {
        name, description: description || null, createdBy: user?.id ?? null,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['casts'] });
      setOpen(false);
      setName('');
      setDescription('');
      toast({ title: t('castDialog.toast.castCreated') });
    },
    onError: (err: Error) => toast({ title: t('castDialog.toast.error'), description: err.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" />{t('castDialog.newCast')}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">{t('castDialog.newCast')}</DialogTitle>
          {isEditorMode && isRealAdmin && (
            <Badge variant="outline" className="text-xs text-muted-foreground w-fit">
              <Token>CastDialog.tsx</Token>
            </Badge>
          )}
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
          className="space-y-4"
        >
          <Input placeholder={t('castDialog.castNameExample')} value={name} onChange={e => setName(e.target.value)} required />
          <Textarea placeholder={t('castDialog.descriptionOptional')} value={description} onChange={e => setDescription(e.target.value)} />
          <Button type="submit" className="w-full" disabled={create.isPending || !name.trim() || !currentOrg}>
            {create.isPending ? t('castDialog.creating') : t('castDialog.create')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
