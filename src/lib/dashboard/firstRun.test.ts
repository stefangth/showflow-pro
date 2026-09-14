// src/lib/dashboard/firstRun.test.ts
import { it, expect } from "vitest";
import i18n from "@/i18n";
import { composeArtist, composeOnboarding, welcomeCopy, railHeaderCopy, collapsedCopy, adminTeamStep, injectAdminTeamStep } from "./firstRun";
import { buildArtistOnboarding } from "./moduleOnboarding";
import type { ComposeInput, DashboardRole, ModuleOnboardingDef, ModuleStatusLite, OnboardingCtx } from "./types";

// The copy builders are now t-driven; rebind the English catalog so these assertions keep
// pinning the exact shipped English copy (German is covered by the i18n gates).
const t = i18n.getFixedT("en", "onboarding");
const ARTIST_ONBOARDING = buildArtistOnboarding(t);

const bookingDef: ModuleOnboardingDef<"flow" | "slots"> = {
  key: "booking_flow",
  railHeader: { title: "Get bookings running", body: "b" },
  steps: {
    flow: { title: "Booking flow", todoHint: "t", doneHint: "d", ctaLabel: "Choose", ctaRoute: "/settings", ctaCapability: "edit_booking_settings" },
    slots: { title: "Slots per show", todoHint: "t", doneHint: "d", ctaLabel: "Set", ctaRoute: "/productions", ctaCapability: "edit_booking_settings" },
  },
  rules: () => [{ title: "Rule", hint: "h" }],
  offFooter: "Booking flow is off.",
};
const hireDef: ModuleOnboardingDef<"letterhead"> = {
  key: "hire_orders",
  railHeader: { title: "Get hire orders ready", body: "b" },
  steps: { letterhead: { title: "Letterhead", todoHint: "t", doneHint: "d", ctaLabel: "Set", ctaRoute: "/settings/hire-orders" } },
  rules: () => [],
  offFooter: "Hire orders is off. Ask your account manager to switch it on.",
};
const registry = { booking_flow: bookingDef, hire_orders: hireDef } as never;

const ctx = { orgName: "Halle Kollektiv", artistAcceptance: true, counts: { pendingConfirmations: 4, openOffers: 2, awaitingCountersign: 1 } };
const bookingStatus: ModuleStatusLite = {
  steps: [{ key: "flow", done: true, block: null }, { key: "slots", done: false, block: "filling" }],
  complete: false,
};

it("composes only enabled modules and carries done/block from status", () => {
  const input: ComposeInput = { enabled: new Set(["booking_flow"]), role: "admin", moduleStatuses: { booking_flow: bookingStatus }, ctx };
  const r = composeOnboarding(input, registry);
  expect(r.steps.map((s) => s.key)).toEqual(["flow", "slots"]);
  expect(r.steps[1]).toMatchObject({ done: false, block: "filling", moduleKey: "booking_flow", title: "Slots per show" });
  expect(r.complete).toBe(false);
});

it("complete is the AND over enabled modules' status.complete", () => {
  const input: ComposeInput = {
    enabled: new Set(["booking_flow", "hire_orders"]),
    role: "admin",
    moduleStatuses: {
      booking_flow: { steps: [{ key: "flow", done: true, block: null }], complete: true },
      hire_orders: { steps: [{ key: "letterhead", done: false, block: null }], complete: false },
    },
    ctx,
  };
  expect(composeOnboarding(input, registry).complete).toBe(false);
});

it("complete is true when every enabled module status is complete", () => {
  const input: ComposeInput = {
    enabled: new Set(["booking_flow", "hire_orders"]),
    role: "admin",
    moduleStatuses: {
      booking_flow: { steps: [{ key: "flow", done: true, block: null }], complete: true },
      hire_orders: { steps: [{ key: "letterhead", done: true, block: null }], complete: true },
    },
    ctx,
  };
  expect(composeOnboarding(input, registry).complete).toBe(true);
});

