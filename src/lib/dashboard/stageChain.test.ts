import { it, expect } from "vitest";
import i18n from "@/i18n";
import { composeStageChain } from "./stageChain";
import type { StageChainInput } from "./stageChain.types";

const base: StageChainInput = {
  role: "admin", orgName: "Halle Kollektiv",
  bookingEntitled: true, hireEntitled: false, offers: true, imported: false,
  canEditBooking: true, canEditHire: true,
  bookingSteps: { shows:{done:false}, slots:{done:false}, flow:{done:true}, people:{done:true},
                  ladder:{done:false}, eligibility:{done:false}, timing:{done:true} },
  hireSteps: { letterhead:{done:false}, terms:{done:false}, countersign:{done:false} },
  artistBlockDatesDone: false,
  metrics: { datesIn:0, readyToOffer:0, bookableDates:0, confirmed:0, hireDrafts:0,
             eligibleDates:0, blockedDates:0, arriving:0, toSign:0 },
  provenance: { byYou:true, actorName:null, changedAt:null },
  timing: { digestHourBerlin: 19, responseWindowHours: 48 },
};

// composeStageChain now takes a namespace-bound translator; bind the English catalog so
// these assertions keep pinning the exact shipped English copy (German is covered by the gates).
const t = i18n.getFixedT("en", "onboarding");
const compose = (input: StageChainInput) => composeStageChain(input, t);

it("admin, bf on, ho off, offers, no dates → 8 steps, 3 filled, stage 01 hot", () => {
  const r = compose(base);
  expect(r.progressLabel).toBe("Set up · 3 of 8");
  expect(r.stages[0].variant).toBe("hot");
  expect(r.stages[0].name).toBe("Dates");
  expect(r.offFooters).toContain("Hire orders is off for this org. Ask your account manager to switch it on.");
});

it("no modules → floor state, hasChain false", () => {
  const r = compose({ ...base, bookingEntitled:false, hireEntitled:false });
  expect(r.nothingOn).toBe(true);
  expect(r.hasChain).toBe(false);
  expect(r.headline).toBe("No modules are switched on for Halle Kollektiv");
});

it("no em-dashes anywhere in composed copy", () => {
  const r = compose({ ...base, imported:true, metrics:{ ...base.metrics, datesIn:34, readyToOffer:4 } });
  expect(JSON.stringify(r)).not.toMatch(/[—–]/);
});

it("producer without edit caps → offers stage demotes (not hot)", () => {
  const r = compose({ ...base, role:"producer", canEditBooking:false, canEditHire:false, imported:true,
    metrics:{ ...base.metrics, datesIn:34, readyToOffer:4 } });
  const offersStage = r.stages.find(s => s.key === "offers")!;
  expect(offersStage.variant).not.toBe("hot");
  // No provenance actor known → falls back to a generic admin, never the demo name.
  expect(offersStage.needs).toBe("Waits on your admin");
  expect(JSON.stringify(r)).not.toContain("Mara Kessler");
});

it("producer without edit caps + known provenance actor → demoted stage names the real actor, never Mara Kessler", () => {
  const r = compose({ ...base, role:"producer", canEditBooking:false, canEditHire:false, imported:true,
    provenance: { byYou:false, actorName:"Jamie Cole", changedAt:null },
    metrics:{ ...base.metrics, datesIn:34, readyToOffer:4 } });
  const offersStage = r.stages.find(s => s.key === "offers")!;
  expect(offersStage.needs).toBe("Waits on Jamie Cole");
  expect(JSON.stringify(r)).not.toContain("Mara Kessler");
});

it("artist composition never contains the demo cast name Ensemble A", () => {
  const r = compose({ ...base, role:"artist" });
  expect(JSON.stringify(r)).not.toContain("Ensemble A");
});

it("direct flow → 'Book directly' + 'Confirmed on the spot' with confirmed metric", () => {
  const r = compose({ ...base, offers:false, imported:true, metrics:{ ...base.metrics, bookableDates:12, confirmed:12 } });
  expect(r.stages.find(s=>s.key==="offers")!.name).toBe("Book directly");
  expect(r.stages.find(s=>s.key==="confirm")!.name).toBe("Confirmed on the spot");
});

it("artist → exactly one step (blockDates)", () => {
  const r = compose({ ...base, role:"artist" });
  expect(r.stages.flatMap(s => s.steps.map(st => st.key))).toEqual(["blockDates"]);
});

