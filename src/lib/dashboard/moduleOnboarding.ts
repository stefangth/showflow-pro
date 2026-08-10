// src/lib/dashboard/moduleOnboarding.ts
import { ROUTES } from "@/config/app.config";
import type { FeatureKey } from "@/lib/entitlements";
import { STEP_TITLES, type BookingSetupStepKey } from "@/lib/bookings/setupStatus";
import type { SetupStepKey } from "@/lib/hireOrders/setupStatus";
import type {
  InheritedRule,
  ModuleOnboardingDef,
  OnboardingCtx,
  OnboardingStepMeta,
} from "./types";

export const bookingOnboarding: ModuleOnboardingDef<BookingSetupStepKey> = {
  key: "booking_flow",
  // Flow-neutral, unlike the steps and rules below it. `railHeader` is a flat pair of
  // strings and neither consumer has a ctx to branch on: useModuleOnboardingRail prints it
  // as the ShowsBookingsPage banner, BookingSetupRail as its own card header. So it renders
  // unchanged at a direct-book org (artist_acceptance false), which never opens a tier, and
  // "what the first offer needs" sat one line above rows the engine chips "Blocks booking"
  // for precisely that org. "The first booking" holds under every preset.
  railHeader: {
    title: "Get bookings running",
    body: "Dates keep syncing and you can edit them now. These are what the first booking needs.",
  },
  steps: {
    flow: { title: STEP_TITLES.flow, todoHint: "Offers, or straight to booked. Everything downstream reads this.", doneHint: "Chosen. Change it any time in Settings.", ctaLabel: "Choose flow", ctaRoute: ROUTES.SETTINGS, ctaCapability: "edit_booking_settings" },
    // Gated on `add_artists`, not `edit_booking_settings`: adding artists is roster work, so
    // a producer who cannot change booking settings still gets an actionable CTA here (that
    // capability defaults on), while an org that revoked it gets a read-only row instead of
    // a button leading nowhere. The setup sheet this CTA opens honours the same split, see
    // BookingProducerWaitingCard.
    // The hint names no pipeline: this row sits directly under the flow step, where an org
    // can pick direct book (artist_acceptance false) and never send an offer at all.
    //
    // Nor does it promise delivery. Two shipped states email an artist nothing whatsoever:
    // the "off" preset (active false), which every digest function skips, and a direct-book
    // org with confirmation_digest off.
    //
    // ONE LINE, and only the consequence. SetupStepRow prints this hint in the row header
    // and keeps it there while the panel is expanded underneath, and the default first-run
    // path arrives with this row already open (FlowStep's onDone opens `people`; the
    // dashboard rail's "Add artists" opens the sheet at `people`). So whatever this hint
    // says, PeopleStep may not say again. It used to carry the card-address explanation as
    // well, which the panel then repeated verbatim two lines lower. The panel owns the
    // mechanism, the counts and the address/invite explanation; this row owns the
    // consequence, at the length of its siblings.
    //
    // Consequence first, not an instruction: DashboardSetupRail hides a step's CTA from a
    // viewer without its capability, so a producer in an org that revoked add_artists reads
    // this hint with no button under it. "Import your roster" would hand them a task and no
    // control; what is broken reads the same with or without the CTA, like every sibling.
    people: { title: STEP_TITLES.people, todoHint: "Nobody to book until your roster has active artists.", doneHint: "Your roster has active artists on it.", ctaLabel: "Add artists", ctaRoute: ROUTES.ARTISTS, ctaCapability: "add_artists" },
    slots: { title: STEP_TITLES.slots, todoHint: "A show with no slot count never reads as full.", doneHint: "Set on every show.", ctaLabel: "Set slots", ctaRoute: ROUTES.PRODUCTIONS, ctaCapability: "edit_booking_settings" },
    // These two hints name what the row HOLDS, not what one flow does with it, and that is
    // forced by the shape of this record: `steps` is flat, neither consumer passes a ctx,
    // so both strings render verbatim at a direct-book org. That org never opens a tier,
    // and the ladder in particular is read by nothing it runs (cast_city_priority and the
    // priority column on show_cast_eligibility are read by resolveTierLadder and
    // fetchOfferTiers, both offer-only; the direct-book picker is deriveDirectBookList over
    // useEligibleArtists, which ignores priority). So "The order offers go out in" was not
    // a vague hint for that reader, it was a false one.
    //
    // The consequence, which is the half that really does differ, is stated by the panels
    // these hints sit above: LadderStep and EligibilityStep read the org's flow and say what
    // an unranked city or an unmatched show costs THIS org (src/lib/bookings/coverageCopy.ts).
    // "Review coverage" over "Open bookings": on the bookings page itself these buttons
    // open the inline checklist Sheet in place, so a label naming the page they already
    // sit on read as a no-op. The label says what happens on every surface.
    ladder: { title: STEP_TITLES.ladder, todoHint: "Your casts ranked per city, tier 1 first.", doneHint: "Every scheduled city has a tier-1 cast.", ctaLabel: "Review coverage", ctaRoute: ROUTES.BOOKINGS, ctaCapability: "edit_booking_settings" },
    eligibility: { title: STEP_TITLES.eligibility, todoHint: "Which casts belong to which show, in which city.", doneHint: "Every scheduled show and city has a cast.", ctaLabel: "Review coverage", ctaRoute: ROUTES.BOOKINGS, ctaCapability: "edit_booking_settings" },
    // Like ladder and eligibility above, the hint names what the row HOLDS (send hours and
    // an answer window), not what one flow does with it: "how long artists get" presumed a
    // pipeline where artists answer, which a direct-book org does not run. TimingStep's own
    // panel reads the real flow and narrates what THIS org does with these hours.
    timing: { title: STEP_TITLES.timing, todoHint: "When booking email goes out, and the answer window.", doneHint: "Hours set. Change them any time in Settings.", ctaLabel: "Set timing", ctaRoute: ROUTES.SETTINGS, ctaCapability: "edit_booking_settings" },
  },
  // This block is the rail's COMPLETE state: it narrates how this org works, as fact. Rule
  // one already branches on the flow, so every rule under it has to branch too. A
  // direct-book org (artist_acceptance false) never opens a tier, which means it has no
  // offer digest, no response window and no accepted offer waiting on a producer: those
  // three rules used to be printed to it anyway, directly contradicting the rule above them.
  rules: (role, ctx) => ([
    { title: ctx.artistAcceptance ? "Offers with tiers" : "Direct booking", hint: ctx.artistAcceptance ? "Tier 1 goes out first. Tier 2 opens later if unfilled." : "Producers book straight from the eligibility list." },
    ...(ctx.artistAcceptance
      ? [
          // Names no delivery mode: offer_delivery is per org, and the shipped fast-track
          // preset sets "immediate", where open-offer-tier mails at tier open and
          // send-offer-digest skips the hour gate. TimingStep's own narrative reads the
          // real flow and states which of the two this org runs.
          { title: "Offers go out by email", hint: "Artists answer from the email. Your timing settings decide whether it leaves at once or waits for the next digest." },
          { title: "Response window", hint: "After it passes the offer expires and the tier reopens." },
          { title: role === "producer" ? "Confirm is on you" : "Confirm is manual", hint: "An accepted offer waits for a producer. That is the queue on this page." },
        ]
      : [
          { title: "Nothing to accept", hint: "An artist you add to a date is booked. It shows in their calendar as confirmed." },
        ]),
    // Admins only: Editor Mode is gated by editorAccess.canUseEditor (org admin or
    // super-admin), so a producer told to use it would be sent to a control they cannot see.
    //
    // The hint stops at what the toolbar can deliver. Its "as user" picker is filled from
    // admin-list-users, an auth.users enumeration, so an artist who is on the roster but
    // has never signed in is not selectable at all; the always-available fallback is the
    // "Viewing as: Artist" role option, which switches the shell but leaves the admin as
    // themselves, so useMyArtist finds no artist row. Since this rule renders once setup is
    // complete, right after the people step said an artist needs no account to be added, an
    // over-promise here lands exactly when the picker is empty.
    ...(role === "admin"
      ? [{ title: "See it as your artists do", hint: "The pencil icon top right opens the editor bar, where you can switch to the artist view. Once an artist has logged in, you can preview the app as that exact person." }]
      : []),
  ]),
  offFooter: "Booking flow is off for this org. Ask your account manager to switch it on.",
};

