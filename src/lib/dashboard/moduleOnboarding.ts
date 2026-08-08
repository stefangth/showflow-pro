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
  steps: {
    flow: { title: STEP_TITLES.flow, todoHint: "Offers, or straight to booked. Everything downstream reads this.", doneHint: "Chosen. Change it any time in Settings.", ctaLabel: "Choose flow", ctaRoute: ROUTES.SETTINGS, ctaCapability: "edit_booking_settings" },
    slots: { title: STEP_TITLES.slots, todoHint: "A show with no slot count never reads as full.", doneHint: "Set on every show.", ctaLabel: "Set slots", ctaRoute: ROUTES.PRODUCTIONS, ctaCapability: "edit_booking_settings" },
    ladder: { title: STEP_TITLES.ladder, todoHint: "The order offers go out in, per city.", doneHint: "Every scheduled city has a tier-1 cast.", ctaLabel: "Open bookings", ctaRoute: ROUTES.BOOKINGS, ctaCapability: "edit_booking_settings" },
    eligibility: { title: STEP_TITLES.eligibility, todoHint: "Which casts can be offered which show in which city.", doneHint: "Every scheduled show and city has a cast.", ctaLabel: "Open bookings", ctaRoute: ROUTES.BOOKINGS, ctaCapability: "edit_booking_settings" },
    timing: { title: STEP_TITLES.timing, todoHint: "How long artists get, and when mail goes out.", doneHint: "Window and digest hours set.", ctaLabel: "Set timing", ctaRoute: ROUTES.SETTINGS, ctaCapability: "edit_booking_settings" },
  },
  rules: (role, ctx) => ([
    { title: ctx.artistAcceptance ? "Offers with tiers" : "Direct booking", hint: ctx.artistAcceptance ? "Tier 1 goes out first. Tier 2 opens later if unfilled." : "Producers book straight from the eligibility list." },
    { title: "Daily offer digest", hint: "Offers batch overnight rather than mailing instantly." },
    { title: "Response window", hint: "After it passes the offer expires and the tier reopens." },
    { title: role === "producer" ? "Confirm is on you" : "Confirm is manual", hint: "An accepted offer waits for a producer. That is the queue on this page." },
  ]),
  offFooter: "Booking flow is off for this org. Ask your account manager to switch it on.",
};

export const hireOrderOnboarding: ModuleOnboardingDef<SetupStepKey> = {
  key: "hire_orders",
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

// ---- Artist personal readiness (B.4). Artists have no org-engine setup, so they
// do NOT go through MODULE_ONBOARDING (whose booking_flow steps are keyed by the
// engine keys). They get their own step metadata and rules, booking_flow only.
// Only genuinely actionable steps are listed: account linkage is a precondition for
// the dashboard rendering at all (ArtistDashboard early-returns without an artist),
// so it is never an open todo and is excluded from the count.
export const ARTIST_STEP_KEYS = ["blockDates", "notifications"] as const;
export type ArtistStepKey = typeof ARTIST_STEP_KEYS[number];

export const ARTIST_ONBOARDING: {
  steps: Record<ArtistStepKey, OnboardingStepMeta>;
  rules: (ctx: OnboardingCtx) => InheritedRule[];
} = {
  steps: {
    blockDates: { title: "Block what you cannot play", todoHint: "Offers skip blocked dates before they are sent, so you only get asked about dates that work.", doneHint: "Your calendar is up to date.", ctaLabel: "Open availability", ctaRoute: ROUTES.AVAILABILITY },
    notifications: { title: "Notifications", todoHint: "Email is on. Add a phone number for same-day offers.", doneHint: "You will hear about new offers.", ctaLabel: "Add number", ctaRoute: ROUTES.PROFILE },
  },
  rules: (ctx) => ([
    { title: "Eligibility comes from your cast", hint: "Only your cast's dates can ever be offered to you." },
    { title: ctx.artistAcceptance ? "Offers arrive in a daily digest" : "You are booked directly", hint: ctx.artistAcceptance ? "One digest a day, not a mail per date." : "There is no offer step; you are added straight to the date." },
    { title: "You have a response window", hint: "After it passes the offer expires and goes to the next tier." },
  ]),
};
