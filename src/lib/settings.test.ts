import { describe, it, expect } from "vitest";
import { dedupeProgramPairs, computeSchedulingWarnings } from "./settings";

describe("dedupeProgramPairs", () => {
  it("dedupes by (program, sub_program) and drops null pairs", () => {
    const out = dedupeProgramPairs([
      { program: "A", sub_program: "x" },
      { program: "A", sub_program: "x" },
      { program: "A", sub_program: "y" },
      { program: null, sub_program: "z" },
      { program: "B", sub_program: null },
    ]);
    expect(out).toEqual([
      { program: "A", sub_program: "x" },
      { program: "A", sub_program: "y" },
    ]);
  });
});

describe("computeSchedulingWarnings", () => {
  const pairs = [
    { program: "A", sub_program: "x" },
    { program: "A", sub_program: "y" },
  ];
  it("counts pairs with no slot defaults configured", () => {
    const defaults = { A: { x: { main_cast: 2, understudies: 1 } } };
    const w = computeSchedulingWarnings(pairs, defaults);
    expect(w.schedulingWarnings).toBe(1); // A/y is unconfigured
    expect(w.hasAnyWarning).toBe(true);
  });
  it("reports zero when all pairs are configured", () => {
    const defaults = {
      A: { x: { main_cast: 2, understudies: 1 }, y: { main_cast: 1, understudies: 0 } },
    };
    const w = computeSchedulingWarnings(pairs, defaults);
    expect(w.schedulingWarnings).toBe(0);
    expect(w.hasAnyWarning).toBe(false);
  });
  it("handles null inputs", () => {
    expect(computeSchedulingWarnings(null, null).schedulingWarnings).toBe(0);
  });
});
