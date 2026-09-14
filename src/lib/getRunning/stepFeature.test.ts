import { describe, it, expect } from "vitest";
import { STEP_FEATURE, stepFeatureLink, stepsForRoute, PAPERWORK_STEP_KEYS } from "./stepFeature";
import { ROUTES } from "@/config/app.config";

describe("stepFeature", () => {
  it("covers all 17 step keys", () => {
    expect(Object.keys(STEP_FEATURE)).toHaveLength(17);
  });

  it("routes coverage to the casts-coverage settings tab", () => {
    expect(stepFeatureLink("coverage")).toBe(`${ROUTES.SETTINGS}?tab=casts-coverage`);
  });

  it("routes productions to the productions page (no tab)", () => {
    expect(stepFeatureLink("productions")).toBe(ROUTES.PRODUCTIONS);
  });

  it("routes contracts steps to the hire-orders tab", () => {
    for (const k of ["letterhead", "fee", "terms", "document", "countersign"] as const) {
      expect(stepFeatureLink(k)).toBe(`${ROUTES.SETTINGS}?tab=hire-orders`);
    }
  });

  it("resolves /dates to its four source steps in order", () => {
    expect(stepsForRoute(ROUTES.BOOKINGS)).toEqual(["source", "connect", "map", "cities"]);
  });
  it("resolves /productions to the productions step", () => {
    expect(stepsForRoute(ROUTES.PRODUCTIONS)).toEqual(["productions"]);
  });
  it("resolves /artists to the artists step", () => {
    expect(stepsForRoute(ROUTES.ARTISTS)).toEqual(["artists"]);
  });
  it("resolves /settings?tab=hire-orders to the five paperwork steps in order", () => {
    expect(stepsForRoute(ROUTES.SETTINGS, "hire-orders")).toEqual([
      "letterhead",
      "fee",
      "terms",
      "document",
      "countersign",
    ]);
  });
  it("returns an empty array for a route with no matching step", () => {
    expect(stepsForRoute("/nonexistent")).toEqual([]);
  });
  it("exposes the paperwork steps for the contracts page", () => {
    expect(PAPERWORK_STEP_KEYS).toEqual(["letterhead", "fee", "terms", "document", "countersign"]);
  });
});
