import { describe, it, expect } from "vitest";
import { resolveContactEmail, resolveAccountDisplayName } from "@/lib/identity";

// Smoke test for the re-export bridge only. Full edge-case coverage (null,
// whitespace, both-absent) lives in the co-located Deno test:
// supabase/functions/_shared/identity.test.ts
describe("identity resolver (frontend re-export bridge)", () => {
  it("re-exports resolveContactEmail with login-first semantics", () => {
    expect(resolveContactEmail({ authEmail: "login@x.com", bookingEmail: "book@x.com" })).toBe("login@x.com");
  });
  it("re-exports resolveAccountDisplayName with display-name-first semantics", () => {
    expect(resolveAccountDisplayName({ displayName: "Ada", artistName: "Talent" })).toBe("Ada");
  });
});
