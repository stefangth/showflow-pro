import { it, expect } from "vitest";
import { MODULE_ONBOARDING, bookingOnboarding, hireOrderOnboarding } from "./moduleOnboarding";
import { FEATURE_KEYS } from "@/lib/entitlements";
import { computeBookingSetupStatus } from "@/lib/bookings/setupStatus";
import { computeSetupStatus } from "@/lib/hireOrders/setupStatus";
import { ROUTES } from "@/config/app.config";

it("has one contribution per FeatureKey (no orphans, no gaps)", () => {
  expect(Object.keys(MODULE_ONBOARDING).sort()).toEqual([...FEATURE_KEYS].sort());
});

it("booking step keys cover exactly the engine's step keys", () => {
  const engineKeys = computeBookingSetupStatus({ flowChosen: false, shows: [], timingChosen: false, coverage: null })
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

it("every CTA route is a real ROUTES value and no copy uses em/en dashes", () => {
  const all = [bookingOnboarding, hireOrderOnboarding].flatMap((d) => Object.values(d.steps));
  for (const s of all) {
    expect(Object.values(ROUTES)).toContain(s.ctaRoute);
    expect(`${s.title}${s.todoHint}${s.doneHint}${s.ctaLabel}`).not.toMatch(/[—–]/);
  }
});
