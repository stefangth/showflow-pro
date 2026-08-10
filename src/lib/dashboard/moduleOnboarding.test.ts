import { it, expect } from "vitest";
import { ARTIST_ONBOARDING, ARTIST_STEP_KEYS, MODULE_ONBOARDING, bookingOnboarding, hireOrderOnboarding } from "./moduleOnboarding";
import { FEATURE_KEYS } from "@/lib/entitlements";
import { computeBookingSetupStatus } from "@/lib/bookings/setupStatus";
import { computeSetupStatus } from "@/lib/hireOrders/setupStatus";
import { ROUTES } from "@/config/app.config";
import { CAPABILITY_DEFS } from "@/lib/capabilities";

it("has one contribution per FeatureKey (no orphans, no gaps)", () => {
  expect(Object.keys(MODULE_ONBOARDING).sort()).toEqual([...FEATURE_KEYS].sort());
});

it("booking step keys cover exactly the engine's step keys", () => {
  const engineKeys = computeBookingSetupStatus({ flowChosen: false, hasAnyShows: false, shows: [], timingChosen: false, coverage: null, artistCount: null, artistAcceptance: null })
    .steps.map((s) => s.key).sort();
  expect(Object.keys(bookingOnboarding.steps).sort()).toEqual(engineKeys);
});

it("hire-order step keys cover exactly the engine's step keys", () => {
  // SetupStatusInput = { letterhead, terms, countersignChosen } — an all-empty input
  // is enough to enumerate the step keys.
  const engineKeys = computeSetupStatus({ letterhead: null, terms: null, countersignChosen: false })
    .steps.map((s) => s.key).sort();
  expect(Object.keys(hireOrderOnboarding.steps).sort()).toEqual(engineKeys);
});

it("scopes the address claim to the artist it is actually true for", () => {
  // Two separate over-claims have to stay out of this sentence.
  //
  // (1) Delivery. Two shipped states send an artist no email at all: the "off" preset
  //     (active false), where every digest function skips the org outright, and a
  //     direct-book org with the confirmation digest switched off. "Email reaches them,
  //     so nobody has to log in first" is false in both.
  // (2) The address. `resolveContactEmail` (supabase/functions/_shared/identity.ts,
  //     ADR-0011) returns the AUTH email first and falls back to the artist card only when
  //     there is none, so "anything the app emails an artist goes to the address on their
  //     card" is false for a REGISTERED artist. That divergence is reachable:
  //     create-invitation links an invite to an artist row by `artist_id`, so the invite
  //     can go to a different address than the card carries, and every digest after
  //     acceptance uses the login address.
  //
  // What survives both is the unregistered case, which is the entire point being made:
  // an artist with no account has only the card address, so no account is needed to add one.
  const people = bookingOnboarding.steps.people;
  expect(`${people.todoHint}${people.doneHint}`).not.toMatch(/reach(es)?\s+them|log in/i);
  expect(people.todoHint).not.toMatch(/anything the app emails/i);
  expect(people.todoHint).toMatch(/an artist with no account is emailed at the address on their card/i);
  expect(people.todoHint).toMatch(/no account is needed/i);
});

it("the people step points at the artists page and says an account is not a prerequisite", () => {
  const people = bookingOnboarding.steps.people;
  expect(people.title).toBe("Add your artists");
  // Every host that composes these steps (DashboardPage, ShowsBookingsPage, HireOrdersPage)
  // passes onStepAction, so the CTA opens SetupChecklistSheet at this step rather than
  // navigating: the label has to name the work done inside, the way its siblings do
  // ("Choose flow", "Set slots"), not the page it would otherwise open.
  expect(people.ctaLabel).toBe("Add artists");
  expect(people.ctaRoute).toBe(ROUTES.ARTISTS);
  // Gated on the roster capability, not on booking settings: a producer who cannot change
  // booking settings must still get this CTA (producer_can_add_artists defaults on), and a
  // producer whose org revoked add_artists must not be handed a button they cannot use.
  expect(people.ctaCapability).toBe("add_artists");
  expect(people.todoHint).toMatch(/email/i);
  // A direct-book org (artist_acceptance false) never sends an offer, and direct book is
  // chosen one row above this one on the same rail, so this hint cannot promise offers.
  // PeopleStep, the panel this hint is printed over, is held to the same rule.
  expect(`${people.todoHint}${people.doneHint}`).not.toMatch(/offer|\btiers?\b/i);
});

