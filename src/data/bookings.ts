import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { TierAttentionInput } from "@/lib/bookingCockpit";
import { showSlots } from "@/lib/settings";

export interface OpenOfferTierResult {
  offersCreated: number;
  message?: string;
  /** True when offers were created but the tier tracking row failed to write —
   *  escalation/at-risk won't see this round until the tier is re-opened. */
  trackingWarning?: boolean;
}

/** Invoke the open-offer-tier edge function for one (show_date, tier). */
export async function openOfferTier(
  client: SupabaseClient<Database>,
  args: { showDateId: string; tier: number; skillFilterIds?: string[] },
): Promise<OpenOfferTierResult> {
  const body: Record<string, unknown> = { show_date_id: args.showDateId, tier: args.tier };
  if (args.skillFilterIds && args.skillFilterIds.length > 0) body.skill_filter_ids = args.skillFilterIds;
  const { data, error } = await client.functions.invoke("open-offer-tier", { body });
  if (error) throw error;
  const payload = data as { offers_created?: number; message?: string; error?: string; tier_tracking_warning?: boolean };
  if (payload?.error) throw new Error(payload.error);
  const result: OpenOfferTierResult = { offersCreated: payload?.offers_created ?? 0, message: payload?.message };
  if (payload?.tier_tracking_warning === true) result.trackingWarning = true;
  return result;
}

/**
 * Tiers that *can* be opened for a date.
 * - `priorities`: RAW priorities (duplicates preserved). Dedup/sort/labeling
 *   is the consumer's job, see `buildOfferTierOptions` in `@/lib/bookings`.
 * - `hasAdHoc`: whether the date has any per-date ("ad-hoc") cast assignments.
 * - `source`: "show" when the show's own (show, city) ladder has prioritized rows
 *   (it wins outright, no fallback query); "org" when falling back to the org-wide
 *   `cast_city_priority` list for the city.
 * A null `cityId` skips both priority queries (priorities = [], source = "org") but
 * still checks ad-hoc, since ad-hoc casts are per-date, not per-city.
 */
export async function fetchOfferTiers(
  client: SupabaseClient<Database>,
  args: { showId: string; cityId: string | null; showDateId: string },
): Promise<{ priorities: number[]; hasAdHoc: boolean; source: "show" | "org" }> {
  let priorities: number[] = [];
  let source: "show" | "org" = "org";
  if (args.cityId) {
    // Show-scoped ladder wins outright for this (show, city); org list is the fallback.
    const { data: showRows, error: showErr } = await client
      .from("show_cast_eligibility")
      .select("priority")
      .eq("show_id", args.showId)
      .eq("city_id", args.cityId)
      .not("priority", "is", null);
    if (showErr) throw showErr;
    const showPriorities = ((showRows ?? []) as { priority: number }[]).map((r) => r.priority);
    if (showPriorities.length > 0) {
      priorities = showPriorities;
      source = "show";
    } else {
      const { data, error } = await client
        .from("cast_city_priority")
        .select("priority")
        .eq("city_id", args.cityId);
      if (error) throw error;
      // Raw, dedup happens downstream in buildOfferTierOptions.
      priorities = (data ?? []).map((r) => r.priority as number);
    }
  }
  // Any show_date_cast_eligibility row for this date means ad-hoc casts exist (tier 99).
  const { data: adHoc, error: adErr } = await client
    .from("show_date_cast_eligibility")
    .select("id")
    .eq("show_date_id", args.showDateId)
    .limit(1);
  if (adErr) throw adErr;
  return { priorities, hasAdHoc: (adHoc ?? []).length > 0, source };
}

export interface OpenedTier { tier: number; openedAt: string; closedAt: string | null }

/** Tiers that *have* been opened for a date (read-only state display). */
export async function fetchOpenedTiers(
  client: SupabaseClient<Database>,
  showDateId: string,
): Promise<OpenedTier[]> {
  const { data, error } = await client
    .from("show_date_offer_tiers")
    .select("tier, opened_at, closed_at")
    .eq("show_date_id", showDateId)
    .order("tier", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => ({ tier: r.tier, openedAt: r.opened_at, closedAt: r.closed_at }));
}

/** The first waterfall step that eliminated an artist from a dry-run preview.
 *  Mirrors the edge function's ExcludedReason (open-offer-tier/index.ts) — kept as a
 *  hand-maintained twin rather than a mirror-manifest entry since it's a tiny literal
 *  union, not worth a generated block. */