it("offFooters come from disabled licensable modules", () => {
  const input: ComposeInput = { enabled: new Set(["booking_flow"]), role: "admin", moduleStatuses: { booking_flow: bookingStatus }, ctx };
  expect(composeOnboarding(input, registry).offFooters).toEqual(["Hire orders is off. Ask your account manager to switch it on."]);
});

const artistStatus: ModuleStatusLite = {
  steps: [
    { key: "blockDates", done: false, block: null },
  ],
  complete: false,
};

it("adminTeamStep is a non-gating booking_flow step, done only with a producer", () => {
  // done follows the producer count; null (unread) and 0 both read as not done.
  expect(adminTeamStep(0, t).done).toBe(false);
  expect(adminTeamStep(null, t).done).toBe(false);
  expect(adminTeamStep(2, t).done).toBe(true);
  const step = adminTeamStep(0, t);
  expect(step.key).toBe("team");
  expect(step.moduleKey).toBe("booking_flow");
  // Non-gating: never chips, never counts against canOffer/complete.
  expect(step.block).toBeNull();
  // Carries the shared meta (title/CTA) so any generic consumer renders it.
  expect(step.title).toBe("Add your Production Team");
  expect(step.ctaLabel).toBe("Invite team");
});

it("injectAdminTeamStep gates on the passed (booking) complete, not composed.complete", () => {
  // A dashboard-shaped composed: BOTH modules entitled, booking done, hire_orders not — so
  // the combined composed.complete is false while booking on its own is complete.
  const composed = composeOnboarding(
    {
      enabled: new Set(["booking_flow", "hire_orders"]),
      role: "admin",
      moduleStatuses: {
        booking_flow: { steps: [{ key: "flow", done: true, block: null }], complete: true },
        hire_orders: { steps: [{ key: "letterhead", done: false, block: null }], complete: false },
      },
      ctx,
    },
    registry,
  );
  expect(composed.complete).toBe(false);

  // Regression: keying on composed.complete (false) would keep the booking-scoped team nudge
  // on the dashboard after booking is done, while the booking-only banner/sheet already hid it.
  // Passing booking's own completeness (true) retires it on every surface.
  const hidden = injectAdminTeamStep(composed, { role: "admin", bookingEnabled: true, producerCount: 0, complete: true }, t);
  expect(hidden.steps.some((s) => s.key === "team")).toBe(false);
  expect(hidden.total).toBe(composed.steps.length);

  // Booking still incomplete → the nudge shows first and bumps the count by one.
  const shown = injectAdminTeamStep(composed, { role: "admin", bookingEnabled: true, producerCount: 0, complete: false }, t);
  expect(shown.steps[0].key).toBe("team");
  expect(shown.total).toBe(composed.steps.length + 1);

  // Producers never see it, regardless of completeness.
  const producer = injectAdminTeamStep(composed, { role: "producer", bookingEnabled: true, producerCount: 0, complete: false }, t);
  expect(producer.steps.some((s) => s.key === "team")).toBe(false);
});

it("composeArtist carries ARTIST_ONBOARDING metadata over booking_flow only", () => {
  const r = composeArtist(artistStatus, ARTIST_ONBOARDING, ctx);
  expect(r.steps).toHaveLength(1);
  expect(r.steps.map((s) => s.key)).toEqual(["blockDates"]);
  expect(r.steps.map((s) => s.title)).toEqual(["Block what you cannot take on"]);
  expect(r.steps.every((s) => s.moduleKey === "booking_flow")).toBe(true);
  expect(r.steps.map((s) => s.done)).toEqual([false]);
  expect(r.complete).toBe(false); // mirrors the status
  expect(r.offFooters).toEqual([]);
});

