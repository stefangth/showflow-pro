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
  // CVE-2026-53669 / CVE-2025-68470 class: browsers fold `\` into `/` for http(s) URLs, so
  // `/\evil.com` resolves cross-origin. React Router's history falls back to
  // `location.assign` when the resulting pushState throws SecurityError, turning an
  // attacker-supplied `?redirect=` into a real open redirect. There is no fix in the
  // react-router v6 line (patched only in 7.18.0), so the clamp has to reject it here.
  it("rejects backslash paths that browsers reinterpret as protocol-relative", () => {
    expect(safeRelativeRedirect("/\\evil.com", "/login")).toBe("/login");
    expect(safeRelativeRedirect("/\\/evil.com", "/login")).toBe("/login");
    expect(safeRelativeRedirect("\\\\evil.com", "/login")).toBe("/login");
    expect(safeRelativeRedirect("/dashboard\\evil.com", "/login")).toBe("/login");
  });
  // Same class, different character: the URL parser *removes* ASCII tab/LF/CR before parsing,
  // so `/<TAB>/evil.com` becomes `//evil.com` and resolves cross-origin. `?redirect=/%09/…`
  // is enough to deliver it, because URLSearchParams.get() percent-decodes.
  it("rejects control characters the URL parser strips before parsing", () => {
    expect(safeRelativeRedirect("/\t/evil.com", "/login")).toBe("/login");
    expect(safeRelativeRedirect("/\n/evil.com", "/login")).toBe("/login");
    expect(safeRelativeRedirect("/\r/evil.com", "/login")).toBe("/login");
    // An interior space is percent-encoded rather than stripped, so it stays same-origin
    // and must keep working: the guard targets stripped characters, not anything unusual.
    expect(safeRelativeRedirect("/accept-invite?note=a b", "/login")).toBe("/accept-invite?note=a b");
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
