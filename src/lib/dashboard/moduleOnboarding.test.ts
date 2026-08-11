import { it, expect } from "vitest";
import {
  ARTIST_ONBOARDING,
  ARTIST_STEP_KEYS,
  MODULE_ONBOARDING,
  VIEW_AS_ARTIST_TIP,
  PRODUCER_ROLE_NOTE,
  ROLE_EXPLAINER_LINK_LABEL,
  ROLE_EXPLAINER_LINK_ROUTE,
  bookingOnboarding,
  hireOrderOnboarding,
} from "./moduleOnboarding";
import { FEATURE_KEYS } from "@/lib/entitlements";
import { computeBookingSetupStatus } from "@/lib/bookings/setupStatus";
import { computeSetupStatus } from "@/lib/hireOrders/setupStatus";
import { ROLE_DESCRIPTIONS, ROUTES } from "@/config/app.config";
import { SETTINGS_TAB_PARAMS } from "@/lib/settingsTabs";
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

it("states the people consequence once and leaves the explaining to the panel", () => {
  // SetupStepRow prints a step's hint in the collapsed row header AND keeps it there while
  // the panel is expanded underneath, so anything said in both is printed twice, about two
  // lines apart. This hint used to carry the whole card-address explanation as well as the
  // consequence, and PeopleStep said the same two things again: the default first-run path
  // (FlowStep's onDone opens `people`; the dashboard rail's "Add artists" opens the sheet
  // at `people`) showed the duplicate, not some edge case.
  //
  // One owner per fact: the row states the consequence in one line, the way every sibling
  // does ("A show with no slot count never reads as full."), and PeopleStep owns the
  // mechanism, the counts and the address/invite explanation. The scoping of that address
  // claim is enforced where it now lives, in PeopleStep.test.tsx.
  const people = bookingOnboarding.steps.people;
  expect(people.todoHint).toBe("Nobody to book until your roster has active artists.");
  expect(people.todoHint).not.toMatch(/emailed at the address on their card/i);
  // The row hint slot is documented as a one-line hint. Held against the real siblings
  // rather than a magic number, so the rule survives a rewording of any of them.
  const siblings = Object.entries(bookingOnboarding.steps)
    .filter(([key]) => key !== "people")
    .map(([, s]) => s.todoHint.length);
  expect(people.todoHint.length).toBeLessThanOrEqual(Math.max(...siblings));
  // Neither half may promise delivery: the "off" preset (every digest function skips a
  // paused org) and a direct-book org with confirmation_digest off email an artist nothing.
  expect(`${people.todoHint}${people.doneHint}`).not.toMatch(/reach(es)?\s+them|log in/i);
});

it("the people step points at the artists page", () => {
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
  // rail's COMPLETE state, straight after the people panel said an artist can be added
  // before they ever sign in, which is precisely when the picker holds no artists.
  //
  // The precondition is stated as the ACCOUNT, not a login. admin-list-users enumerates
  // auth.users, so an artist who accepted their invitation and has not been back since is
  // still in the picker, and "once they have logged in" reads as a recency condition that
  // would have the admin waiting for nothing. "Account" is also the word the product
  // already uses at the only place an admin can check: the artist card's account-status
  // chip ("Active account" / "No account", see AccountStatusChip).
  const ctx = { orgName: "Test Org", artistAcceptance: true, counts: { pendingConfirmations: 0, openOffers: 0, awaitingCountersign: 0 } };
  const tip = bookingOnboarding.rules("admin", ctx).find((r) => r.title === "See it as your artists do")!;
  expect(tip.hint).toMatch(/has an account/i);
  expect(tip.hint).not.toMatch(/logged in|signed in|logs in/i);
  expect(tip.hint).not.toMatch(/exactly as they do/i);
  expect(tip.hint).not.toMatch(/\bany artist\b/i);
});

