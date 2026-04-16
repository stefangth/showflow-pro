import { useState } from 'react';
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
import { Plus, Search, Music, Star } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Artist } from '@/types';

export default function ArtistsPage() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
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

  const filtered = artists?.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.skills?.some(s => s.toLowerCase().includes(search.toLowerCase()))
  );

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

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search artists or skills..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3].map(i => <div key={i} className="h-40 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered?.map((artist, i) => (
            <motion.div key={artist.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
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
          {filtered?.length === 0 && <p className="text-muted-foreground col-span-full text-center py-12">No artists found</p>}
        </div>
      )}
    </div>
  );
}
