import { it, expect } from "vitest";
import { ARTIST_ONBOARDING, ARTIST_STEP_KEYS, MODULE_ONBOARDING, bookingOnboarding, hireOrderOnboarding } from "./moduleOnboarding";
import { FEATURE_KEYS } from "@/lib/entitlements";
import { computeBookingSetupStatus } from "@/lib/bookings/setupStatus";
import { computeSetupStatus } from "@/lib/hireOrders/setupStatus";
import { ROUTES } from "@/config/app.config";

it("has one contribution per FeatureKey (no orphans, no gaps)", () => {
  expect(Object.keys(MODULE_ONBOARDING).sort()).toEqual([...FEATURE_KEYS].sort());
});

it("booking step keys cover exactly the engine's step keys", () => {
  const engineKeys = computeBookingSetupStatus({ flowChosen: false, hasAnyShows: false, shows: [], timingChosen: false, coverage: null })
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
