// Pure derivation for the Autopilot "Today" board: turns already-fetched reads
// (open-tier attention, cancellation and roster facts, bounced asks, the
// done-for-you feed) into a single TodayModel of "things that need a human"
// plus the "done for you" feed. No React, no Supabase imports here — see
// src/data/autopilot.ts for the data-access layer that populates TodayInput.

import { parseDateOnly } from "@/lib/dates";
import { computeTierAttention, type TierAttentionInput } from "@/lib/bookingCockpit";
import type { BookingFlow, FlowTimes } from "@/lib/bookingFlow";

export type TodayItemKind = "at_risk" | "cancelled_untold";

export interface AtRiskDate {
  kind: "at_risk";
  showDateId: string;
  date: string; // yyyy-mm-dd
  title: string; // "Hamlet, Abend"
  where: string; // "Thalia Theater, Hamburg"
  placesEmpty: number;
  daysOut: number;
  /** True when no further tier exists AND no eligible artist is left unasked. */
  exhausted: boolean;
  nextCastName: string | null; // "Ensemble Nord"
  nextCastFreeCount: number; // 6
  rosterCount: number; // 14
  rosterFreeCount: number; // 9
  /** The tier number to pass to `openOfferTier` for "Open it up to <cast>" —
   *  see `AtRiskDateFacts.nextTierNumber`. Null when there is nothing left
   *  to open (mirrors `hasUnopenedTier` being false). */
  nextTierNumber: number | null;
}

export interface CancelledUntoldDate {
  kind: "cancelled_untold";
  showDateId: string;
  date: string;
  title: string;
  where: string;
  daysOut: number;
  artistNames: string[]; // still holding the date
}

export type TodayItem = AtRiskDate | CancelledUntoldDate;

export interface BouncedAsk {
  artistId: string;
  artistName: string;
  email: string;
  showDateId: string;
  dateLabel: string; // "Die Zauberflöte on 12 Sep"
  bouncedAt: string; // ISO
}

export type FeedKind = "book" | "ask" | "draft" | "notify";
export type FeedAffordance = "undo" | "review";

/**
 * Structured display values for one feed row — carried as plain data rather
 * than a pre-rendered sentence so the COMPONENT layer (`DoneForYouFeed`) can
 * render it through `t("feed.<kind>", ...)`, keeping the data layer free of
 * hardcoded English (finding 6 in the Today board review: the direction used
 * to run the other way, with `src/data/autopilot.ts` baking English text and
 * the `feed.*` i18n keys sitting dead). Not every kind uses every field —
 * unused ones are `0`/`""`:
 *  - book   → count (artists who accepted), names, show, date
 *  - ask    → count (artists asked), show, date
 *  - draft  → count (contracts drafted), show, date
 *  - notify → names (empty string when nobody was still holding the date —
 *             the component falls back to `t("feed.theCast")`), show, date
 */
export interface FeedRowDetail {
  count: number;
  names: string;
  show: string;
  date: string;
}

export interface FeedRow extends FeedRowDetail {
  id: string;
  kind: FeedKind;
  at: string; // "07:02" | "Sun 19:00"
  affordance: FeedAffordance;
  /** The specific booking ids this row describes — for "book" rows the
   *  artists who accepted, for "ask" rows the still-suggested offers that
   *  were made. Undo must act on exactly these, never on every matching
   *  booking for the date/tier. Empty for kinds with no backing booking rows
   *  ("draft"/"notify"). */
  bookingIds: string[];
}

export interface TodayModel {
  items: TodayItem[];
  bounced: BouncedAsk[];
  feed: FeedRow[];
  /** items.length + (bounced.length ? 1 : 0) — drives the headline and nav badge. */
  openCount: number;
  fillingOnTheirOwn: number;
  bookedOvernight: number;
  /** The org's `booking_flow.producer_confirmation` — true when a yes is only a
   *  hold until a producer books it (Classic), false when a yes books the artist
   *  on its own (Autopilot). The board's own copy has to say which of the two
   *  actually happened: "Booked them, the place is theirs" is only true in the
   *  second case, and it was being asserted for both. Carried on the model so
   *  the presentational components (which take a model and nothing else) can
   *  pick their wording without reaching for the flow themselves. */
  producerConfirmation: boolean;
}

/**
 * Per-date facts an at-risk card needs beyond what `fetchTierAttention`'s
 * open-tier row already carries (`src/data/bookings.ts`): the venue/city
 * label, whether a further tier could still be opened, how many eligible
 * artists remain unasked across any tier, and the cast/roster figures the
 * resolution options show. Keyed by `showDateId`.
 *
 * A show_date whose current open tier is flagged at-risk/expiring by
 * `computeTierAttention` but has no matching facts row here is dropped from
 * the board rather than rendered with a guessed exhaustion state.
 */