// One ctx builder for the rule tests, so a direct-book org is exercised with the same
// shape the dashboard passes rather than a hand-trimmed object.
const ctxFor = (artistAcceptance: boolean) => ({
  orgName: "Test Org",
  artistAcceptance,
  counts: { pendingConfirmations: 0, openOffers: 0, awaitingCountersign: 0 },
});

// The rail's completed state narrates "how this org works" as fact. Rule 1 already branches
// on the flow, so any rule below it that assumes the offer pipeline contradicts the rule
// directly above it for a direct-book org: no tier is ever opened there, so there is no
// digest, no response window and no accepted offer waiting on a producer.
const OFFER_PIPELINE_WORDS = /digest|expires|\btiers?\b|response window|accepted offer/i;

it("never narrates the offer pipeline to a direct-book org", () => {
  const ctx = ctxFor(false);
  for (const role of ["admin", "producer", "artist"] as const) {
    for (const r of bookingOnboarding.rules(role, ctx)) {
      expect(`${r.title} ${r.hint}`).not.toMatch(OFFER_PIPELINE_WORDS);
    }
  }
});

it("keeps the response window rule for an org that does send offers", () => {
  const titles = bookingOnboarding.rules("admin", ctxFor(true)).map((r) => r.title);
  expect(titles).toContain("Response window");
});

it("states no single offer delivery mode as fact", () => {
  // offer_delivery is per org: the shipped fast-track preset sets "immediate", and
  // open-offer-tier mails those orgs at tier open while send-offer-digest skips the hour
  // gate entirely. "Offers batch overnight" was flatly false for them.
  for (const r of bookingOnboarding.rules("admin", ctxFor(true))) {
    expect(`${r.title} ${r.hint}`).not.toMatch(/overnight|instantly/i);
  }
});

it("tells a direct-book org what actually happens instead", () => {
  // Silence would be an improvement over a false rule, but the rail's complete state is
  // the only place this org is told how booking works, so it has to say something true.
  const rules = bookingOnboarding.rules("admin", ctxFor(false));
  expect(rules.length).toBeGreaterThanOrEqual(2);
  expect(rules.map((r) => r.title)).toContain("Direct booking");
  expect(rules.some((r) => /booked/i.test(r.hint))).toBe(true);
});

it("never narrates the offer pipeline to an artist of a direct-book org", () => {
  // Same registry defect, artist side: the acceptance branch was on rule 2 only, so a
  // direct-book artist was told about a response window they will never see.
  for (const r of ARTIST_ONBOARDING.rules(ctxFor(false))) {
    expect(`${r.title} ${r.hint}`).not.toMatch(OFFER_PIPELINE_WORDS);
  }
});

it("states the cast limit only where it holds: which dates can be OFFERED", () => {
  // The cast rule used to be flow-neutral ("you can only be booked on your cast's dates"),
  // which is false in exactly the flow that generalization was meant to cover. Verified in
  // the shipped code, not assumed: `useEligibleArtists` resolves `artistIds` to null
  // ("no restriction") when an org has no show_cast_eligibility and no
  // show_date_cast_eligibility rows, and `deriveDirectBookList` (src/lib/bookings.ts) then
  // returns EVERY active org artist for the direct-book picker in ShowDateDetailSheet. So
  // at a direct-book org that never configured eligibility, a producer can book an artist
  // onto a date belonging to none of their casts.
  //
  // On the offer side the claim holds by construction: a tier IS a cast (resolveTierLadder
  // in supabase/functions/_shared/eligibility.ts), so an org with no ladder opens no tier
  // and sends no offer. The rule therefore lives in the acceptance branch, offer-scoped.
  for (const r of ARTIST_ONBOARDING.rules(ctxFor(false))) {
    expect(`${r.title} ${r.hint}`).not.toMatch(/\bcast/i);
  }
  const scoped = ARTIST_ONBOARDING.rules(ctxFor(true)).find((r) => /\bcast/i.test(`${r.title} ${r.hint}`));
  expect(scoped).toBeDefined();
  expect(scoped!.hint).toMatch(/offered/i);
  expect(scoped!.hint).not.toMatch(/booked/i);
});

