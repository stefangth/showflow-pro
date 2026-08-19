// Data access for the Autopilot "Today" board. Every function takes the
// Supabase client as its first parameter (never imports the singleton) and
// returns the exact shapes `src/lib/autopilot/today.ts` declares — that pure
// module has no Supabase/React imports of its own, so this file is the only
// place those shapes get filled in from real reads.
//
// Org scoping is explicit everywhere (ADR-0003): `is_org_member()` short-
// circuits true for super-admins and is true for every org a multi-org user
// belongs to, so RLS never narrows a read to "the active org" on its own.
// Every query below carries its own `.eq("org_id", orgId)` (or an `!inner`
// join that carries one), even where the embedded table itself has no
// `org_id` column (`booking_audit_log`) — there the join is onto an
// org-scoped parent row instead.

import { format } from "date-fns";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { dfLocale, parseDateOnly } from "@/lib/dates";
import { fetchOfferTiers, fetchOpenedTiers } from "./bookings";
import {
  fetchGateArtistIds,
  fetchRequiredSkillIds,
  fetchShowPriorityRows,
  fetchSkillEligibleArtistIds,
} from "./eligibility";
import {
  showTitle,
  type AtRiskDateFacts,
  type BouncedAsk,
  type CancelledUntoldInput,
  type FeedInput,
  type FeedKind,
} from "@/lib/autopilot/today";

/** "12 Sep" — day + short month, no year (the board never spans a year boundary). */
function shortDate(dateKey: string): string {
  return format(parseDateOnly(dateKey), "d MMM", { locale: dfLocale() });
}

/**
 * The artists holding a booking on `showDateIds` who were `confirmed` or
 * `soft_booked` at the moment their booking was cancelled — i.e. actually
 * had the date in their calendar, not a bare unanswered `suggested` offer.
 *
 * Identified per the controller ruling: the cancellation cascade
 * (20260620130000_show_date_cancellation.sql) stamps every non-cancelled
 * booking on a cancelled date to `status='cancelled',
 * cancellation_reason='date_cancelled'`, which erases the pre-cancel status.
 * `notify_booking_transition_trigger` (20260514240000_booking_notification_
 * trigger.sql, `AFTER UPDATE ON bookings`, fires on every status change, not
 * only the two transitions it emails/notifies for) recovers it: it always
 * inserts a `booking_audit_log` row with `old_status`/`new_status`, so the
 * transition INTO cancelled from `confirmed` or `soft_booked` is on record.
 * A booking is terminal once cancelled (no further status transition), so
 * there is at most one such row per booking — no risk of the `!inner` join
 * fanning a booking out into duplicate names.
 *
 * `booking_audit_log` has no `org_id` column of its own, so the org scope is
 * carried by the `bookings!inner` embed (`bookings.org_id`), not a bare
 * `.eq` on the child table.
 */
async function fetchCancelledArtistNamesByDate(
  client: SupabaseClient<Database>,
  args: { orgId: string; showDateIds: string[] },
): Promise<Map<string, string[]>> {
  const namesByDate = new Map<string, string[]>();
  if (args.showDateIds.length === 0) return namesByDate;

  interface CancelledBookingRow {
    id: string;
    show_date_id: string;
    artist: { name: string } | null;
    booking_audit_log: { old_status: string; new_status: string }[];
  }
  const { data, error } = await client
    .from("bookings")
    .select("id, show_date_id, artist:artists(name), booking_audit_log!inner(old_status, new_status)")
    .eq("org_id", args.orgId)
    .in("show_date_id", args.showDateIds)
    .eq("status", "cancelled")
    .eq("cancellation_reason", "date_cancelled")
    .eq("booking_audit_log.new_status", "cancelled")
    .or("old_status.eq.confirmed,old_status.eq.soft_booked", { foreignTable: "booking_audit_log" });
  if (error) throw error;

  for (const row of (data ?? []) as unknown as CancelledBookingRow[]) {
    const name = row.artist?.name;
    if (!name) continue;
    const list = namesByDate.get(row.show_date_id) ?? [];
    list.push(name);
    namesByDate.set(row.show_date_id, list);
  }
  return namesByDate;
}

