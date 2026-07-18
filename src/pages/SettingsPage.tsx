import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ROUTES, BOOKING_ENGINE_DEFAULTS } from '@/config/app.config';
import { useSettingsWarnings } from '@/hooks/useSettingsWarnings';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from '@/features/auth/AuthContext';
import { useFeature } from '@/hooks/useEntitlements';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { toast } from 'sonner';
import { Settings as SettingsIcon, Database, Bell, Wand2, Save, SlidersHorizontal, MapPin, Clock, BookOpen, UserCog, Building2, FileSignature } from 'lucide-react';
import { upsertOrgSetting, mergeOrgRows } from '@/data/settings';
import { computeSettingsDirtyKeys } from '@/lib/settings';
import { AirtableSyncTab } from '@/components/settings/AirtableSyncTab';
import { OrganizationTab } from '@/components/settings/OrganizationTab';
import { CastsCitiesTab } from '@/components/settings/CastsCitiesTab';
import { ProductionOwnershipTab } from '@/components/settings/ProductionOwnershipTab';
import { DocumentationTab } from '@/components/settings/DocumentationTab';
import { BookingFlowTab } from '@/components/settings/bookingFlow/BookingFlowTab';
import { BOOKING_AUDIT_KEYS } from '@/components/settings/bookingFlow/auditKeys';
import { HireOrdersTab } from '@/components/settings/hireOrders/HireOrdersTab';

type FilterKey = 'program' | 'timeframe' | 'sort' | 'status';
const FILTER_KEYS: FilterKey[] = ['program', 'timeframe', 'sort', 'status'];
const PAGES: ('shows' | 'artists' | 'bookings')[] = ['shows', 'artists', 'bookings'];
const ROLES: ('producer' | 'artist')[] = ['producer', 'artist'];

// Every app_settings key this page's draft can edit. Used for the dirty calc so a
// first-ever value (a key with no persisted row yet, e.g. resend_from_address) still
// counts as dirty — iterating only persisted rows would leave it unsavable.
const EDITABLE_SETTING_KEYS: readonly string[] = [
  ...Object.keys(BOOKING_ENGINE_DEFAULTS),
  'email_template_overrides',
  'filters_visibility',
  'notifications_enabled',
  'booking_flow',
];

type SettingRow = {
  key: string;
  value: unknown;
};

/** Shape of the `filters_visibility` setting: page → role → filter-key → on/off. */
type FiltersVisibility = Record<string, Record<string, Record<string, boolean>>>;

function ShowSlotsEditor() {
  const warn = useSettingsWarnings(); // returns { schedulingWarnings, hasAnyWarning } directly
  return (
    <div className="space-y-3">
      {warn.schedulingWarnings > 0 ? (
        <Alert>
          <AlertDescription>
            {warn.schedulingWarnings} production(s) have no slot configuration. Bookings for these can't reach
            <em> fully filled</em> until slots are set.
          </AlertDescription>
        </Alert>
      ) : null}
      <p className="text-sm text-muted-foreground">
        Slot configuration has moved to the <Link to={ROUTES.PRODUCTIONS} className="text-primary underline">Productions</Link> page.
      </p>
    </div>
  );
}

