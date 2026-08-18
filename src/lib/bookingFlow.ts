// Booking flow policy: one JSON object per org in app_settings key "booking_flow".
// Dual-home rule: supabase/functions/_shared/bookingFlow.ts mirrors the types,
// defaults, normalize, and referenceLabel below. Keep both in sync in the same PR.

import { BOOKING_ENGINE_DEFAULTS } from "@/config/app.config";

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

export type PresetName = "classic" | "fasttrack" | "direct" | "off";

type FlowFields = Omit<BookingFlow, "reference_field" | "active">;

export const BOOKING_FLOW_PRESETS: Record<Exclude<PresetName, "off">, FlowFields> = {
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

const FLOW_FIELD_KEYS = Object.keys(BOOKING_FLOW_PRESETS.classic) as (keyof FlowFields)[];

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

export function applyPreset(flow: BookingFlow, preset: PresetName): BookingFlow {
  if (preset === "off") return { ...flow, active: false };
  return { ...flow, ...BOOKING_FLOW_PRESETS[preset], active: true };
}

export function matchPreset(flow: BookingFlow): PresetName | "custom" {
  if (!flow.active) return "off";
  for (const name of Object.keys(BOOKING_FLOW_PRESETS) as Exclude<PresetName, "off">[]) {
    const preset = BOOKING_FLOW_PRESETS[name];
    if (FLOW_FIELD_KEYS.every((key) => flow[key] === preset[key])) return name;
  }
  return "custom";
}

export interface FlowTimes {
  windowHours: number;
  offerDigestHour: number;
  confirmationDigestHour: number;
}

export type BookingTemplateName = "classic" | "fasttrack" | "direct" | "off";

export interface BookingTemplateDefinition {
  flow: BookingFlow;
  times: FlowTimes;
}

export type BookingFlowTemplates = Record<BookingTemplateName, BookingTemplateDefinition>;

const DEFAULT_TEMPLATE_TIMES: FlowTimes = {
  windowHours: BOOKING_ENGINE_DEFAULTS.offer_response_window_hours,
  offerDigestHour: BOOKING_ENGINE_DEFAULTS.offer_digest_hour_berlin,
  confirmationDigestHour: BOOKING_ENGINE_DEFAULTS.confirmation_digest_hour_berlin,
};

export const BOOKING_FLOW_TEMPLATE_DEFAULTS: BookingFlowTemplates = {
  classic: { flow: applyPreset(BOOKING_FLOW_DEFAULTS, "classic"), times: { ...DEFAULT_TEMPLATE_TIMES } },
  fasttrack: { flow: applyPreset(BOOKING_FLOW_DEFAULTS, "fasttrack"), times: { ...DEFAULT_TEMPLATE_TIMES } },
  direct: { flow: applyPreset(BOOKING_FLOW_DEFAULTS, "direct"), times: { ...DEFAULT_TEMPLATE_TIMES } },
  off: { flow: applyPreset(BOOKING_FLOW_DEFAULTS, "off"), times: { ...DEFAULT_TEMPLATE_TIMES } },
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

export function bookingTemplateMatches(
  flow: BookingFlow,
  times: FlowTimes,
  template: BookingTemplateDefinition,
): boolean {
  const normalizedFlow = normalizeBookingFlow(flow);
  const normalizedTemplate = normalizeBookingFlow(template.flow);
  return JSON.stringify(normalizedFlow) === JSON.stringify(normalizedTemplate)
    && times.windowHours === template.times.windowHours
    && times.offerDigestHour === template.times.offerDigestHour
    && times.confirmationDigestHour === template.times.confirmationDigestHour;
}

export function inferBookingTemplate(
  flow: BookingFlow,
  times: FlowTimes,
  templates: BookingFlowTemplates,
): BookingTemplateName {
  return BOOKING_TEMPLATE_NAMES.find((name) => bookingTemplateMatches(flow, times, templates[name])) ?? "classic";
}

export interface LifecycleChip {
  label: string;
  tone: "violet" | "amber" | "green" | "neutral";
}

export function hh(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

/** User-facing display for the Berlin-anchored booking clock. */
export function berlinTime(hour: number): string {
  return `${hh(hour)}h (Berlin, Germany)`;
}

export function lifecycleChips(flow: BookingFlow): LifecycleChip[] {
  // Only an explicit active===false is "off"; a flow missing the field (a pre-active literal)
  // reads as active, since active defaults true everywhere it is normalized.
  if (flow.active === false) return [{ label: "Off", tone: "neutral" }];
  if (!flow.artist_acceptance) {
    return [
      { label: "Direct booking", tone: "neutral" },
      { label: "Confirmed", tone: "green" },
    ];
  }
  const chips: LifecycleChip[] = [{ label: "Offered", tone: "violet" }];
  if (flow.producer_confirmation) chips.push({ label: "Soft booked", tone: "amber" });
  chips.push({ label: "Confirmed", tone: "green" });
  return chips;
}

export interface PracticeRow {
  who: "Artist" | "Producer" | "Automation";
  text: string;
}

export function inPracticeRows(flow: BookingFlow, times: FlowTimes): PracticeRow[] {
  if (flow.active === false) {
    return [
      { who: "Artist", text: "Gets no new offers while the flow is off." },
      { who: "Producer", text: "Nothing to review; turn a flow on to start booking." },
      { who: "Automation", text: "Nothing new runs while the flow is off; offers already sent still time out." },
    ];
  }
  let artist: string;
  if (flow.artist_acceptance) {
    const delivery =
      flow.offer_delivery === "digest"
        ? `Gets the offer in the daily ${hh(times.offerDigestHour)} digest email`
        : "Gets the offer email the moment the tier opens";
    const accept = flow.producer_confirmation
      ? "Accepting soft-books the date."
      : "Accepting confirms the booking instantly.";
    artist = `${delivery}, then has ${times.windowHours} h to respond. ${accept}`;
  } else {
    artist = `Never sees an offer. The booking appears as confirmed in their calendar${
      flow.confirmation_digest ? ` and the ${hh(times.confirmationDigestHour)} confirmation digest.` : "."
    }`;
  }

  let producer: string;
  if (!flow.artist_acceptance) {
    producer =
      "Books artists directly from the per-date eligibility list; each booking is confirmed immediately.";
  } else if (flow.producer_confirmation) {
    producer = "Reviews accepted artists in “Ready to Confirm” and bulk-confirms the cast.";
  } else {
    producer = "No review queue: acceptances confirm on their own; the dashboard tracks fills as they land.";
  }

  const autos: string[] = [];
  if (flow.auto_open_tier1 && flow.artist_acceptance) autos.push("tier 1 opens as soon as a date is ready (sessions and slots configured)");
  if (flow.auto_escalate && flow.artist_acceptance) autos.push("unfilled windows escalate to the next tier");
  if (flow.at_risk_alerts && flow.artist_acceptance) autos.push("producers are alerted when a date can no longer fill in time");
  if (flow.expiry_reminder && flow.artist_acceptance) autos.push("unanswered artists get a reminder 24 h before their window closes");
  if (flow.understudy_promotion) autos.push("cancellations promote the longest-waiting accepted understudy");
  const automation = autos.length
    ? `${autos.join("; ").replace(/^./, (c) => c.toUpperCase())}.`
    : "Nothing runs in the background; every step is manual.";

  return [
    { who: "Artist", text: artist },
    { who: "Producer", text: producer },
    { who: "Automation", text: automation },
  ];
}

export interface PreviewRow {
  at: string;
  text: string;
}

export function flowPreviewRows(flow: BookingFlow, times: FlowTimes): PreviewRow[] {
  if (flow.active === false) {
    return [{ at: "·", text: "The flow is paused; no new offers, reminders, digests or confirmations are sent." }];
  }
  const rows: PreviewRow[] = [
    { at: "09:02", text: "Date created (Airtable sync or in-app) · 12 eligible artists in tier 1" },
  ];
  if (flow.artist_acceptance) {
    rows.push(
      flow.auto_open_tier1
        ? { at: "09:02", text: "Tier 1 opens automatically · 12 offers created (suggested)" }
        : { at: "·", text: "Tier 1 waits for a producer to open it" },
    );
    rows.push(
      flow.offer_delivery === "digest"
        ? { at: hh(times.offerDigestHour), text: `Offer digest emailed · ${times.windowHours} h response window starts` }
        : { at: "09:03", text: `Offers emailed immediately · ${times.windowHours} h response window starts` },
    );
    if (flow.producer_confirmation) {
      rows.push({ at: "+1 day", text: "Anna K. accepts → soft booked" });
      rows.push({ at: "+1 day", text: "Producer confirms the cast → confirmed" });
    } else {
      rows.push({ at: "+1 day", text: "Anna K. accepts → confirmed immediately" });
    }
    if (flow.expiry_reminder && times.windowHours > 24) {
      rows.push({ at: `+${times.windowHours - 24} h`, text: "Unanswered artists get an expiry reminder" });
    }
    if (flow.at_risk_alerts) {
      rows.push({ at: "auto", text: "Producers alerted if remaining offers cannot fill the date" });
    }
    rows.push(
      flow.auto_escalate
        ? { at: `+${times.windowHours} h`, text: "Window closes short → tier 2 opens automatically" }
        : { at: `+${times.windowHours} h`, text: "Window closes short; the next tier stays manual" },
    );
  } else {
    rows.push({ at: "·", text: "No offers; producer books artists from the eligibility list" });
    rows.push({ at: "·", text: "Producer booking → confirmed directly" });
  }
  if (flow.confirmation_digest) {
    rows.push({ at: hh(times.confirmationDigestHour), text: "Confirmation digest email sent to newly confirmed artists" });
  }
  if (flow.understudy_promotion) {
    rows.push({ at: "auto", text: "On cancellation, longest-waiting accepted understudy promoted" });
  }
  return rows;
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

const FLOW_FIELD_LABELS: Record<keyof BookingFlow, string> = {
  auto_open_tier1: "Auto-open tier 1",
  auto_escalate: "Auto-escalation",
  at_risk_alerts: "At-risk alerts",
  offer_delivery: "Offer delivery",
  expiry_reminder: "Expiry reminder",
  artist_acceptance: "Artist acceptance",
  producer_confirmation: "Producer confirmation",
  confirmation_digest: "Confirmation digest",
  understudy_promotion: "Understudy promotion",
  active: "Booking automation",
  reference_field: "Reference field",
};

const SETTING_LABELS: Record<string, string> = {
  booking_flow: "Booking engine",
  booking_flow_template: "Booking engine template",
  offer_response_window_hours: "Response window",
  offer_digest_hour_berlin: "Offer digest hour",
  confirmation_digest_hour_berlin: "Confirmation digest hour",
  resend_from_address: "Sender address",
  email_template_overrides: "Email templates",
};

function fmtFlowValue(field: keyof BookingFlow, flow: BookingFlow): string {
  if (field === "offer_delivery") return flow.offer_delivery === "digest" ? "daily digest" : "immediate";
  if (field === "reference_field") {
    if (flow.reference_field.source === "program") return "program";
    if (flow.reference_field.source === "custom") {
      // Include a short id so switching between two custom fields still diffs;
      // a bare "custom field" on both sides read as "No effective change".
      const id = flow.reference_field.custom_field_id;
      return id ? `custom field ${id.slice(0, 8)}` : "custom field";
    }
    return "show label";
  }
  return flow[field] ? "on" : "off";
}

export function describeAuditEntry(entry: {
  key: string;
  old_value: unknown;
  new_value: unknown;
}): string {
  if (entry.key === "booking_flow") {
    const before = normalizeBookingFlow(entry.old_value);
    const after = normalizeBookingFlow(entry.new_value);
    const parts: string[] = [];
    for (const field of Object.keys(FLOW_FIELD_LABELS) as (keyof BookingFlow)[]) {
      const a = fmtFlowValue(field, before);
      const b = fmtFlowValue(field, after);
      if (a !== b) parts.push(`${FLOW_FIELD_LABELS[field]}: ${a} → ${b}`);
    }
    return parts.length ? parts.join(" · ") : "No effective change";
  }
  const label = SETTING_LABELS[entry.key] ?? entry.key;
  const fmt = (v: unknown) => (v === null || v === undefined ? "unset" : typeof v === "object" ? "updated" : String(v));
  return `${label}: ${fmt(entry.old_value)} → ${fmt(entry.new_value)}`;
}