interface CancelledDateRow {
  id: string;
  date: string;
  venue: string | null;
  cancellation_reason: string | null;
  cast_notified_at: string | null;
  show: { program: string | null; sub_program: string | null } | null;
}

/**
 * Cancelled show_dates whose cast has not yet been told (`cast_notified_at`
 * is null), today or later, for the "cancelled, cast not told" board card.
 * `artistNames` is scoped to artists who actually held the date at
 * cancellation time (see `fetchCancelledArtistNamesByDate`) — a date with no
 * such artist is still returned with an empty `artistNames`; `computeToday`
 * is the one that drops it (documented on `CancelledUntoldInput`).
 */
export async function fetchCancelledUntoldDates(
  client: SupabaseClient<Database>,
  args: { orgId: string | null; today: string },
): Promise<CancelledUntoldInput[]> {
  if (!args.orgId) return [];
  const orgId = args.orgId;

  const { data: dateRows, error: dateErr } = await client
    .from("show_dates")
    .select("id, date, venue, cancellation_reason, cast_notified_at, show:shows(program, sub_program)")
    .eq("org_id", orgId)
    .eq("status", "cancelled")
    .is("cast_notified_at", null)
    .gte("date", args.today);
  if (dateErr) throw dateErr;
  const dates = (dateRows ?? []) as unknown as CancelledDateRow[];
  if (dates.length === 0) return [];

  const namesByDate = await fetchCancelledArtistNamesByDate(client, {
    orgId,
    showDateIds: dates.map((d) => d.id),
  });

  return dates.map((d) => ({
    showDateId: d.id,
    date: d.date,
    program: d.show?.program ?? null,
    subProgram: d.show?.sub_program ?? null,
    venue: d.venue,
    cancellationReason: d.cancellation_reason,
    castNotifiedAt: d.cast_notified_at,
    artistNames: namesByDate.get(d.id) ?? [],
  }));
}

interface BouncedBookingRow {
  artist_id: string;
  show_date_id: string;
  artist: { id: string; name: string; email: string | null } | null;
  show_date: { date: string; show: { program: string | null; sub_program: string | null } | null } | null;
}

interface SuppressedRow {
  email: string;
  created_at: string;
}

/**
 * Artists with a `suggested` (unanswered) offer on an upcoming date whose
 * email address is on the `suppressed_emails` bounce/complaint list — the
 * offer went out but never arrived. Two-step: first the candidate asks
 * (org-scoped via `bookings.org_id`), then `suppressed_emails` narrowed to
 * just those candidates' addresses.
 *
 * `suppressed_emails` itself has no `org_id` column (it's a global,
 * email-keyed suppression list — ADR N/A, see `supabase/migrations/
 * 20260710231816_email_delivery_tables.sql`), so it has no direct org scope
 * of its own; the org narrowing happens upstream, on the `bookings` read,
 * before the suppression lookup ever runs — `.in("email", …)` only narrows
 * the global list down to THOSE org-scoped candidates' addresses, it isn't
 * itself an org filter.
 *
 * `suppressed_emails` carries two additive SELECT policies, OR'd together by
 * RLS: the original super-admin-only read, plus `"org members read
 * suppressed_emails for their artists"` (`supabase/migrations/
 * 20260819090000_suppressed_emails_org_member_read.sql`), which grants an
 * org member a row whenever the suppressed email matches an artist in an org
 * they belong to. Because this function's own candidate set is already
 * `bookings`-org-scoped before it ever queries `suppressed_emails`, an
 * ordinary org admin/producer now sees exactly their own org's bounces, not
 * zero rows — pgTAP proves the cross-org negative (a member of org B cannot
 * see org A's suppression rows even for a shared email).
 */
