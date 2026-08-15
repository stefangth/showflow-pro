// Point-of-action narration for the producer's show-date cockpit: what a control does, who
// hears about it, and when. Distinct from coverageCopy.ts (what a setup panel's rows are FOR)
// and timingCopy.ts (what the timing settings do once saved) — this module speaks at the
// moment a producer is about to click something, not while they are still configuring the
// flow.
//
// `import type { BookingFlow } from "@/lib/bookingFlow"` deliberately, not "@/types" (the
// brief's interface sketch names the latter, but BookingFlow is not re-exported there — every
// existing consumer, e.g. coverageCopy.ts, TierTimeline.tsx, DryRunDialog.tsx, imports it from
// "@/lib/bookingFlow").

import type { TFunction } from "i18next";
import { berlinTime, type BookingFlow } from "@/lib/bookingFlow";
import { scheduleChangeNote } from "@/lib/notifications/scheduleChangeCopy";

type ActionT = TFunction<"bookingCopy">;

/** The flow fields that decide what Confirm will actually do. */
type ConfirmFlow = Pick<BookingFlow, "active" | "confirmation_digest">;

/**
 * What clicking Confirm on an accepted/soft-booked row actually does, and when the artist
 * finds out. Confirm itself always writes immediately (there is no async step in between);
 * what varies is only whether an email follows, and on what schedule.
 *
 * Only an explicit `active === false` reads as paused, matching the same convention used
 * throughout bookingFlow.ts (`lifecycleChips`, `timingScopeNote`): a flow missing the field
 * (a pre-`active` literal) still reads as on.
 *
 * `bookingFlowEnabled` is the org's real `booking_flow` entitlement, not the module-gate's
 * super-admin-exempt read (mirrors `cancelBookingCopy`'s own `bookingFlowEnabled` param and
 * its rationale): a super-admin can view an org lacking the entitlement and still see
 * `flow.active`/`flow.confirmation_digest` reflect defaults, but the entitlement-gated
 * `send-confirmation-digest` cron will never fire for that org, so any digest-email promise
 * would be dishonest. When it is false, this always returns the bare consequence.
 */
export function confirmConsequenceNote(
  flow: ConfirmFlow | null | undefined,
  confirmationDigestHour: number,
  bookingFlowEnabled: boolean,
  t: ActionT,
): string {
  if (!bookingFlowEnabled || !flow || flow.active === false) return t("actionCopy.confirm.bareConsequence");
  if (flow.confirmation_digest) {
    return t("actionCopy.confirm.withDigest", { time: berlinTime(confirmationDigestHour) });
  }
  return t("actionCopy.confirm.appOnly");
}

/** The flow field that decides what accepting an offer does. */
type AcceptFlow = Pick<BookingFlow, "producer_confirmation">;

/**
 * What accepting an offer actually does, said at the toast. Mirrors the accept branch of
 * respondToOffer: producer_confirmation true soft-books (a hold, producer confirms next);
 * false confirms instantly. Undefined reads as the classic hold flow (respondToOffer's own
 * `?? true` default), so an unknown flow never over-promises "you're booked".
 */
export function acceptConsequenceNote(flow: AcceptFlow | null | undefined, t: ActionT): {
  title: string;
  description?: string;
} {
  const holds = flow?.producer_confirmation ?? true;
  return holds
    ? { title: t("actionCopy.accept.holdTitle"), description: t("actionCopy.accept.holdDescription") }
    : { title: t("actionCopy.accept.bookedTitle") };
}

/** What the cockpit's "Accepted" badge means, and the module-off "Soft-booked" badge means
 *  the same thing: the artist said yes, the slot is held, and nothing is booked until a
 *  producer confirms it. */
export function softBookedMeaning(t: ActionT): string {
  return t("actionCopy.softBookedMeaning");
}

/** What a tier is, read next to the tier picker before a producer has opened one yet. */
export function tierConceptNote(t: ActionT): string {
  return t("actionCopy.tierConceptNote");
}

/** What happens to a hand-added show date next to an Airtable-synced one. */
export function dateSourceNote(t: ActionT): string {
  return t("actionCopy.dateSourceNote");
}

/** The direct-book eligibility list's "nothing is restricting who shows up here" note. */
export function unrestrictedEligibilityNote(orgName: string, t: ActionT): string {
  return t("actionCopy.unrestrictedEligibility", { org: orgName });
}

/**
 * The cancel-confirmation dialog's copy for a single cast-list row: what gets promoted, and
 * who is told. `understudyPromotionEnabled` is precomputed by the caller (`flow.active &&
 * flow.understudy_promotion`) rather than read from `flow` here, because the caller already
 * has to derive it once for the whole list and the two flow slices this function reads
 * (`ConfirmFlow`-shaped for the who-hears line, `understudy_promotion` for the promotion line)
 * would otherwise overlap awkwardly in one Pick.
 *
 * `whoHearsLine` reuses `scheduleChangeNote` rather than re-authoring the who-hears rule: a
 * cancellation is exactly the kind of schedule change that function already describes
 * (log_show_date_schedule_change fires on the same `bookings`/`show_dates` writes). Its `null`
 * case (flow off, flow unread, or the org has no booking_flow entitlement) falls back to a
 * plain claim that stays true regardless: `updateBookingStatusGuarded`'s cancel path itself
 * does not depend on the booking_flow module, so an in-app cancellation notice is not
 * conditional on any of those in the way the schedule-change pipeline is.
 */
export function cancelBookingCopy(args: {
  artistName: string;
  /** = flow.active && flow.understudy_promotion */
  understudyPromotionEnabled: boolean;
  bookingFlowEnabled: boolean;
  flow: Pick<BookingFlow, "active" | "confirmation_digest"> | null | undefined;
  confirmationDigestHour: number;
  t: ActionT;
}): { title: string; understudyLine: string | null; whoHearsLine: string } {
  const { artistName, understudyPromotionEnabled, bookingFlowEnabled, flow, confirmationDigestHour, t } = args;
  return {
    title: t("actionCopy.cancel.title", { artist: artistName }),
    understudyLine: understudyPromotionEnabled
      ? t("actionCopy.cancel.understudyLine", { artist: artistName })
      : null,
    whoHearsLine:
      scheduleChangeNote(bookingFlowEnabled, flow, confirmationDigestHour) ?? t("actionCopy.cancel.whoHearsFallback"),
  };
}