it("bf off + ho on → hire stage is the hot manual-order card + booking off-footer", () => {
  const r = compose({ ...base, bookingEntitled:false, hireEntitled:true });
  const hire = r.stages.find(s=>s.key==="hire")!;
  expect(hire.ctaLabel).toBe("New order");
  expect(r.offFooters).toContain("Booking engine is not enabled for this org. Ask your account manager to switch it on.");
  expect(r.modules).toContainEqual({ label: "Booking engine", on: false });
});

it("copy uses configured digest hour, not 09:00", () => {
  const r = compose({ ...base, role:"artist", imported:true, offers:true,
    timing:{ digestHourBerlin: 7, responseWindowHours: 24 }, metrics:{ ...base.metrics, arriving:2, blockedDates:3 } });
  expect(JSON.stringify(r)).toContain("07:00");
  expect(JSON.stringify(r)).not.toContain("48 hours");
});

it("headline/body prose numbers follow input.metrics, not the demo literals", () => {
  const r = compose({ ...base, imported:true, metrics:{ ...base.metrics, datesIn:12, readyToOffer:4 } });
  const json = JSON.stringify(r);
  expect(json).toContain("12");
  expect(json).not.toContain("34");
});

it("artist with artistBlockDatesDone → Availability stage is done, not the hot act card", () => {
  const r = compose({ ...base, role:"artist", artistBlockDatesDone:true });
  const availability = r.stages.find(s => s.key === "availability")!;
  expect(availability.variant).not.toBe("hot");
  expect(availability.running).toBe(true);
});

it("artist with no docked steps (bf off, ho on) never claims a step is theirs", () => {
  const r = compose({ ...base, role: "artist", bookingEntitled: false, hireEntitled: true });
  expect(r.hasSteps).toBe(false);
  expect(r.headline).not.toContain("One step is yours");
  expect(r.body).not.toContain("One step is yours");
  expect(JSON.stringify(r)).not.toContain("One step is yours");
});

// rulesByLine: exercise all four provenance branches directly, including fmtDate.
it("rulesBy: byYou wins regardless of actor/date", () => {
  const r = compose({
    ...base,
    provenance: { byYou: true, actorName: "Jamie Cole", changedAt: "2026-07-20T09:00:00Z" },
  });
  expect(r.rulesBy).toBe("Rules set by you · Settings · Booking engine");
});

it("rulesBy: actorName + changedAt formats the date (exercises fmtDate)", () => {
  const r = compose({
    ...base,
    provenance: { byYou: false, actorName: "Jamie Cole", changedAt: "2026-07-20T09:00:00Z" },
  });
  expect(r.rulesBy).toBe("Rules set by Jamie Cole · 20 Jul");
});

it("rulesBy: actorName only, no changedAt, omits the date", () => {
  const r = compose({
    ...base,
    provenance: { byYou: false, actorName: "Jamie Cole", changedAt: null },
  });
  expect(r.rulesBy).toBe("Rules set by Jamie Cole");
});

it("rulesBy: neither byYou nor a known actor falls back to the generic line", () => {
  const r = compose({
    ...base,
    provenance: { byYou: false, actorName: null, changedAt: null },
  });
  expect(r.rulesBy).toBe("Rules set in Settings · Booking engine");
});

// The non-artist imported headline is recomposed from two catalog keys joined with a space
// (orgImportedLanded + the offers/bookable clause), the one place this refactor changed a
// single interpolated template into a concatenation. Pin both branches byte-for-byte so a
// stray/lost separator or a mis-wired clause key cannot ship silently.
it("pins the org imported headline (offers): landed clause + digest clause", () => {
  const r = compose({ ...base, imported: true, metrics: { ...base.metrics, datesIn: 34, readyToOffer: 4 } });
  expect(r.headline).toBe("34 dates landed. 4 of them can be offered in the next digest.");
});

it("pins the org imported headline (direct): landed clause + bookable clause", () => {
  const r = compose({ ...base, offers: false, imported: true, metrics: { ...base.metrics, datesIn: 34, bookableDates: 12 } });
  expect(r.headline).toBe("34 dates landed. 12 are bookable now.");
});

// Exercise the `_one` singular branches of the pluralized keys (every other assertion uses a
// plural count), so a mis-authored singular ("1 dates landed", a wrong is/are) is caught.
it("uses singular forms at count 1 (landed, bookable clause, dates-in-catalog line)", () => {
  const r = compose({ ...base, offers: false, imported: true, metrics: { ...base.metrics, datesIn: 1, bookableDates: 1 } });
  expect(r.headline).toBe("1 date landed. 1 is bookable now.");
  const dates = r.stages.find((s) => s.key === "dates")!;
  expect(dates.line).toBe("1 date is in your catalog.");
});