export async function fetchBouncedAsks(
  client: SupabaseClient<Database>,
  args: { orgId: string | null; today: string },
): Promise<BouncedAsk[]> {
  if (!args.orgId) return [];

  const { data: bookingRows, error: bookingErr } = await client
    .from("bookings")
    .select(
      "artist_id, show_date_id, artist:artists(id, name, email), " +
      "show_date:show_dates!inner(date, show:shows(program, sub_program))",
    )
    .eq("org_id", args.orgId)
    .eq("status", "suggested")
    .gte("show_date.date", args.today);
  if (bookingErr) throw bookingErr;
  const bookings = (bookingRows ?? []) as unknown as BouncedBookingRow[];

  const emails = Array.from(
    new Set(bookings.map((b) => b.artist?.email).filter((e): e is string => !!e)),
  );
  if (emails.length === 0) return [];

  const { data: suppressedRows, error: suppressedErr } = await client
    .from("suppressed_emails")
    .select("email, created_at")
    .in("email", emails);
  if (suppressedErr) throw suppressedErr;
  const bouncedAtByEmail = new Map(
    ((suppressedRows ?? []) as unknown as SuppressedRow[]).map((r) => [r.email, r.created_at]),
  );
  if (bouncedAtByEmail.size === 0) return [];

  const out: BouncedAsk[] = [];
  for (const b of bookings) {
    const email = b.artist?.email;
    if (!email || !b.artist || !b.show_date) continue;
    const bouncedAt = bouncedAtByEmail.get(email);
    if (!bouncedAt) continue;
    out.push({
      artistId: b.artist.id,
      artistName: b.artist.name,
      email,
      showDateId: b.show_date_id,
      dateLabel: `${showTitle(b.show_date.show?.program ?? null, b.show_date.show?.sub_program ?? null)} on ${shortDate(b.show_date.date)}`,
      bouncedAt,
    });
  }
  return out;
}

interface AtRiskDateContextRow {
  id: string;
  date: string;
  show_id: string;
  city_id: string | null;
  venue: string | null;
  city: { name: string } | null;
}

/**
 * Per-date facts an at-risk card needs beyond `fetchTierAttention`'s own
 * open-tier rows (`src/data/bookings.ts`) — see `AtRiskDateFacts` in
 * `src/lib/autopilot/today.ts` for the exact contract. No function shape was
 * specified for this in the Task 3 brief's interface block; this one exists
 * per the controller ruling ("build one, reuse fetchTierAttention and the
 * existing tier/eligibility reads … rather than writing new eligibility
 * logic from scratch").
 *
 * Reuses, per date: `fetchOfferTiers` + `fetchOpenedTiers` (the tier ladder
 * and what of it is already open — `src/data/bookings.ts`) and
 * `fetchGateArtistIds` + `fetchRequiredSkillIds` + `fetchSkillEligibleArtistIds`
 * + `fetchShowPriorityRows` (the eligibility gate — `src/data/eligibility.ts`).
 * "Free" (for `nextCastFreeCount`/`rosterFreeCount`) means: an active roster
 * artist who does not already hold a non-cancelled booking on this date and
 * has no self-declared `blocked_dates` row for it — mirroring
 * `open-offer-tier`'s own `already_booked`/`blocked` exclusions.
 * "Unasked" (for `unaskedEligibleCount`) means: no booking row AT ALL for
 * this date, in any status — being asked is a historical fact that a
 * withdrawn or declined offer doesn't erase.
 *
 * Runs the tier-ladder/eligibility reads per date (they take a single
 * showDateId each); the roster, booking and blocked-date reads are each
 * batched once across every date in `args.showDateIds`. Callers are expected
 * to pass a small set (the show_dates `fetchTierAttention` already flagged
 * as open-tier), not the whole season.
 *
 * Concurrency: every date is processed via `Promise.all` (never one date
 * after another), and within one date the two independent read groups — the
 * tier-ladder/next-cast branch (`fetchOfferTiersAndNextCast`) and the
 * eligibility branch (`fetchUnaskedEligibleCount`) — also run concurrently
 * via `Promise.all`, since neither reads a value the other produces. `Promise.
 * all` preserves input order in its resolved array regardless of completion
 * order, so `facts` still comes out in the same order as `dates` (and the
 * same order `args.showDateIds` implies) — no re-sort needed. Worst case this
 * takes the per-date sequential chain from ~10-14 round trips down to ~5, and
 * that ~5 no longer multiplies by the number of at-risk dates.
 */
