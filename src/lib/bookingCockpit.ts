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
      text: `${pendingCount} ${pendingCount === 1 ? "offer expires" : "offers expire"} ${formatDateWithWeekday(nextExpiry.slice(0, 10))}`,
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
