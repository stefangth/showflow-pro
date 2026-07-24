import { describe, it, expect } from "vitest";
import { copyDurationToAll } from "./durationFill";

describe("copyDurationToAll", () => {
  it("copies the source date's duration into every other date, leaving sessions untouched", () => {
    const schedules = {
      d1: { durationMin: "90", sessions: [{ label: "", time: "19:00" }] },
      d2: { durationMin: "", sessions: [{ label: "", time: "20:00" }] },
      d3: { durationMin: "60", sessions: [] as { label: string; time: string }[] },
    };
    const result = copyDurationToAll(schedules, "d1");
    expect(result.d1.durationMin).toBe("90");
    expect(result.d2.durationMin).toBe("90");
    expect(result.d3.durationMin).toBe("90");
    // Sessions are never touched by a duration copy.
    expect(result.d2.sessions).toEqual([{ label: "", time: "20:00" }]);
    expect(result.d3.sessions).toEqual([]);
  });

  it("returns the input unchanged when the source id is missing", () => {
    const schedules = { d1: { durationMin: "90", sessions: [] } };
    expect(copyDurationToAll(schedules, "nope")).toBe(schedules);
  });
});
