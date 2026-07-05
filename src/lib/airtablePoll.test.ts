import { describe, it, expect } from "vitest";
import {
  MIN_POLL_INTERVAL_MINUTES, POLL_INTERVAL_PRESET_MINUTES, POLL_INTERVAL_PRESETS,
  clampInterval, formatInterval, nextSyncAt,
} from "./airtablePoll";

describe("airtablePoll", () => {
  it("exposes the approved presets", () => {
    expect(POLL_INTERVAL_PRESET_MINUTES).toEqual([5, 15, 30, 60, 120, 240, 480]);
    expect(POLL_INTERVAL_PRESETS[0]).toEqual({ value: 5, label: "5 minutes" });
    expect(POLL_INTERVAL_PRESETS.find((p) => p.value === 60)?.label).toBe("1 hour");
    expect(POLL_INTERVAL_PRESETS.find((p) => p.value === 120)?.label).toBe("2 hours");
  });

  it("formats minutes and hours", () => {
    expect(formatInterval(5)).toBe("5 minutes");
    expect(formatInterval(30)).toBe("30 minutes");
    expect(formatInterval(60)).toBe("1 hour");
    expect(formatInterval(480)).toBe("8 hours");
  });

  it("clamps below-floor / invalid values to the minimum", () => {
    expect(clampInterval(1)).toBe(MIN_POLL_INTERVAL_MINUTES);
    expect(clampInterval(0)).toBe(5);
    expect(clampInterval(-10)).toBe(5);
    expect(clampInterval("nope")).toBe(5);
    expect(clampInterval(undefined)).toBe(5);
    expect(clampInterval(30)).toBe(30);
  });

  it("computes the next sync time (null when never synced)", () => {
    expect(nextSyncAt(null, 30)).toBeNull();
    expect(nextSyncAt(undefined, 30)).toBeNull();
    const last = "2026-07-05T10:00:00.000Z";
    expect(nextSyncAt(last, 30)?.toISOString()).toBe("2026-07-05T10:30:00.000Z");
    // interval below floor is clamped to 5 min
    expect(nextSyncAt(last, 1)?.toISOString()).toBe("2026-07-05T10:05:00.000Z");
  });
});