export async function fetchAtRiskDateFacts(
  client: SupabaseClient<Database>,
  args: { orgId: string | null; showDateIds: string[] },
): Promise<AtRiskDateFacts[]> {
  if (!args.orgId || args.showDateIds.length === 0) return [];
  const orgId = args.orgId;

  const { data: dateRows, error: dateErr } = await client
    .from("show_dates")
    .select("id, date, show_id, city_id, venue, city:cities(name)")
    .eq("org_id", orgId)
    .in("id", args.showDateIds);
  if (dateErr) throw dateErr;
  const dates = (dateRows ?? []) as unknown as AtRiskDateContextRow[];
  if (dates.length === 0) return [];

  interface RosterRow { id: string }
  const { data: rosterRows, error: rosterErr } = await client
    .from("artists")
    .select("id")
    .eq("org_id", orgId)
    .eq("status", "active");
  if (rosterErr) throw rosterErr;
  const rosterIds = ((rosterRows ?? []) as unknown as RosterRow[]).map((r) => r.id);
  const rosterIdSet = new Set(rosterIds);
  const rosterCount = rosterIds.length;

  const { data: bookingRows, error: bookingErr } = await client
    .from("bookings")
    .select("show_date_id, artist_id, status")
    .eq("org_id", orgId)
    .in("show_date_id", args.showDateIds);
  if (bookingErr) throw bookingErr;
  const bookingsByDate = new Map<string, DateBookingRow[]>();
  for (const b of (bookingRows ?? []) as unknown as DateBookingRow[]) {
    const list = bookingsByDate.get(b.show_date_id) ?? [];
    list.push(b);
    bookingsByDate.set(b.show_date_id, list);
  }

  const dateKeys = Array.from(new Set(dates.map((d) => d.date)));
  interface BlockedRow { date: string; artist_id: string }
  const { data: blockedRows, error: blockedErr } = await client
    .from("blocked_dates")
    .select("date, artist_id")
    .eq("org_id", orgId)
    .in("date", dateKeys);
  if (blockedErr) throw blockedErr;
  const blockedByDate = new Map<string, Set<string>>();
  for (const r of (blockedRows ?? []) as unknown as BlockedRow[]) {
    const set = blockedByDate.get(r.date) ?? new Set<string>();
    set.add(r.artist_id);
    blockedByDate.set(r.date, set);
  }

  const facts = await Promise.all(
    dates.map((d) =>
      fetchOneAtRiskDateFacts(client, {
        d,
        orgId,
        rosterIds,
        rosterIdSet,
        rosterCount,
        bookingsForDate: bookingsByDate.get(d.id) ?? [],
        blockedIds: blockedByDate.get(d.date) ?? new Set<string>(),
      }),
    ),
  );
  return facts;
}

interface DateBookingRow { show_date_id: string; artist_id: string; status: string }

/** One date's facts, per `fetchAtRiskDateFacts` — split into the two
 *  independent read branches below and run concurrently. */