export interface AtRiskDateFacts {
  showDateId: string;
  where: string;
  /** True when a tier beyond the one `fetchTierAttention` reports as open
   *  still exists and has not been opened yet. */
  hasUnopenedTier: boolean;
  /** Eligible artists for this date, across the whole roster, who have not
   *  been asked (offered) in any tier so far. */
  unaskedEligibleCount: number;
  nextCastName: string | null;
  nextCastFreeCount: number;
  rosterCount: number;
  rosterFreeCount: number;
  /** The tier number `openOfferTier` should open next, i.e. the lowest tier
   *  in the ladder that has not been opened yet — null when `hasUnopenedTier`
   *  is false (nothing left to open). This is what lets the "Open it up to
   *  <cast>" button actually call `openOfferTier` instead of only navigating. */
  nextTierNumber: number | null;
}

/**
 * The raw "cancelled, cast not told" row the data layer produces: a
 * show_date that cancelled while someone was still holding it.
 * `artistNames` is expected to already be scoped by the data layer to the
 * artists who were `confirmed`/`soft_booked` at the moment of cancellation
 * (not a bare unanswered `suggested` offer, which is not "holding" the
 * date) — `computeToday` still defensively drops any row whose list comes
 * through empty, so there is never a card with nobody to tell.
 */
export interface CancelledUntoldInput {
  showDateId: string;
  date: string;
  program: string | null;
  subProgram: string | null;
  venue: string | null;
  cancellationReason: string | null;
  castNotifiedAt: string | null;
  artistNames: string[];
}

/**
 * The raw done-for-you feed row the data layer produces. `at` is the
 * already-formatted display timestamp ("07:02" | "Sun 19:00"); `actedAt` and
 * `emailedAt` are the ISO instants `feedAffordance` reasons about.
 */
export interface FeedInput extends FeedRowDetail {
  id: string;
  kind: FeedKind;
  at: string;
  actedAt: string; // ISO
  emailedAt: string | null; // ISO, or null while the carrying email is unsent
  /** The specific booking ids this row describes — see `FeedRow.bookingIds`. */
  bookingIds: string[];
}

/**
 * The input bag `computeToday` takes: every read the board needs, already
 * fetched by `src/data/autopilot.ts` (and `fetchTierAttention` in
 * `src/data/bookings.ts`), so this module stays pure — no React, no
 * Supabase.
 */
export interface TodayInput {
  /** Open-tier attention rows, exactly as `fetchTierAttention` returns them. */
  tierAttention: TierAttentionInput[];
  /** Per-date facts `tierAttention` alone cannot supply — see `AtRiskDateFacts`. */
  atRiskFacts: AtRiskDateFacts[];
  cancelledUntold: CancelledUntoldInput[];
  bounced: BouncedAsk[];
  feed: FeedInput[];
  flow: BookingFlow;
  times: FlowTimes;
  fillingOnTheirOwn: number;
  bookedOvernight: number;
}

// The booking engine is Berlin-anchored (digest hours, expiry windows), so
// "today" and the digest boundary must both be read in Europe/Berlin, not
// the caller's local timezone. Same en-CA/Intl trick as bookingCockpit.ts.
const berlinDayKey = (iso: string): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));

const berlinMinutesSinceMidnight = (iso: string): number => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
};

/** Whole calendar days between two `yyyy-mm-dd` strings, parsed via the
 *  timezone-safe `parseDateOnly` helper so the difference is stable
 *  regardless of the caller's local timezone. */
function daysBetween(dateKey: string, fromKey: string): number {
  const ms = parseDateOnly(dateKey).getTime() - parseDateOnly(fromKey).getTime();
  return Math.round(ms / 86_400_000);
}

/** `dayKey` plus one calendar day, as a `yyyy-mm-dd` string. Pure Y-M-D
 *  arithmetic done in UTC so month/year rollovers are correct without any
 *  timezone involved — `dayKey` is already a Berlin calendar-day key, not an
 *  instant, so there is no DST to account for here. */
function nextDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/** "Hamlet, Abend" — exported for reuse by `src/data/autopilot.ts`, which
 *  imports it rather than keeping its own copy (this module already imports
 *  types from that file's sibling data layer types the other direction, so
 *  the dependency runs data -> lib, never lib -> data/Supabase). */
export function showTitle(program: string | null, subProgram: string | null): string {
  return [program, subProgram].filter((part): part is string => !!part).join(", ") || "Untitled show";
}

/**
 * The undo invariant. An action is reversible only while the email that
 * carries it has not yet been sent. `emailedAt` non-null => "review".
 *
 * For a digest-delivery org with no `emailedAt` yet, undo lasts until the
 * NEXT digest occurrence strictly after `actedAt`: if the action happened
 * before that day's digest hour, the boundary is that same day's digest
 * hour; if it happened at or after it (the digest for that day has already
 * run), the action rides tomorrow's digest instead, so the boundary is
 * tomorrow's digest hour. An action taken at 19:30 Berlin — after a 19:00
 * digest has already gone out — cannot have been carried by that digest; it
 * stays undoable until the NEXT one, 24h later.
 */