it("tells a direct-book artist what they do control", () => {
  // Dropping the false cast rule must not leave this artist with a single line. Blocking
  // is the one lever they have when there is nothing to decline, and it is honoured on
  // both paths (open-offer-tier skips blocked_dates server-side; deriveDirectBookList
  // filters blocked artists out of the direct-book picker).
  const rules = ARTIST_ONBOARDING.rules(ctxFor(false));
  expect(rules.length).toBeGreaterThanOrEqual(2);
  expect(rules.map((r) => r.title)).toContain("You are booked directly");
  expect(rules.some((r) => /blocked dates/i.test(r.hint))).toBe(true);
});

it("words the artist's blocking step for every flow, not just the offer ones", () => {
  // ARTIST_ONBOARDING.steps is a flat record with no ctx, so this hint renders unchanged at
  // a direct-book org, which never sends an offer. The mechanism is true under both flows,
  // so the hint states that instead of the pipeline.
  const step = ARTIST_ONBOARDING.steps.blockDates;
  expect(`${step.todoHint}${step.doneHint}`).not.toMatch(/\boffers?\b/i);
  expect(step.todoHint).toMatch(/blocked dates/i);
});

it("leads the people hint with the consequence, the way its siblings do", () => {
  // DashboardSetupRail.StepRow hides the CTA when the viewer lacks the step's capability,
  // so a producer in an org that revoked producer_can_add_artists reads this hint with no
  // button under it. An instruction ("Import your roster...") hands them a task and no
  // control; every sibling states what is broken instead ("A show with no slot count never
  // reads as full."), which is readable whether or not the CTA is there.
  const people = bookingOnboarding.steps.people;
  expect(people.todoHint).toMatch(/^Nobody to book/);
  expect(people.todoHint).toMatch(/email/i);
  // Names the roster as the reader's, not as "this roster": on the dashboard rail this hint
  // renders next to a step title with no roster anywhere on screen, so a demonstrative has
  // nothing to point at. It only reads right on the bookings rail, where PeopleStep is open
  // directly underneath it.
  expect(people.todoHint).toMatch(/your roster/);
  expect(people.todoHint).not.toMatch(/this roster/);
});

// The registry's `steps` is a FLAT record: neither consumer (DashboardSetupRail through
// composeOnboarding, BookingSetupRail through `bookingOnboarding.steps` directly) has a ctx
// to branch on, so every one of these hints renders verbatim at a direct-book org. The
// people step was held to that rule step by step and the rules block by OFFER_PIPELINE_WORDS,
// but nothing swept the remaining hints, and the ladder and eligibility ones narrated the
// offer pipeline as fact ("The order offers go out in, per city.") to an org that never
// opens a tier.
const OFFER_CLAIM = /\boffer(s|ed|ing)?\b/i;

it("narrates the offer pipeline in no step hint except the flow choice itself", () => {
  // `flow` is exempt, and only `flow`: there "Offers" is not a claim about this org's
  // pipeline, it is the name of one of the two options the reader is about to pick between.
  // The noun "tier" is deliberately NOT swept: the ranks in Settings, Casts and cities are
  // called tiers whatever flow the org runs. What a direct-book org never has is an OPENED
  // tier, and that is what this regex catches.
  for (const [key, s] of Object.entries(bookingOnboarding.steps)) {
    if (key === "flow") continue;
    expect(`${s.title} ${s.todoHint} ${s.doneHint} ${s.ctaLabel}`).not.toMatch(OFFER_CLAIM);
  }
  for (const s of Object.values(hireOrderOnboarding.steps)) {
    expect(`${s.title} ${s.todoHint} ${s.doneHint} ${s.ctaLabel}`).not.toMatch(OFFER_CLAIM);
  }
});