async function fetchOneAtRiskDateFacts(
  client: SupabaseClient<Database>,
  args: {
    d: AtRiskDateContextRow;
    orgId: string;
    rosterIds: string[];
    rosterIdSet: Set<string>;
    rosterCount: number;
    bookingsForDate: DateBookingRow[];
    blockedIds: Set<string>;
  },
): Promise<AtRiskDateFacts> {
  const { d, orgId, rosterIds, rosterIdSet, rosterCount, bookingsForDate, blockedIds } = args;
  const activeBookedIds = new Set(
    bookingsForDate.filter((b) => b.status !== "cancelled").map((b) => b.artist_id),
  );
  const askedIds = new Set(bookingsForDate.map((b) => b.artist_id));
  const isFree = (artistId: string) => !activeBookedIds.has(artistId) && !blockedIds.has(artistId);

  const [castBranch, unaskedEligibleCount] = await Promise.all([
    fetchNextCastBranch(client, { d, orgId, rosterIdSet, isFree }),
    fetchUnaskedEligibleCount(client, { d, rosterIds, askedIds }),
  ]);

  return {
    showDateId: d.id,
    where: [d.venue, d.city?.name ?? null].filter((p): p is string => !!p).join(", "),
    hasUnopenedTier: castBranch.hasUnopenedTier,
    unaskedEligibleCount,
    nextCastName: castBranch.nextCastName,
    nextCastFreeCount: castBranch.nextCastFreeCount,
    rosterCount,
    rosterFreeCount: rosterIds.filter((id) => isFree(id)).length,
    nextTierNumber: castBranch.nextTierNumber,
  };
}

interface NextCastBranchResult {
  hasUnopenedTier: boolean;
  nextTierNumber: number | null;
  nextCastName: string | null;
  nextCastFreeCount: number;
}

/** The tier-ladder / "who gets asked next" branch of one date's facts —
 *  independent of `fetchUnaskedEligibleCount` below, so the two run
 *  concurrently in `fetchOneAtRiskDateFacts`. */
async function fetchNextCastBranch(
  client: SupabaseClient<Database>,
  args: { d: AtRiskDateContextRow; orgId: string; rosterIdSet: Set<string>; isFree: (artistId: string) => boolean },
): Promise<NextCastBranchResult> {
  const { d, orgId, rosterIdSet, isFree } = args;

  const [tiers, opened] = await Promise.all([
    fetchOfferTiers(client, { showId: d.show_id, cityId: d.city_id, showDateId: d.id }),
    fetchOpenedTiers(client, d.id),
  ]);
  const openedSet = new Set(opened.map((o) => o.tier));
  const availableTiers = new Set(tiers.priorities);
  if (tiers.hasAdHoc) availableTiers.add(99);
  const unopened = [...availableTiers].filter((t) => !openedSet.has(t)).sort((a, b) => a - b);
  const hasUnopenedTier = unopened.length > 0;
  const nextTier = unopened.length > 0 ? unopened[0] : null;

  let nextCastIds: string[] = [];
  if (nextTier === 99) {
    interface CastIdRow { cast_id: string }
    const { data: adHocRows, error: adHocErr } = await client
      .from("show_date_cast_eligibility")
      .select("cast_id")
      .eq("show_date_id", d.id);
    if (adHocErr) throw adHocErr;
    nextCastIds = ((adHocRows ?? []) as unknown as CastIdRow[]).map((r) => r.cast_id);
  } else if (nextTier !== null && d.city_id) {
    if (tiers.source === "show") {
      const showPriorities = await fetchShowPriorityRows(client, d.show_id);
      nextCastIds = showPriorities
        .filter((r) => r.cityId === d.city_id && r.priority === nextTier)
        .map((r) => r.castId);
    } else {
      interface CastIdRow { cast_id: string }
      const { data: cityRows, error: cityErr } = await client
        .from("cast_city_priority")
        .select("cast_id")
        .eq("org_id", orgId)
        .eq("city_id", d.city_id)
        .eq("priority", nextTier);
      if (cityErr) throw cityErr;
      nextCastIds = ((cityRows ?? []) as unknown as CastIdRow[]).map((r) => r.cast_id);
    }
  }
  nextCastIds = Array.from(new Set(nextCastIds));

  let nextCastName: string | null = null;
  let nextCastFreeCount = 0;
  if (nextCastIds.length > 0) {
    interface CastNameRow { id: string; name: string }
    interface CastMemberRow { artist_id: string }
    const [castRes, memberRes] = await Promise.all([
      client.from("casts").select("id, name").in("id", nextCastIds),
      client.from("cast_members").select("artist_id").in("cast_id", nextCastIds),
    ]);
    if (castRes.error) throw castRes.error;
    if (memberRes.error) throw memberRes.error;
    const names = ((castRes.data ?? []) as unknown as CastNameRow[]).map((r) => r.name);
    nextCastName = names.length > 0 ? names.join(", ") : null;
    const memberIds = new Set(((memberRes.data ?? []) as unknown as CastMemberRow[]).map((r) => r.artist_id));
    nextCastFreeCount = [...memberIds].filter((id) => rosterIdSet.has(id) && isFree(id)).length;
  }

  return { hasUnopenedTier, nextTierNumber: nextTier, nextCastName, nextCastFreeCount };
}