it("composeArtist rules reflect ctx.artistAcceptance", () => {
  const offers = composeArtist(artistStatus, ARTIST_ONBOARDING, { ...ctx, artistAcceptance: true } as OnboardingCtx);
  // Titled by the channel, not by the batching: offer_delivery is per org, so an artist at
  // a fast-track org gets the mail the moment a tier opens, not in a daily digest.
  expect(offers.rules.some((rule) => rule.title === "Asks arrive by email")).toBe(true);
  const direct = composeArtist(artistStatus, ARTIST_ONBOARDING, { ...ctx, artistAcceptance: false } as OnboardingCtx);
  expect(direct.rules.some((rule) => rule.title === "You are booked directly")).toBe(true);
  // A direct-book artist has no ask to answer, so the window rule is not theirs.
  expect(direct.rules.some((rule) => rule.title === "You have a window to answer")).toBe(false);
});

it("never tells a direct-book artist that offers are on the way", () => {
  // welcomeCopy is the headline card directly above the rules block, and that block already
  // branches on the flow: a direct-book org (artist_acceptance false) never opens a tier,
  // so ARTIST_ONBOARDING tells that artist "You are booked directly". The card used to
  // announce "Offers arrive by email and land on this page" over the top of it, which made
  // the one surface contradict itself.
  const direct = { ...ctx, artistAcceptance: false } as OnboardingCtx;
  for (const complete of [true, false]) {
    const w = welcomeCopy("artist", complete, direct, { filled: 1, total: 2 }, false, t);
    expect(`${w.headline} ${w.body}`).not.toMatch(/\basks?\b/i);
    expect(w.body.length).toBeGreaterThan(0);
    expect(`${w.headline}${w.body}`).not.toMatch(/[—–]/);
  }
  // An org that does run offers keeps the offer narrative.
  expect(welcomeCopy("artist", false, ctx, { filled: 1, total: 2 }, false, t).body).toMatch(/^Asks arrive by email/);
  expect(welcomeCopy("artist", true, ctx, { filled: 2, total: 2 }, false, t).headline).toMatch(/asks/i);
});

it("labels the artist's rules block without naming a pipeline the org may not run", () => {
  // railHeaderCopy and collapsedCopy take no ctx, so their artist labels render unchanged at
  // a direct-book org. "How offers work here" is itself a claim that offers exist, and it
  // sat directly on top of a rules list saying they do not. These labels carry no flow.
  expect(railHeaderCopy("artist", true, false, t).eyebrow).toBe("How booking works here");
  expect(railHeaderCopy("artist", true, false, t).body).not.toMatch(/\basks?\b/i);
  expect(railHeaderCopy("artist", false, false, t).title).not.toMatch(/\basks?\b/i);
  expect(railHeaderCopy("artist", false, false, t).body).not.toMatch(/\basks?\b/i);
  expect(collapsedCopy("artist", true, 0, t).cta).toBe("How booking works here");
  expect(collapsedCopy("artist", true, 0, t).hint).not.toMatch(/\basks?\b/i);
  // The producer/admin labels are untouched: their rails cover the whole org, not a pipeline.
  expect(railHeaderCopy("admin", true, false, t).eyebrow).toBe("How this org works");
});

it("never names an offer in a rail header, at any role or grant", () => {
  // railHeaderCopy takes no ctx, so every string it returns is printed unchanged at a
  // direct-book org. The artist branch was already swept for this; the admin and producer
  // bodies still said "Some of these block the first offer" while sitting directly above
  // step rows the engine chips "Blocks booking" for exactly that org (blockFor in
  // src/lib/bookings/setupStatus.ts). Same false pipeline, louder position.
  for (const role of ["admin", "producer", "artist"] as const) {
    for (const complete of [true, false]) {
      for (const canEditSetup of [true, false]) {
        const r = railHeaderCopy(role, complete, canEditSetup, t);
        expect(`${r.eyebrow} ${r.title} ${r.body}`).not.toMatch(/\basks?\b/i);
      }
    }
  }
});