// ─── SettingsPage ────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const { hasRole, currentOrg, isSuperAdmin } = useAuth();
  const orgId = currentOrg?.id ?? null;
  const qc = useQueryClient();
  const bookingFlowEntitled = useFeature('booking_flow');
  const hireOrdersEntitled = useFeature('hire_orders');

  const { data: settings, isLoading } = useQuery({
    queryKey: ['app-settings', 'all', orgId],
    queryFn: async () => {
      let q = supabase.from('app_settings').select('key, value, org_id');
      q = orgId ? q.or(`org_id.eq.${orgId},org_id.is.null`) : q.is('org_id', null);
      const { data, error } = await q;
      if (error) throw error;
      // resolve: org row wins over platform row, per key (shared helper)
      const byKey = mergeOrgRows((data ?? []) as { key: string; value: unknown; org_id: string | null }[]);
      return Array.from(byKey.entries()).map(([key, v]) => ({ key, value: v.value })) as SettingRow[];
    },
  });

  const [draft, setDraft] = useState<Record<string, unknown>>({});
  // Track which org the draft was last seeded for so switching orgs re-seeds even
  // when the previous draft was dirty; refetches of the SAME org must not clobber
  // in-progress edits (a child AirtableSyncTab autosave invalidates ['app-settings'],
  // and AuthContext realtime invalidates it on any app_settings write).
  const seededOrgRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (!settings) return;
    const seed = () => {
      const next: Record<string, unknown> = {};
      for (const s of settings) next[s.key] = s.value;
      setDraft(next);
      seededOrgRef.current = orgId;
    };
    // New entity (org switch or first load) → always adopt server state.
    if (seededOrgRef.current !== orgId) { seed(); return; }
    // Same org refetched: only re-seed when the user has no unsaved edits, otherwise
    // an unrelated invalidation would silently wipe in-progress Booking-Engine/Filters edits.
    const dirty = computeSettingsDirtyKeys(settings, draft, EDITABLE_SETTING_KEYS);
    if (dirty.length === 0) seed();
    // `draft` is read but DELIBERATELY excluded from the deps: seed() calls setDraft() with a
    // fresh object, so including `draft` would re-run this effect immediately (draft changed →
    // not dirty → seed → …) in an infinite reseed loop. React Query structural sharing keeps
    // `settings` referentially stable across identical refetches, so gating on [settings, orgId]
    // runs the effect only on a real org switch or genuine data change; `draft` here just
    // captures the value at that render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, orgId]);

  const saveMutation = useMutation({
    mutationFn: async (updates: { key: string; value: unknown }[]) => {
      if (!orgId) throw new Error('No active organization');
      for (const u of updates) {
        await upsertOrgSetting(supabase, orgId, u.key, u.value as Json);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['app-settings'] });
      toast.success('Settings saved');
    },
    onError: (e: Error) => toast.error(e.message ?? 'Failed to save'),
  });

  const isAdmin = hasRole('admin');
  const isProducer = hasRole('producer');
  const canEnter = isAdmin || isProducer;
  const { schedulingWarnings } = useSettingsWarnings();

  // Controlled so we know which tab is active: the Booking flow tab renders its own
  // scoped Save/Discard in FlowRail, and the page-level control must defer to it there.
  const [activeTab, setActiveTab] = useState(isAdmin ? 'organization' : 'scheduling');

  const dirtyKeys = computeSettingsDirtyKeys(settings, draft, EDITABLE_SETTING_KEYS);

  const isDirty = dirtyKeys.length > 0;

  // Hide the page-level Save/Discard while on the Booking flow tab, but only when every
  // dirty key belongs to that tab (BOOKING_AUDIT_KEYS) AND the org is entitled to the
  // booking_flow module. If the draft also holds a dirty key from another tab (e.g. edited
  // on Notifications, then switched here), keep the page-level control visible so that other
  // change stays reachable: the rail's Save only ever writes BOOKING_AUDIT_KEYS, so it cannot
  // save it. When the org is NOT entitled, FlowRail hides its own Save/Discard entirely (the
  // flow fields are locked read-only) but the from-address input and EmailTemplatesCard stay
  // editable — both write keys inside BOOKING_AUDIT_KEYS (resend_from_address,
  // email_template_overrides). Without the entitlement check those edits would be dirty,
  // hidePageLevelSave would still fire, and the user would have no Save control anywhere on
  // the page (a locked org has no rail Save to fall back to).
  const hidePageLevelSave =
    activeTab === 'booking' && bookingFlowEntitled && dirtyKeys.every(k => BOOKING_AUDIT_KEYS.includes(k));

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

  const get = (key: string, fallback: unknown = '') => draft[key] ?? fallback;
  const set = (key: string, value: unknown) => setDraft(d => ({ ...d, [key]: value }));

  const handleSave = () => {
    const updates = dirtyKeys.map(k => ({ key: k, value: draft[k] }));
    if (updates.length === 0) {
      toast.info('No changes to save');
      return;
    }
    saveMutation.mutate(updates);
  };

  // Booking-flow tab: the FlowRail saves/discards only the keys it owns, so the
  // rail's dirty count and Save button stay scoped to this tab.
  const bookingDirtyKeys = dirtyKeys.filter(k => BOOKING_AUDIT_KEYS.includes(k));

  const handleSaveBooking = () => {
    const updates = bookingDirtyKeys.map(k => ({ key: k, value: draft[k] }));
    if (updates.length === 0) return;
    saveMutation.mutate(updates);
  };

  const handleDiscardBooking = () => {
    const saved = new Map(settings.map(s => [s.key, s.value]));
    setDraft(d => {
      const next = { ...d };
      for (const k of BOOKING_AUDIT_KEYS) {
        if (saved.has(k)) next[k] = saved.get(k);
        else delete next[k];
      }
      return next;
    });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-[32px] font-semibold tracking-tight flex items-center gap-3">
            <SettingsIcon className="h-7 w-7 text-primary" />
            Settings
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure integrations, booking behaviour, and notifications. Changes apply immediately.
          </p>
        </div>
        {canEnter && !hidePageLevelSave && (
          <Button onClick={handleSave} disabled={saveMutation.isPending || !isDirty}>
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? 'Saving…' : `Save${isDirty ? ` (${dirtyKeys.length})` : ''}`}
          </Button>
        )}
      </div>

      {isDirty && !hidePageLevelSave && (
        <div className="flex items-center justify-between gap-4 rounded-lg border border-warning bg-warning/10 px-4 py-2.5 text-sm text-warning">
          <span>You have unsaved changes. They will be lost if you navigate away.</span>
          <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saveMutation.isPending ? 'Saving…' : 'Save now'}
          </Button>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          {isAdmin && <TabsTrigger value="organization"><Building2 className="h-4 w-4 mr-2" />Organization</TabsTrigger>}
          {isAdmin && <TabsTrigger value="airtable"><Database className="h-4 w-4 mr-2" />Airtable Sync</TabsTrigger>}
          {isAdmin && <TabsTrigger value="filters"><SlidersHorizontal className="h-4 w-4 mr-2" />Filters</TabsTrigger>}
          <TabsTrigger value="casts-cities"><MapPin className="h-4 w-4 mr-2" />Casts & Cities</TabsTrigger>
          {(isAdmin || isProducer) && <TabsTrigger value="production-ownership"><UserCog className="h-4 w-4 mr-2" />Production Ownership</TabsTrigger>}
          <TabsTrigger value="scheduling" className="gap-2">
            <Clock className="h-4 w-4" />
            Scheduling
            {schedulingWarnings > 0 && (
              <span className="h-2 w-2 rounded-full bg-destructive shrink-0" />
            )}
          </TabsTrigger>
          {isAdmin && <TabsTrigger value="booking"><Wand2 className="h-4 w-4 mr-2" />Booking flow</TabsTrigger>}
          {isAdmin && hireOrdersEntitled && <TabsTrigger value="hire-orders"><FileSignature className="h-4 w-4 mr-2" />Hire orders</TabsTrigger>}
          {isAdmin && <TabsTrigger value="notifications"><Bell className="h-4 w-4 mr-2" />Notifications</TabsTrigger>}
          <TabsTrigger value="docs"><BookOpen className="h-4 w-4 mr-2" />Documentation</TabsTrigger>
        </TabsList>

        <TabsContent value="casts-cities">
          <CastsCitiesTab currentOrgId={currentOrg?.id} canEnter={canEnter} />
        </TabsContent>

        <TabsContent value="production-ownership">
          <ProductionOwnershipTab currentOrgId={currentOrg?.id} canEnter={canEnter} />
        </TabsContent>

        <TabsContent value="scheduling" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Slots per Show</CardTitle>
              <CardDescription>
                Set the main cast and understudy slot counts for each show. A date can only reach <em>fully filled</em> once its show has both values set.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ShowSlotsEditor />
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
          <TabsContent value="organization" className="mt-4">
            <OrganizationTab />
          </TabsContent>
        )}

        <TabsContent value="airtable" className="mt-4">
          <AirtableSyncTab orgId={orgId} />
        </TabsContent>

        <TabsContent value="filters" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-display">Filter Visibility per Role</CardTitle>
              <CardDescription>
                Toggle which filters producers and artists see on each page. Admins always see everything.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              {PAGES.map(page => {
                const pageVis = (get('filters_visibility', {}) as FiltersVisibility)?.[page] ?? {};
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
                                        const all = (get('filters_visibility', {}) as FiltersVisibility) ?? {};
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
          {/* Keyed by org so per-org component state (e.g. the remembered
              producer_confirmation choice) resets on org switch. The draft itself
              lives at page level, so remounting the tab loses nothing. */}
          <BookingFlowTab
            key={orgId ?? 'no-org'}
            get={get}
            set={set}
            dirtyKeys={bookingDirtyKeys}
            saving={saveMutation.isPending}
            onSave={handleSaveBooking}
            onDiscard={handleDiscardBooking}
          />
        </TabsContent>

        {isAdmin && hireOrdersEntitled && (
          <TabsContent value="hire-orders" className="mt-4">
            <HireOrdersTab />
          </TabsContent>
        )}

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
          <DocumentationTab isSuperAdmin={isSuperAdmin} />
        </TabsContent>
      </Tabs>

    </div>
  );
}
