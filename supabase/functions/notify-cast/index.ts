import { preflight, json } from "../_shared/http.ts";
import { requireRole, requireOrgRole } from "../_shared/auth.ts";
import { requireFeature } from "../_shared/entitlements.ts";
import { realDeps, type Deps } from "../_shared/deps.ts";
import type { ArtistJoin } from "../_shared/rows.ts";

/** Mirrors the show_dates select in handle() below. */
interface ShowDateOrgRow {
  id: string;
  org_id: string;
}

/** Mirrors the show_dates join nested in the bookings select below (mirrors
 *  send-confirmation-digest's ConfirmedBookingRow.show_dates shape). */
interface BookingShowDateJoin {
  date: string;
  shows: { program: string | null; sub_program: string | null } | null;
  cities: { name: string } | null;
}

/** Mirrors the bookings select in handle() below. */
interface CancelledBookingRow {
  id: string;
  artist_id: string;
  artists: ArtistJoin | null;
  show_dates: BookingShowDateJoin | null;
}

/** `${program} — ${sub_program}` (or just program, or 'Unknown show') — matches
 *  the show-label formatting send-confirmation-digest/send-offer-digest use. */
function showLabel(show: { program: string | null; sub_program: string | null } | null): string {
  const program = show?.program;
  const subProgram = show?.sub_program;
  return program ? (subProgram ? `${program} — ${subProgram}` : program) : "Unknown show";
}

interface NotificationInsertRow {
  org_id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  related_entity_type: string;
  related_entity_id: string;
}

/**
 * "Needs you" queue: "Notify cast" action for a cancelled date.
 *
 * Today the only cancellation notice artists get is the delayed 20:00 Berlin
 * confirmation digest (send-confirmation-digest), and it never covers a
 * producer-cancelled individual hold outside that window. This gives producers
 * an on-demand, IMMEDIATE in-app alternative: one `schedule_change` notification
 * per registered artist whose booking on this date was released by the
 * date-level cancellation cascade (`cascade_cancel_bookings_on_date_cancel`,
 * status='cancelled' AND cancellation_reason='date_cancelled' — this is exactly
 * the "held/confirmed cast lost to this cancellation" set, not every cancelled
 * booking on the date for some other reason like a decline or an expired offer).
 *
 * After notifying, it stamps `show_dates.cast_notified_at` (marks the queue item
 * done) and consumes the date's undigested 'cancelled' `show_date_change_log`
 * row (`digested_at`) so send-confirmation-digest does not re-notify the same
 * artists again at 20:00.
 *
 * Auth: user JWT. A coarse `requireRole(['admin','producer'])` gate runs FIRST,
 * before any admin-client (service-role) lookup — resolving show_dates.org_id
 * ahead of a role check would let ANY authenticated user distinguish "date
 * exists" (would-be 403) from "doesn't" (404), an existence oracle across every
 * org (mirrors open-offer-tier's identical coarse-gate-first comment/pattern).
 * The org-scoped `requireOrgRole(org_id, ['admin','producer'])` still runs
 * afterward as defense in depth — an admin/producer of one org may only notify
 * cast for a date in their OWN org. Gated on the `booking_flow` entitlement —
 * this is part of the booking engine's notification surface.
 */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return preflight();

  const admin = deps.admin;

  // Coarse gate FIRST: fail unauthenticated / no-role callers before any
  // admin-client DB read, so a valid UUID can't be used as a cross-org
  // existence timing oracle. The org-scoped check happens after the fetch.
  const preAuth = await requireRole(deps, req, ["admin", "producer"]);
  if (!preAuth.ok) return preAuth.response;

  let show_date_id: string;
  try {
    const body = await req.json();
    show_date_id = body?.show_date_id;
    if (!show_date_id || typeof show_date_id !== "string") {
      return json({ error: "show_date_id is required" }, 400);
    }
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  // Resolve the date's org — it drives the org-scoped auth check below.
  const { data: showDateRaw, error: sdErr } = await admin
    .from("show_dates")
    .select("id, org_id")
    .eq("id", show_date_id)
    .maybeSingle();
  if (sdErr || !showDateRaw) return json({ error: "Show date not found" }, 404);
  const orgId = (showDateRaw as ShowDateOrgRow).org_id;

  const auth = await requireOrgRole(deps, req, orgId, ["admin", "producer"]);
  if (!auth.ok) return auth.response;

  const featureGate = await requireFeature(deps, orgId, "booking_flow");
  if (featureGate) return featureGate;

  const { data: bookingsRaw, error: bookingsErr } = await admin
    .from("bookings")
    .select("id, artist_id, artists ( id, name, email, user_id ), show_dates ( date, shows ( program, sub_program ), cities ( name ) )")
    .eq("show_date_id", show_date_id)
    .eq("status", "cancelled")
    .eq("cancellation_reason", "date_cancelled");
  if (bookingsErr) {
    console.error("notify-cast: bookings query failed", { showDateId: show_date_id, error: bookingsErr.message });
    return json({ error: "Failed to load cast" }, 500);
  }

  const bookings = (bookingsRaw ?? []) as unknown as CancelledBookingRow[];
  const notificationRows: NotificationInsertRow[] = bookings
    .filter((b): b is CancelledBookingRow & { artists: ArtistJoin & { user_id: string } } => !!b.artists?.user_id)
    .map((b) => {
      const show = showLabel(b.show_dates?.shows ?? null);
      const date = b.show_dates?.date ?? "—";
      return {
        org_id: orgId,
        user_id: b.artists.user_id,
        type: "schedule_change",
        title: "Booking cancelled",
        message: `Your booking for ${show} on ${date} was cancelled.`,
        related_entity_type: "show_date",
        related_entity_id: show_date_id,
      };
    });

  if (notificationRows.length > 0) {
    const { error: insertErr } = await admin.from("notifications").insert(notificationRows);
    if (insertErr) {
      console.error("notify-cast: notification insert failed", { showDateId: show_date_id, error: insertErr.message });
      return json({ error: "Failed to notify cast" }, 500);
    }
  }

  const now = deps.now();

  const { error: stampErr } = await admin
    .from("show_dates")
    .update({ cast_notified_at: now.toISOString() })
    .eq("id", show_date_id);
  if (stampErr) {
    console.error("notify-cast: cast_notified_at stamp failed", { showDateId: show_date_id, error: stampErr.message });
  }

  // Consume the undigested cancellation change-log row(s) for this date so
  // send-confirmation-digest's undigested-row query does not re-notify the same
  // artists at 20:00 for a cancellation already delivered here.
  const { error: digestStampErr } = await admin
    .from("show_date_change_log")
    .update({ digested_at: now.toISOString() })
    .eq("show_date_id", show_date_id)
    .eq("change_type", "cancelled")
    .is("digested_at", null);
  if (digestStampErr) {
    console.error("notify-cast: change-log stamp failed", { showDateId: show_date_id, error: digestStampErr.message });
  }

  return json({ notified: notificationRows.length });
}

if (import.meta.main) Deno.serve((req) => handle(req, realDeps()));
