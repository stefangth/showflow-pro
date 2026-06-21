/**
 * Pure booking/eligibility derivations extracted from ShowDateDetailSheet.
 * No Supabase, no React — safe to unit-test directly.
 */

import type { Database } from "@/integrations/supabase/types";

export interface BookingLike {
  artist_id: string;
  status: string;
  is_understudy: boolean;
}

export interface BookingGroups<T extends BookingLike> {
  /** All non-cancelled bookings. */
  active: T[];
  /** Active, non-understudy. */
  main: T[];
  /** Active understudies. */
  understudy: T[];
  /** Set of artist_ids with any active booking. */
  bookedArtistIds: Set<string>;
  /** Count of confirmed main-cast bookings. */
  confirmedMainCount: number;
  /** Count of confirmed understudy bookings. */
  confirmedUnderstudyCount: number;
}

export function deriveBookingGroups<T extends BookingLike>(
  bookings: T[] | null | undefined,
): BookingGroups<T> {
  const active = (bookings ?? []).filter((b) => b.status !== "cancelled");
  const main = active.filter((b) => !b.is_understudy);
  const understudy = active.filter((b) => b.is_understudy);
  return {
    active,
    main,
    understudy,
    bookedArtistIds: new Set(active.map((b) => b.artist_id)),
    confirmedMainCount: main.filter((b) => b.status === "confirmed").length,
    confirmedUnderstudyCount: understudy.filter((b) => b.status === "confirmed").length,
  };
}

/** Eligibility-derived cast ids, minus any date-level overrides. */
export function computeInheritedCastIds(
  eligibilityCastIds: string[] | null | undefined,
  overrideCastIds: Set<string>,
): Set<string> {
  return new Set((eligibilityCastIds ?? []).filter((cid) => !overrideCastIds.has(cid)));
}

/** Update payload for a booking status transition. */
export interface BookingStatusUpdate {
  status: Database["public"]["Enums"]["booking_status"];
  confirmed_at?: string;
  cancelled_at?: string;
}

/**
 * Build the `bookings` update payload for a status transition.
 *
 * NOTE: matches current production behavior exactly — it only *sets*
 * confirmed_at / cancelled_at and never clears a stale stamp on the reverse
 * transition. See part2-bug-log.md ("booking timestamp never cleared").
 */
export function bookingStatusUpdate(status: string, now: Date): BookingStatusUpdate {
  const updates: BookingStatusUpdate = { status: status as Database["public"]["Enums"]["booking_status"] };
  if (status === "confirmed") updates.confirmed_at = now.toISOString();
  if (status === "cancelled") updates.cancelled_at = now.toISOString();
  return updates;
}

// ── Offer-tier UI helpers (open/close actions in ShowDateDetailSheet) ──────────

export interface OfferTierOption { value: number; label: string }

/** A tier's human noun, used across toasts and dialog copy. 99 = ad-hoc convention. */
function tierNoun(tier: number): string {
  return tier === 99 ? "ad-hoc casts" : `tier ${tier}`;
}

/** Dropdown options: deduped+sorted city tiers (drop <1 and stray 99), then Ad-hoc(99). */
export function buildOfferTierOptions(
  input: { priorities: number[]; hasAdHoc: boolean },
): OfferTierOption[] {
  const uniq = Array.from(new Set(input.priorities))
    .filter((p) => Number.isFinite(p) && p >= 1 && p !== 99)
    .sort((a, b) => a - b);
  const opts: OfferTierOption[] = uniq.map((p) => ({ value: p, label: `Tier ${p}` }));
  if (input.hasAdHoc) opts.push({ value: 99, label: "Ad-hoc casts" });
  return opts;
}

/** Map an open-offer-tier result to a toast kind + text. */
export function offerResultToast(
  result: { offersCreated: number; message?: string },
  tier: number,
): { kind: "success" | "info"; text: string } {
  if (result.offersCreated > 0) {
    const n = result.offersCreated;
    return { kind: "success", text: `Opened ${tierNoun(tier)} — ${n} offer${n === 1 ? "" : "s"} created` };
  }
  return { kind: "info", text: result.message ?? "No new offers created" };
}

/** Confirmation copy for opening a tier; re-open note explains the additive semantics. */
export function offerConfirmCopy(
  input: { tier: number; dateLabel: string; alreadyOpened: boolean },
): { title: string; body: string } {
  const noun = tierNoun(input.tier);
  const base =
    `This creates suggested bookings for all eligible artists in ${noun} for ${input.dateLabel}. ` +
    `They'll be emailed in the next daily offer digest, and you can cancel any offer afterward.`;
  const cap = input.tier === 99 ? "Ad-hoc casts have" : `Tier ${input.tier} has`;
  const reopen = input.alreadyOpened
    ? ` ${cap} already been opened — re-opening only adds offers for artists who don't have one yet.`
    : "";
  return { title: `Open ${noun} offers?`, body: base + reopen };
}

/** Count still-pending (suggested) offers for a tier — feeds the close dialog. */
export function pendingOfferCount(
  bookings: ReadonlyArray<{ status: string; offer_tier: number | null }>,
  tier: number,
): number {
  return bookings.filter((b) => b.status === "suggested" && b.offer_tier === tier).length;
}

export interface CloseConfirmCopy {
  title: string;
  intro: string;
  withdraw: { label: string; caption: string };
  keep: { label: string; caption: string };
}

/** Jargon-free copy for the close dialog's two choices. */
export function closeConfirmCopy(input: { tier: number; pendingCount: number }): CloseConfirmCopy {
  const noun = tierNoun(input.tier);
  const n = input.pendingCount;
  const s = n === 1 ? "" : "s";
  return {
    title: `Close ${noun}?`,
    intro: `Closing stops the reminder and at-risk alerts for ${noun}.`,
    withdraw: {
      label: "Withdraw unanswered offers",
      caption: n > 0
        ? `Cancels the ${n} offer${s} no-one has accepted yet, so those artists can't take a spot later. Anyone who already accepted keeps their spot.`
        : "No unanswered offers to cancel. Anyone who already accepted keeps their spot.",
    },
    keep: {
      label: "Keep offers open",
      caption: n > 0
        ? `Leaves the ${n} unanswered offer${s} live — artists can still accept until the offers expire.`
        : "Nothing to withdraw — this just stops the alerts.",
    },
  };
}

/** Map a close-offer-tier result to a toast kind + text. */
export function closeResultToast(
  result: { closed: boolean; withdrawn: number; message?: string },
  tier: number,
): { kind: "success" | "info"; text: string } {
  const noun = tierNoun(tier);
  const n = result.withdrawn;
  const s = n === 1 ? "" : "s";
  if (result.closed && n > 0) return { kind: "success", text: `Closed ${noun} — withdrew ${n} offer${s}` };
  if (result.closed) return { kind: "success", text: `Closed ${noun}` };
  // Tier was already closed: re-closing only withdrew surviving (kept-live) offers.
  if (n > 0) return { kind: "success", text: `Withdrew ${n} offer${s} from ${noun}` };
  return { kind: "info", text: result.message ?? "Tier was not open" };
}
