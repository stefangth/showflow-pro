/**
 * Pure booking/eligibility derivations extracted from ShowDateDetailSheet.
 * No Supabase, no React — safe to unit-test directly.
 */

// ── Booking-status badge styling (single source of truth) ──────────────────────
// Previously duplicated across BookingRow, ArtistBookingsView, and AvailabilityPage
// and DRIFTED: `suggested` was `bg-muted text-muted-foreground` in the producer
// BookingRow but `bg-info/10 text-info` in the two artist surfaces. Reconciled to
// the artist-surface variant (`bg-info/10 text-info`, the 2-of-3 majority) so a
// pending offer reads as an info state everywhere. `unanswered` is a synthetic,
// artist-only status (no active booking yet) — harmless where booking rows never
// carry it. Labels stay per-surface (they differ intentionally, e.g. "Hold placed"
// vs "Soft booked"); only the class map is centralized here.
const BOOKING_STATUS_BADGE_CLASS: Record<string, string> = {
  confirmed: "bg-success/10 text-success",
  soft_booked: "bg-warning/10 text-warning",
  suggested: "bg-info/10 text-info",
  unanswered: "bg-muted text-muted-foreground",
  cancelled: "bg-destructive/10 text-destructive",
};

/**
 * Semantic-token badge classes for a booking status (or the synthetic `unanswered`
 * artist status). Unknown statuses return "" so the Badge falls back to its variant.
 */
export function bookingStatusBadgeClass(status: string): string {
  return BOOKING_STATUS_BADGE_CLASS[status] ?? "";
}

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
  input: { tier: number; dateLabel: string; alreadyOpened: boolean; offerDelivery: "digest" | "immediate" },
): { title: string; body: string } {
  const noun = tierNoun(input.tier);
  const deliverySentence = input.offerDelivery === "immediate"
    ? "Offers are emailed the moment the tier opens, and you can cancel any offer afterward."
    : "They'll be emailed in the next daily offer digest, and you can cancel any offer afterward.";
  const base =
    `This creates suggested bookings for all eligible artists in ${noun} for ${input.dateLabel}. ` +
    deliverySentence;
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

/**
 * Whether tier 1 should be auto-opened for a date. True only when the org's flow
 * enables auto-open AND artist acceptance (direct-booking orgs never open offers),
 * a session is configured (`hasSession`), and tier 1 has not already been opened.
 * Consumed by the date-ready auto-open path (Task 14).
 */
export function shouldAutoOpenTier1(args: {
  flow: { auto_open_tier1: boolean; artist_acceptance: boolean };
  hasSession: boolean;
  openedTiers: { tier: number }[];
}): boolean {
  return (
    args.flow.auto_open_tier1 &&
    args.flow.artist_acceptance &&
    args.hasSession &&
    !args.openedTiers.some((t) => t.tier === 1)
  );
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