it("keeps the timing step flow-neutral like its siblings", () => {
  // "Response window and digests" was the last offer-shaped survivor: a direct-book org
  // (artist_acceptance false) has no response window, and the OFFER_CLAIM sweep above never
  // caught it because the phrase dodges the word itself. Like ladder and eligibility, the
  // copy names what the row holds (send hours, an answer window); TimingStep's own panel
  // reads the real flow and narrates what THIS org does with them.
  expect(bookingOnboarding.steps.timing.title).toBe("Email timing");
  expect(bookingOnboarding.steps.timing.todoHint).toBe("When booking email goes out, and the answer window.");
  expect(bookingOnboarding.steps.timing.doneHint).toBe("Hours set. Change them any time in Settings.");
});

it("labels the coverage CTAs by what they open, not the page they sit on", () => {
  // "Open bookings" is circular on the bookings page itself, where these buttons open the
  // inline checklist Sheet in place. The label must say what happens on every surface.
  expect(bookingOnboarding.steps.ladder.ctaLabel).toBe("Review coverage");
  expect(bookingOnboarding.steps.eligibility.ctaLabel).toBe("Review coverage");
});

it("keeps the flow step naming both options it is asking the reader to choose between", () => {
  // The exemption above is only sound while that step really is the choice: if the word
  // ever leaves it, the exemption is dead code hiding the guard.
  expect(bookingOnboarding.steps.flow.todoHint).toMatch(OFFER_CLAIM);
});

it("says what the ladder and eligibility rows actually hold, not what one flow does with it", () => {
  // Neither replacement may be a shrug. Both name the thing the row stores, which is true
  // under every preset; the panels underneath (LadderStep, EligibilityStep) read the org's
  // flow and state the consequence, which is the half that genuinely differs.
  expect(bookingOnboarding.steps.ladder.todoHint).toMatch(/casts/i);
  expect(bookingOnboarding.steps.ladder.todoHint).toMatch(/city|cities/i);
  expect(bookingOnboarding.steps.eligibility.todoHint).toMatch(/casts/i);
  expect(bookingOnboarding.steps.eligibility.todoHint).toMatch(/show/i);
});

it("every step ctaCapability is a real capability action", () => {
  // A typo here silently disables a CTA for every non-admin: useCan(unknown) is always
  // false, and admins never notice because they bypass the check.
  const actions = new Set(CAPABILITY_DEFS.map((d) => d.action));
  const all = [bookingOnboarding, hireOrderOnboarding].flatMap((d) => Object.values(d.steps));
  for (const s of all) {
    if (s.ctaCapability) expect(actions).toContain(s.ctaCapability);
  }
});

it("offers admins the view-as tip, and never offers it to producers", () => {
  // Editor Mode is admin-or-super-admin only (editorAccess.canUseEditor), so a producer
  // shown this rule would be told to use a control they cannot see.
  const ctx = { orgName: "Test Org", artistAcceptance: true, counts: { pendingConfirmations: 0, openOffers: 0, awaitingCountersign: 0 } };
  const adminTitles = bookingOnboarding.rules("admin", ctx).map((r) => r.title);
  const producerTitles = bookingOnboarding.rules("producer", ctx).map((r) => r.title);
  expect(adminTitles).toContain("See it as your artists do");
  expect(producerTitles).not.toContain("See it as your artists do");
});

it("points the view-as tip at the control, not at the name of a mode", () => {
  // Every other hint in this registry tells the reader what happens to them. Naming a
  // mode as the actor ("Editor Mode can view this app...") leaves an admin hunting for a
  // menu; the pencil is the thing they actually click.
  const ctx = { orgName: "Test Org", artistAcceptance: true, counts: { pendingConfirmations: 0, openOffers: 0, awaitingCountersign: 0 } };
  const tip = bookingOnboarding.rules("admin", ctx).find((r) => r.title === "See it as your artists do")!;
  expect(tip.hint).toMatch(/^The pencil icon top right/);
});

