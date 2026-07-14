import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/features/auth/AuthContext";
import {
  applyPreset,
  matchPreset,
  normalizeBookingFlow,
  referenceLabel,
  type BookingFlow,
  type FlowTimes,
  type PresetName,
} from "@/lib/bookingFlow";
import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";
import { fetchCustomFieldDefs } from "@/data/customFields";
import { useSettingsAudit } from "@/hooks/useSettingsAudit";
import { EmailTemplatesCard } from "@/components/settings/EmailTemplatesCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FlowPresets } from "./FlowPresets";
import { FlowTimeline } from "./FlowTimeline";
import { FlowRail } from "./FlowRail";

/**
 * Every app_settings key the booking-flow tab owns. SettingsPage filters its
 * page-level dirtyKeys against this list to drive the rail's Save/Discard, and
 * the tab feeds it to useSettingsAudit for the change-history panel.
 */
export const BOOKING_AUDIT_KEYS = [
  "booking_flow",
  "offer_response_window_hours",
  "offer_digest_hour_berlin",
  "confirmation_digest_hour_berlin",
  "resend_from_address",
  "email_template_overrides",
];

interface Props {
  get: (key: string) => unknown;
  set: (key: string, value: unknown) => void;
  dirtyKeys: string[];
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

export function BookingFlowTab({ get, set, dirtyKeys, saving, onSave, onDiscard }: Props) {
  const { currentOrg } = useAuth();
  const orgId = currentOrg?.id ?? null;

  const flow = normalizeBookingFlow(get("booking_flow"));

  // SettingsPage's `get` returns '' for keys with no draft/persisted value, so a
  // bare `?? default` would leave `Number('')` === 0. Coerce explicitly instead.
  const num = (key: string, fallback: number): number => {
    const v = get(key);
    if (typeof v === "number") return v;
    if (v === undefined || v === null || v === "") return fallback;
    return Number(v);
  };
  const times: FlowTimes = {
    windowHours: num("offer_response_window_hours", BOOKING_ENGINE_DEFAULTS.offer_response_window_hours),
    offerDigestHour: num("offer_digest_hour_berlin", BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin),
    confirmationDigestHour: num("confirmation_digest_hour_berlin", BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin),
  };

  const { data: customFieldDefs } = useQuery({
    queryKey: ["custom-fields", "show_dates", orgId],
    queryFn: () => fetchCustomFieldDefs(supabase, { orgId, entity: "show_dates" }),
    enabled: Boolean(orgId),
  });
  const audit = useSettingsAudit(BOOKING_AUDIT_KEYS);

  const customFields = (customFieldDefs ?? []).map((d) => ({ id: d.id, label: d.label }));
  const customFieldKey =
    flow.reference_field.source === "custom"
      ? (customFieldDefs ?? []).find((d) => d.id === flow.reference_field.custom_field_id)?.key ?? null
      : null;
  const referencePreview = `Offer: ${referenceLabel({
    reference: flow.reference_field,
    show: { program: "Candlelight", sub_program: "Strings" },
    custom: { [customFieldKey ?? ""]: "FV-2033" },
    customFieldKey,
  })} · Apr 30, Berlin`;

  // Remembers the last user-chosen producer_confirmation while artist_acceptance is on.
  // normalizeBookingFlow forces producer_confirmation on whenever artist_acceptance is off
  // (security-relevant invariant: a direct booking IS the confirmation, so the field can't
  // read "not yet confirmed" in that mode); that invariant must stay in normalizeBookingFlow.
  // But the forced value shouldn't permanently clobber a fast-track org's choice: turning
  // acceptance back on restores what the user had set before it was forced.
  const lastProducerConfirmationRef = useRef(flow.producer_confirmation);

  // FlowTimeline emits single-field patches and relies on this handler normalizing
  // the merged flow (e.g. artist_acceptance off forces producer_confirmation on).
  const onFlowChange = (patch: Partial<BookingFlow>) => {
    // Track the user's producer_confirmation choice while it's a real, editable choice
    // (artist_acceptance on), i.e. before a subsequent "turn acceptance off" forces it on.
    if (flow.artist_acceptance) {
      lastProducerConfirmationRef.current =
        patch.producer_confirmation !== undefined ? patch.producer_confirmation : flow.producer_confirmation;
    }
    let merged: Partial<BookingFlow> = { ...flow, ...patch };
    if (patch.artist_acceptance === true && !flow.artist_acceptance) {
      merged = { ...merged, producer_confirmation: lastProducerConfirmationRef.current };
    }
    set("booking_flow", normalizeBookingFlow(merged));
  };
  const onTimesChange = (patch: Partial<FlowTimes>) => {
    if (patch.windowHours !== undefined) set("offer_response_window_hours", patch.windowHours);
    if (patch.offerDigestHour !== undefined) set("offer_digest_hour_berlin", patch.offerDigestHour);
    if (patch.confirmationDigestHour !== undefined) set("confirmation_digest_hour_berlin", patch.confirmationDigestHour);
  };
  const onPreset = (p: PresetName) => set("booking_flow", applyPreset(flow, p));

  return (
    <div className="space-y-4">
      <FlowPresets active={matchPreset(flow)} onSelect={onPreset} />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <FlowTimeline
          flow={flow}
          times={times}
          onFlowChange={onFlowChange}
          onTimesChange={onTimesChange}
          customFields={customFields}
          referencePreview={referencePreview}
        />
        <FlowRail
          flow={flow}
          times={times}
          dirtyCount={dirtyKeys.length}
          saving={saving}
          onSave={onSave}
          onDiscard={onDiscard}
          audit={audit.data ?? []}
          isLoading={audit.isLoading}
          isError={audit.isError}
        />
      </div>
      <div className="max-w-sm space-y-2">
        <Label htmlFor="resend-from-address">From address (Resend)</Label>
        <Input
          id="resend-from-address"
          placeholder={BOOKING_ENGINE_DEFAULTS.resend_from_address}
          value={(get("resend_from_address") as string) ?? ""}
          onChange={(e) => set("resend_from_address", e.target.value)}
        />
        <p className="text-xs text-muted-foreground">Overrides the default sender address for all outgoing emails.</p>
      </div>
      <EmailTemplatesCard get={get} set={set} />
    </div>
  );
}
