import { describe, it, expect } from "vitest";
import { canArtistSign } from "./signing";

describe("canArtistSign", () => {
  const ok = { canManage: false, status: "issued", mode: "electronic" as const, isLinkedArtist: true };
  it("allows the linked artist on an issued electronic order", () => {
    expect(canArtistSign(ok)).toBe(true);
  });
  it("blocks producers/admins", () => {
    expect(canArtistSign({ ...ok, canManage: true })).toBe(false);
  });
  it("blocks non-issued statuses", () => {
    expect(canArtistSign({ ...ok, status: "countersigned" })).toBe(false);
    expect(canArtistSign({ ...ok, status: "draft" })).toBe(false);
  });
  it("blocks manual mode", () => {
    expect(canArtistSign({ ...ok, mode: "manual" })).toBe(false);
  });
  it("blocks a non-linked artist", () => {
    expect(canArtistSign({ ...ok, isLinkedArtist: false })).toBe(false);
  });
});
