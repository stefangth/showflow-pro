import { describe, expect, it } from "vitest";
import { resolveFields } from "./resolveFields";

describe("resolveFields", () => {
  it("applies precedence manual > sheet > showflow > default with source tags", () => {
    const out = resolveFields({
      defaults: { currency: "EUR", fee: "1000" },
      showflow: { artist_name: "Mara", venue: "Colosseum", fee: "2000" },
      sheet: { venue: "Palladium", fee: "3000" },
      manual: { fee: "4500" },
    });
    expect(out.artist_name).toEqual({ value: "Mara", source: "showflow" });
    expect(out.venue).toEqual({ value: "Palladium", source: "sheet" });
    expect(out.fee).toEqual({ value: "4500", source: "manual" });
    expect(out.currency).toEqual({ value: "EUR", source: "default" });
  });

  it("skips undefined and empty-string layer values", () => {
    const out = resolveFields({ showflow: { venue: "X" }, sheet: { venue: "" }, manual: { venue: undefined } });
    expect(out.venue).toEqual({ value: "X", source: "showflow" });
  });
});
