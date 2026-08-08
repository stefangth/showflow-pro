import { describe, it, expect } from "vitest";
import { pagerPosition } from "@/lib/bookingCockpit";

describe("pagerPosition", () => {
  const ids = ["a", "b", "c"];

  it("returns null when there is no active id", () => {
    expect(pagerPosition(ids, null)).toBeNull();
  });

  it("returns null when the active id is not in the list (filtered out)", () => {
    expect(pagerPosition(ids, "z")).toBeNull();
  });

  it("middle item exposes both neighbours", () => {
    expect(pagerPosition(ids, "b")).toEqual({ index: 2, total: 3, prevId: "a", nextId: "c" });
  });

  it("first item has no prev", () => {
    expect(pagerPosition(ids, "a")).toEqual({ index: 1, total: 3, prevId: null, nextId: "b" });
  });

  it("last item has no next", () => {
    expect(pagerPosition(ids, "c")).toEqual({ index: 3, total: 3, prevId: "b", nextId: null });
  });

  it("single-item list has no neighbours", () => {
    expect(pagerPosition(["only"], "only")).toEqual({ index: 1, total: 1, prevId: null, nextId: null });
  });
});