export const hireOrderOnboarding: ModuleOnboardingDef<SetupStepKey> = {
  key: "hire_orders",
  railHeader: {
    title: "Get hire orders ready",
    body: "You can draft orders right now. These are only needed before the first one goes out.",
  },
  steps: {
    letterhead: { title: "Letterhead", todoHint: "Your name, address and logo on every hire order.", doneHint: "Set. Every order uses it.", ctaLabel: "Set letterhead", ctaRoute: ROUTES.SETTINGS, ctaCapability: "edit_hire_order_settings" },
    terms: { title: "Terms", todoHint: "The clauses printed on the engagement sheet.", doneHint: "A terms variant is chosen.", ctaLabel: "Choose terms", ctaRoute: ROUTES.SETTINGS, ctaCapability: "edit_hire_order_settings" },
    countersign: { title: "Countersignature", todoHint: "Who signs on behalf of the org.", doneHint: "Countersign policy set.", ctaLabel: "Set countersign", ctaRoute: ROUTES.SETTINGS, ctaCapability: "edit_hire_order_settings" },
  },
  rules: () => ([
    { title: "Auto-drafted on fill", hint: "When a date fills, a draft hire order is created from its confirmed bookings." },
    { title: "Issuing is manual", hint: "A producer reviews the draft and issues the PDF to the artist." },
  ]),
  offFooter: "Hire orders is off for this org. Ask your account manager to switch it on.",
};

