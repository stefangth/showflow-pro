import { describe, it, expect } from "vitest";
import { parseLines, serializeLines, parseCasts, serializeCasts } from "./templateText";

describe("parseLines / serializeLines", () => {
  it("splits and trims, dropping blanks", () => {
    expect(parseLines("Vocals\n  Dance \n\nAerial")).toEqual(["Vocals", "Dance", "Aerial"]);
  });
  it("round-trips", () => {
    expect(serializeLines(["A", "B"])).toBe("A\nB");
  });
});

describe("parseCasts / serializeCasts", () => {
  it("parses 'Name :: Description' lines (description optional)", () => {
    expect(parseCasts("Main Cast :: Default\nSwing")).toEqual([
      { name: "Main Cast", description: "Default" },
      { name: "Swing", description: null },
    ]);
  });
  it("round-trips", () => {
    const casts = [{ name: "Main Cast", description: "Default" }, { name: "Swing", description: null }];
    expect(parseCasts(serializeCasts(casts))).toEqual(casts);
  });
});
