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