it("never tells a direct-book producer that offers will appear here", () => {
  // Same defect one card up. welcomeCopy DOES take ctx, and its artist branch already reads
  // ctx.artistAcceptance, so the producer body branches rather than going flow-neutral: an
  // org that runs offers keeps the fuller narrative.
  const direct = { ...ctx, artistAcceptance: false } as OnboardingCtx;
  for (const complete of [true, false]) {
    const w = welcomeCopy("producer", complete, direct, { filled: 1, total: 4 }, false, t);
    expect(`${w.headline} ${w.body}`).not.toMatch(/\basks?\b/i);
    expect(w.body.length).toBeGreaterThan(0);
    expect(`${w.headline}${w.body}`).not.toMatch(/[—–]/);
  }
  // An org that does run offers still gets told about them.
  expect(welcomeCopy("producer", false, ctx, { filled: 1, total: 4 }, false, t).body).toMatch(/asks/i);
});

it("welcomeCopy interpolates org name and progress", () => {
  const w = welcomeCopy("admin", false, ctx, { filled: 1, total: 4 }, false, t);
  expect(w.headline).toContain("Halle Kollektiv");
  expect(w.progressTotal).toBe(4);
  expect(w.progressFilled).toBe(1);
  expect(w.body).not.toMatch(/[—–]/); // no em/en dashes
});

// welcomeCopy has no org-maturity input: `complete` only says setup steps are
// outstanding, which is just as true for the SECOND admin joining an org already
// holding shows, dates, and artists (verified live: 6 shows / 75 dates / 25 artists
// rendered under this very card). Copy on this branch must therefore claim nothing
// about being first and nothing about the database being empty.
it("incomplete-admin welcome claims neither firstness nor an empty database", () => {
  const w = welcomeCopy("admin", false, ctx, { filled: 1, total: 4 }, false, t);
  expect(`${w.headline} ${w.body}`).not.toMatch(/first admin/i);
  expect(`${w.headline} ${w.body}`).not.toMatch(/database is empty|empty/i);
  expect(w.headline).toBe("Finish setting up Halle Kollektiv");
  expect(w.body).toBe(
    "A few decisions still shape how this workspace runs. Walk the remaining steps, because every number on this page follows them.",
  );
});

// ---- Table-driven coverage over the full role x complete matrix for the three
// copy functions. Expected values are hardcoded (not re-derived from the same
// branching as the implementation) so a future copy edit that changes a label,
// drops an org-name interpolation, or breaks pluralization fails a test.

const WELCOME_ROWS: { role: DashboardRole; complete: boolean; primaryLabel: string; orgInHeadline: boolean }[] = [
  { role: "admin", complete: true, primaryLabel: "How this org works", orgInHeadline: false },
  { role: "admin", complete: false, primaryLabel: "Start setup", orgInHeadline: true },
  { role: "producer", complete: true, primaryLabel: "How this org works", orgInHeadline: true },
  { role: "producer", complete: false, primaryLabel: "See what is outstanding", orgInHeadline: true },
  { role: "artist", complete: true, primaryLabel: "How booking works here", orgInHeadline: false },
  { role: "artist", complete: false, primaryLabel: "Start setup", orgInHeadline: true },
];

it("welcomeCopy covers every role x complete branch", () => {
  for (const row of WELCOME_ROWS) {
    const w = welcomeCopy(row.role, row.complete, ctx, { filled: 2, total: 4 }, false, t);
    expect(w.primaryLabel).toBe(row.primaryLabel);
    expect(w.headline.includes(ctx.orgName)).toBe(row.orgInHeadline);
    const all = `${w.eyebrow}${w.headline}${w.body}${w.primaryLabel}${w.secondaryLabel}${w.progressLabel}${w.progressHint}`;
    expect(all).not.toMatch(/[—–]/);
  }
});