export type ExcludedReason = "missing_skills" | "blocked" | "already_booked" | "inactive" | "not_eligible";

export interface ExcludedDetailEntry {
  id: string;
  name: string;
  reason: ExcludedReason;
}

export interface DryRunResult {
  candidates: { id: string; name: string }[];
  excluded: { alreadyBooked: number; blocked: number; inactive: number; notEligible: number; missingSkills: number };
  /** Named, per-artist exclusion detail (id/name/reason), capped server-side.
   *  Additive alongside `excluded` — the aggregate counts above are the source of
   *  truth for totals; this is only for naming who and why in the UI. */
  excludedDetail: ExcludedDetailEntry[];
  /** True when more artists were excluded than `excludedDetail` lists (see the
   *  edge function's EXCLUDED_DETAIL_CAP). The aggregate `excluded` counts are
   *  never truncated — only this per-artist detail array is. */
  excludedDetailTruncated: boolean;
  message?: string;
}

/** Preview who would receive offers for a (show_date, tier) without writing anything. */
export async function dryRunOfferTier(
  client: SupabaseClient<Database>,
  args: { showDateId: string; tier: number; skillFilterIds?: string[] },
): Promise<DryRunResult> {
  const body: Record<string, unknown> = { show_date_id: args.showDateId, tier: args.tier, dry_run: true };
  if (args.skillFilterIds && args.skillFilterIds.length > 0) body.skill_filter_ids = args.skillFilterIds;
  const { data, error } = await client.functions.invoke("open-offer-tier", { body });
  if (error) throw error;
  const payload = data as {
    candidates?: { id: string; name: string }[];
    excluded?: {
      already_booked?: number; blocked?: number; inactive?: number;
      not_eligible?: number; missing_skills?: number;
    };
    excludedDetail?: ExcludedDetailEntry[];
    excludedDetailTruncated?: boolean;
    message?: string;
  };
  return {
    candidates: payload?.candidates ?? [],
    excluded: {
      alreadyBooked: payload?.excluded?.already_booked ?? 0,
      blocked: payload?.excluded?.blocked ?? 0,
      inactive: payload?.excluded?.inactive ?? 0,
      notEligible: payload?.excluded?.not_eligible ?? 0,
      missingSkills: payload?.excluded?.missing_skills ?? 0,
    },
    excludedDetail: payload?.excludedDetail ?? [],
    excludedDetailTruncated: payload?.excludedDetailTruncated ?? false,
    message: payload?.message,
  };
}

export interface CloseOfferTierResult { closed: boolean; withdrawn: number; message?: string }

/** Invoke the close-offer-tier edge function for one (show_date, tier). */
export async function closeOfferTier(
  client: SupabaseClient<Database>,
  args: { showDateId: string; tier: number; withdraw: boolean },
): Promise<CloseOfferTierResult> {
  const { data, error } = await client.functions.invoke("close-offer-tier", {
    body: { show_date_id: args.showDateId, tier: args.tier, withdraw: args.withdraw },
  });
  if (error) throw error;
  const payload = data as { closed?: boolean; withdrawn?: number; message?: string; error?: string };
  if (payload?.error) throw new Error(payload.error);
  return { closed: !!payload?.closed, withdrawn: payload?.withdrawn ?? 0, message: payload?.message };
}

/** Count of bookings awaiting producer confirmation (soft_booked) in an org.
 *  Uses a server-side head count — no row data crosses the wire and there is no
 *  PostgREST max-rows truncation. */
