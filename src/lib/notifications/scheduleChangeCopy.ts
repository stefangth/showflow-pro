import { hh, type BookingFlow } from "@/lib/bookingFlow";

/** The flow fields that decide what `scheduleChangeNote` can honestly say. */
export type ScheduleChangeFlow = Pick<BookingFlow, "active" | "confirmation_digest">;

/**
 * What actually happens when a session time is saved on a show date, or null when nothing
 * does. The only writer of `show_date_change_log` is `log_show_date_schedule_change`
 * (supabase/migrations/20260620140000_schedule_change_notifications.sql), whose trigger
 * fires `AFTER UPDATE OF session_1, session_2, session_3, status` — editing the date,
 * production, venue, city, or notes logs nothing and notifies nobody, so callers only pass
 * this to the session-time fields, never a blanket "any edit" guarantee.
 *
 * Timing: `send-confirmation-digest` is an HOURLY cron that only acts on an org once its
 * Berlin hour matches the org's `confirmation_digest_hour_berlin` setting
 * (`if (berlinHour !== targetHour) continue`) — that gate covers BOTH the in-app
 * `schedule_change` notification insert and the email loop, so neither goes out "right
 * away"; both wait for the same daily hour. Within that hour the org's `flow.active` gate
 * must also be true (an "Off" flow sends neither).
 *
 * The two channels reach different people on different conditions, which is why they get
 * separate clauses rather than one blended "in the app and by email" sentence:
 *  - EMAIL resolves a recipient address from the artist record itself (bookingEmail
 *    fallback in `resolveContactEmail`), so it reaches any booked artist with an email on
 *    file, account or not. `flow.confirmation_digest` is an email-only opt-out: when it is
 *    false the whole email loop is skipped. `artists.email` is itself nullable (an admin
 *    can create a roster artist with none in one click), so "has an email on file" is a
 *    real condition, not a given.
 *  - The IN-APP `schedule_change` notification is inserted ONLY for artists who already
 *    have a linked user account (`if (b.artists?.user_id)`), never for one who has been
 *    added to the roster but not yet invited.
 * A booked artist with neither an email nor an account is told by NEITHER channel. Both
 * branches below name that residual gap explicitly rather than only one of them: the old
 * copy named it for the digest-off branch (the in-app-only case) but let the digest-on
 * branch claim email "reaches booked artists" unqualified, silently assuming every booked
 * artist has one on file.
 *
 * Copy voice: each sentence leads with the consequence (what happens), never a qualifier
 * (who it happens to first) — the house voice moduleOnboarding.ts already establishes
 * ("Offers go out by email.", "Artists answer from the email."). An earlier draft opened
 * both branches with "Booked artists with X see..." and closed with "...hear nothing",
 * which read as a legal appendix rather than plain narration; "is not told" replaces it.
 * (A further, smaller upper bound not named in the copy: an artist can also mute the
 * `schedule_changes` in-app category via notification preferences, which the DB's
 * `gate_notification_pref` trigger silently drops the row for. Email is unaffected by
 * that preference, so it stays the more reliable of the two channels either way.)
 */
export function scheduleChangeNote(
  bookingFlowEnabled: boolean,
  flow: ScheduleChangeFlow | null | undefined,
  confirmationDigestHour: number,
): string | null {
  if (!bookingFlowEnabled || !flow || flow.active === false) return null;
  const at = `${hh(confirmationDigestHour)} Berlin`;
  if (flow.confirmation_digest) {
    // "are also notified in the app", not "see the change in the app": the change itself
    // is live in the artist's schedule the moment it is saved; what arrives at the hour is
    // the notification (timingCopy.ts states the same distinction for the timing panel).
    return `Session times go out in the daily summary at ${at}. Artists with an account are also notified in the app. Anyone with no email and no account is not told.`;
  }
  // This branch must not say "the daily summary": that is the product's user-facing name
  // for the confirmation digest EMAIL (FlowTimeline's toggle: "Confirmation digest" /
  // "Daily summary email..."), and this branch only renders when that toggle is off. The
  // in-app notice still waits for the same Berlin hour, so the hour stays.
  return `Session times reach booked artists in the app at ${at}. That notice only goes to artists with an account. Anyone without one is not told.`;
}
