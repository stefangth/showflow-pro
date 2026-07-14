// Booking flow policy: one JSON object per org in app_settings key "booking_flow".
// Dual-home rule: supabase/functions/_shared/bookingFlow.ts mirrors the types,
// defaults, normalize, and referenceLabel below. Keep both in sync in the same PR.

export type OfferDelivery = "digest" | "immediate";
export type ReferenceSource = "show" | "program" | "custom";

export interface ReferenceField {
  source: ReferenceSource;
  custom_field_id?: string;
}

export interface BookingFlow {
  auto_open_tier1: boolean;
  auto_escalate: boolean;
  at_risk_alerts: boolean;
  offer_delivery: OfferDelivery;
  expiry_reminder: boolean;
  artist_acceptance: boolean;
  producer_confirmation: boolean;
  confirmation_digest: boolean;
  understudy_promotion: boolean;
  reference_field: ReferenceField;
}

// Defaults = current production behavior for an org with no booking_flow row.
// auto_open_tier1 is true because airtable-poll already auto-opens tier 1 for
// newly synced dates (openOfferTierBatch).
export const BOOKING_FLOW_DEFAULTS: BookingFlow = {
  auto_open_tier1: true,
  auto_escalate: false,
  at_risk_alerts: true,
  offer_delivery: "digest",
  expiry_reminder: false,
  artist_acceptance: true,
  producer_confirmation: true,
  confirmation_digest: true,
  understudy_promotion: true,
  reference_field: { source: "show" },
};

export type PresetName = "classic" | "fasttrack" | "direct";

type FlowFields = Omit<BookingFlow, "reference_field">;

export const BOOKING_FLOW_PRESETS: Record<PresetName, FlowFields> = {
  classic: {
    auto_open_tier1: true,
    auto_escalate: false,
    at_risk_alerts: true,
    offer_delivery: "digest",
    expiry_reminder: false,
    artist_acceptance: true,
    producer_confirmation: true,
    confirmation_digest: true,
    understudy_promotion: true,
  },
  fasttrack: {
    auto_open_tier1: true,
    auto_escalate: true,
    at_risk_alerts: true,
    offer_delivery: "immediate",
    expiry_reminder: true,
    artist_acceptance: true,
    producer_confirmation: false,
    confirmation_digest: true,
    understudy_promotion: true,
  },
  direct: {
    auto_open_tier1: false,
    auto_escalate: false,
    at_risk_alerts: false,
    offer_delivery: "digest",
    expiry_reminder: false,
    artist_acceptance: false,
    producer_confirmation: true,
    confirmation_digest: true,
    understudy_promotion: true,
  },
};

const FLOW_FIELD_KEYS = Object.keys(BOOKING_FLOW_PRESETS.classic) as (keyof FlowFields)[];

export function normalizeBookingFlow(value: unknown): BookingFlow {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const bool = (key: keyof FlowFields): boolean =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : (BOOKING_FLOW_DEFAULTS[key] as boolean);

  const delivery: OfferDelivery = raw.offer_delivery === "immediate" ? "immediate" : "digest";

  const rawRef =
    raw.reference_field && typeof raw.reference_field === "object" && !Array.isArray(raw.reference_field)
      ? (raw.reference_field as Record<string, unknown>)
      : {};
  let reference_field: ReferenceField = { source: "show" };
  if (rawRef.source === "program") reference_field = { source: "program" };
  else if (rawRef.source === "custom" && typeof rawRef.custom_field_id === "string") {
    reference_field = { source: "custom", custom_field_id: rawRef.custom_field_id };
  }

  const flow: BookingFlow = {
    auto_open_tier1: bool("auto_open_tier1"),
    auto_escalate: bool("auto_escalate"),
    at_risk_alerts: bool("at_risk_alerts"),
    offer_delivery: delivery,
    expiry_reminder: bool("expiry_reminder"),
    artist_acceptance: bool("artist_acceptance"),
    producer_confirmation: bool("producer_confirmation"),
    confirmation_digest: bool("confirmation_digest"),
    understudy_promotion: bool("understudy_promotion"),
    reference_field,
  };
  if (!flow.artist_acceptance) flow.producer_confirmation = true;
  return flow;
}

export function applyPreset(flow: BookingFlow, preset: PresetName): BookingFlow {
  return { ...flow, ...BOOKING_FLOW_PRESETS[preset] };
}

export function matchPreset(flow: BookingFlow): PresetName | "custom" {
  for (const name of Object.keys(BOOKING_FLOW_PRESETS) as PresetName[]) {
    const preset = BOOKING_FLOW_PRESETS[name];
    if (FLOW_FIELD_KEYS.every((key) => flow[key] === preset[key])) return name;
  }
  return "custom";
}
