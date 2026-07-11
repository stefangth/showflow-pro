import { assertEquals } from "./test-asserts.ts";
import { redactEmail, redactEmailsInText, resolveContactEmail, resolveAccountDisplayName } from "./identity.ts";

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

Deno.test("redactEmail: keeps first char + domain, masks the rest", () => {
  assertEquals(redactEmail("alice@example.com"), "a***@example.com");
  assertEquals(redactEmail("BOB@sub.domain.org"), "B***@sub.domain.org");
});

Deno.test("redactEmail: never returns the full local part", () => {
  const full = "sensitive.person@example.com";
  const out = redactEmail(full);
  // The redacted form must not contain the raw local part verbatim.
  assertEquals(out.includes("sensitive.person"), false);
  assertEquals(out, "s***@example.com");
});

Deno.test("redactEmail: null/empty/malformed degrade to a safe placeholder", () => {
  assertEquals(redactEmail(null), "(none)");
  assertEquals(redactEmail(undefined), "(none)");
  assertEquals(redactEmail(""), "(none)");
  assertEquals(redactEmail("not-an-email"), "***");
  assertEquals(redactEmail("@nolocal.com"), "***");
});

Deno.test("redactEmailsInText: redacts every email-shaped substring in free-form text", () => {
  assertEquals(
    redactEmailsInText("Invalid `to` field: alice@example.com is not a verified recipient"),
    "Invalid `to` field: a***@example.com is not a verified recipient",
  );
  // Multiple addresses in the same message all get redacted.
  assertEquals(
    redactEmailsInText("bounce for bob@x.com, cc carol@y.org failed"),
    "bounce for b***@x.com, cc c***@y.org failed",
  );
  // Text with no email-shaped substring is returned unchanged.
  assertEquals(redactEmailsInText("Resend 500: internal server error"), "Resend 500: internal server error");
});

Deno.test("redactEmailsInText: null/empty pass through unchanged so `?? fallback` still applies", () => {
  assertEquals(redactEmailsInText(null), null);
  assertEquals(redactEmailsInText(""), "");
});