export const MODULE_ONBOARDING: Record<FeatureKey, ModuleOnboardingDef<string>> = {
  booking_flow: bookingOnboarding,
  hire_orders: hireOrderOnboarding,
};

// ---- Artist personal readiness. Artists have no org-engine setup, so they do NOT go
// through MODULE_ONBOARDING (whose booking_flow steps are keyed by the engine keys).
// They get their own step metadata and rules, booking_flow only. Just one actionable
// step: blocking dates you cannot play. Account linkage is a precondition (the dashboard
// only renders for a linked artist), and a phone/notifications step was dropped because
// delivery is email + in-app only, so a phone number changes nothing about offers.
export const ARTIST_STEP_KEYS = ["blockDates"] as const;
export type ArtistStepKey = typeof ARTIST_STEP_KEYS[number];

export const ARTIST_ONBOARDING: {
  steps: Record<ArtistStepKey, OnboardingStepMeta>;
  rules: (ctx: OnboardingCtx) => InheritedRule[];
} = {
  steps: {
    // Flow-neutral on purpose. This record takes no ctx, so the hint renders unchanged at a
    // direct-book org, which never sends an offer: "offers skip blocked dates before they
    // are sent" described a pipeline that org does not run. Blocked dates are honoured on
    // BOTH paths (open-offer-tier skips blocked_dates server-side; deriveDirectBookList
    // drops blocked artists from the direct-book picker), so the mechanism is what it says.
    blockDates: { title: "Block what you cannot play", todoHint: "Blocked dates come off the list before anyone books you, so you only hear about dates that work.", doneHint: "Your calendar is up to date.", ctaLabel: "Open availability", ctaRoute: ROUTES.AVAILABILITY },
  },
  // Same rule as the org-side registry above: an artist whose org books directly never
  // sees an offer, so nothing here may describe one as theirs. The window rule used to be
  // printed to them regardless, right under a rule saying they are booked directly.
  rules: (ctx) => ([
    ...(ctx.artistAcceptance
      ? [
          // Offer-scoped, and it has to stay that way. The flow-neutral version ("you can
          // only be booked on your cast's dates") is false at a direct-book org that never
          // configured eligibility: useEligibleArtists resolves artistIds to null, meaning
          // "no restriction", and deriveDirectBookList (src/lib/bookings.ts) then hands
          // ShowDateDetailSheet's picker EVERY active org artist, so a producer can book
          // someone onto a date belonging to none of their casts. On the offer side the
          // limit holds by construction: a tier IS a cast (resolveTierLadder), so an org
          // with no ladder opens no tier and sends nothing.
          { title: "Eligibility comes from your cast", hint: "Your casts decide which dates can be offered to you." },
          // No delivery mode named: a fast-track org emails the moment a tier opens.
          { title: "Offers arrive by email", hint: "Your producer's timing decides whether that is the daily digest or the moment a tier opens." },
          { title: "You have a response window", hint: "After it passes the offer expires and goes to the next tier." },
        ]
      : [
          { title: "You are booked directly", hint: "There is no offer step. A date booked for you appears in your calendar as confirmed." },
          // Dropping the cast rule must not leave this artist with a single line telling
          // them everything happens to them. Blocking is the one lever they have when there
          // is nothing to decline, and it is the mechanism, not a guarantee: blocked
          // artists are filtered out of the list the direct-book picker is built from.
          { title: "Blocking is how you say no", hint: "Blocked dates come out of the list your producer books from, and that is where your say goes." },
        ]),
  ]),
};
