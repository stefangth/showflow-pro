// MIRROR of src/lib/bookingFlow.ts (types, defaults, normalize, referenceLabel).
// The two runtimes cannot share an import; change both files in the same PR.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { BOOKING_ENGINE_DEFAULTS, resolveOrgSetting } from "./settings.ts";
import { checkFeature } from "./entitlements.ts";

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
  /** Master switch: false = the whole flow is paused (the "off" preset). Defaults true. */
  active: boolean;
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
  active: true,
  reference_field: { source: "show" },
};

type FlowFields = Omit<BookingFlow, "reference_field" | "active">;

export function normalizeBookingFlow(value: unknown): BookingFlow {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const bool = (key: keyof FlowFields): boolean =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : (BOOKING_FLOW_DEFAULTS[key] as boolean);

  const active = typeof raw.active === "boolean" ? raw.active : BOOKING_FLOW_DEFAULTS.active;

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
    active,
    reference_field,
  };
  if (!flow.artist_acceptance) flow.producer_confirmation = true;
  return flow;
}

export interface FlowTimes {
  windowHours: number;
  offerDigestHour: number;
  confirmationDigestHour: number;
}

export type BookingTemplateName = "classic" | "fasttrack" | "direct" | "off";
export interface BookingTemplateDefinition { flow: BookingFlow; times: FlowTimes }
export type BookingFlowTemplates = Record<BookingTemplateName, BookingTemplateDefinition>;

const TEMPLATE_FLOW_FIELDS: Record<Exclude<BookingTemplateName, "off">, Partial<BookingFlow>> = {
  classic: {},
  fasttrack: {
    auto_open_tier1: true,
    auto_escalate: true,
    at_risk_alerts: true,
    offer_delivery: "digest",
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

const defaultTimes = (): FlowTimes => ({
  windowHours: BOOKING_ENGINE_DEFAULTS.offer_response_window_hours,
  offerDigestHour: BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin,
  confirmationDigestHour: BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin,
});

export const BOOKING_FLOW_TEMPLATE_DEFAULTS: BookingFlowTemplates = {
  classic: { flow: normalizeBookingFlow({ ...TEMPLATE_FLOW_FIELDS.classic, active: true }), times: defaultTimes() },
  fasttrack: { flow: normalizeBookingFlow({ ...TEMPLATE_FLOW_FIELDS.fasttrack, active: true }), times: defaultTimes() },
  direct: { flow: normalizeBookingFlow({ ...TEMPLATE_FLOW_FIELDS.direct, active: true }), times: defaultTimes() },
  off: { flow: normalizeBookingFlow({ active: false }), times: defaultTimes() },
};

const BOOKING_TEMPLATE_NAMES: BookingTemplateName[] = ["classic", "fasttrack", "direct", "off"];
const finiteNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

export function normalizeBookingFlowTemplates(value: unknown): BookingFlowTemplates {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return Object.fromEntries(BOOKING_TEMPLATE_NAMES.map((name) => {
    const fallback = BOOKING_FLOW_TEMPLATE_DEFAULTS[name];
    const candidate = raw[name];
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return [name, { flow: { ...fallback.flow, reference_field: { ...fallback.flow.reference_field } }, times: { ...fallback.times } }];
    }
    const record = candidate as Record<string, unknown>;
    const rawTimes = record.times && typeof record.times === "object" && !Array.isArray(record.times)
      ? record.times as Record<string, unknown>
      : {};
    const rawFlow = record.flow && typeof record.flow === "object" && !Array.isArray(record.flow)
      ? record.flow as Record<string, unknown>
      : {};
    const flow = normalizeBookingFlow({ ...fallback.flow, ...rawFlow });
    flow.active = name !== "off";
    return [name, {
      flow,
      times: {
        windowHours: finiteNumber(rawTimes.windowHours, fallback.times.windowHours),
        offerDigestHour: finiteNumber(rawTimes.offerDigestHour, fallback.times.offerDigestHour),
        confirmationDigestHour: finiteNumber(rawTimes.confirmationDigestHour, fallback.times.confirmationDigestHour),
      },
    }];
  })) as BookingFlowTemplates;
}

export function bookingTemplateMatches(flow: BookingFlow, times: FlowTimes, template: BookingTemplateDefinition): boolean {
  return JSON.stringify(normalizeBookingFlow(flow)) === JSON.stringify(normalizeBookingFlow(template.flow))
    && times.windowHours === template.times.windowHours
    && times.offerDigestHour === template.times.offerDigestHour
    && times.confirmationDigestHour === template.times.confirmationDigestHour;
}

export function inferBookingTemplate(flow: BookingFlow, times: FlowTimes, templates: BookingFlowTemplates): BookingTemplateName {
  return BOOKING_TEMPLATE_NAMES.find((name) => bookingTemplateMatches(flow, times, templates[name])) ?? "classic";
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
  // booking_flow fails OPEN on an entitlement-check error (see checkFeature) — an
  // unentitled org (or an org whose feature row was explicitly turned off) gets the
  // defaults, never its stored app_settings override.
  if (!(await checkFeature(admin, orgId, "booking_flow"))) return normalizeBookingFlow(null);
  return normalizeBookingFlow(await resolveOrgSetting(admin, orgId, "booking_flow", null));
}
