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
});
