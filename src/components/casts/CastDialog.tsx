import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { useEditorConfig } from '@/features/editor/EditorContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Plus } from 'lucide-react';

export function CastDialog() {
  const { user, roles, currentOrg } = useAuth();
  const { isEditorMode } = useEditorConfig();
  const isRealAdmin = roles.includes('admin');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const create = useMutation({
    mutationFn: async () => {
      if (!currentOrg) throw new Error('No active organization');
      const { error } = await supabase.from('casts').insert({
        name,
        description: description || null,
        created_by: user?.id ?? null,
        org_id: currentOrg.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['casts'] });
      setOpen(false);
      setName('');
      setDescription('');
      toast({ title: 'Cast created' });
    },
    onError: (err: Error) => toast({ title: 'Error', description: err.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Plus className="h-4 w-4 mr-1" />New Cast</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display">New Cast</DialogTitle>
          {isEditorMode && isRealAdmin && (
            <Badge variant="outline" className="text-xs font-mono text-muted-foreground w-fit">
              CastDialog.tsx
            </Badge>
          )}
        </DialogHeader>
        <form
          onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate(); }}
          className="space-y-4"
        >
          <Input placeholder="Cast name (e.g. Berlin A-Team)" value={name} onChange={e => setName(e.target.value)} required />
          <Textarea placeholder="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} />
          <Button type="submit" className="w-full" disabled={create.isPending || !name.trim() || !currentOrg}>
            {create.isPending ? 'Creating…' : 'Create'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
