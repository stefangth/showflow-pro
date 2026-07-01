import { describe, it, expect } from "vitest";
import { guessMapping } from "./guessMapping";

describe("guessMapping", () => {
  it("maps common header variants to fields", () => {
    expect(guessMapping(["Full Name", "E-Mail", "Mobile", "Notes"])).toEqual({
      name: "Full Name",
      email: "E-Mail",
      phone: "Mobile",
      bio: "Notes",
    });
  });

  it("returns {} when nothing matches", () => {
    expect(guessMapping(["col1", "col2"])).toEqual({});
  });

  it("claims the first matching header and does not overwrite", () => {
    const m = guessMapping(["Name", "Artist Name"]);
    expect(m.name).toBe("Name");
  });

  it("does not map the same source column to two fields", () => {
    const m = guessMapping(["email"]);
    expect(m.email).toBe("email");
    expect(m.name).toBeUndefined();
  });

  it("prefers an exact 'Email' over a loose 'Mailing Address' match", () => {
    // "Mailing Address" comes first in column order and matches the loose /mail/,
    // but the exact "Email" must win the email slot.
    expect(guessMapping(["Mailing Address", "Email"]).email).toBe("Email");
  });

  it("does not let a loose /name/ steal 'Company Name' when a real Name exists", () => {
    const m = guessMapping(["Company Name", "Name"]);
    expect(m.name).toBe("Name");
  });
});
