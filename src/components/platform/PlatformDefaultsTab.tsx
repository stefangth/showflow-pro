import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveOrgSetting } from "@/data/settings";
import {
  savePlatformSetting, EMPTY_STARTER_TEMPLATE, type StarterCatalogTemplate,
  fetchPlatformBookingDefaults, savePlatformBookingDefaults, type BookingEngineDefaults,
} from "@/data/platform";
import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";
import type { Json } from "@/integrations/supabase/types";
import { FEATURE_KEYS, FEATURE_REGISTRY, type FeatureKey } from "@/lib/entitlements";
import { TERMS_LIBRARY_KEY } from "@/data/hireOrders";
import { useDerivedDraft } from "@/hooks/useDerivedDraft";
import { HIRE_ORDER_STARTER_TERMS } from "@/lib/hireOrders/starterTerms";
import type { HireOrderTemplate } from "@/lib/hireOrders/terms";
import { parseLines, serializeLines, parseCasts, serializeCasts } from "./templateText";
import { POLL_INTERVAL_PRESETS, MIN_POLL_INTERVAL_MINUTES } from "@/lib/airtablePoll";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function PlatformDefaultsTab() {
  return (
    <div className="space-y-6">
      <StarterCatalogCard />
      <BookingEngineDefaultsCard />
      <AirtableDefaultsCard />
      <DefaultModulesCard />
      <HireOrderTermsLibraryCard />
    </div>
  );
}

function StarterCatalogCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["platform", "starter-template"],
    queryFn: () => resolveOrgSetting<StarterCatalogTemplate>(supabase, null, "starter_catalog_template", EMPTY_STARTER_TEMPLATE),
  });

  // Views of the stored template, not copies seeded into state by an effect. Save
  // persists these three verbatim, and a seeded copy is still empty in the commit
  // that opens the isLoading gate below - a click there wrote an EMPTY starter
  // catalog, which every org provisioned afterwards would then be seeded from. An
  // unrelated refetch (window refocus) still cannot wipe edits in progress, and a
  // stale tab no longer reverts what another super-admin just saved.
  const [skills, setSkills] = useDerivedDraft(data && serializeLines(data.skills ?? []), "");
  const [cities, setCities] = useDerivedDraft(data && serializeLines(data.cities ?? []), "");
  const [casts, setCasts] = useDerivedDraft(data && serializeCasts(data.casts ?? []), "");

  const save = useMutation({
    mutationFn: () => savePlatformSetting(supabase, "starter_catalog_template", {
      skills: parseLines(skills), cities: parseLines(cities), casts: parseCasts(casts),
    } as unknown as Json),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["platform", "starter-template"] }); toast.success("Starter catalog saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) return <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>;

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Starter catalog template</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          New organizations are seeded with these skills, cities and casts. One item per line. Casts use <code>Name :: Description</code>.
        </p>
        <div className="space-y-1.5"><Label htmlFor="t-skills">Skills</Label><Textarea id="t-skills" rows={6} value={skills} onChange={(e) => setSkills(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="t-cities">Cities</Label><Textarea id="t-cities" rows={3} value={cities} onChange={(e) => setCities(e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="t-casts">Casts</Label><Textarea id="t-casts" rows={3} value={casts} onChange={(e) => setCasts(e.target.value)} /></div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save defaults</Button>
      </CardContent>
    </Card>
  );
}

/**
 * Platform-wide booking-engine defaults (org_id IS NULL). Every org that hasn't
 * set its own override in Settings → Booking Engine inherits these; the inputs'
 * placeholders show the code fallback (BOOKING_ENGINE_DEFAULTS) used if a field
 * is left unset.
 */
function BookingEngineDefaultsCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["platform", "booking-defaults"],
    queryFn: () => fetchPlatformBookingDefaults(supabase),
  });

  // A view of the stored defaults, not a copy seeded into state by an effect. These
  // cascade to every org that has not overridden them, and a seeded copy is still
  // BOOKING_ENGINE_DEFAULTS in the commit that opens the isLoading gate below, so a
  // Save there replaced the platform's real values with the code fallbacks. Edits in
  // progress are still pinned against an unrelated refetch.
  const [form, setForm] = useDerivedDraft<BookingEngineDefaults>(data, BOOKING_ENGINE_DEFAULTS);

  const save = useMutation({
    mutationFn: () => {
      if (form.offer_response_window_hours < 1) {
        throw new Error("Offer response window must be at least 1 hour");
      }
      return savePlatformBookingDefaults(supabase, form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform", "booking-defaults"] });
      qc.invalidateQueries({ queryKey: ["app-settings"] }); // org Settings forms inherit these defaults
      toast.success("Booking engine defaults saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) return <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>;

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Booking engine defaults</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Platform-wide fallbacks for the booking engine. An organization that sets its own value in
          Settings → Booking Engine overrides these.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="bd-window">Offer response window (hours)</Label>
            <Input
              id="bd-window" type="number" min={1}
              value={form.offer_response_window_hours}
              placeholder={String(BOOKING_ENGINE_DEFAULTS.offer_response_window_hours)}
              onChange={(e) => setForm((f) => ({ ...f, offer_response_window_hours: Number(e.target.value) }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bd-offer-hour">Offer digest hour (Berlin)</Label>
            <Input
              id="bd-offer-hour" type="number" min={0} max={23}
              value={form.offer_digest_hour_berlin}
              placeholder={String(BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin)}
              onChange={(e) => setForm((f) => ({ ...f, offer_digest_hour_berlin: Number(e.target.value) }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bd-conf-hour">Confirmation digest hour (Berlin)</Label>
            <Input
              id="bd-conf-hour" type="number" min={0} max={23}
              value={form.confirmation_digest_hour_berlin}
              placeholder={String(BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin)}
              onChange={(e) => setForm((f) => ({ ...f, confirmation_digest_hour_berlin: Number(e.target.value) }))}
            />
          </div>
        </div>
        <div className="space-y-1.5 max-w-sm">
          <Label htmlFor="bd-from">Default sender address (Resend)</Label>
          <Input
            id="bd-from" type="text"
            value={form.resend_from_address}
            placeholder={BOOKING_ENGINE_DEFAULTS.resend_from_address}
            onChange={(e) => setForm((f) => ({ ...f, resend_from_address: e.target.value }))}
          />
          <p className="text-xs text-muted-foreground">Sender for all transactional email unless an org overrides it.</p>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save booking defaults</Button>
      </CardContent>
    </Card>
  );
}

/** Platform-wide default Airtable poll interval (org_id IS NULL). Orgs override it in
 *  Settings → Airtable Sync. */
function AirtableDefaultsCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["platform", "airtable-interval"],
    queryFn: () => resolveOrgSetting<number>(supabase, null, "airtable_poll_interval_minutes", MIN_POLL_INTERVAL_MINUTES),
  });

  const save = useMutation({
    mutationFn: (minutes: number) => savePlatformSetting(supabase, "airtable_poll_interval_minutes", minutes as unknown as Json),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform", "airtable-interval"] });
      qc.invalidateQueries({ queryKey: ["airtable", "settings"] }); // org tabs inherit this default
      toast.success("Airtable sync default saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>;

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Airtable sync defaults</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Default polling frequency for organizations that haven't set their own in
          Settings → Airtable Sync. The poll runs on a shared 5-minute cycle; this sets how
          often each org is actually synced.
        </p>
        <div className="space-y-1.5 max-w-xs">
          <Label>Default sync frequency</Label>
          <Select value={String(data ?? MIN_POLL_INTERVAL_MINUTES)} onValueChange={(v) => save.mutate(Number(v))}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {POLL_INTERVAL_PRESETS.map((p) => (
                <SelectItem key={p.value} value={String(p.value)}>{p.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

/** Registry fallback for the default_entitlements platform setting, derived from
 *  FEATURE_REGISTRY so it can't drift from each feature's own defaultEnabled. */
const DEFAULT_ENTITLEMENTS_FALLBACK: Record<FeatureKey, boolean> = Object.fromEntries(
  FEATURE_KEYS.map((key) => [key, FEATURE_REGISTRY[key].defaultEnabled]),
) as Record<FeatureKey, boolean>;

/** Platform-wide default module entitlements (org_id IS NULL). Seeded onto every
 *  new org at creation time by provision-org; an org's own toggle in Edit organization
 *  overrides it afterward. */
function DefaultModulesCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["platform", "default-entitlements"],
    queryFn: () => resolveOrgSetting<Record<FeatureKey, boolean>>(
      supabase, null, "default_entitlements", DEFAULT_ENTITLEMENTS_FALLBACK,
    ),
  });

  const save = useMutation({
    mutationFn: (value: Record<FeatureKey, boolean>) =>
      savePlatformSetting(supabase, "default_entitlements", value as unknown as Json),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["platform"] });
      toast.success("Default modules saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;
  if (isError) return <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>;

  const current = data ?? DEFAULT_ENTITLEMENTS_FALLBACK;

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Default modules</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Modules new organizations start with, seeded at creation time. An organization's own
          toggle in Edit organization overrides this afterward.
        </p>
        {FEATURE_KEYS.map((key) => {
          const def = FEATURE_REGISTRY[key];
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor={`default-module-${key}`} className="font-medium">{def.label}</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{def.description}</p>
              </div>
              <Switch
                id={`default-module-${key}`}
                aria-label={def.label}
                checked={current[key] ?? def.defaultEnabled}
                disabled={save.isPending}
                onCheckedChange={(checked) => save.mutate({ ...current, [key]: checked })}
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

interface TermsLibraryValue {
  templates: HireOrderTemplate[];
}

/**
 * The platform hire-order terms library. Orgs import a COPY of these into their own
 * `hire_order_terms`, so editing here never changes contract text an org is already
 * issuing. Stored as JSON because the shape is nested; the starter set is the fallback
 * when no row exists, so there is nothing to seed in a new environment.
 */
function HireOrderTermsLibraryCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["platform", "terms-library"],
    queryFn: () =>
      resolveOrgSetting<TermsLibraryValue>(supabase, null, TERMS_LIBRARY_KEY, {
        templates: HIRE_ORDER_STARTER_TERMS,
      }),
  });

  // A view of the stored library, not a copy seeded into state by an effect: Save
  // parses and persists this text verbatim, and a seeded copy is still empty in the
  // commit that opens the isLoading gate below.
  const [text, setText] = useDerivedDraft(
    data && JSON.stringify(data.templates ?? HIRE_ORDER_STARTER_TERMS, null, 2),
    "",
  );
  const [parseError, setParseError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () => {
      let templates: HireOrderTemplate[];
      try {
        templates = JSON.parse(text) as HireOrderTemplate[];
      } catch {
        throw new Error("That is not valid JSON");
      }
      if (!Array.isArray(templates)) throw new Error("Expected an array of templates");
      for (const t of templates) {
        if (!t || typeof t.id !== "string" || typeof t.name !== "string" || !Array.isArray(t.clauses)) {
          throw new Error("Every template needs an id, a name and a clauses array");
        }
        // Validate the clause objects too, not just the array around them. Every
        // consumer dereferences clause.title (the picker joins them into its subtitle,
        // the renderer prints them), so one null or untitled clause here would throw
        // wherever it renders, for every org at once.
        for (const c of t.clauses) {
          if (!c || typeof c.title !== "string" || typeof c.body !== "string") {
            throw new Error(`Every clause in "${t.name}" needs a title and a body string`);
          }
        }
      }
      return savePlatformSetting(supabase, TERMS_LIBRARY_KEY, { templates } as unknown as Json);
    },
    onSuccess: () => {
      setParseError(null);
      qc.invalidateQueries({ queryKey: ["platform", "terms-library"] });
      qc.invalidateQueries({ queryKey: ["app-settings", "hire_order_terms_library"] });
      toast.success("Terms library saved");
    },
    onError: (e: Error) => setParseError(e.message),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (isError) return <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>;

  return (
    <Card>
      <CardHeader><CardTitle className="font-display">Hire order terms library</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Templates an organization can add to its own hire-order terms in one click. Organizations get a copy they
          own, so changes here never alter terms already in use. Shape:{" "}
          <code>{`[{ "id": "...", "name": "...", "clauses": [{ "title": "...", "body": "..." }] }]`}</code>
        </p>
        <div className="space-y-1.5">
          <Label htmlFor="t-terms-library">Templates (JSON)</Label>
          <Textarea
            id="t-terms-library"
            rows={16}
            className="font-mono text-xs"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        {parseError && <Alert variant="destructive"><AlertDescription>{parseError}</AlertDescription></Alert>}
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save library</Button>
      </CardContent>
    </Card>
  );
}