export function feedAffordance(
  row: { emailedAt: string | null; actedAt: string },
  flow: { offer_delivery: "digest" | "immediate" },
  times: { offerDigestHour: number },
  now: Date,
): FeedAffordance {
  if (row.emailedAt !== null) return "review";
  // Immediate delivery sends the mail the instant the action happens — there
  // is no undo window to check the clock against.
  if (flow.offer_delivery === "immediate") return "review";

  const digestMinutes = times.offerDigestHour * 60;
  const actedDay = berlinDayKey(row.actedAt);
  const actedMinutes = berlinMinutesSinceMidnight(row.actedAt);
  // The digest occurrence that actually carries this action: today's if the
  // action landed before the digest ran, otherwise tomorrow's.
  const boundaryDay = actedMinutes < digestMinutes ? actedDay : nextDayKey(actedDay);

  const nowIso = now.toISOString();
  const nowDay = berlinDayKey(nowIso);
  if (nowDay > boundaryDay) return "review"; // a later Berlin day: the carrying digest already ran
  if (nowDay < boundaryDay) return "undo"; // still before the carrying digest's own day
  return berlinMinutesSinceMidnight(nowIso) >= digestMinutes ? "review" : "undo";
}

/**
 * Whether THIS viewer may reverse a feed row, on top of the time-based
 * `feedAffordance` above. Undoing a "book" row cancels bookings
 * (`confirm_bookings`); undoing an "ask" row withdraws offers
 * (`run_offer_engine`) — the same rights every other booking surface gates on
 * (ShowsBookingsPage, ShowDateDetailSheet) and the same ones `open-offer-tier`
 * enforces at the edge. An org admin can revoke either from producers, and
 * offering Undo anyway just produces a 403 the toast reports as "try again".
 * "draft"/"notify" have no reversal mutation at all, so they are never undoable.
 *
 * Lives here, not in the component, so the button's LABEL and the container's
 * HANDLER read the same rule (a Review label wired to an undo handler would be
 * worse than either alone).
 */
export function canUndoFeedRow(
  kind: FeedKind,
  rights: { canBook: boolean; canAsk: boolean },
): boolean {
  if (kind === "book") return rights.canBook;
  if (kind === "ask") return rights.canAsk;
  return false;
}

export function computeToday(input: TodayInput, now: Date): TodayModel {
  const todayKey = berlinDayKey(now.toISOString());
  const factsByDate = new Map(input.atRiskFacts.map((f) => [f.showDateId, f]));

  const atRiskItems: AtRiskDate[] = [];
  const seenDates = new Set<string>();
  for (const attention of computeTierAttention(input.tierAttention, now)) {
    if (seenDates.has(attention.showDateId)) continue;
    const facts = factsByDate.get(attention.showDateId);
    if (!facts) continue; // no basis to render the card — drop it rather than guess
    seenDates.add(attention.showDateId);
    atRiskItems.push({
      kind: "at_risk",
      showDateId: attention.showDateId,
      date: attention.date,
      title: showTitle(attention.program, attention.subProgram),
      where: facts.where,
      placesEmpty: Math.max(0, attention.required - attention.filled),
      daysOut: daysBetween(attention.date, todayKey),
      exhausted: !facts.hasUnopenedTier && facts.unaskedEligibleCount === 0,
      nextCastName: facts.nextCastName,
      nextCastFreeCount: facts.nextCastFreeCount,
      rosterCount: facts.rosterCount,
      rosterFreeCount: facts.rosterFreeCount,
      nextTierNumber: facts.nextTierNumber,
    });
  }

  const cancelledItems: CancelledUntoldDate[] = input.cancelledUntold
    .filter((row) => row.castNotifiedAt === null && row.artistNames.length > 0)
    .map((row) => ({
      kind: "cancelled_untold",
      showDateId: row.showDateId,
      date: row.date,
      title: showTitle(row.program, row.subProgram),
      where: row.venue ?? "",
      daysOut: daysBetween(row.date, todayKey),
      artistNames: row.artistNames,
    }));

  const items: TodayItem[] = [...atRiskItems, ...cancelledItems].sort((a, b) => a.date.localeCompare(b.date));

  const feed: FeedRow[] = input.feed.map((row) => ({
    id: row.id,
    kind: row.kind,
    count: row.count,
    names: row.names,
    show: row.show,
    date: row.date,
    at: row.at,
    affordance: feedAffordance({ emailedAt: row.emailedAt, actedAt: row.actedAt }, input.flow, input.times, now),
    bookingIds: row.bookingIds,
  }));

  return {
    items,
    bounced: input.bounced,
    feed,
    openCount: items.length + (input.bounced.length > 0 ? 1 : 0),
    fillingOnTheirOwn: input.fillingOnTheirOwn,
    bookedOvernight: input.bookedOvernight,
    producerConfirmation: input.flow.producer_confirmation,
  };
}
