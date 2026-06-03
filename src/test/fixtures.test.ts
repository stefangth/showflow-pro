import { describe, it, expect } from "vitest";
import { anArtist, aShowDate, aBooking } from "./fixtures";

describe("fixtures", () => {
  it("anArtist returns a valid default row", () => {
    const a = anArtist();
    expect(a.id).toBeTruthy();
    expect(a.name).toBeTruthy();
    expect(a.status).toBe("active");
  });

  it("applies overrides", () => {
    expect(anArtist({ name: "Jo", status: "inactive" })).toMatchObject({ name: "Jo", status: "inactive" });
  });

  it("aShowDate and aBooking return overridable rows", () => {
    expect(aShowDate({ city_id: "c1" }).city_id).toBe("c1");
    expect(aBooking({ status: "confirmed" }).status).toBe("confirmed");
  });

  it("gives distinct ids across calls", () => {
    expect(anArtist().id).not.toBe(anArtist().id);
  });
});
