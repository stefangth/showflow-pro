// MIRROR of src/lib/bookingFlow.ts (types, defaults, normalize, referenceLabel).
// The two runtimes cannot share an import; change both files in the same PR.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { resolveOrgSetting } from "./settings.ts";

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

type FlowFields = Omit<BookingFlow, "reference_field">;

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

export function referenceLabel(args: {
  reference: ReferenceField;
  show: { program: string | null; sub_program: string | null } | null;
  custom: Record<string, unknown> | null;
  customFieldKey: string | null;
}): string {
  const { reference, show, custom, customFieldKey } = args;
  const showText =
    [show?.program, show?.sub_program].filter(Boolean).join(" · ") || "Untitled show";
  if (reference.source === "program") return show?.program ?? showText;
  if (reference.source === "custom" && customFieldKey) {
    const value = custom?.[customFieldKey];
    if (value !== null && value !== undefined && String(value).trim() !== "") {
      return String(value);
    }
  }
  return showText;
}

export async function resolveBookingFlow(
  admin: SupabaseClient,
  orgId: string,
): Promise<BookingFlow> {
  return normalizeBookingFlow(await resolveOrgSetting(admin, orgId, "booking_flow", null));
}
