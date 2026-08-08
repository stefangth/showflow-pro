// src/lib/dashboard/firstRun.test.ts
import { it, expect } from "vitest";
import { composeArtist, composeOnboarding, welcomeCopy, railHeaderCopy, collapsedCopy } from "./firstRun";
import { ARTIST_ONBOARDING } from "./moduleOnboarding";
import type { ComposeInput, DashboardRole, ModuleOnboardingDef, ModuleStatusLite, OnboardingCtx } from "./types";

const bookingDef: ModuleOnboardingDef<"flow" | "slots"> = {
  key: "booking_flow",
  steps: {
    flow: { title: "Booking flow", todoHint: "t", doneHint: "d", ctaLabel: "Choose", ctaRoute: "/settings", ctaCapability: "edit_booking_settings" },
    slots: { title: "Slots per show", todoHint: "t", doneHint: "d", ctaLabel: "Set", ctaRoute: "/productions", ctaCapability: "edit_booking_settings" },
  },
  rules: () => [{ title: "Rule", hint: "h" }],
  offFooter: "Booking flow is off.",
};
const hireDef: ModuleOnboardingDef<"letterhead"> = {
  key: "hire_orders",
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
    { key: "notifications", done: false, block: null },
  ],
  complete: false,
};

it("composeArtist carries ARTIST_ONBOARDING metadata over booking_flow only", () => {
  const r = composeArtist(artistStatus, ARTIST_ONBOARDING, ctx);
  expect(r.steps).toHaveLength(2);
  expect(r.steps.map((s) => s.key)).toEqual(["blockDates", "notifications"]);
  expect(r.steps.map((s) => s.title)).toEqual(["Block what you cannot play", "Notifications"]);
  expect(r.steps.every((s) => s.moduleKey === "booking_flow")).toBe(true);
  expect(r.steps.map((s) => s.done)).toEqual([false, false]);
  expect(r.complete).toBe(false); // mirrors the status
  expect(r.offFooters).toEqual([]);
});

it("composeArtist rules reflect ctx.artistAcceptance", () => {
  const digest = composeArtist(artistStatus, ARTIST_ONBOARDING, { ...ctx, artistAcceptance: true } as OnboardingCtx);
  expect(digest.rules.some((rule) => rule.title === "Offers arrive in a daily digest")).toBe(true);
  const direct = composeArtist(artistStatus, ARTIST_ONBOARDING, { ...ctx, artistAcceptance: false } as OnboardingCtx);
  expect(direct.rules.some((rule) => rule.title === "You are booked directly")).toBe(true);
});

it("welcomeCopy interpolates org name and progress", () => {
  const w = welcomeCopy("admin", false, ctx, { filled: 1, total: 4 });
  expect(w.headline).toContain("Halle Kollektiv");
  expect(w.progressTotal).toBe(4);
  expect(w.progressFilled).toBe(1);
  expect(w.body).not.toMatch(/[—–]/); // no em/en dashes
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
  { role: "artist", complete: true, primaryLabel: "How offers work here", orgInHeadline: false },
  { role: "artist", complete: false, primaryLabel: "Start setup", orgInHeadline: true },
];

it("welcomeCopy covers every role x complete branch", () => {
  for (const row of WELCOME_ROWS) {
    const w = welcomeCopy(row.role, row.complete, ctx, { filled: 2, total: 4 });
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
  { role: "artist", complete: true, eyebrow: "How offers work here", title: "The rules you inherited" },
  { role: "artist", complete: false, eyebrow: "Set up", title: "Before your first offer" },
];

it("railHeaderCopy covers every role x complete branch", () => {
  for (const row of RAIL_ROWS) {
    const r = railHeaderCopy(row.role, row.complete);
    expect(r.eyebrow).toBe(row.eyebrow);
    expect(r.title).toBe(row.title);
    expect(`${r.eyebrow}${r.title}${r.body}`).not.toMatch(/[—–]/);
  }
});

it("railHeaderCopy never points the artist at Settings (they have no access)", () => {
  expect(railHeaderCopy("artist", true).body).not.toMatch(/Settings/);
  // Admins keep the Settings pointer; producers and artists do not.
  expect(railHeaderCopy("admin", true).body).toMatch(/Settings/);
  expect(railHeaderCopy("producer", true).body).not.toMatch(/Settings/);
});

const COLLAPSED_ROWS: { role: DashboardRole; complete: boolean; remaining: number; label: string; cta: string; hint?: string }[] = [
  { role: "admin", complete: true, remaining: 0, label: "Set up · done", cta: "How this org works" },
  { role: "admin", complete: false, remaining: 1, label: "Set up in progress", cta: "Resume", hint: "1 step left" },
  { role: "admin", complete: false, remaining: 3, label: "Set up in progress", cta: "Resume", hint: "3 steps left" },
  { role: "producer", complete: true, remaining: 0, label: "Set up · done", cta: "How this org works" },
  { role: "producer", complete: false, remaining: 1, label: "Org setup in progress", cta: "See what is outstanding", hint: "1 step left" },
  { role: "producer", complete: false, remaining: 2, label: "Org setup in progress", cta: "See what is outstanding", hint: "2 steps left" },
  { role: "artist", complete: true, remaining: 0, label: "Set up · done", cta: "How offers work here" },
  { role: "artist", complete: false, remaining: 1, label: "Set up in progress", cta: "Resume", hint: "1 step left" },
  { role: "artist", complete: false, remaining: 2, label: "Set up in progress", cta: "Resume", hint: "2 steps left" },
];

it("collapsedCopy covers every role x complete branch, with pluralization", () => {
  for (const row of COLLAPSED_ROWS) {
    const c = collapsedCopy(row.role, row.complete, row.remaining);
    expect(c.label).toBe(row.label);
    expect(c.cta).toBe(row.cta);
    if (row.hint) expect(c.hint).toBe(row.hint);
    expect(`${c.label}${c.hint}${c.cta}`).not.toMatch(/[—–]/);
  }
});
