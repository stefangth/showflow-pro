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
import type {
  AtRiskDateFacts,
  BouncedAsk,
  CancelledUntoldInput,
  FeedInput,
  FeedKind,
} from "@/lib/autopilot/today";

/** "Hamlet, Abend" — same rule as `today.ts`'s private `showTitle` (kept in
 *  sync by hand since that module deliberately has no Supabase-layer import). */
function showTitle(program: string | null, subProgram: string | null): string {
  return [program, subProgram].filter((p): p is string => !!p).join(", ") || "Untitled show";
}

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
 * 20260710231816_email_delivery_tables.sql`), so scoping here is entirely
 * on the org-scoped `bookings` read; the `.in("email", …)` narrows the
 * global list down to this org's own candidates, it isn't an org filter.
 *
 * KNOWN GAP (see the Task 3 report): `suppressed_emails`' only RLS policy is
 * "super-admin reads only" (`is_super_admin(auth.uid())`). An org admin or
 * producer session calling this as written gets zero rows, not an org-scoped
 * subset — this needs a follow-up RLS policy before the bounced-asks card
 * can work for anyone but a super-admin.
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

  interface DateBookingRow { show_date_id: string; artist_id: string; status: string }
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

  const facts: AtRiskDateFacts[] = [];
  for (const d of dates) {
    const bookingsForDate = bookingsByDate.get(d.id) ?? [];
    const activeBookedIds = new Set(
      bookingsForDate.filter((b) => b.status !== "cancelled").map((b) => b.artist_id),
    );
    const askedIds = new Set(bookingsForDate.map((b) => b.artist_id));
    const blockedIds = blockedByDate.get(d.date) ?? new Set<string>();
    const isFree = (artistId: string) => !activeBookedIds.has(artistId) && !blockedIds.has(artistId);

    const tiers = await fetchOfferTiers(client, { showId: d.show_id, cityId: d.city_id, showDateId: d.id });
    const opened = await fetchOpenedTiers(client, d.id);
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
      const { data: castRows, error: castErr } = await client
        .from("casts")
        .select("id, name")
        .in("id", nextCastIds);
      if (castErr) throw castErr;
      const names = ((castRows ?? []) as unknown as CastNameRow[]).map((r) => r.name);
      nextCastName = names.length > 0 ? names.join(", ") : null;

      interface CastMemberRow { artist_id: string }
      const { data: memberRows, error: memberErr } = await client
        .from("cast_members")
        .select("artist_id")
        .in("cast_id", nextCastIds);
      if (memberErr) throw memberErr;
      const memberIds = new Set(((memberRows ?? []) as unknown as CastMemberRow[]).map((r) => r.artist_id));
      nextCastFreeCount = [...memberIds].filter((id) => rosterIdSet.has(id) && isFree(id)).length;
    }

    const gate = await fetchGateArtistIds(client, { showId: d.show_id, cityId: d.city_id, showDateId: d.id });
    const requiredSkills = await fetchRequiredSkillIds(client, { showId: d.show_id, showDateId: d.id });
    const skillEligible = await fetchSkillEligibleArtistIds(client, { requiredSkillIds: requiredSkills.all });
    let eligibleIds = gate === null ? rosterIds : rosterIds.filter((id) => gate.has(id));
    if (skillEligible !== null) eligibleIds = eligibleIds.filter((id) => skillEligible.has(id));
    const unaskedEligibleCount = eligibleIds.filter((id) => !askedIds.has(id)).length;

    facts.push({
      showDateId: d.id,
      where: [d.venue, d.city?.name ?? null].filter((p): p is string => !!p).join(", "),
      hasUnopenedTier,
      unaskedEligibleCount,
      nextCastName,
      nextCastFreeCount,
      rosterCount,
      rosterFreeCount: rosterIds.filter((id) => isFree(id)).length,
    });
  }
  return facts;
}

/**
 * The "done for you" feed since `args.since` (an ISO instant — typically the
 * previous digest run): every ask/book/draft/notify the engine did on its
 * own, one row per (show_date [, tier]) batch. `text`/`at` are pre-formatted
 * for direct display, matching the convention `BouncedAsk.dateLabel` already
 * establishes (see the Task 3 report for the i18n gap this and `dateLabel`
 * both open — plain English, not routed through `t()`).
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
    show_date_id: string;
    offer_tier: number | null;
    offered_at: string | null;
    digest_sent_at: string | null;
    show_date: { date: string; show: { program: string | null; sub_program: string | null } | null } | null;
  }
  const { data: askRows, error: askErr } = await client
    .from("bookings")
    .select(
      "show_date_id, offer_tier, offered_at, digest_sent_at, " +
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
    rows.push({
      id: `ask:${key}`,
      kind: "ask" as FeedKind,
      text: `Asked ${group.length} artist${group.length === 1 ? "" : "s"} about ${title}, ${shortDate(first.show_date.date)}.`,
      at: format(new Date(actedTimes[0]), "EEE HH:mm", { locale: dfLocale() }),
      actedAt: actedTimes[0],
      emailedAt: group.find((r) => r.digest_sent_at)?.digest_sent_at ?? null,
    });
  }

  // ── "book": artist acceptances (suggested → soft_booked/confirmed) ─────
  // old_status=suggested AND new_status IN (soft_booked, confirmed). Org
  // scope is carried by `bookings!inner` (booking_audit_log has no org_id
  // of its own — same shape as the cancelled-untold join above).
  const { data: acceptRows, error: acceptErr } = await client
    .from("booking_audit_log")
    .select(
      "id, created_at, booking:bookings!inner(show_date_id, org_id, confirmation_digest_sent_at, " +
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
    rows.push({
      id: `book:${showDateId}`,
      kind: "book" as FeedKind,
      text: `Booked ${names.join(", ")} onto ${title}, ${shortDate(showDate.date)}. They said yes, so the place is theirs.`,
      at: format(new Date(actedTimes[0]), "EEE HH:mm", { locale: dfLocale() }),
      actedAt: actedTimes[0],
      emailedAt: group.find((r) => r.booking?.confirmation_digest_sent_at)?.booking?.confirmation_digest_sent_at ?? null,
    });
  }

  // ── "draft": hire orders auto-drafted on fully_filled ───────────────────
  interface DraftRow {
    id: string;
    show_date_id: string | null;
    created_at: string;
    show_date: { date: string; show: { program: string | null; sub_program: string | null } | null } | null;
  }
  const { data: draftRows, error: draftErr } = await client
    .from("hire_orders")
    .select("id, show_date_id, created_at, show_date:show_dates(date, show:shows(program, sub_program))")
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
      text: `Drafted ${group.length} contract${group.length === 1 ? "" : "s"} for ${title}, ${shortDate(showDate.date)}. They send when you are happy with them.`,
      at: format(new Date(actedTimes[0]), "EEE HH:mm", { locale: dfLocale() }),
      actedAt: actedTimes[0],
      emailedAt: null,
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
        text: `Told ${names.length > 0 ? names.join(", ") : "the cast"} that ${title}, ${shortDate(d.date)} is off.`,
        at: format(new Date(d.cast_notified_at), "EEE HH:mm", { locale: dfLocale() }),
        actedAt: d.cast_notified_at,
        emailedAt: d.cast_notified_at,
      });
    }
  }

  return rows;
}