const RAIL_ROWS: { role: DashboardRole; complete: boolean; eyebrow: string; title: string }[] = [
  { role: "admin", complete: true, eyebrow: "How this org works", title: "The rules you inherited" },
  { role: "admin", complete: false, eyebrow: "Set up", title: "Get the workspace running" },
  { role: "producer", complete: true, eyebrow: "How this org works", title: "The rules you inherited" },
  { role: "producer", complete: false, eyebrow: "Org setup", title: "What is still outstanding" },
  { role: "artist", complete: true, eyebrow: "How booking works here", title: "The rules you inherited" },
  { role: "artist", complete: false, eyebrow: "Set up", title: "Before your first booking" },
];

it("railHeaderCopy covers every role x complete branch", () => {
  for (const row of RAIL_ROWS) {
    const r = railHeaderCopy(row.role, row.complete, false, t);
    expect(r.eyebrow).toBe(row.eyebrow);
    expect(r.title).toBe(row.title);
    expect(`${r.eyebrow}${r.title}${r.body}`).not.toMatch(/[—–]/);
  }
});

it("railHeaderCopy never points the artist at Settings (they have no access)", () => {
  expect(railHeaderCopy("artist", true, false, t).body).not.toMatch(/Settings/);
  // Admins keep the Settings pointer; a producer without the grant does not.
  expect(railHeaderCopy("admin", true, false, t).body).toMatch(/Settings/);
  expect(railHeaderCopy("producer", true, false, t).body).not.toMatch(/Settings/);
});

it("treats a capability-granted producer as set-up-capable (no 'only an admin' framing)", () => {
  // A producer granted edit_* capabilities can reach Settings, so the "only an admin" /
  // "you cannot change these" copy must not apply to them.
  expect(railHeaderCopy("producer", true, true, t).body).toMatch(/Settings/);
  expect(railHeaderCopy("producer", false, true, t).body).not.toMatch(/Only an admin/);
  const capable = welcomeCopy("producer", false, ctx, { filled: 0, total: 3 }, true, t);
  expect(capable.progressHint).not.toBe("Only an admin can do these");
  expect(capable.primaryLabel).toBe("Start setup");
  // Default (no capability) keeps the admin-gated framing.
  expect(railHeaderCopy("producer", false, false, t).body).toMatch(/Only an admin/);
  expect(welcomeCopy("producer", false, ctx, { filled: 0, total: 3 }, false, t).progressHint).toBe("Only an admin can do these");
});

const COLLAPSED_ROWS: { role: DashboardRole; complete: boolean; remaining: number; label: string; cta: string; hint?: string }[] = [
  { role: "admin", complete: true, remaining: 0, label: "Set up · done", cta: "How this org works" },
  { role: "admin", complete: false, remaining: 1, label: "Set up in progress", cta: "Resume", hint: "1 step left" },
  { role: "admin", complete: false, remaining: 3, label: "Set up in progress", cta: "Resume", hint: "3 steps left" },
  { role: "producer", complete: true, remaining: 0, label: "Set up · done", cta: "How this org works" },
  { role: "producer", complete: false, remaining: 1, label: "Org setup in progress", cta: "See what is outstanding", hint: "1 step left" },
  { role: "producer", complete: false, remaining: 2, label: "Org setup in progress", cta: "See what is outstanding", hint: "2 steps left" },
  { role: "artist", complete: true, remaining: 0, label: "Set up · done", cta: "How booking works here" },
  { role: "artist", complete: false, remaining: 1, label: "Set up in progress", cta: "Resume", hint: "1 step left" },
  { role: "artist", complete: false, remaining: 2, label: "Set up in progress", cta: "Resume", hint: "2 steps left" },
];

it("collapsedCopy covers every role x complete branch, with pluralization", () => {
  for (const row of COLLAPSED_ROWS) {
    const c = collapsedCopy(row.role, row.complete, row.remaining, t);
    expect(c.label).toBe(row.label);
    expect(c.cta).toBe(row.cta);
    if (row.hint) expect(c.hint).toBe(row.hint);
    expect(`${c.label}${c.hint}${c.cta}`).not.toMatch(/[—–]/);
  }
});