/** The eligibility-gate branch of one date's facts — independent of
 *  `fetchNextCastBranch` above, so the two run concurrently. */
async function fetchUnaskedEligibleCount(
  client: SupabaseClient<Database>,
  args: { d: AtRiskDateContextRow; rosterIds: string[]; askedIds: Set<string> },
): Promise<number> {
  const { d, rosterIds, askedIds } = args;
  const [gate, requiredSkills] = await Promise.all([
    fetchGateArtistIds(client, { showId: d.show_id, cityId: d.city_id, showDateId: d.id }),
    fetchRequiredSkillIds(client, { showId: d.show_id, showDateId: d.id }),
  ]);
  const skillEligible = await fetchSkillEligibleArtistIds(client, { requiredSkillIds: requiredSkills.all });
  let eligibleIds = gate === null ? rosterIds : rosterIds.filter((id) => gate.has(id));
  if (skillEligible !== null) eligibleIds = eligibleIds.filter((id) => skillEligible.has(id));
  return eligibleIds.filter((id) => !askedIds.has(id)).length;
}

/**
 * The "done for you" feed since `args.since` (an ISO instant — typically the
 * previous digest run): every ask/book/draft/notify the engine did on its
 * own, one row per (show_date [, tier]) batch. `at` is pre-formatted for
 * direct display; the rest of the row's content (`count`/`names`/`show`/
 * `date`) is plain structured data, NOT a pre-rendered sentence — the
 * component layer (`DoneForYouFeed`) renders it through `t("feed.<kind>",
 * ...)` using the `feed.*` i18n keys (finding 6 in the Today board review).
 *

 * `emailedAt` is the timestamp of whichever mail actually carries that row's
 * action irreversible, per kind:
 *  - ask    → `bookings.digest_sent_at` (the offer digest email)
 *  - book   → `bookings.confirmation_digest_sent_at` (the confirmation digest)
 *  - draft  → always null (a draft never auto-emails; only `issue` does, and
 *             that's a separate human action, not an "undo" of the draft)
 *  - notify → `show_dates.cast_notified_at` itself (the notify-cast call IS
 *             the email/notification event, so it's already "sent" the
 *             instant the row exists)
 */
