import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import appLogicMd from '../../docs/app-logic.md?raw';
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
import { Settings as SettingsIcon, Database, Bell, Wand2, Save, SlidersHorizontal, MapPin, Plus, Trash2, Clock, AlertTriangle, BookOpen } from 'lucide-react';
import type { City, Cast } from '@/types';
import type { SubProgramSlotConfig, NestedSlotDefaults } from '@/hooks/useSubProgramSlots';

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

type ProgramSubProgramPair = { program: string; sub_program: string };

function SubProgramSlotsEditor({
  value,
  onChange,
  availablePairs,
}: {
  value: NestedSlotDefaults;
  onChange: (v: NestedSlotDefaults) => void;
  availablePairs: ProgramSubProgramPair[];
}) {
  const [newProgram, setNewProgram] = useState('');
  const [newSubProgram, setNewSubProgram] = useState('');
  const [newMainCast, setNewMainCast] = useState(1);
  const [newUnderstudies, setNewUnderstudies] = useState(0);

  const isConfigured = (program: string, subProgram: string) => Boolean(value?.[program]?.[subProgram]);
  const unconfigured = availablePairs.filter(p => !isConfigured(p.program, p.sub_program));

  const programs = Array.from(new Set(availablePairs.map(p => p.program))).sort();
  const subProgramsForNewProgram = newProgram
    ? Array.from(new Set(unconfigured.filter(p => p.program === newProgram).map(p => p.sub_program))).sort()
    : [];

  const configuredPrograms = Object.keys(value ?? {}).sort();

  function addRow() {
    if (!newProgram || !newSubProgram) return;
    const next: NestedSlotDefaults = { ...(value ?? {}) };
    next[newProgram] = { ...(next[newProgram] ?? {}), [newSubProgram]: { main_cast: newMainCast, understudies: newUnderstudies } };
    onChange(next);
    setNewProgram('');
    setNewSubProgram('');
    setNewMainCast(1);
    setNewUnderstudies(0);
  }

  function removeRow(program: string, subProgram: string) {
    const next: NestedSlotDefaults = { ...(value ?? {}) };
    if (next[program]) {
      const { [subProgram]: _, ...rest } = next[program];
      if (Object.keys(rest).length === 0) {
        delete next[program];
      } else {
        next[program] = rest;
      }
    }
    onChange(next);
  }

  function updateConfig(program: string, subProgram: string, field: keyof SubProgramSlotConfig, n: number) {
    const existing = value?.[program]?.[subProgram] ?? { main_cast: 0, understudies: 0 };
    const next: NestedSlotDefaults = { ...(value ?? {}) };
    next[program] = { ...(next[program] ?? {}), [subProgram]: { ...existing, [field]: n } };
    onChange(next);
  }

  return (
    <div className="space-y-6">
      {unconfigured.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Slot defaults missing for <strong>{unconfigured.length}</strong> program/sub-program combination{unconfigured.length === 1 ? '' : 's'}:{' '}
            <strong>{unconfigured.map(p => `${p.program} / ${p.sub_program}`).join(', ')}</strong>.
            Bookings for these cannot reach <em>fully filled</em> until defaults are set.
          </AlertDescription>
        </Alert>
      )}

      {configuredPrograms.length === 0 && unconfigured.length === 0 && (
        <p className="text-sm text-muted-foreground">No programs found — they will appear here once Airtable sync populates shows.</p>
      )}

      {configuredPrograms.map(program => {
        const subPrograms = Object.entries(value[program] ?? {});
        return (
          <div key={program} className="space-y-2">
            <h4 className="font-display font-semibold text-sm">{program}</h4>
            <div className="grid grid-cols-[1fr_80px_80px_32px] gap-2 text-xs text-muted-foreground px-1">
              <span>Sub-program</span>
              <span className="text-center">Main cast</span>
              <span className="text-center">Understudies</span>
              <span />
            </div>
            <div className="space-y-2">
              {subPrograms.map(([subProgram, config]) => (
                <div key={subProgram} className="grid grid-cols-[1fr_80px_80px_32px] items-center gap-2">
                  <span className="text-sm font-medium truncate">{subProgram}</span>
                  <Input
                    type="number"
                    min={0}
                    className="text-center h-8"
                    value={config.main_cast}
                    onChange={e => updateConfig(program, subProgram, 'main_cast', Number(e.target.value) || 0)}
                  />
                  <Input
                    type="number"
                    min={0}
                    className="text-center h-8"
                    value={config.understudies}
                    onChange={e => updateConfig(program, subProgram, 'understudies', Number(e.target.value) || 0)}
                  />
                  <button
                    onClick={() => removeRow(program, subProgram)}
                    className="text-muted-foreground hover:text-destructive p-1 rounded"
                    aria-label={`Remove ${program} / ${subProgram}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {unconfigured.length > 0 && (
        <form
          className="grid grid-cols-[1fr_1fr_80px_80px_auto] gap-2 pt-1"
          onSubmit={e => { e.preventDefault(); addRow(); }}
        >
          <Select value={newProgram} onValueChange={v => { setNewProgram(v); setNewSubProgram(''); }}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Program…" />
            </SelectTrigger>
            <SelectContent>
              {programs
                .filter(p => unconfigured.some(u => u.program === p))
                .map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={newSubProgram} onValueChange={setNewSubProgram} disabled={!newProgram}>
            <SelectTrigger className="h-8">
              <SelectValue placeholder="Sub-program…" />
            </SelectTrigger>
            <SelectContent>
              {subProgramsForNewProgram.map(sp => <SelectItem key={sp} value={sp}>{sp}</SelectItem>)}
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
          <Button type="submit" variant="outline" size="sm" disabled={!newProgram || !newSubProgram} className="h-8">
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

  const { data: showProgramSubProgramPairs } = useQuery({
    queryKey: ['shows-program-sub-programs'],
    enabled: canEnter,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shows')
        .select('program, sub_program')
        .not('program', 'is', null)
        .not('sub_program', 'is', null);
      if (error) throw error;
      const seen = new Set<string>();
      const pairs: ProgramSubProgramPair[] = [];
      (data ?? []).forEach(r => {
        const key = `${r.program}::${r.sub_program}`;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push({ program: r.program as string, sub_program: r.sub_program as string });
        }
      });
      pairs.sort((a, b) => a.program.localeCompare(b.program) || a.sub_program.localeCompare(b.sub_program));
      return pairs;
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
          {(isAdmin || isProducer) && <TabsTrigger value="booking"><Wand2 className="h-4 w-4 mr-2" />Booking Engine</TabsTrigger>}
          {isAdmin && <TabsTrigger value="notifications"><Bell className="h-4 w-4 mr-2" />Notifications</TabsTrigger>}
          <TabsTrigger value="docs"><BookOpen className="h-4 w-4 mr-2" />Documentation</TabsTrigger>
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
              <CardTitle className="font-display">Default Slots by Program &amp; Sub-Program</CardTitle>
              <CardDescription>
                Set the main cast and understudy slot counts for each program / sub-program combination. Combinations are sourced from existing shows. A date can only reach <em>fully filled</em> once its combination is configured.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SubProgramSlotsEditor
                value={get('sub_program_slots_defaults', {}) as NestedSlotDefaults}
                onChange={v => set('sub_program_slots_defaults', v)}
                availablePairs={showProgramSubProgramPairs ?? []}
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

        <TabsContent value="docs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-display">App Logic Guide</CardTitle>
              <CardDescription>
                How Showflow Pro works: roles, data model, eligibility, and the full availability → booking flow.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none text-foreground
                [&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-6 [&_h1]:mb-3
                [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:border-b [&_h2]:border-border [&_h2]:pb-1
                [&_h3]:font-display [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1
                [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-3 [&_p]:text-foreground
                [&_li]:text-sm [&_li]:leading-relaxed
                [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:mb-3
                [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:mb-3
                [&_code]:bg-muted [&_code]:text-foreground [&_code]:text-xs [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded
                [&_pre]:bg-muted [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:mb-3 [&_pre]:text-xs
                [&_pre_code]:bg-transparent [&_pre_code]:p-0
                [&_table]:w-full [&_table]:text-sm [&_table]:border-collapse [&_table]:mb-4
                [&_th]:text-left [&_th]:font-medium [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-3 [&_th]:py-1.5
                [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_td]:text-sm [&_td]:align-top
                [&_hr]:border-border [&_hr]:my-4
                [&_strong]:font-semibold [&_strong]:text-foreground
                [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{appLogicMd}</ReactMarkdown>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

    </div>
  );
}
