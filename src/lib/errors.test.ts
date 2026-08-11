import { describe, it, expect } from "vitest";
import { toErrorMessage, friendlyError } from "./errors";

describe("toErrorMessage", () => {
  it("reads Error.message", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });
  it("reads .message off a plain PostgREST-shaped object (the supabase-js error shape)", () => {
    expect(toErrorMessage({ code: "P0001", message: "org must keep at least one admin" }))
      .toBe("org must keep at least one admin");
  });
  it("falls back for a value with no usable message", () => {
    expect(toErrorMessage(null)).toBe("Something went wrong");
    expect(toErrorMessage({})).toBe("Something went wrong");
    expect(toErrorMessage({ message: "" }, "Nope")).toBe("Nope");
  });
});

describe("friendlyError", () => {
  it("maps the last-admin guards to guidance", () => {
    expect(friendlyError({ message: "org must keep at least one admin" }))
      .toMatch(/at least one admin/i);
    expect(friendlyError({ message: "Cannot remove the last admin of the organization" }))
      .toMatch(/admin first/i);
  });
  it("passes other messages through unchanged", () => {
    expect(friendlyError({ message: "Forbidden" })).toBe("Forbidden");
  });
});
