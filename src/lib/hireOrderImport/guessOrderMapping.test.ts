import { describe, it, expect } from "vitest";
import { guessOrderMapping } from "./guessOrderMapping";

describe("guessOrderMapping", () => {
  it("maps German headers to hire-order fields", () => {
    expect(
      guessOrderMapping(["Künstler", "E-Mail", "Datum", "Venue", "Stadt", "Gage", "Dauer"])
    ).toEqual({
      artist_name: "Künstler",
      recipient_email: "E-Mail",
      date: "Datum",
      venue: "Venue",
      city: "Stadt",
      fee: "Gage",
      duration_min: "Dauer",
    });
  });

  it("maps English headers to hire-order fields, including role/cast/currency/notes", () => {
    const headers = [
      "Artist Name",
      "Email",
      "Date",
      "Venue",
      "City",
      "Fee",
      "Duration",
      "Currency",
      "Role",
      "Cast",
      "Notes",
    ];
    expect(guessOrderMapping(headers)).toEqual({
      artist_name: "Artist Name",
      recipient_email: "Email",
      date: "Date",
      venue: "Venue",
      city: "City",
      fee: "Fee",
      duration_min: "Duration",
      currency: "Currency",
      role: "Role",
      cast: "Cast",
      notes: "Notes",
    });
  });

  it("returns {} when nothing matches", () => {
    expect(guessOrderMapping(["col1", "col2"])).toEqual({});
  });

  it("does not map the same header to two fields", () => {
    const m = guessOrderMapping(["Gage"]);
    expect(m.fee).toBe("Gage");
    expect(Object.values(m)).toEqual(["Gage"]);
  });

  it("prefers an exact 'Gage' over a loose substring match elsewhere", () => {
    // "Konzertgage" only loosely matches /gage/ - the exact "Gage" header must win
    // the fee slot in the strong pass, leaving "Konzertgage" unclaimed.
    const m = guessOrderMapping(["Konzertgage", "Gage"]);
    expect(m.fee).toBe("Gage");
  });

  it("does not let 'honorar' (fee) steal the currency column via weak substring overlap", () => {
    const m = guessOrderMapping(["Honorar", "Währung"]);
    expect(m.fee).toBe("Honorar");
    expect(m.currency).toBe("Währung");
  });
});
