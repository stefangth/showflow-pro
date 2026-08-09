import { describe, it, expect } from "vitest";
import { parseRecoveryHash, safeRelativeRedirect, newPasswordSchema } from "./resetPassword";

describe("parseRecoveryHash", () => {
  it("reads the type param from a recovery hash", () => {
    expect(parseRecoveryHash("#access_token=abc&type=recovery&x=1").type).toBe("recovery");
  });
  it("reads invite type and handles missing/leading-hash", () => {
    expect(parseRecoveryHash("type=invite").type).toBe("invite");
    expect(parseRecoveryHash("").type).toBeNull();
  });
});

describe("safeRelativeRedirect", () => {
  it("accepts a relative path", () => {
    expect(safeRelativeRedirect("/accept-invite?token=t", "/login")).toBe("/accept-invite?token=t");
  });
  it("rejects protocol-relative and absolute URLs and null", () => {
    expect(safeRelativeRedirect("//evil.com", "/login")).toBe("/login");
    expect(safeRelativeRedirect("https://evil.com", "/login")).toBe("/login");
    expect(safeRelativeRedirect(null, "/login")).toBe("/login");
  });
  it("safeRelativeRedirect: callback targets", () => {
    expect(safeRelativeRedirect(null, "/dashboard")).toBe("/dashboard");
    expect(safeRelativeRedirect("//evil.com", "/dashboard")).toBe("/dashboard");
    expect(safeRelativeRedirect("http://x", "/dashboard")).toBe("/dashboard");
    expect(safeRelativeRedirect("/accept-invite?token=x", "/dashboard")).toBe("/accept-invite?token=x");
    expect(safeRelativeRedirect("/dashboard", "/dashboard")).toBe("/dashboard");
  });
});

describe("newPasswordSchema", () => {
  it("rejects short passwords and mismatches, accepts a good pair", () => {
    expect(newPasswordSchema.safeParse({ password: "short", confirm: "short" }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: "longenough", confirm: "different" }).success).toBe(false);
    expect(newPasswordSchema.safeParse({ password: "longenough", confirm: "longenough" }).success).toBe(true);
  });
});