export async function fetchAutopilotFeed(
  client: SupabaseClient<Database>,
  args: { orgId: string | null; since: string },
): Promise<FeedInput[]> {
  if (!args.orgId) return [];
  const orgId = args.orgId;
  const rows: FeedInput[] = [];

  // ── "ask": offers batched by (show_date, tier) ──────────────────────────
  interface AskRow {
    id: string;
    show_date_id: string;
    offer_tier: number | null;
    offered_at: string | null;
    digest_sent_at: string | null;
    show_date: { date: string; show: { program: string | null; sub_program: string | null } | null } | null;
  }
  const { data: askRows, error: askErr } = await client
    .from("bookings")
    .select(
      "id, show_date_id, offer_tier, offered_at, digest_sent_at, " +
      "show_date:show_dates!inner(date, show:shows(program, sub_program))",
    )
    .eq("org_id", orgId)
    .not("offered_at", "is", null)
    .gte("offered_at", args.since);
  if (askErr) throw askErr;
  const askGroups = new Map<string, AskRow[]>();
  for (const r of (askRows ?? []) as unknown as AskRow[]) {
    const key = `${r.show_date_id}:${r.offer_tier ?? "0"}`;
    const list = askGroups.get(key) ?? [];
    list.push(r);
    askGroups.set(key, list);
  }
  for (const [key, group] of askGroups) {
    const first = group[0];
    if (!first.show_date) continue;
    const title = showTitle(first.show_date.show?.program ?? null, first.show_date.show?.sub_program ?? null);
    const actedTimes = group.map((r) => r.offered_at).filter((v): v is string => !!v).sort();
    // The exact suggested bookings this row describes — undo (finding 1)
    // must withdraw only these, never every suggested offer on the tier
    // (`cancelAutopilotAskedIds`, not `closeOfferTier`).
    const bookingIds = Array.from(new Set(group.map((r) => r.id).filter((id): id is string => !!id)));
    rows.push({
      id: `ask:${key}`,
      kind: "ask" as FeedKind,
      count: group.length,
      names: "",
      show: title,
      date: shortDate(first.show_date.date),
      at: format(new Date(actedTimes[0]), "EEE HH:mm", { locale: dfLocale() }),
      actedAt: actedTimes[0],
      emailedAt: group.find((r) => r.digest_sent_at)?.digest_sent_at ?? null,
      bookingIds,
    });
  }

  // ── "book": artist acceptances (suggested → soft_booked/confirmed) ─────
  // old_status=suggested AND new_status IN (soft_booked, confirmed). Org
  // scope is carried by `bookings!inner` (booking_audit_log has no org_id
  // of its own — same shape as the cancelled-untold join above).
  const { data: acceptRows, error: acceptErr } = await client
    .from("booking_audit_log")
    .select(
      "id, created_at, booking:bookings!inner(id, show_date_id, org_id, confirmation_digest_sent_at, " +
      "artist:artists(name), show_date:show_dates(date, show:shows(program, sub_program)))",
    )
    .eq("booking.org_id", orgId)
    .eq("old_status", "suggested")
    .in("new_status", ["soft_booked", "confirmed"])
    .gte("created_at", args.since);
  if (acceptErr) throw acceptErr;
  interface AcceptRow {
    id: string;
    created_at: string;
    booking: {
      id: string;
      show_date_id: string;
      confirmation_digest_sent_at: string | null;
      artist: { name: string } | null;
      show_date: { date: string; show: { program: string | null; sub_program: string | null } | null } | null;
    } | null;
  }
  const acceptGroups = new Map<string, AcceptRow[]>();
  for (const r of (acceptRows ?? []) as unknown as AcceptRow[]) {
    if (!r.booking) continue;
    const list = acceptGroups.get(r.booking.show_date_id) ?? [];
    list.push(r as AcceptRow);
    acceptGroups.set(r.booking.show_date_id, list);
  }
  for (const [showDateId, group] of acceptGroups) {
    const showDate = group[0].booking?.show_date ?? null;
    if (!showDate) continue;
    const title = showTitle(showDate.show?.program ?? null, showDate.show?.sub_program ?? null);
    const names = group.map((r) => r.booking?.artist?.name).filter((n): n is string => !!n);
    const actedTimes = group.map((r) => r.created_at).sort();
    // The exact bookings this row describes — undo must cancel only these,
    // never every soft-booked/confirmed booking on the date (findings 2/3).
    const bookingIds = Array.from(
      new Set(group.map((r) => r.booking?.id).filter((id): id is string => !!id)),
    );
    rows.push({
      id: `book:${showDateId}`,
      kind: "book" as FeedKind,
      count: names.length,
      names: names.join(", "),
      show: title,
      date: shortDate(showDate.date),
      at: format(new Date(actedTimes[0]), "EEE HH:mm", { locale: dfLocale() }),
      actedAt: actedTimes[0],
      emailedAt: group.find((r) => r.booking?.confirmation_digest_sent_at)?.booking?.confirmation_digest_sent_at ?? null,
      bookingIds,
    });
  }

  // ── "draft": hire orders auto-drafted on fully_filled ───────────────────
  interface DraftRow {
    id: string;
    show_date_id: string | null;
    created_at: string;
    show_date: { date: string; show: { program: string | null; sub_program: string | null } | null } | null;
  }
  // `hire_orders` has TWO relationships to `show_dates` — the direct
  // `hire_orders_show_date_id_fkey` column and the `hire_order_dates`
  // many-to-many join table — so PostgREST refuses to embed without a hint
  // (PGRST201, HTTP 300 Multiple Choices). Disambiguate to the direct FK,
  // confirmed against `src/integrations/supabase/types.ts` (the generated
  // `hire_orders` table's Relationships array) and the live local DB error.
  const { data: draftRows, error: draftErr } = await client
    .from("hire_orders")
    .select(
      "id, show_date_id, created_at, " +
      "show_date:show_dates!hire_orders_show_date_id_fkey(date, show:shows(program, sub_program))",
    )
    .eq("org_id", orgId)
    .eq("status", "draft")
    .gte("created_at", args.since);
  if (draftErr) throw draftErr;
  const draftGroups = new Map<string, DraftRow[]>();
  for (const r of (draftRows ?? []) as unknown as DraftRow[]) {
    if (!r.show_date_id) continue;
    const list = draftGroups.get(r.show_date_id) ?? [];
    list.push(r);
    draftGroups.set(r.show_date_id, list);
  }
  for (const [showDateId, group] of draftGroups) {
    const showDate = group[0].show_date;
    if (!showDate) continue;
    const title = showTitle(showDate.show?.program ?? null, showDate.show?.sub_program ?? null);
    const actedTimes = group.map((r) => r.created_at).sort();
    rows.push({
      id: `draft:${showDateId}`,
      kind: "draft" as FeedKind,
      count: group.length,
      names: "",
      show: title,
      date: shortDate(showDate.date),
      at: format(new Date(actedTimes[0]), "EEE HH:mm", { locale: dfLocale() }),
      actedAt: actedTimes[0],
      emailedAt: null,
      bookingIds: [],
    });
  }

  // ── "notify": producer told cast a date was cancelled ───────────────────
  interface NotifyDateRow {
    id: string;
    date: string;
    cast_notified_at: string | null;
    show: { program: string | null; sub_program: string | null } | null;
  }
  const { data: notifyRows, error: notifyErr } = await client
    .from("show_dates")
    .select("id, date, cast_notified_at, show:shows(program, sub_program)")
    .eq("org_id", orgId)
    .not("cast_notified_at", "is", null)
    .gte("cast_notified_at", args.since);
  if (notifyErr) throw notifyErr;
  const notifyDates = (notifyRows ?? []) as unknown as NotifyDateRow[];
  if (notifyDates.length > 0) {
    const namesByDate = await fetchCancelledArtistNamesByDate(client, {
      orgId,
      showDateIds: notifyDates.map((d) => d.id),
    });
    for (const d of notifyDates) {
      if (!d.cast_notified_at) continue;
      const title = showTitle(d.show?.program ?? null, d.show?.sub_program ?? null);
      const names = namesByDate.get(d.id) ?? [];
      rows.push({
        id: `notify:${d.id}`,
        kind: "notify" as FeedKind,
        count: names.length,
        // "" when nobody was still holding the date — the component falls
        // back to `t("feed.theCast")` for this case.
        names: names.join(", "),
        show: title,
        date: shortDate(d.date),
        at: format(new Date(d.cast_notified_at), "EEE HH:mm", { locale: dfLocale() }),
        actedAt: d.cast_notified_at,
        emailedAt: d.cast_notified_at,
        bookingIds: [],
      });
    }
  }

  return rows;
}
