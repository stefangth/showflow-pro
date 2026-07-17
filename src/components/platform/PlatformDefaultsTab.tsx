import { useEffect, useRef, useState } from "react";
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
    </div>
  );
}

function StarterCatalogCard() {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["platform", "starter-template"],
    queryFn: () => resolveOrgSetting<StarterCatalogTemplate>(supabase, null, "starter_catalog_template", EMPTY_STARTER_TEMPLATE),
  });

  const [skills, setSkills] = useState("");
  const [cities, setCities] = useState("");
  const [casts, setCasts] = useState("");

  // Seed the editable fields once, when server data first arrives. Re-seeding on
  // every `data` identity change would let an unrelated refetch (e.g. window
  // refocus) wipe in-progress edits. Save's own refetch already matches the form.
  const seededRef = useRef(false);
  useEffect(() => {
    if (!data || seededRef.current) return;
    seededRef.current = true;
    setSkills(serializeLines(data.skills ?? []));
    setCities(serializeLines(data.cities ?? []));
    setCasts(serializeCasts(data.casts ?? []));
  }, [data]);

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

  const [form, setForm] = useState<BookingEngineDefaults>({ ...BOOKING_ENGINE_DEFAULTS });
  // Seed once when server data first arrives; a later unrelated refetch must not
  // clobber in-progress edits (the save's own refetch already matches the form).
  const seededRef = useRef(false);
  useEffect(() => {
    if (data && !seededRef.current) { seededRef.current = true; setForm(data); }
  }, [data]);

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
