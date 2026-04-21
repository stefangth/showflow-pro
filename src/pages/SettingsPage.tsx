import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/features/auth/AuthContext';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Settings as SettingsIcon, Database, Bell, Wand2, Save, SlidersHorizontal, MapPin, Plus, Trash2 } from 'lucide-react';
import type { City, Cast } from '@/types';

type FilterKey = 'program' | 'timeframe' | 'sort' | 'status';
const FILTER_KEYS: FilterKey[] = ['program', 'timeframe', 'sort', 'status'];
const PAGES: ('shows' | 'artists' | 'bookings')[] = ['shows', 'artists', 'bookings'];
const ROLES: ('producer' | 'artist')[] = ['producer', 'artist'];

type SettingRow = {
  id: string;
  key: string;
  value: any;
  description: string | null;
  updated_at: string;
};

export default function SettingsPage() {
  const { hasRole } = useAuth();
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['app-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('app_settings').select('*').order('key');
      if (error) throw error;
      return (data ?? []) as SettingRow[];
    },
  });

  const [draft, setDraft] = useState<Record<string, any>>({});

  useEffect(() => {
    if (settings) {
      const next: Record<string, any> = {};
      for (const s of settings) next[s.key] = s.value;
      setDraft(next);
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async (updates: { key: string; value: any }[]) => {
      for (const u of updates) {
        const { error } = await supabase
          .from('app_settings')
          .update({ value: u.value })
          .eq('key', u.key);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['app-settings'] });
      toast.success('Settings saved');
    },
    onError: (e: any) => toast.error(e.message ?? 'Failed to save'),
  });

  const isAdmin = hasRole('admin');
  const isProducer = hasRole('producer');
  const canEnter = isAdmin || isProducer;

  // Cities (available to producers + admins)
  const { data: cities } = useQuery({
    queryKey: ['cities'],
    enabled: canEnter,
    queryFn: async () => {
      const { data, error } = await supabase.from('cities').select('*').order('name');
      if (error) throw error;
      return data as City[];
    },
  });
  const [newCity, setNewCity] = useState('');
  const addCity = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await supabase.from('cities').insert({ name });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cities'] }); setNewCity(''); toast.success('City added'); },
    onError: (e: any) => toast.error(e.message ?? 'Failed to add'),
  });
  const removeCity = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('cities').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['cities'] }); toast.success('City removed'); },
    onError: (e: any) => toast.error(e.message ?? 'Failed to remove'),
  });

  const { data: casts } = useQuery({
    queryKey: ['casts'],
    enabled: canEnter,
    queryFn: async () => {
      const { data, error } = await supabase.from('casts').select('*').order('name');
      if (error) throw error;
      return data as Cast[];
    },
  });
  const { data: castCounts } = useQuery({
    queryKey: ['cast-members-counts'],
    enabled: canEnter,
    queryFn: async () => {
      const { data, error } = await supabase.from('cast_members').select('cast_id');
      if (error) throw error;
      const map: Record<string, number> = {};
      (data ?? []).forEach(r => { map[r.cast_id] = (map[r.cast_id] ?? 0) + 1; });
      return map;
    },
  });

  if (!canEnter) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">Admin or producer access required</p>
      </div>
    );
  }

  if (isLoading || !settings) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground">Loading settings…</div>;
  }

  const get = (key: string, fallback: any = '') => draft[key] ?? fallback;
  const set = (key: string, value: any) => setDraft(d => ({ ...d, [key]: value }));

  const dirtyKeys = settings
    .filter(s => JSON.stringify(s.value) !== JSON.stringify(draft[s.key]))
    .map(s => s.key);

  const handleSave = () => {
    const updates = dirtyKeys.map(k => ({ key: k, value: draft[k] }));
    if (updates.length === 0) {
      toast.info('No changes to save');
      return;
    }
    saveMutation.mutate(updates);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold flex items-center gap-3">
            <SettingsIcon className="h-7 w-7 text-primary" />
            Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure integrations, booking behaviour, and notifications. Changes apply immediately.
          </p>
        </div>
        <Button onClick={handleSave} disabled={saveMutation.isPending || dirtyKeys.length === 0}>
          <Save className="h-4 w-4 mr-2" />
          {saveMutation.isPending ? 'Saving…' : `Save${dirtyKeys.length ? ` (${dirtyKeys.length})` : ''}`}
        </Button>
      </div>

      <Tabs defaultValue="airtable">
        <TabsList>
          <TabsTrigger value="airtable"><Database className="h-4 w-4 mr-2" />Airtable Sync</TabsTrigger>
          <TabsTrigger value="filters"><SlidersHorizontal className="h-4 w-4 mr-2" />Filters</TabsTrigger>
          <TabsTrigger value="booking"><Wand2 className="h-4 w-4 mr-2" />Booking Engine</TabsTrigger>
          <TabsTrigger value="notifications"><Bell className="h-4 w-4 mr-2" />Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="airtable" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Airtable Sync</CardTitle>
              <CardDescription>
                Pull show schedules from Airtable on a regular interval. Sync is currently mocked — enabling it will start the polling loop once the integration is wired up.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Enable Airtable sync</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Turn polling on or off globally.</p>
                </div>
                <Switch
                  checked={!!get('airtable_sync_enabled', false)}
                  onCheckedChange={v => set('airtable_sync_enabled', v)}
                />
              </div>
              <Separator />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Poll interval (minutes)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={get('airtable_poll_interval_minutes', 5)}
                    onChange={e => set('airtable_poll_interval_minutes', Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Airtable base ID</Label>
                  <Input
                    placeholder="app1234567890"
                    value={get('airtable_base_id', '')}
                    onChange={e => set('airtable_base_id', e.target.value)}
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label>Airtable table name</Label>
                  <Input
                    placeholder="Shows"
                    value={get('airtable_table_name', '')}
                    onChange={e => set('airtable_table_name', e.target.value)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The Airtable API key is stored as a Supabase secret, not here. Add or rotate it from the Edge Functions secrets panel.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="filters" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Filter Mappings (Airtable)</CardTitle>
              <CardDescription>
                Map Showflow filter fields to your Airtable column names. Mock for now — these will be used once the sync worker is wired up.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(['program', 'timeframe', 'sort_field', 'status'] as const).map(field => (
                <div key={field} className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3 items-center">
                  <Label className="capitalize">{field.replace('_', ' ')}</Label>
                  <Input
                    placeholder="Airtable column name"
                    value={(get('filter_mappings', {})?.[field]) ?? ''}
                    onChange={e => set('filter_mappings', { ...(get('filter_mappings', {}) ?? {}), [field]: e.target.value })}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-display">Filter Visibility per Role</CardTitle>
              <CardDescription>
                Toggle which filters producers and artists see on each page. Admins always see everything.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              {PAGES.map(page => {
                const pageVis = get('filters_visibility', {})?.[page] ?? {};
                return (
                  <div key={page} className="space-y-3">
                    <h4 className="font-display font-semibold capitalize">{page}</h4>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-muted-foreground text-xs">
                            <th className="text-left py-2 pr-4 font-medium">Role</th>
                            {FILTER_KEYS.map(k => <th key={k} className="text-center py-2 px-2 font-medium capitalize">{k}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {ROLES.map(role => {
                            const row = pageVis[role] ?? {};
                            return (
                              <tr key={role} className="border-t border-border">
                                <td className="py-2 pr-4 capitalize font-medium">{role}</td>
                                {FILTER_KEYS.map(key => (
                                  <td key={key} className="text-center py-2 px-2">
                                    <Switch
                                      checked={!!row[key]}
                                      onCheckedChange={(v) => {
                                        const all = get('filters_visibility', {}) ?? {};
                                        const nextPage = { ...(all[page] ?? {}) };
                                        nextPage[role] = { ...(nextPage[role] ?? {}), [key]: v };
                                        set('filters_visibility', { ...all, [page]: nextPage });
                                      }}
                                    />
                                  </td>
                                ))}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="booking" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Booking Engine</CardTitle>
              <CardDescription>Tune the auto-suggest engine and soft-book lifecycle.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Enable auto-suggest</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Rank artists per slot using priority, skill match, and recent history.</p>
                </div>
                <Switch
                  checked={!!get('auto_suggest_enabled', true)}
                  onCheckedChange={v => set('auto_suggest_enabled', v)}
                />
              </div>
              <Separator />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Soft-book expiry (hours)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={get('soft_book_expiry_hours', 48)}
                    onChange={e => set('soft_book_expiry_hours', Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max suggestions per slot</Label>
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    value={get('max_suggestions', 5)}
                    onChange={e => set('max_suggestions', Number(e.target.value))}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Notifications</CardTitle>
              <CardDescription>Control in-app alerts for bookings and schedule changes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="font-medium">Enable in-app notifications</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">Producers and artists receive real-time alerts.</p>
                </div>
                <Switch
                  checked={!!get('notifications_enabled', true)}
                  onCheckedChange={v => set('notifications_enabled', v)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
