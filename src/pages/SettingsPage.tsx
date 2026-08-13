import { useState, useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { BOOKING_ENGINE_DEFAULTS, roleLabel } from '@/config/app.config';
import { resolveInitialTab } from '@/lib/settingsTabs';
import { useIsMobile } from '@/hooks/use-mobile';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from '@/features/auth/AuthContext';
import { useFeature } from '@/hooks/useEntitlements';
import { useCan } from '@/hooks/useCapabilities';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { Settings as SettingsIcon, Database, Bell, Wand2, Save, SlidersHorizontal, MapPin, BookOpen, UserCog, Building2, FileSignature, ShieldCheck, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { upsertOrgSetting, mergeOrgRows } from '@/data/settings';
import { computeSettingsDirtyKeys } from '@/lib/settings';
import { AirtableSyncTab } from '@/components/settings/AirtableSyncTab';
import { OrganizationTab } from '@/components/settings/OrganizationTab';
import { CastsCitiesTab } from '@/components/settings/CastsCitiesTab';
import { ProductionOwnershipTab } from '@/components/settings/ProductionOwnershipTab';
import { TrustDataTab } from '@/components/settings/trust/TrustDataTab';
import { DocumentationTab } from '@/components/settings/DocumentationTab';
import { BookingFlowTab } from '@/components/settings/bookingFlow/BookingFlowTab';
import { BOOKING_AUDIT_KEYS } from '@/components/settings/bookingFlow/auditKeys';
import { HireOrdersTab } from '@/components/settings/hireOrders/HireOrdersTab';
import { PermissionsTab } from '@/components/settings/permissions/PermissionsTab';
import { EmailTemplatesTab } from '@/components/settings/emailTemplates/EmailTemplatesTab';
import { Badge } from '@/components/ui/badge';

// Tabs whose content is a wide reference surface rather than a form: they drop
// the page's reading measure and run to `main`'s own 24px padding at every
// display width. Everything else keeps `max-w-5xl`, which is what a column of
// labelled inputs and toggle rows wants — Filters, measured uncapped at 1920,
// separates each row's four toggles from the label they belong to by 1400px.
// Trust & data is the opposite case: two tables and a claim matrix that wrapped
// five of eight row labels inside the capped 772px column. The measure that
// tabs in this set still need is applied to their own prose (see
// `src/components/settings/trust/*`), not to the page.
const WIDE_TABS = new Set(['trust']);

type FilterKey = 'program' | 'timeframe' | 'sort' | 'status';
const FILTER_KEYS: FilterKey[] = ['program', 'timeframe', 'sort', 'status'];
const PAGES: ('shows' | 'artists' | 'bookings')[] = ['shows', 'artists', 'bookings'];
const ROLES: ('producer' | 'artist')[] = ['producer', 'artist'];

// Every app_settings key this page's draft can edit. Used for the dirty calc so a
// first-ever value (a key with no persisted row yet, e.g. resend_from_address) still
// counts as dirty — iterating only persisted rows would leave it unsavable.
const EDITABLE_SETTING_KEYS: readonly string[] = [
  ...Object.keys(BOOKING_ENGINE_DEFAULTS),
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

  // Broad Settings, read-only floor: these tabs are now visible to producers, but every
  // write control inside them stays gated behind its own capability (admins always pass,
  // see useCan). Called unconditionally at top level for every render — Rules of Hooks.
  const canEditBookingSettings = useCan('edit_booking_settings');
  const canConfigureAirtable = useCan('configure_airtable');
  const canTriggerSync = useCan('trigger_sync');
  const canEditHireOrderSettings = useCan('edit_hire_order_settings');
  const canEditFilterSettings = useCan('edit_filter_settings');
  const canRenameOrg = useCan('rename_org');
  const canEditEmailTemplates = useCan('edit_email_templates');

  // Controlled so we know which tab is active: the Booking engine tab renders its own
  // scoped Save/Discard in FlowRail, and the page-level control must defer to it there.
  //
  // `?tab=` seeds the initial value (lazy useState initializer), so a deep link from a
  // notification or a setup step lands on the right section without pinning the page there:
  // a manual switch is plain local state and the URL is left alone.
  //
  // The seed alone runs once per MOUNT, which is not the same thing as "per deep link".
  // Every link that ships on this branch (the concept links in LadderStep/EligibilityStep)
  // is rendered off Settings, so it always remounts the page, but a notification deep-link
  // clicked while the user is already sitting on Settings only changes the URL: without the
  // effect below the page would ignore it. It also re-runs on `isAdmin`, which is what a
  // producer switching orgs needs: an admin-only tab resolves back to their default rather
  // than leaving them on a pane with no trigger and no content.
  //
  // Keyed on `location.key`, the identity of the NAVIGATION, not on the param value: a
  // second click on the same in-app link (the sync-held notification lands on
  // `?tab=airtable`, and the user may have switched tabs by hand in between) leaves the URL
  // byte-identical, so a value-keyed effect would not re-run and the click would be dead.
  // A manual tab switch is plain local state and touches neither the URL nor the key, so it
  // is still never undone by a re-render.
  //
  // Widened to `string` on purpose: the seed is a SettingsTabParam, but Tabs.onValueChange
  // hands back a plain string (and "hire-orders", deliberately not a deep-link target, is a
  // reachable tab), so narrowing the state to the whitelist would reject legitimate switches.
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const navKey = useLocation().key;
  const [activeTab, setActiveTab] = useState<string>(() => resolveInitialTab(tabParam, isAdmin));
  useEffect(() => {
    // No param means "wherever you were": a link into plain /settings must not drag someone
    // off the tab they are working on back to the role default.
    if (tabParam) setActiveTab(resolveInitialTab(tabParam, isAdmin));
    // `navKey` is a trigger, not an input: nothing in the callback reads it, which is
    // exactly the point, since a repeat navigation changes nothing else the callback sees.
  }, [tabParam, isAdmin, navKey]);
  // Keep the Tabs ARIA orientation matched to the actual layout axis: the nav rail is
  // vertical on md+ but a horizontal scroll row below md, so arrow-key roving (Up/Down
  // vs Left/Right) follows the visual direction at each breakpoint. Breakpoint (768px)
  // matches the `md:` boundary the rail styling uses.
  const isMobile = useIsMobile();

  const dirtyKeys = computeSettingsDirtyKeys(settings, draft, EDITABLE_SETTING_KEYS);

  const isDirty = dirtyKeys.length > 0;

  // Hide the page-level Save/Discard while on the Booking engine tab, but only when every
  // dirty key belongs to that tab (BOOKING_AUDIT_KEYS) AND the org is entitled to the
  // booking_flow module. If the draft also holds a dirty key from another tab (e.g. edited
  // on Notifications, then switched here), keep the page-level control visible so that other
  // change stays reachable: the rail's Save only ever writes BOOKING_AUDIT_KEYS, so it cannot
  // save it. When the org is NOT entitled, FlowRail hides its own Save/Discard entirely while
  // the from-address input stays editable. Without the entitlement check that edit would hide
  // the page-level Save and leave the user without any save control.
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

  const navGroups: { heading: string; items: { value: string; label: string; icon: typeof Building2; show: boolean; moduleState?: boolean }[] }[] = [
    { heading: "Organization", items: [
      { value: "organization", label: "Organization", icon: Building2, show: isAdmin || isProducer },
      { value: "permissions", label: "Roles & permissions", icon: ShieldCheck, show: isAdmin },
      { value: "trust", label: "Trust & data", icon: Lock, show: isAdmin || isProducer },
      { value: "production-ownership", label: "Production Ownership", icon: UserCog, show: isAdmin || isProducer },
      { value: "casts-cities", label: "Casts & Cities", icon: MapPin, show: true },
    ] },
    { heading: "Automation", items: [
      { value: "airtable", label: "Airtable Sync", icon: Database, show: isAdmin || isProducer },
      { value: "email-templates", label: "Email templates", icon: Bell, show: isAdmin || isProducer },
    ] },
    { heading: "Modules", items: [
      { value: "booking", label: "Booking engine", icon: Wand2, show: isAdmin || isProducer, moduleState: bookingFlowEntitled },
      { value: "hire-orders", label: "Hire orders", icon: FileSignature, show: isAdmin || isProducer, moduleState: hireOrdersEntitled },
    ] },
    { heading: "Preferences", items: [
      { value: "filters", label: "Filters", icon: SlidersHorizontal, show: isAdmin || isProducer },
      { value: "notifications", label: "Notifications", icon: Bell, show: isAdmin || isProducer },
    ] },
    { heading: "Help", items: [
      { value: "docs", label: "Documentation", icon: BookOpen, show: true },
    ] },
  ];

  return (
    // `max-w-5xl` is the right measure for twelve tabs of forms and lists and
    // the wrong one for the thirteenth: it left the page 172px short of the
    // viewport at 1440, 460px at 1728 and 652px at 1920 (`main` pads to 24px,
    // and every other page in the app sits there), and since the 220px nav
    // rail and the 32px gap come out of the same width it held every tab's
    // content column to 772px however wide the display was — while Trust &
    // data's matrix wrapped inside it. So the cap is now per tab. Raising it
    // to a wider fixed value was tried first and rejected: a fixed cap only
    // moves the void to a wider display (`xl:max-w-7xl` measured 204px at
    // 1728, worse than the 172px this started from).
    //
    // The whole page, not just the panel, takes the active tab's measure:
    // capping the header while the panel ran wide left the page-level Save and
    // the tab's own top-right action on right edges 628px apart at 1920.
    <div className={cn('space-y-6', !WIDE_TABS.has(activeTab) && 'max-w-5xl')}>
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

      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        orientation={isMobile ? 'horizontal' : 'vertical'}
        className="md:grid md:grid-cols-[220px_1fr] md:gap-8 md:items-start"
      >
        <TabsList className="mb-4 flex h-auto w-full items-stretch gap-1 overflow-x-auto bg-transparent p-0 md:sticky md:top-4 md:mb-0 md:flex-col md:gap-0 md:overflow-visible">
          {navGroups.map((group) => {
            const items = group.items.filter((i) => i.show);
            if (items.length === 0) return null;
            return (
              <div key={group.heading} className="contents md:mt-4 md:block md:first:mt-0">
                {/* Decorative visual grouping only. aria-hidden so this stray non-tab
                    child isn't announced inside the role="tablist"; the tabs themselves
                    carry clear labels, so screen-reader users get a clean flat list. */}
                <p
                  aria-hidden="true"
                  className="hidden px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground md:block"
                >
                  {group.heading}
                </p>
                {items.map((item) => (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    className="shrink-0 justify-start gap-2 rounded-md px-3 py-2 text-muted-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none hover:bg-muted/60 md:w-full"
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                    {item.moduleState !== undefined && (
                      <Badge variant={item.moduleState ? "accent" : "neutral"} className="ml-1 md:ml-auto">
                        {item.moduleState ? "On" : "Off"}
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
              </div>
            );
          })}
        </TabsList>

        <div className="min-w-0">
        <TabsContent value="casts-cities">
          <CastsCitiesTab currentOrgId={currentOrg?.id} canEnter={canEnter} />
        </TabsContent>

        <TabsContent value="production-ownership">
          <ProductionOwnershipTab currentOrgId={currentOrg?.id} canEnter={canEnter} />
        </TabsContent>

        {(isAdmin || isProducer) && (
          <TabsContent value="organization" className="mt-4">
            <OrganizationTab readOnly={!canRenameOrg} />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="permissions" className="mt-4">
            <PermissionsTab />
          </TabsContent>
        )}

        {(isAdmin || isProducer) && (
          <TabsContent value="trust" className="mt-4">
            <TrustDataTab />
          </TabsContent>
        )}

        <TabsContent value="airtable" className="mt-4">
          <AirtableSyncTab orgId={orgId} readOnly={!canConfigureAirtable} canTriggerSync={canTriggerSync} />
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
                                <td className="py-2 pr-4 font-medium">{roleLabel(role)}</td>
                                {FILTER_KEYS.map(key => (
                                  <td key={key} className="text-center py-2 px-2">
                                    <Switch
                                      checked={!!row[key]}
                                      disabled={!canEditFilterSettings}
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
            readOnly={!canEditBookingSettings}
          />
        </TabsContent>

        <TabsContent value="email-templates" className="mt-4">
          <EmailTemplatesTab readOnly={!canEditEmailTemplates} isSuperAdmin={isSuperAdmin} />
        </TabsContent>

        {(isAdmin || isProducer) && (
          <TabsContent value="hire-orders" className="mt-4">
            <HireOrdersTab readOnly={!canEditHireOrderSettings} />
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
                  disabled={!canEditFilterSettings}
                  onCheckedChange={v => set('notifications_enabled', v)}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="docs" className="mt-4">
          <DocumentationTab isSuperAdmin={isSuperAdmin} />
        </TabsContent>
        </div>
      </Tabs>

    </div>
  );
}
