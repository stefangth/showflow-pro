import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/config/app.config';
import { useSettingsWarnings } from '@/hooks/useSettingsWarnings';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Settings as SettingsIcon, Database, Bell, Wand2, Save, SlidersHorizontal, MapPin, Plus, Trash2, Clock, AlertTriangle } from 'lucide-react';
import type { City, Cast } from '@/types';
import type { SubProgramSlotConfig } from '@/hooks/useSubProgramSlots';

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

function SubProgramSlotsEditor({
  value,
  onChange,
  availableSubPrograms,
}: {
  value: Record<string, SubProgramSlotConfig>;
  onChange: (v: Record<string, SubProgramSlotConfig>) => void;
  availableSubPrograms: string[];
}) {
  const [selectedSubProgram, setSelectedSubProgram] = useState('');
  const [newMainCast, setNewMainCast] = useState(1);
  const [newUnderstudies, setNewUnderstudies] = useState(0);

  const entries = Object.entries(value);
  const unconfigured = availableSubPrograms.filter(sp => !value[sp]);

  function addRow() {
    if (!selectedSubProgram) return;
    onChange({ ...value, [selectedSubProgram]: { main_cast: newMainCast, understudies: newUnderstudies } });
    setSelectedSubProgram('');
    setNewMainCast(1);
    setNewUnderstudies(0);
  }

  function removeRow(key: string) {
    const next = { ...value };
    delete next[key];
    onChange(next);
  }

  function updateConfig(key: string, field: keyof SubProgramSlotConfig, n: number) {
    onChange({ ...value, [key]: { ...value[key], [field]: n } });
  }

  return (
    <div className="space-y-4">
      {unconfigured.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Slot defaults missing for: <strong>{unconfigured.join(', ')}</strong>. Bookings for these sub-programs cannot be processed until defaults are set.
          </AlertDescription>
        </Alert>
      )}

      {(entries.length > 0 || unconfigured.length > 0) && (
        <div className="grid grid-cols-[1fr_80px_80px_32px] gap-2 text-xs text-muted-foreground px-1">
          <span>Sub-program</span>
          <span className="text-center">Main cast</span>
          <span className="text-center">Understudies</span>
          <span />
        </div>
      )}

      {entries.length > 0 && (
        <div className="space-y-2">
          {entries.map(([subProgram, config]) => (
            <div key={subProgram} className="grid grid-cols-[1fr_80px_80px_32px] items-center gap-2">
              <span className="text-sm font-medium truncate">{subProgram}</span>
              <Input
                type="number"
                min={0}
                className="text-center h-8"
                value={config.main_cast}
                onChange={e => updateConfig(subProgram, 'main_cast', Number(e.target.value) || 0)}
              />
              <Input
                type="number"
                min={0}
                className="text-center h-8"
                value={config.understudies}
                onChange={e => updateConfig(subProgram, 'understudies', Number(e.target.value) || 0)}
              />
              <button
                onClick={() => removeRow(subProgram)}
                className="text-muted-foreground hover:text-destructive p-1 rounded"
                aria-label={`Remove ${subProgram}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {entries.length === 0 && unconfigured.length === 0 && (
        <p className="text-sm text-muted-foreground">No sub-programs found — they will appear here once Airtable sync populates shows.</p>
      )}

      {unconfigured.length > 0 && (
        <form
          className="grid grid-cols-[1fr_80px_80px_auto] gap-2 pt-1"
          onSubmit={e => { e.preventDefault(); addRow(); }}
        >
          <Select value={selectedSubProgram} onValueChange={setSelectedSubProgram}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Select sub-program…" />
            </SelectTrigger>
            <SelectContent>
              {unconfigured.map(sp => (
                <SelectItem key={sp} value={sp}>{sp}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={0}
            className="text-center h-8"
            value={newMainCast}
            onChange={e => setNewMainCast(Number(e.target.value) || 0)}
            placeholder="Main"
          />
          <Input
            type="number"
            min={0}
            className="text-center h-8"
            value={newUnderstudies}
            onChange={e => setNewUnderstudies(Number(e.target.value) || 0)}
            placeholder="U/S"
          />
          <Button type="submit" variant="outline" size="sm" disabled={!selectedSubProgram} className="h-8">
            <Plus className="h-4 w-4" />
          </Button>
        </form>
      )}
    </div>
  );
}

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
  const { schedulingWarnings } = useSettingsWarnings();

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

  const { data: showSubPrograms } = useQuery({
    queryKey: ['shows-sub-programs'],
    enabled: canEnter,
    queryFn: async () => {
      const { data, error } = await supabase.from('shows').select('sub_program').not('sub_program', 'is', null);
      if (error) throw error;
      const unique = [...new Set((data ?? []).map(r => r.sub_program as string))].sort();
      return unique;
    },
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

  const dirtyKeys = (settings ?? [])
    .filter(s => JSON.stringify(s.value) !== JSON.stringify(draft[s.key]))
    .map(s => s.key);

  const isDirty = dirtyKeys.length > 0;

  // Warn on browser tab close / refresh — must be before any early returns (Rules of Hooks)
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

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
        {canEnter && (
          <Button onClick={handleSave} disabled={saveMutation.isPending || !isDirty}>
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? 'Saving…' : `Save${isDirty ? ` (${dirtyKeys.length})` : ''}`}
          </Button>
        )}
      </div>

      {isDirty && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-warning bg-warning/10 px-4 py-2.5 text-sm text-warning">
          <span>You have unsaved changes — they will be lost if you navigate away.</span>
          <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saveMutation.isPending ? 'Saving…' : 'Save now'}
          </Button>
        </div>
      )}

      <Tabs defaultValue={isAdmin ? 'airtable' : 'scheduling'}>
        <TabsList>
          {isAdmin && <TabsTrigger value="airtable"><Database className="h-4 w-4 mr-2" />Airtable Sync</TabsTrigger>}
          {isAdmin && <TabsTrigger value="filters"><SlidersHorizontal className="h-4 w-4 mr-2" />Filters</TabsTrigger>}
          <TabsTrigger value="casts-cities"><MapPin className="h-4 w-4 mr-2" />Casts & Cities</TabsTrigger>
          <TabsTrigger value="scheduling" className="gap-2">
            <Clock className="h-4 w-4" />
            Scheduling
            {schedulingWarnings > 0 && (
              <span className="h-2 w-2 rounded-full bg-destructive shrink-0" />
            )}
          </TabsTrigger>
          {isAdmin && <TabsTrigger value="booking"><Wand2 className="h-4 w-4 mr-2" />Booking Engine</TabsTrigger>}
          {isAdmin && <TabsTrigger value="notifications"><Bell className="h-4 w-4 mr-2" />Notifications</TabsTrigger>}
        </TabsList>

        <TabsContent value="casts-cities" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Cities</CardTitle>
              <CardDescription>
                Pulled from Airtable once sync is wired — currently editable for mock data. Cities are used to scope cast eligibility per show.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <form
                className="flex gap-2"
                onSubmit={(e) => { e.preventDefault(); if (newCity.trim()) addCity.mutate(newCity.trim()); }}
              >
                <Input placeholder="New city name" value={newCity} onChange={e => setNewCity(e.target.value)} />
                <Button type="submit" disabled={!newCity.trim() || addCity.isPending}>
                  <Plus className="h-4 w-4 mr-1" />Add
                </Button>
              </form>
              <div className="flex flex-wrap gap-2 pt-2">
                {(cities ?? []).map(c => (
                  <Badge key={c.id} variant="secondary" className="gap-2 py-1.5 pl-3 pr-1">
                    {c.name}
                    <button
                      onClick={() => removeCity.mutate(c.id)}
                      className="rounded hover:bg-background/40 p-0.5"
                      aria-label={`Remove ${c.name}`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {(cities?.length ?? 0) === 0 && <p className="text-sm text-muted-foreground">No cities yet.</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-display">Casts</CardTitle>
              <CardDescription>
                Manage casts and their members on the <Link className="text-primary underline" to={ROUTES.ARTISTS}>Artists page</Link>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(casts?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No casts yet.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {casts!.map(c => (
                    <div key={c.id} className="p-3 rounded-lg border border-border">
                      <p className="font-medium text-sm">{c.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {castCounts?.[c.id] ?? 0} member{(castCounts?.[c.id] ?? 0) === 1 ? '' : 's'}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scheduling" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Soft-Book Expiry</CardTitle>
              <CardDescription>
                Soft bookings that aren't confirmed within this window are automatically cancelled by a scheduled database job.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-w-xs">
                <Label>Expiry window (hours)</Label>
                <Input
                  type="number"
                  min={1}
                  value={get('soft_book_expiry_hours', 48)}
                  onChange={e => set('soft_book_expiry_hours', Number(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">Default: 48 hours. The job runs every hour on the hour.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-display">Default Slots by Sub-Program</CardTitle>
              <CardDescription>
                Set the main cast and understudy slot counts for each sub-program. Sub-programs are sourced from Airtable. All sub-programs must be configured before bookings can be processed.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SubProgramSlotsEditor
                value={get('sub_program_slots_defaults', {}) as Record<string, SubProgramSlotConfig>}
                onChange={v => set('sub_program_slots_defaults', v)}
                availableSubPrograms={showSubPrograms ?? []}
              />
            </CardContent>
          </Card>
        </TabsContent>

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
              <div className="max-w-xs space-y-2">
                <Label>Max suggestions per slot</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={get('max_suggestions', 5)}
                  onChange={e => set('max_suggestions', Number(e.target.value))}
                />
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
