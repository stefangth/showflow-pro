// Pure helpers for the per-date booking cockpit (Milestone E).
// Consumed by the cockpit components in Task 19: funnel counts, the "up next"
// action pills, and per-tier fill counts. No Supabase or React imports here.

import { hh, type BookingFlow, type FlowTimes } from "./bookingFlow";
import { formatDateWithWeekday } from "./dates";

export interface FunnelCounts {
  offered: number;
  accepted: number;
  confirmedMain: number;
  confirmedUnderstudy: number;
}

export function computeFunnel(
  bookings: Array<{ status: string; is_understudy: boolean }>,
): FunnelCounts {
  const active = bookings.filter((b) => b.status !== "cancelled");
  return {
    offered: active.length,
    accepted: active.filter((b) => b.status === "soft_booked" || b.status === "confirmed").length,
    confirmedMain: active.filter((b) => b.status === "confirmed" && !b.is_understudy).length,
    confirmedUnderstudy: active.filter((b) => b.status === "confirmed" && b.is_understudy).length,
  };
}

export interface UpNextItem {
  tone: "violet" | "amber" | "neutral";
  text: string;
}

// The booking engine is Berlin-anchored (digest hours, expiry windows), so the expiry
// pill must show the Berlin-local calendar day: an offer expiring 23:30 UTC is already
// the next day in Berlin. en-CA formats as YYYY-MM-DD, which formatDateWithWeekday
// parses timezone-safely.
const berlinDayKey = (iso: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

export function computeUpNext(args: {
  flow: BookingFlow;
  times: FlowTimes;
  pendingCount: number;
  nextExpiry: string | null;
  hasOpenTier: boolean;
}): UpNextItem[] {
  const { flow, times, pendingCount, nextExpiry, hasOpenTier } = args;
  if (!flow.artist_acceptance) {
    return [{ tone: "neutral", text: "Direct booking: producers book from the eligibility list" }];
  }
  const items: UpNextItem[] = [];
  if (pendingCount > 0 && flow.offer_delivery === "digest") {
    items.push({ tone: "violet", text: `Digest sends daily · ${hh(times.offerDigestHour)}` });
  }
  if (pendingCount > 0 && nextExpiry) {
    items.push({
      tone: "amber",
      text: `${pendingCount} ${pendingCount === 1 ? "offer expires" : "offers expire"} ${formatDateWithWeekday(berlinDayKey(nextExpiry))}`,
    });
  }
  if (hasOpenTier) {
    items.push({ tone: "neutral", text: `Auto-escalate: ${flow.auto_escalate ? "on" : "off"}` });
  }
  return items;
}

export function tierFillCounts(
  bookings: Array<{ status: string; offer_tier: number | null }>,
  tier: number,
): { pending: number; accepted: number } {
  const inTier = bookings.filter((b) => b.offer_tier === tier);
  return {
    pending: inTier.filter((b) => b.status === "suggested").length,
    accepted: inTier.filter((b) => b.status === "soft_booked" || b.status === "confirmed").length,
  };
}

export interface TierAttentionInput {
  showDateId: string;
  date: string;
  program: string | null;
  subProgram: string | null;
  custom: Record<string, unknown> | null;
  slots: { main_cast: number; understudies: number } | null;
  tier: number;
  bookings: Array<{ status: string; offer_tier: number | null; offer_expires_at: string | null }>;
}

export interface TierAttentionItem {
  showDateId: string;
  date: string;
  program: string | null;
  subProgram: string | null;
  custom: Record<string, unknown> | null;
  tier: number;
  filled: number;
  required: number;
  atRisk: boolean;
  expiresSoon: boolean;
}

const EXPIRES_SOON_MS = 24 * 60 * 60 * 1000;

/**
 * Attention rows for the producer dashboard: open tiers that are under-filled
 * (filled = pending + accepted in the tier, required = total configured slots,
 * matching the dashboard's fully-confirmed math) or that have pending offers
 * in the SAME tier expiring within 24h. Dates without slot config are skipped: no basis to
 * judge. Sorted soonest first.
 */
export function computeTierAttention(rows: TierAttentionInput[], now: Date): TierAttentionItem[] {
  const items: TierAttentionItem[] = [];
  for (const r of rows) {
    if (!r.slots) continue;
    const required = r.slots.main_cast + r.slots.understudies;
    const counts = tierFillCounts(r.bookings, r.tier);
    const filled = counts.pending + counts.accepted;
    const atRisk = filled < required;
    const expiresSoon = r.bookings.some((b) => {
      if (b.status !== "suggested" || b.offer_tier !== r.tier || !b.offer_expires_at) return false;
      const dt = new Date(b.offer_expires_at).getTime() - now.getTime();
      return dt > 0 && dt <= EXPIRES_SOON_MS;
    });
    if (!atRisk && !expiresSoon) continue;
    items.push({
      showDateId: r.showDateId, date: r.date, program: r.program, subProgram: r.subProgram,
      custom: r.custom, tier: r.tier, filled, required, atRisk, expiresSoon,
    });
  }
  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/** Direct-mode dashboard rows: upcoming dates whose confirmed main cast is short. */
export function unfilledMainCastDates(
  dates: Array<{ id: string; date: string; program: string | null; subProgram: string | null; mainSlots: number | null }>,
  confirmedMainByDate: Map<string, number>,
): Array<{ id: string; date: string; program: string | null; subProgram: string | null; mainBooked: number; mainSlots: number }> {
  return dates
    .filter((d) => d.mainSlots != null && (confirmedMainByDate.get(d.id) ?? 0) < d.mainSlots)
    .map((d) => ({
      id: d.id, date: d.date, program: d.program, subProgram: d.subProgram,
      mainBooked: confirmedMainByDate.get(d.id) ?? 0, mainSlots: d.mainSlots as number,
    }));
}

/* ------------------------------------------------------------------------- *
 * Show Date Cockpit + row peek helpers (2026-08 redesign).
 * Pure: no Supabase or React imports. Consumed by CockpitHeader, CockpitRail,
 * and the bookings-row peek.
 * ------------------------------------------------------------------------- */

export interface DatePeekSeg { tone: "confirmed" | "accepted" | "open" }
export interface DatePeek {
  tone: "filled" | "at-risk" | "neutral";
  eyebrowSuffix: "filled" | "at risk" | "open";
  headline: string;
  meter: DatePeekSeg[];
  acceptedWaiting: number;
  openSlots: number;
  confirmable: boolean;
}

/** Slot-meter segment tones (confirmed → accepted → open), the single source
 *  the cockpit header meter and the row-peek meter both render. Clamps its own
 *  inputs so callers may pass raw counts. */
export function slotMeterTones(confirmed: number, accepted: number, total: number): DatePeekSeg["tone"][] {
  const c = Math.min(total, Math.max(0, confirmed));
  const a = Math.min(total - c, Math.max(0, accepted));
  return Array.from({ length: total }, (_, i) => (i < c ? "confirmed" : i < c + a ? "accepted" : "open"));
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Compact summary for the bookings-row peek. Null when the date has no slot config. */
export function computeDatePeek(args: {
  counts: { confirmedMain: number; confirmedUs: number; acceptedMain: number; acceptedUs: number } | null;
  slots: { main_cast: number; understudies: number } | null;
}): DatePeek | null {
  const { slots } = args;
  if (!slots) return null;
  const c = args.counts ?? { confirmedMain: 0, confirmedUs: 0, acceptedMain: 0, acceptedUs: 0 };
  const total = slots.main_cast + slots.understudies;
  const confirmed = Math.min(total, c.confirmedMain + c.confirmedUs);
  const accepted = Math.min(total - confirmed, c.acceptedMain + c.acceptedUs);
  const openSlots = Math.max(0, total - confirmed - accepted);
  const openMain = Math.max(0, slots.main_cast - c.confirmedMain - c.acceptedMain);
  const openUs = Math.max(0, slots.understudies - c.confirmedUs - c.acceptedUs);

  const meter: DatePeekSeg[] = slotMeterTones(confirmed, accepted, total).map((tone) => ({ tone }));

  let tone: DatePeek["tone"]; let eyebrowSuffix: DatePeek["eyebrowSuffix"];
  if (confirmed >= total) { tone = "filled"; eyebrowSuffix = "filled"; }
  else if (openSlots > 0) { tone = "at-risk"; eyebrowSuffix = "at risk"; }
  else { tone = "neutral"; eyebrowSuffix = "open"; }

  let headline: string;
  if (confirmed >= total) {
    headline = `All ${total} slots confirmed`;
  } else {
    const parts: string[] = [];
    if (accepted > 0) parts.push(plural(accepted, "accepted waiting on you", "accepted waiting on you"));
    if (openMain > 0) parts.push(plural(openMain, "main slot open", "main slots open"));
    else if (openUs > 0) parts.push(plural(openUs, "understudy slot open", "understudy slots open"));
    headline = parts.length ? parts.join(" · ") : "Ready to confirm";
  }

  return { tone, eyebrowSuffix, headline, meter, acceptedWaiting: accepted, openSlots, confirmable: accepted > 0 };
}

export type HeaderCtaKind = "confirm" | "openTier" | "reviewOffers" | "book" | "none";
export interface HeaderCta { kind: HeaderCtaKind; label: string }

/** The primary booking-workflow action for the cockpit header. The hire-order
 *  terminal is a separate, feature-gated button, so this returns "none" once the
 *  workflow itself is done. */
export function computeHeaderCta(args: {
  artistAcceptance: boolean; acceptedCount: number; confirmedCount: number;
  totalSlots: number | null; openTier: number | null; maxTier: number;
}): HeaderCta {
  const none: HeaderCta = { kind: "none", label: "" };
  if (args.acceptedCount > 0) return { kind: "confirm", label: `Confirm ${args.acceptedCount} accepted` };
  if (args.totalSlots == null || args.confirmedCount >= args.totalSlots) return none;
  if (!args.artistAcceptance) return { kind: "book", label: "Book from eligibility" };
  if (args.openTier != null && args.openTier < args.maxTier)
    return { kind: "openTier", label: `Open tier ${args.openTier + 1}` };
  return { kind: "reviewOffers", label: "Review open offers" };
}

export interface ActivityItem { iso: string; text: string }

/** Derive a per-date activity feed from real booking + tier timestamps (no new
 *  backend). Newest first, capped at `limit` (default 6). Formatting of `iso`
 *  is left to the consumer to keep this pure and locale-free. */
export function buildActivity(args: {
  bookings: Array<{ status: string; confirmed_at: string | null; artist: { name: string } | null }>;
  openedTiers: Array<{ tier: number; openedAt: string | null; closedAt: string | null }>;
  limit?: number;
}): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const b of args.bookings) {
    if (b.status === "confirmed" && b.confirmed_at) {
      out.push({ iso: b.confirmed_at, text: `${b.artist?.name ?? "Artist"} confirmed` });
    }
  }
  for (const t of args.openedTiers) {
    if (t.openedAt) out.push({ iso: t.openedAt, text: `Tier ${t.tier} opened` });
    if (t.closedAt) out.push({ iso: t.closedAt, text: `Tier ${t.tier} closed` });
  }
  out.sort((a, b) => b.iso.localeCompare(a.iso));
  return out.slice(0, args.limit ?? 6);
}