it("keeps the view-as tip as one shared object, since two surfaces render it", () => {
  // `rules` is the rail's COMPLETE state, so as a rule alone this tip only ever reached an
  // admin who had already finished setup. The gap it answers is the opposite one: nothing
  // suggests viewing the app as an artist WHILE you are still setting it up. So
  // BookingSetupRail renders it in its own footer too, and that surface is on screen only
  // while setup is unfinished. One exported object rather than two literals: a reworded tip
  // that lands on one of the two surfaces is exactly the drift this registry exists to stop.
  const ctx = ctxFor(true);
  const fromRules = bookingOnboarding.rules("admin", ctx).find((r) => r.title === VIEW_AS_ARTIST_TIP.title);
  expect(fromRules).toBe(VIEW_AS_ARTIST_TIP);
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

// A ctaRoute is rendered by DashboardSetupRail as `<Link to={step.ctaRoute}>`, which takes a
// path AND a query string. So the invariant is on the PATH: the query is the deep-link
// (`?tab=`), and pinning the whole string to Object.values(ROUTES) would have banned exactly
// the honest link the labels below promise.
const routePath = (to: string) => to.split("?")[0];
/** Every `?tab=` a step may carry has to be one SettingsPage will actually open. */
const tabParam = (to: string) => new URLSearchParams(to.split("?")[1] ?? "").get("tab");

it("every CTA route is a real ROUTES value and no copy uses em/en dashes", () => {
  const all = [bookingOnboarding, hireOrderOnboarding].flatMap((d) => Object.values(d.steps));
  for (const s of all) {
    expect(Object.values(ROUTES)).toContain(routePath(s.ctaRoute));
    const tab = tabParam(s.ctaRoute);
    if (tab !== null) {
      expect(routePath(s.ctaRoute)).toBe(ROUTES.SETTINGS);
      expect(SETTINGS_TAB_PARAMS).toContain(tab);
    }
    expect(`${s.title}${s.todoHint}${s.doneHint}${s.ctaLabel}`).not.toMatch(/[—–]/);
  }
});

it("the two Settings steps deep-link to the tab their label names", () => {
  // "Choose flow" and "Set timing" both live in Settings, Booking flow. A bare
  // ROUTES.SETTINGS lands on Organization for an admin and Scheduling for a producer, so
  // the CTA opened a pane with neither control on it and left the reader to find the tab.
  // Same fix, same reason, as the LadderStep/EligibilityStep links one screen away.
  //
  // Latent rather than live today: DashboardSetupRail only renders the Link when its host
  // passes no onStepAction, and every current host passes one. It is the fallback that has
  // to be right, because nothing tells the next host to supply a handler.
  expect(bookingOnboarding.steps.flow.ctaRoute).toBe(`${ROUTES.SETTINGS}?tab=booking`);
  expect(bookingOnboarding.steps.timing.ctaRoute).toBe(`${ROUTES.SETTINGS}?tab=booking`);
});

it("leaves the hire-order steps on bare Settings", () => {
  // `hire-orders` is deliberately absent from SETTINGS_TAB_PARAMS: the tab is
  // entitlement-gated and the pure resolver cannot see an org's entitlement, so deep-linking
  // it would strand an unentitled org on an empty pane. These three keep the bare route.
  for (const s of Object.values(hireOrderOnboarding.steps)) {
    expect(s.ctaRoute).toBe(ROUTES.SETTINGS);
  }
  expect(SETTINGS_TAB_PARAMS as readonly string[]).not.toContain("hire-orders");
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
    expect(Object.values(ROUTES)).toContain(routePath(s.ctaRoute));
    expect(`${s.title}${s.todoHint}${s.doneHint}${s.ctaLabel}`).not.toMatch(/[—–]/);
  }
});

// P0.2: a producer had no reachable explanation of what "Production Team" covers versus
// the admin. The rail's complete-state rules are the one place every role's narrative
// already lives (VIEW_AS_ARTIST_TIP above is the admin-only precedent), so the explainer
// joins that block rather than opening a new surface.
it("gives a producer a reachable explanation of their role, absent for admin", () => {
  const ctx = ctxFor(true);
  const producerRules = bookingOnboarding.rules("producer", ctx);
  const explainer = producerRules.find((r) => r.hint === PRODUCER_ROLE_NOTE);
  expect(explainer).toBeDefined();
  expect(explainer!.title).toBe(ROLE_EXPLAINER_LINK_LABEL);

  const adminRules = bookingOnboarding.rules("admin", ctx);
  expect(adminRules.some((r) => r.hint === PRODUCER_ROLE_NOTE)).toBe(false);
  expect(adminRules.some((r) => r.title === ROLE_EXPLAINER_LINK_LABEL)).toBe(false);
});

it("carries the producer role explainer under a direct-book org too", () => {
  // Rule 1 already branches on ctx.artistAcceptance; the explainer does not describe the
  // org's pipeline at all, so it has to survive that branch unchanged.
  const producerRules = bookingOnboarding.rules("producer", ctxFor(false));
  expect(producerRules.some((r) => r.hint === PRODUCER_ROLE_NOTE)).toBe(true);
});

it("points the role explainer link at Settings, Documentation", () => {
  expect(ROLE_EXPLAINER_LINK_ROUTE).toBe(`${ROUTES.SETTINGS}?tab=docs`);
  expect(SETTINGS_TAB_PARAMS as readonly string[]).toContain("docs");
});

it("keeps the producer role note dash free", () => {
  expect(PRODUCER_ROLE_NOTE).not.toMatch(/[—–]/);
  expect(ROLE_EXPLAINER_LINK_LABEL).not.toMatch(/[—–]/);
});

// P0.1 regression pin: ROLE_DESCRIPTIONS.producer is consumed elsewhere in this
// initiative (the People pane role dropdown, the accept-invite screen); this task does
// not change it, so pin that it stays a real, dash-free sentence.
it("keeps ROLE_DESCRIPTIONS.producer non-empty and dash free (regression pin)", () => {
  expect(ROLE_DESCRIPTIONS.producer.length).toBeGreaterThan(0);
  expect(ROLE_DESCRIPTIONS.producer).not.toMatch(/[—–]/);
});
