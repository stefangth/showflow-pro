/**
 * Pure booking/eligibility derivations extracted from ShowDateDetailSheet.
 * No Supabase, no React — safe to unit-test directly.
 */
import type { ExcludedDetailEntry } from "@/data/bookings";

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

// ── Producer-facing status display label ───────────────────────────────────────
// The artist-facing labels live in `bookingStatusLabels` (flowCopy) and read from
// the artist's side ("Offer pending" / "Hold placed"). This is the producer-facing
// noun for the SAME booking status, used where a producer reads a booking's state
// (e.g. ShowDateDetailSheet's assigned-artists rows). `suggested` is exactly what
// open-offer-tier creates when the offer goes out to the artist, so it reads as
// "Offered", never the internal enum. Unknown values humanize.
const BOOKING_STATUS_DISPLAY_LABEL: Record<string, string> = {
  suggested: "Asked",
  soft_booked: "Said yes, waiting on you",
  confirmed: "Booked",
  cancelled: "Cancelled",
};

/**
 * Human display label for a booking status on producer surfaces. Unknown statuses
 * fall back to a humanized form (underscores → spaces, first letter capitalized),
 * so a new enum value never surfaces the raw token.
 */
export function bookingStatusDisplayLabel(status: string): string {
  const known = BOOKING_STATUS_DISPLAY_LABEL[status];
  if (known) return known;
  const spaced = status.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
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

/** Friendly, non-jargon phrasing for an ExcludedReason, used in the cast-aware
 *  confirm copy's "Not offered" line. */
const EXCLUDED_REASON_LABEL: Record<ExcludedDetailEntry["reason"], string> = {
  missing_skills: "missing a required skill",
  blocked: "blocked on this date",
  already_booked: "already booked",
  inactive: "inactive",
  not_eligible: "not eligible",
};

/** Named, capped "Not offered: A (reason) · B (reason)." line. Empty string when
 *  there's nothing to name. Caps at 5 named entries, summarizing the remainder. */
function excludedDetailLine(excludedDetail: ExcludedDetailEntry[] | undefined): string {
  if (!excludedDetail || excludedDetail.length === 0) return "";
  const shown = excludedDetail.slice(0, 5);
  const parts = shown.map((e) => `${e.name} (${EXCLUDED_REASON_LABEL[e.reason]})`);
  const remainder = excludedDetail.length - shown.length;
  if (remainder > 0) parts.push(`and ${remainder} more`);
  return ` Not offered: ${parts.join(" · ")}.`;
}

/** Confirmation copy for opening a tier; re-open note explains the additive semantics.
 *  When `castName` is supplied (the caller resolved the next offer target to a single
 *  cast — owner's RELABEL rule), renders a cast-aware variant naming the cast and its
 *  match count instead of the bare tier noun. Every other input is unused in that path. */
export function offerConfirmCopy(
  input: {
    tier: number;
    dateLabel: string;
    alreadyOpened: boolean;
    offerDelivery: "digest" | "immediate";
    /** Names of skills the offer is scoped to, if a producer applied a skill filter. */
    skillFilterNames?: string[];
    /** Name of the single cast the next tier maps to. Presence switches to the
     *  cast-aware copy below; absence keeps today's tier/ad-hoc copy unchanged. */
    castName?: string;
    /** How many artists in the cast actually match and will receive an offer. */
    matchCount?: number;
    /** Total artists in the cast (matched + excluded). */
    castTotal?: number;
    /** Skills this date requires, named for the "All N have the skills..." sentence. */
    requiredSkillNames?: string[];
    /** Named, per-artist exclusion detail for the "Not offered" line. */
    excludedDetail?: ExcludedDetailEntry[];
  },
): { title: string; body: string } {
  const deliverySentence = input.offerDelivery === "immediate"
    ? "Offers are emailed the moment the tier opens, and you can cancel any offer afterward."
    : "They'll be emailed in the next daily offer digest, and you can cancel any offer afterward.";
  const cap = input.tier === 99 ? "Ad-hoc casts have" : `Tier ${input.tier} has`;
  const reopen = input.alreadyOpened
    ? ` ${cap} already been opened — re-opening only adds offers for artists who don't have one yet.`
    : "";

  if (input.castName) {
    const matchSentence =
      `${input.matchCount} of the ${input.castTotal} artists in ${input.castName} ` +
      `get an offer for ${input.dateLabel}.`;
    const skillSentence = input.requiredSkillNames && input.requiredSkillNames.length > 0
      ? ` All ${input.matchCount} have the skills this date requires: ${input.requiredSkillNames.join(", ")}.`
      : "";
    const notOffered = excludedDetailLine(input.excludedDetail);
    return {
      title: `Open offers to ${input.castName}?`,
      body: `${matchSentence}${skillSentence} ${deliverySentence}${reopen}${notOffered}`,
    };
  }

  const noun = tierNoun(input.tier);
  const base =
    `This creates suggested bookings for all eligible artists in ${noun} for ${input.dateLabel}. ` +
    deliverySentence;
  const skillCue = input.skillFilterNames && input.skillFilterNames.length > 0
    ? ` Only artists with all of these skills receive offers: ${input.skillFilterNames.join(", ")}.`
    : "";
  return { title: `Open ${noun} offers?`, body: base + reopen + skillCue };
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

/**
 * Resolves the artist list the direct-mode booking surface may offer a Book
 * action for. Fails closed: until BOTH the eligibility set and the blocked-date
 * set have resolved (loading or errored), nobody is bookable; a momentary
 * "everyone is eligible" window would expose artists outside the cast/city
 * eligibility with no DB backstop. A null artistIds means genuinely
 * unrestricted (no eligibility config). Blocked artists are excluded to match
 * the tiered offer path, which skips blocked_dates server-side.
 * The skill-eligibility set follows the same fail-closed contract: undefined =
 * unresolved = nobody bookable; null = no skill requirements.
 */
export function deriveDirectBookList<T extends { id: string; name: string }>(
  orgArtists: T[] | undefined,
  eligibility: { artistIds: Set<string> | null } | undefined,
  blockedIds: Set<string> | undefined,
  skillEligibleIds: Set<string> | null | undefined,
): T[] {
  if (eligibility === undefined || blockedIds === undefined || skillEligibleIds === undefined) return [];
  const all = orgArtists ?? [];
  const base = eligibility.artistIds == null ? all : all.filter((a) => eligibility.artistIds!.has(a.id));
  const skilled = skillEligibleIds == null ? base : base.filter((a) => skillEligibleIds.has(a.id));
  return skilled.filter((a) => !blockedIds.has(a.id));
}
