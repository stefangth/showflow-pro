import { describe, it, expect } from "vitest";
import { buildImportRows } from "./buildImportRows";
import type { FieldMapping } from "./guessMapping";

const MAP: FieldMapping = { name: "name", email: "email", phone: "phone", bio: "bio" };
const row = (o: Partial<Record<string, string>>) => ({ name: "", email: "", phone: "", bio: "", ...o });

describe("buildImportRows", () => {
  it("marks a valid, unseen row as new and coerces empty cells to null", () => {
    const [r] = buildImportRows([row({ name: "Ada", email: "ada@x.com" })], MAP, []);
    expect(r.status).toBe("new");
    expect(r.values).toEqual({ name: "Ada", email: "ada@x.com", phone: null, bio: null });
  });

  it("flags a missing name as an error (precedence over email)", () => {
    const [r] = buildImportRows([row({ name: "", email: "not-an-email" })], MAP, []);
    expect(r.status).toBe("error");
    expect(r.error).toBe("Name is required");
  });

  it("flags a malformed email as an error", () => {
    const [r] = buildImportRows([row({ name: "Ada", email: "nope" })], MAP, []);
    expect(r.status).toBe("error");
    expect(r.error).toBe("Invalid email");
  });

  it("skips a row whose email already exists (case-insensitive)", () => {
    const [r] = buildImportRows([row({ name: "Ada", email: "Ada@X.com" })], MAP, ["ada@x.com"]);
    expect(r.status).toBe("skipped_existing");
  });

  it("treats a no-email row as new (never dedup'd)", () => {
    const [r] = buildImportRows([row({ name: "Ada" })], MAP, ["ada@x.com"]);
    expect(r.status).toBe("new");
    expect(r.values.email).toBeNull();
  });

  it("preserves the source index", () => {
    const rows = buildImportRows([row({ name: "A" }), row({ name: "B" })], MAP, []);
    expect(rows.map((r) => r.index)).toEqual([0, 1]);
  });
});
