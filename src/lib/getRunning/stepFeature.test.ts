import { describe, it, expect } from "vitest";
import { STEP_FEATURE, stepFeatureLink } from "./stepFeature";
import { ROUTES } from "@/config/app.config";

describe("stepFeature", () => {
  it("covers all 16 step keys", () => {
    expect(Object.keys(STEP_FEATURE)).toHaveLength(16);
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
});