export async function fetchPendingConfirmationsCount(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<number> {
  const { count, error } = await client
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("status", "soft_booked");
  if (error) throw error;
  return count ?? 0;
}

/** Count of open offers (suggested) awaiting a given artist's response.
 *  Server-side head count (see fetchPendingConfirmationsCount). */
export async function fetchMyOpenOffersCount(
  client: SupabaseClient<Database>,
  artistId: string,
): Promise<number> {
  const { count, error } = await client
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("artist_id", artistId)
    .eq("status", "suggested");
  if (error) throw error;
  return count ?? 0;
}

// ── Guarded status transitions (H3) ────────────────────────────────────────────
// Producer/admin/artist status writes carry an explicit precondition on the CURRENT
// status and report how many rows actually changed. A stale write (the row moved on
// under the client — e.g. expire-offers cancelled a suggested offer, or a date
// cancellation cascade cancelled a soft_booked hold) matches 0 rows, so the caller
// can surface honest "this changed — refresh" feedback instead of a false success.
// The DB trigger enforce_booking_transition (20260702120020) is the hard backstop;
// these preconditions keep the UI honest and avoid no-op success toasts.

type BookingStatus = Database["public"]["Enums"]["booking_status"];

/**
 * Confirm all soft_booked bookings among `ids` (producer bulk-confirm).
 * Only rows still in `soft_booked` are affected. Returns the number of rows changed.
 */
export async function bulkConfirmSoftBooked(
  client: SupabaseClient<Database>,
  args: { ids: string[]; now: Date },
): Promise<{ affected: number }> {
  const { data, error } = await client
    .from("bookings")
    .update({ status: "confirmed", confirmed_at: args.now.toISOString() })
    .in("id", args.ids)
    .eq("status", "soft_booked")
    .select("id");
  if (error) throw error;
  return { affected: (data ?? []).length };
}

/**
 * Bump `offer_expires_at` on a date's pending offers (suggested/soft_booked) by
 * `hours` — the producer "Needs you" queue's "Extend 24h" action. PostgREST can't
 * express a column-relative `+ interval` update, so this calls the
 * `extend_offer_expiry` SQL RPC (SECURITY INVOKER — RLS still gates which rows,
 * if any, are affected). Returns the number of bookings whose expiry advanced.
 */
export async function extendOfferExpiry(
  client: SupabaseClient<Database>,
  args: { showDateId: string; hours: number },
): Promise<{ affected: number }> {
  const { data, error } = await client.rpc("extend_offer_expiry", {
    p_show_date_id: args.showDateId,
    p_hours: args.hours,
  });
  if (error) throw error;
  return { affected: (data as number | null) ?? 0 };
}

/**
 * Immediately notify a cancelled date's held/confirmed cast — the producer
 * "Needs you" queue's "Notify cast" action (invokes the `notify-cast` edge
 * function). The only other cancellation notice is the delayed 20:00 Berlin
 * confirmation digest, which never covers a producer-cancelled individual hold
 * outside that window. Returns the number of artists notified.
 */
export async function notifyCast(
  client: SupabaseClient<Database>,
  args: { showDateId: string },
): Promise<{ notified: number }> {
  const { data, error } = await client.functions.invoke("notify-cast", {
    body: { show_date_id: args.showDateId },
  });
  if (error) throw error;
  return { notified: (data as { notified?: number } | null)?.notified ?? 0 };
}

/** The ids of a date's still-soft_booked bookings — the row-peek confirm target. */
export async function fetchSoftBookedIdsForDate(
  client: SupabaseClient<Database>,
  showDateId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from("bookings")
    .select("id")
    .eq("show_date_id", showDateId)
    .eq("status", "soft_booked");
  if (error) throw error;
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * Decline (cancel) all soft_booked bookings among `ids` (producer bulk-decline).
 * Only rows still in `soft_booked` are affected. Returns the number of rows changed.
 */
export async function bulkDeclineSoftBooked(
  client: SupabaseClient<Database>,
  args: { ids: string[]; now: Date },
): Promise<{ affected: number }> {
  const { data, error } = await client
    .from("bookings")
    .update({
      status: "cancelled",
      cancelled_at: args.now.toISOString(),
      cancellation_reason: "producer_declined",
    })
    .in("id", args.ids)
    .eq("status", "soft_booked")
    .select("id");
  if (error) throw error;
  return { affected: (data ?? []).length };
}

/**
 * Transition a single booking to `confirmed` or `cancelled` with a status precondition:
 *  - confirmed  requires the booking is currently soft_booked;
 *  - cancelled  requires the booking is currently non-cancelled (any active state).
 * Returns the number of rows changed (0 = the booking moved on under us).
 */
export async function updateBookingStatusGuarded(
  client: SupabaseClient<Database>,
  args: { bookingId: string; status: Extract<BookingStatus, "confirmed" | "cancelled">; now: Date },
): Promise<{ affected: number }> {
  const patch: Database["public"]["Tables"]["bookings"]["Update"] =
    args.status === "confirmed"
      ? { status: "confirmed", confirmed_at: args.now.toISOString() }
      : { status: "cancelled", cancelled_at: args.now.toISOString() };

  let q = client.from("bookings").update(patch).eq("id", args.bookingId);
  q = args.status === "confirmed"
    ? q.eq("status", "soft_booked") // only a soft_booked hold can be confirmed
    : q.neq("status", "cancelled"); // any active booking can be cancelled; skip no-op re-cancel

  const { data, error } = await q.select("id");
  if (error) throw error;
  return { affected: (data ?? []).length };
}

/**
 * Artist response to a pending (suggested) offer. Accept → soft_booked (or, with
 * `autoConfirm` when the org's booking_flow disables producer confirmation, straight
 * to confirmed); Decline → cancelled(artist_declined). Only affects a still-suggested
 * offer, so a withdrawn/expired offer reports 0 rows changed instead of a false
 * "accepted". The confirmed write is still RLS-gated server-side on the org's own
 * booking_flow.producer_confirmation setting (artist_self_confirm_policy migration).
 */
export async function respondToOffer(
  client: SupabaseClient<Database>,
  args: { bookingId: string; accept: boolean; now: Date; autoConfirm?: boolean },
): Promise<{ affected: number }> {
  const patch: Database["public"]["Tables"]["bookings"]["Update"] = args.accept
    ? args.autoConfirm
      ? { status: "confirmed", confirmed_at: args.now.toISOString() }
      : { status: "soft_booked" }
    : { status: "cancelled", cancelled_at: args.now.toISOString(), cancellation_reason: "artist_declined" };

  const { data, error } = await client
    .from("bookings")
    .update(patch)
    .eq("id", args.bookingId)
    .eq("status", "suggested")
    .select("id");
  if (error) throw error;
  return { affected: (data ?? []).length };
}

/**
 * Create a booking directly (producer books an artist from the eligibility list).
 * Inserts `soft_booked` by default, or `confirmed` + confirmed_at when the org's
 * booking flow confirms producer bookings directly (`confirmDirectly`).
 */
export async function createBooking(
  client: SupabaseClient<Database>,
  args: {
    showDateId: string;
    artistId: string;
    isUnderstudy: boolean;
    bookedBy: string;
    orgId: string;
    confirmDirectly: boolean;
    now: Date;
  },
): Promise<void> {
  const { error } = await client.from("bookings").insert({
    show_date_id: args.showDateId,
    artist_id: args.artistId,
    status: args.confirmDirectly ? "confirmed" : "soft_booked",
    confirmed_at: args.confirmDirectly ? args.now.toISOString() : null,
    is_understudy: args.isUnderstudy,
    booked_by: args.bookedBy,
    org_id: args.orgId,
  });
  if (error) throw error;
}

/** Joined row shape of the fetchTierAttention select below — mirror the select string. */
interface TierAttentionRow {
  tier: number;
  show_date: {
    id: string;
    date: string;
    status: string;
    custom: Record<string, unknown> | null;
    org_id: string;
    show: {
      program: string | null;
      sub_program: string | null;
      main_cast_slots: number | null;
      understudy_slots: number | null;
    } | null;
    bookings: { status: string; offer_tier: number | null; offer_expires_at: string | null }[] | null;
  };
}

/**
 * Open offer tiers on this org's upcoming, non-cancelled dates, with the
 * date's bookings and slot config, for the dashboard tier-attention card.
 * `today` is passed in (yyyy-mm-dd) so callers and tests own the clock.
 */
export async function fetchTierAttention(
  client: SupabaseClient<Database>,
  args: { orgId: string | null; today: string },
): Promise<TierAttentionInput[]> {
  if (!args.orgId) return [];
  const { data, error } = await client
    .from("show_date_offer_tiers")
    .select(
      "tier, show_date:show_dates!inner(id, date, status, custom, org_id, " +
      "show:shows(program, sub_program, main_cast_slots, understudy_slots), " +
      "bookings(status, offer_tier, offer_expires_at))",
    )
    .is("closed_at", null)
    .eq("show_date.org_id", args.orgId)
    .gte("show_date.date", args.today)
    .neq("show_date.status", "cancelled");
  if (error) throw error;
  return ((data ?? []) as unknown as TierAttentionRow[]).map((r) => ({
    showDateId: r.show_date.id,
    date: r.show_date.date,
    program: r.show_date.show?.program ?? null,
    subProgram: r.show_date.show?.sub_program ?? null,
    custom: r.show_date.custom ?? null,
    // Single home for the "main slot = configured, understudy optional" rule.
    slots: showSlots(r.show_date.show),
    tier: r.tier,
    bookings: (r.show_date.bookings ?? []).map((b) => ({
      status: b.status, offer_tier: b.offer_tier, offer_expires_at: b.offer_expires_at,
    })),
  }));
}

/* ------------------------------------------------------------------------- *
 * Org-scoped list reads.
 *
 * These previously ran inline in the pages with no org filter. RLS does NOT
 * narrow them to the active org — `is_org_member()` short-circuits true for
 * super-admins and is true for every org a multi-org user belongs to — so the
 * explicit `.eq("org_id", orgId)` below is what scopes the result. See ADR-0003.
 * ------------------------------------------------------------------------- */

export interface DateBookingCounts {
  confirmedMain: number; confirmedUs: number;
  acceptedMain: number; acceptedUs: number;   // soft_booked, waiting on producer confirm
  pendingMain: number; pendingUs: number;      // suggested, awaiting artist response
  total: number;                                // all non-cancelled
}

/** Per-show-date booking tallies for the bookings grid + row peek (non-cancelled only). */
export async function fetchBookingCountsByDate(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<Map<string, DateBookingCounts>> {
  const map = new Map<string, DateBookingCounts>();
  if (!orgId) return map;
  const { data, error } = await client
    .from("bookings")
    .select("show_date_id, status, is_understudy")
    .eq("org_id", orgId)
    .neq("status", "cancelled");
  if (error) throw error;
  interface CountRow { show_date_id: string; status: string; is_understudy: boolean }
  const zero = (): DateBookingCounts => ({
    confirmedMain: 0, confirmedUs: 0, acceptedMain: 0, acceptedUs: 0, pendingMain: 0, pendingUs: 0, total: 0,
  });
  for (const b of (data ?? []) as unknown as CountRow[]) {
    // The .neq() above already excludes cancelled rows server-side; this guard is
    // a defensive backstop so the tally is correct even if a caller's client omits it.
    if (b.status === "cancelled") continue;
    const cur = map.get(b.show_date_id) ?? zero();
    cur.total += 1;
    const us = b.is_understudy;
    if (b.status === "confirmed") { if (us) cur.confirmedUs++; else cur.confirmedMain++; }
    else if (b.status === "soft_booked") { if (us) cur.acceptedUs++; else cur.acceptedMain++; }
    else if (b.status === "suggested") { if (us) cur.pendingUs++; else cur.pendingMain++; }
    map.set(b.show_date_id, cur);
  }
  return map;
}

/**
 * Upcoming (today-or-later) non-cancelled booking counts per artist, for the given
 * artist ids in an org — powers the "N dates" figure on each cast roster row. Scoped
 * to the passed artist ids (a cast's members) so the read stays bounded rather than
 * scanning the org's whole bookings table. `fromDateKey` is the inclusive lower bound
 * (a `YYYY-MM-DD` string, injected so the "today" boundary is deterministic in tests).
 * Dates are filtered client-side (rather than via an embedded-resource `.gte`) so the
 * call-recording fake client exercises the same code path.
 */
export async function fetchUpcomingBookingCountsByArtist(
  client: SupabaseClient<Database>,
  orgId: string | null,
  artistIds: string[],
  fromDateKey: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!orgId || artistIds.length === 0) return map;
  const { data, error } = await client
    .from("bookings")
    .select("artist_id, show_date:show_dates(date)")
    .eq("org_id", orgId)
    .in("artist_id", artistIds)
    .neq("status", "cancelled");
  if (error) throw error;
  interface CountRow { artist_id: string; show_date: { date: string } | null }
  for (const b of (data ?? []) as unknown as CountRow[]) {
    if (!b.show_date || b.show_date.date < fromDateKey) continue;
    map.set(b.artist_id, (map.get(b.artist_id) ?? 0) + 1);
  }
  return map;
}

export interface BookingLite { show_date_id: string; status: string; is_understudy: boolean }

/** The org's confirmed bookings, minimal projection, for dashboard slot maths. */
export async function fetchConfirmedBookingsLite(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<BookingLite[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("bookings")
    .select("show_date_id, status, is_understudy")
    .eq("org_id", orgId)
    .eq("status", "confirmed");
  if (error) throw error;
  return (data ?? []) as unknown as BookingLite[];
}

export interface SoftBookedRow {
  id: string;
  is_understudy: boolean;
  artist: { id: string; name: string } | null;
  show_date: { id: string; date: string; show: { program: string | null; sub_program: string | null } | null } | null;
}

/** The org's soft-booked bookings awaiting producer confirmation. */
export async function fetchSoftBookedRows(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<SoftBookedRow[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("bookings")
    .select("id, is_understudy, artist:artists(id, name), show_date:show_dates!inner(id, date, show:shows(program, sub_program))")
    .eq("org_id", orgId)
    .eq("status", "soft_booked")
    .order("show_date(date)", { ascending: true });
  if (error) throw error;
  return (data ?? []) as unknown as SoftBookedRow[];
}

export interface BookingJoin {
  id: string;
  artist_id: string;
  status: string;
  show_date: { date: string; show: { program: string | null; sub_program: string | null } | null } | null;
}

/** The org's non-cancelled bookings with date/show context, for the artists list. */
export async function fetchBookingsLight(
  client: SupabaseClient<Database>,
  orgId: string | null,
): Promise<BookingJoin[]> {
  if (!orgId) return [];
  const { data, error } = await client
    .from("bookings")
    .select("id, artist_id, status, show_date:show_dates(date, show:shows(program, sub_program))")
    .eq("org_id", orgId)
    .neq("status", "cancelled");
  if (error) throw error;
  return (data ?? []) as unknown as BookingJoin[];
}

export interface BookingWithArtistRow {
  id: string;
  showDateId: string;
  status: "suggested" | "soft_booked" | "confirmed" | "cancelled";
  isUnderstudy: boolean;
  offerExpiresAt: string | null;
  artist: { id: string; name: string } | null;
}

/** Joined row shape of the fetchBookingsWithArtistForDates select below. */
interface BookingWithArtistJoinRow {
  id: string;
  show_date_id: string;
  status: "suggested" | "soft_booked" | "confirmed" | "cancelled";
  is_understudy: boolean;
  offer_expires_at: string | null;
  artist: { id: string; name: string } | null;
}

/**
 * A set of dates' bookings with their artist names and offer expiry, no status
 * filter (the derivation layer buckets by status) — feeds the "Needs you" queue's
 * per-date people chips AND its "Expires today" earliest-expiry read, so
 * `offerExpiresAt` is selected here rather than in a second query.
 */
export async function fetchBookingsWithArtistForDates(
  client: SupabaseClient<Database>,
  args: { orgId: string; showDateIds: string[] },
): Promise<BookingWithArtistRow[]> {
  if (args.showDateIds.length === 0) return [];
  const { data, error } = await client
    .from("bookings")
    .select("id, show_date_id, status, is_understudy, offer_expires_at, artist:artists(id, name)")
    .eq("org_id", args.orgId)
    .in("show_date_id", args.showDateIds);
  if (error) throw error;
  return ((data ?? []) as unknown as BookingWithArtistJoinRow[]).map((r) => ({
    id: r.id,
    showDateId: r.show_date_id,
    status: r.status,
    isUnderstudy: r.is_understudy,
    offerExpiresAt: r.offer_expires_at,
    artist: r.artist,
  }));
}

/** Row shape of the fetchOpenedTier1DateIds select below. */
interface OpenedTier1Row { show_date_id: string }

/**
 * Distinct show_date ids in this org that already have tier 1 opened — existence
 * of a `show_date_offer_tiers` row with `tier = 1`, regardless of `closed_at`
 * (a re-closed tier still counts as "opened"; mirrors the `openedTiers.some(t =>
 * t.tier === 1)` check `shouldAutoOpenTier1` does in src/lib/bookings.ts). Feeds
 * the dashboard first-run "ready to offer" aggregate (src/lib/bookings/readyToOffer.ts).
 */
export async function fetchOpenedTier1DateIds(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from("show_date_offer_tiers")
    .select("show_date_id")
    .eq("org_id", orgId)
    .eq("tier", 1);
  if (error) throw error;
  const rows = (data ?? []) as unknown as OpenedTier1Row[];
  return Array.from(new Set(rows.map((r) => r.show_date_id)));
}
