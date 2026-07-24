import { describe, expect, it } from "vitest";
import { resolveEngagementSessions } from "./engagementDates";

describe("resolveEngagementSessions", () => {
  const synced = { sessions: ["19:00", "21:00"], duration_min: 90 };
  it("uses synced values when there is no override", () => {
    expect(resolveEngagementSessions(synced, undefined)).toEqual(synced);
  });
  it("lets an override replace sessions and/or duration", () => {
    expect(resolveEngagementSessions(synced, { sessions: ["20:00"] })).toEqual({ sessions: ["20:00"], duration_min: 90 });
    expect(resolveEngagementSessions(synced, { duration_min: 120 })).toEqual({ sessions: ["19:00", "21:00"], duration_min: 120 });
  });
  it("treats an empty override sessions array as an explicit clear", () => {
    expect(resolveEngagementSessions(synced, { sessions: [] })).toEqual({ sessions: [], duration_min: 90 });
  });
});
