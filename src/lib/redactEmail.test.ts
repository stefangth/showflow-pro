import { describe, it, expect } from "vitest";
import { redactEmail } from "@/lib/redactEmail";
describe("redactEmail", () => {
  it("masks the local part", () => {
    expect(redactEmail("bthomas@gmail.com")).toBe("b***@gmail.com");
    expect(redactEmail("a@b.co")).toBe("a***@b.co");
    expect(redactEmail("weird")).toBe("***");
  });
});