it("promises only what the view-as control can actually do, and names its precondition", () => {
  // Two facts this rule may not overstate. (1) The toolbar's "as user" picker is fed by
  // the admin-list-users edge function, which enumerates auth.users, so an artist added
  // to the roster or invited but never signed in is not in that list at all. (2) The
  // always-available fallback, the "Viewing as: Artist" role option, sets viewAsRole and
  // no viewAsUser, so useEffectiveUserId still returns the admin and useMyArtist resolves
  // nothing: they get the artist shell, not that person's data. This rule renders in the
  // rail's COMPLETE state, straight after the people step said an artist needs no account
  // to be added, which is precisely when the picker holds no artists.
  const ctx = { orgName: "Test Org", artistAcceptance: true, counts: { pendingConfirmations: 0, openOffers: 0, awaitingCountersign: 0 } };
  const tip = bookingOnboarding.rules("admin", ctx).find((r) => r.title === "See it as your artists do")!;
  expect(tip.hint).toMatch(/logged in/i);
  expect(tip.hint).not.toMatch(/exactly as they do/i);
  expect(tip.hint).not.toMatch(/\bany artist\b/i);
});

it("no inherited rule copy uses em/en dashes", () => {
  // Both flows: half of this copy only renders for one of them.
  const rules = [true, false].flatMap((acceptance) => {
    const ctx = ctxFor(acceptance);
    return [
      ...ARTIST_ONBOARDING.rules(ctx),
      ...(["admin", "producer", "artist"] as const).flatMap((role) => [
        ...bookingOnboarding.rules(role, ctx),
        ...hireOrderOnboarding.rules(role, ctx),
      ]),
    ];
  });
  for (const r of rules) expect(`${r.title}${r.hint}`).not.toMatch(/[—–]/);
});

it("every CTA route is a real ROUTES value and no copy uses em/en dashes", () => {
  const all = [bookingOnboarding, hireOrderOnboarding].flatMap((d) => Object.values(d.steps));
  for (const s of all) {
    expect(Object.values(ROUTES)).toContain(s.ctaRoute);
    expect(`${s.title}${s.todoHint}${s.doneHint}${s.ctaLabel}`).not.toMatch(/[—–]/);
  }
});

it("every module has railHeader copy with no em/en dashes", () => {
  for (const def of [bookingOnboarding, hireOrderOnboarding]) {
    expect(def.railHeader.title.length).toBeGreaterThan(0);
    expect(def.railHeader.body.length).toBeGreaterThan(0);
    expect(`${def.railHeader.title}${def.railHeader.body}`).not.toMatch(/[—–]/);
  }
});

it("names no offer in a rail header, which no flow read reaches", () => {
  // `railHeader` is a flat pair of strings and neither consumer passes ctx: the
  // ShowsBookingsPage banner reads it through useModuleOnboardingRail and BookingSetupRail
  // renders it as the card's own header. So the SAME sentence is printed to a direct-book
  // org (artist_acceptance false), which never opens a tier and never sends an offer, one
  // line above the "Blocks booking" chips this rail already words from that org's flow.
  // Flow-neutral is the fix here rather than a branch, because there is no ctx at either
  // call site to branch on, and "the first booking" is true under every preset.
  for (const def of [bookingOnboarding, hireOrderOnboarding]) {
    expect(`${def.railHeader.title} ${def.railHeader.body}`).not.toMatch(/\boffers?\b/i);
  }
});

it("ARTIST_ONBOARDING step keys match ARTIST_STEP_KEYS (drift guard)", () => {
  expect(Object.keys(ARTIST_ONBOARDING.steps).sort()).toEqual([...ARTIST_STEP_KEYS].sort());
});

it("ARTIST_STEP_KEYS match the keys useArtistOnboardingStatus produces", () => {
  // Hardcoded expectation mirrors the single actionable step assembled in
  // useArtistOnboardingStatus (blockDates). Account linkage is a precondition, not a
  // step, and the phone/notifications step was dropped (no phone-based delivery exists).
  expect([...ARTIST_STEP_KEYS].sort()).toEqual(["blockDates"]);
});

it("artist CTA routes are real ROUTES values and no copy uses em/en dashes", () => {
  for (const s of Object.values(ARTIST_ONBOARDING.steps)) {
    expect(Object.values(ROUTES)).toContain(s.ctaRoute);
    expect(`${s.title}${s.todoHint}${s.doneHint}${s.ctaLabel}`).not.toMatch(/[—–]/);
  }
});
