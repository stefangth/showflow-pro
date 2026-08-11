import { it, expect } from "vitest";
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

it("admin, bf on, ho off, offers, no dates → 8 steps, 3 filled, stage 01 hot", () => {
  const r = composeStageChain(base);
  expect(r.progressLabel).toBe("Set up · 3 of 8");
  expect(r.stages[0].variant).toBe("hot");
  expect(r.stages[0].name).toBe("Dates");
  expect(r.offFooters).toContain("Hire orders is off for this org. Ask your account manager to switch it on.");
});

it("no modules → floor state, hasChain false", () => {
  const r = composeStageChain({ ...base, bookingEntitled:false, hireEntitled:false });
  expect(r.nothingOn).toBe(true);
  expect(r.hasChain).toBe(false);
  expect(r.headline).toBe("No modules are switched on for Halle Kollektiv");
});

it("no em-dashes anywhere in composed copy", () => {
  const r = composeStageChain({ ...base, imported:true, metrics:{ ...base.metrics, datesIn:34, readyToOffer:4 } });
  expect(JSON.stringify(r)).not.toMatch(/[—–]/);
});

it("producer without edit caps → offers stage demotes (not hot)", () => {
  const r = composeStageChain({ ...base, role:"producer", canEditBooking:false, canEditHire:false, imported:true,
    metrics:{ ...base.metrics, datesIn:34, readyToOffer:4 } });
  expect(r.stages.find(s => s.key === "offers")!.variant).not.toBe("hot");
});

it("direct flow → 'Book directly' + 'Confirmed on the spot' with confirmed metric", () => {
  const r = composeStageChain({ ...base, offers:false, imported:true, metrics:{ ...base.metrics, bookableDates:12, confirmed:12 } });
  expect(r.stages.find(s=>s.key==="offers")!.name).toBe("Book directly");
  expect(r.stages.find(s=>s.key==="confirm")!.name).toBe("Confirmed on the spot");
});

it("artist → exactly one step (blockDates)", () => {
  const r = composeStageChain({ ...base, role:"artist" });
  expect(r.stages.flatMap(s => s.steps.map(st => st.key))).toEqual(["blockDates"]);
});

it("bf off + ho on → hire stage is the hot manual-order card + booking off-footer", () => {
  const r = composeStageChain({ ...base, bookingEntitled:false, hireEntitled:true });
  const hire = r.stages.find(s=>s.key==="hire")!;
  expect(hire.ctaLabel).toBe("New order");
  expect(r.offFooters).toContain("Booking flow is off for this org. Ask your account manager to switch it on.");
});

it("copy uses configured digest hour, not 09:00", () => {
  const r = composeStageChain({ ...base, role:"artist", imported:true, offers:true,
    timing:{ digestHourBerlin: 7, responseWindowHours: 24 }, metrics:{ ...base.metrics, arriving:2, blockedDates:3 } });
  expect(JSON.stringify(r)).toContain("07:00");
  expect(JSON.stringify(r)).not.toContain("48 hours");
});

it("headline/body prose numbers follow input.metrics, not the demo literals", () => {
  const r = composeStageChain({ ...base, imported:true, metrics:{ ...base.metrics, datesIn:12, readyToOffer:4 } });
  const json = JSON.stringify(r);
  expect(json).toContain("12");
  expect(json).not.toContain("34");
});

it("artist with artistBlockDatesDone → Availability stage is done, not the hot act card", () => {
  const r = composeStageChain({ ...base, role:"artist", artistBlockDatesDone:true });
  const availability = r.stages.find(s => s.key === "availability")!;
  expect(availability.variant).not.toBe("hot");
  expect(availability.running).toBe(true);
});
