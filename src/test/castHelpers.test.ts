import { describe, expect, it } from "vitest";
import { asQueryResult, asSupabase, partialMock } from "./castHelpers";

describe("castHelpers", () => {
  it("asQueryResult passes fields through", () => {
    const r = asQueryResult<{ id: string }>({ data: { id: "a1" }, isLoading: false });
    expect(r.data).toEqual({ id: "a1" });
  });
  it("partialMock keeps the given keys", () => {
    const m = partialMock<{ a: number; b: number }>({ a: 1 });
    expect(m.a).toBe(1);
  });
  it("asSupabase returns the same object", () => {
    const fake = { from: () => ({}) };
    expect(asSupabase(fake)).toBe(fake);
  });
});
