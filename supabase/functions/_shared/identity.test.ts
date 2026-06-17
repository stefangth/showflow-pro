import { assertEquals } from "./test-asserts.ts";
import { resolveContactEmail, resolveAccountDisplayName } from "./identity.ts";

Deno.test("resolveContactEmail: login (auth) email wins over booking email", () => {
  assertEquals(
    resolveContactEmail({ authEmail: "login@x.com", bookingEmail: "book@x.com" }),
    "login@x.com",
  );
});

Deno.test("resolveContactEmail: falls back to booking email when no auth email", () => {
  assertEquals(resolveContactEmail({ authEmail: null, bookingEmail: "book@x.com" }), "book@x.com");
  assertEquals(resolveContactEmail({ bookingEmail: "book@x.com" }), "book@x.com");
});

Deno.test("resolveContactEmail: whitespace-only treated as absent; both empty → null", () => {
  assertEquals(resolveContactEmail({ authEmail: "   ", bookingEmail: "book@x.com" }), "book@x.com");
  assertEquals(resolveContactEmail({ authEmail: null, bookingEmail: null }), null);
  assertEquals(resolveContactEmail({ authEmail: "  ", bookingEmail: "  " }), null);
});

Deno.test("resolveAccountDisplayName: account display name wins over talent label", () => {
  assertEquals(
    resolveAccountDisplayName({ displayName: "Ada Lovelace", artistName: "Talent Label" }),
    "Ada Lovelace",
  );
});

Deno.test("resolveAccountDisplayName: falls back to talent label, then empty string", () => {
  assertEquals(resolveAccountDisplayName({ displayName: null, artistName: "Talent" }), "Talent");
  assertEquals(resolveAccountDisplayName({ displayName: "  ", artistName: "Talent" }), "Talent");
  assertEquals(resolveAccountDisplayName({ displayName: null, artistName: null }), "");
});
