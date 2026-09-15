import { describe, it, expect } from "vitest";
import { ROLES, type AppRole, ROLE_DESCRIPTIONS, roleDescription, roleLabel } from "./app.config";
import { EMAIL_COPY_DEFAULTS, applyEmailTokens } from "@/lib/emailTemplates/emailCopy";

const ALL_ROLES = Object.values(ROLES) as AppRole[];

describe("ROLE_DESCRIPTIONS", () => {
  it("has a non-empty description for every AppRole", () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_DESCRIPTIONS[role]).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[role].trim().length).toBeGreaterThan(0);
    }
  });

  it("never uses em or en dashes", () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_DESCRIPTIONS[role]).not.toMatch(/[—–]/);
    }
  });
});

describe("roleDescription workspace-type awareness", () => {
  it("is byte-identical to ROLE_DESCRIPTIONS for the production default", () => {
    for (const role of ALL_ROLES) {
      expect(roleDescription(role, "production")).toBe(ROLE_DESCRIPTIONS[role]);
      expect(roleDescription(role)).toBe(ROLE_DESCRIPTIONS[role]);
    }
  });

  it("swaps domain nouns for a staffing workspace", () => {
    const producer = roleDescription("producer", "staffing");
    expect(producer).toContain("clients");
    expect(producer).toContain("people");
    // "show dates" stays literal here, matching roleIntroProducer (see the template note),
    // so it is deliberately NOT swapped to "shifts".
    expect(producer).toContain("show dates");
    expect(producer).not.toContain("productions");
    expect(producer).not.toContain("books artists");
    expect(roleDescription("admin", "staffing")).toContain("teams");
    expect(roleDescription("artist", "staffing")).toContain("clients");
  });

  it("stays dash-free for staffing too", () => {
    for (const role of ALL_ROLES) {
      expect(roleDescription(role, "staffing")).not.toMatch(/[—–]/);
    }
  });
});

describe("roleDescription", () => {
  it("returns the registry entry for a known role", () => {
    for (const role of ALL_ROLES) {
      expect(roleDescription(role)).toBe(ROLE_DESCRIPTIONS[role]);
    }
  });

  it("describes what a producer (Production Team) does, not just the raw enum word", () => {
    const description = roleDescription("producer");
    expect(description.toLowerCase()).not.toBe("producer");
    expect(description).not.toMatch(/[—–]/);
    expect(description.length).toBeGreaterThan(10);
  });

  it("describes the admin role's full-control scope", () => {
    expect(roleDescription("admin").length).toBeGreaterThan(10);
    expect(roleDescription("admin")).not.toMatch(/[—–]/);
  });

  it("describes what an artist receives and does", () => {
    expect(roleDescription("artist")).not.toMatch(/[—–]/);
    expect(roleDescription("artist").length).toBeGreaterThan(10);
  });

  it("is tolerant of an unrecognized role value, mirroring roleLabel's fallback semantics", () => {
    expect(roleDescription("unknown-role")).toBe("");
  });

  it("never states a specific booking flow (offers) as fact, since artist_acceptance is a per-org toggle and a direct-book org never opens one", () => {
    // See supabase/functions/_shared/bookingFlow.ts: artist_acceptance=false is a first-class
    // supported org configuration where producers book straight to confirmed and no offer is
    // ever sent. A description that says "sends offers" / "receives booking offers" is simply
    // false for those orgs, so the registry must stay true regardless of the org's flow.
    expect(roleDescription("producer").toLowerCase()).not.toContain("offer");
    expect(roleDescription("artist").toLowerCase()).not.toContain("offer");
  });

  it("never names the /availability route, since that route is gated by the booking_flow entitlement and an org without it has artists who cannot reach it", () => {
    // ROUTE_FEATURES gates '/availability' behind 'booking_flow' (see app.config.ts above).
    // The artist description says nothing about declaring availability at all (an
    // earlier hedged version was dropped as undecodable to a brand-new invitee, see the
    // doc comment on ROLE_DESCRIPTIONS), so it stays true for an artist in an org where
    // that module is off.
    expect(roleDescription("artist").toLowerCase()).not.toContain("/availability");
  });

  it("the org-invitation.roleIntro opener reads as a complete sentence for every role label, not a dangling fragment", () => {
    // Import the ACTUAL template string (rather than re-typing "Your role is {{role}}."
    // here) so a future edit to roleIntro's punctuation is exercised by this test
    // instead of silently leaving a stale hardcoded copy behind that keeps passing no
    // matter what roleIntro actually says.
    for (const role of ALL_ROLES) {
      const sentence = applyEmailTokens(EMAIL_COPY_DEFAULTS["org-invitation.roleIntro"], {
        orgName: "Acme",
        role: roleLabel(role),
      });
      expect(sentence.endsWith(".")).toBe(true);
      expect(sentence).not.toMatch(/\{\{\w+\}\}/);
    }
  });

  it("roleIntro states the role directly, not 'you are joining as {{role}}' or the stilted 'on the {{role}} side' phrasing", () => {
    // 'You are joining as Production Team.' parses as the invitee BEING a team rather
    // than joining one; 'on the Production Team side' reads awkwardly too. A plain
    // 'Your role is {{role}}.' reads naturally for all three labels.
    expect(EMAIL_COPY_DEFAULTS["org-invitation.roleIntro"]).not.toContain(" side");
    expect(EMAIL_COPY_DEFAULTS["org-invitation.roleIntro"].toLowerCase()).not.toContain("you are joining as");
  });
});

describe("org-invitation body does not repeat the org name in every consecutive sentence", () => {
  // A real render for a producer invite used to read "ShowFlow is where Cirque Lumiere
  // plans shows..." / "You are joining Cirque Lumiere on the Production Team side." /
  // "Your invitation to join Cirque Lumiere is held until ..." — three sentences in a
  // row naming the same org. Only productIntro (the one sentence that needs it to
  // introduce ShowFlow itself) should still carry {{orgName}}.
  it("only one of productIntro, roleIntro, expiryLine references {{orgName}}", () => {
    const bodySentences = [
      EMAIL_COPY_DEFAULTS["org-invitation.productIntro"],
      EMAIL_COPY_DEFAULTS["org-invitation.roleIntro"],
      EMAIL_COPY_DEFAULTS["org-invitation.expiryLine"],
    ];
    const orgNameMentions = bodySentences.filter((s) => s.includes("{{orgName}}")).length;
    expect(orgNameMentions).toBe(1);
  });
});

describe("org-invitation.productIntro", () => {
  // A0.1 asks the invitation email to say what ShowFlow actually IS for a stranger who has
  // never seen the product before. "Plans productions" and "books artists" are core, always-on
  // concepts (never gated by an entitlement, see src/lib/entitlements.ts), so naming them
  // is always true; the roleIntro action lines below name the same two facts again in
  // second person for the invitee's specific role.
  const productIntro = EMAIL_COPY_DEFAULTS["org-invitation.productIntro"];

  it("names what ShowFlow does (productions, artists), not just a tautology about production work", () => {
    expect(productIntro.toLowerCase()).toContain("productions");
    expect(productIntro.toLowerCase()).toContain("artists");
  });

  it("never uses em or en dashes", () => {
    expect(productIntro).not.toMatch(/[—–]/);
  });

  it("never states a specific booking flow (offers) as fact, since artist_acceptance is a per-org toggle and a direct-book org never opens one", () => {
    expect(productIntro.toLowerCase()).not.toContain("offer");
  });
});

describe("org-invitation expiry copy", () => {
  it("does not use the opaque 'is held' verb", () => {
    // 'held' can read as 'queued for delivery' rather than 'the window this invite is
    // valid for'.
    expect(EMAIL_COPY_DEFAULTS["org-invitation.expiryLine"]).not.toMatch(/\bheld\b/);
    expect(EMAIL_COPY_DEFAULTS["org-invitation.expiryFallback"]).not.toMatch(/\bheld\b/);
  });

  it("states the invitation's own validity window, never the emailed link's TTL", () => {
    // The rendered CTA href (and its paste-link fallback) is a short-lived Supabase
    // action link, magiclink or invite, that typically expires in hours and is consumed
    // on first use. That is unrelated to, and usually much shorter than, the 14-day
    // window accept_invitation actually checks (org_invitations.expires_at). A claim
    // like "the link in this email works until {{expiresOn}}" would be false for most
    // of that window, so the copy must scope the statement to the invitation itself,
    // never to "the link" or "this email".
    expect(EMAIL_COPY_DEFAULTS["org-invitation.expiryLine"]).not.toMatch(/\blink\b/i);
    expect(EMAIL_COPY_DEFAULTS["org-invitation.expiryFallback"]).not.toMatch(/\blink\b/i);
  });
});

describe("org-invitation.roleIntroArtist", () => {
  it("does not hedge availability behind an undecodable 'where that is turned on' clause", () => {
    // A brand-new artist has no way to know who turns that on or where; the sentence
    // reads stronger, and just as truthfully, without the hedge.
    expect(EMAIL_COPY_DEFAULTS["org-invitation.roleIntroArtist"]).not.toMatch(/turned on/i);
  });
});

describe("org-invitation.roleIntroArtistOffers", () => {
  // Rendered instead of roleIntroArtist whenever the inviting org's
  // booking_flow.artist_acceptance is true (BOOKING_FLOW_DEFAULTS, the majority case):
  // unlike the flow-neutral line, THIS one is allowed, and expected, to name offers.
  it("is a non-empty, dash-free, period-terminated sentence", () => {
    const line = EMAIL_COPY_DEFAULTS["org-invitation.roleIntroArtistOffers"];
    expect(line.trim().length).toBeGreaterThan(0);
    expect(line).not.toMatch(/[—–]/);
    expect(line.endsWith(".")).toBe(true);
  });

  it("tells the artist about the emailed offers they will actually receive", () => {
    expect(EMAIL_COPY_DEFAULTS["org-invitation.roleIntroArtistOffers"].toLowerCase()).toContain("offer");
  });

  it("never names the /availability route, since that route is gated by the booking_flow entitlement", () => {
    expect(EMAIL_COPY_DEFAULTS["org-invitation.roleIntroArtistOffers"].toLowerCase()).not.toContain("/availability");
  });
});

describe("org-invitation.inviterFallback and linkRecovery", () => {
  // Both moved out of hardcoded literals (provision-org's "the ShowFlow team", and the
  // "if it ever stops working" clause that used to trail ctaHintNewUser/
  // ctaHintExistingUser) into editable copy keys, so they need the same dash guard every
  // other line in this email gets.
  it("inviterFallback is a non-empty, dash-free fallback name", () => {
    const line = EMAIL_COPY_DEFAULTS["org-invitation.inviterFallback"];
    expect(line.trim().length).toBeGreaterThan(0);
    expect(line).not.toMatch(/[—–]/);
  });

  it("linkRecovery is a non-empty, dash-free, period-terminated sentence", () => {
    const line = EMAIL_COPY_DEFAULTS["org-invitation.linkRecovery"];
    expect(line.trim().length).toBeGreaterThan(0);
    expect(line).not.toMatch(/[—–]/);
    expect(line.endsWith(".")).toBe(true);
  });

  it("the button-reassurance lines no longer carry their own recovery clause (it lives in linkRecovery now)", () => {
    expect(EMAIL_COPY_DEFAULTS["org-invitation.ctaHintNewUser"].toLowerCase()).not.toContain("send a fresh one");
    expect(EMAIL_COPY_DEFAULTS["org-invitation.ctaHintExistingUser"].toLowerCase()).not.toContain("send a fresh one");
  });
});

describe("org-invitation per-role action lines (the second-person copy the email actually sends)", () => {
  // These are the strings that really ship in the invitation email (see
  // org-invitation.tsx's roleActionLine, selected by roleKey), a deliberately separate
  // second-person registry from ROLE_DESCRIPTIONS (see the doc comment on
  // ROLE_DESCRIPTIONS in app.config.ts for why the two cannot share one string). They
  // need the same truthfulness guards ROLE_DESCRIPTIONS gets above, since nothing else
  // pins them.
  const ROLE_ACTION_LINE_KEYS = {
    admin: "org-invitation.roleIntroAdmin",
    producer: "org-invitation.roleIntroProducer",
    artist: "org-invitation.roleIntroArtist",
  } as const;

  it("has a non-empty, dash-free, period-terminated action line for every role", () => {
    for (const role of ALL_ROLES) {
      const line = EMAIL_COPY_DEFAULTS[ROLE_ACTION_LINE_KEYS[role]];
      expect(line.trim().length).toBeGreaterThan(0);
      expect(line).not.toMatch(/[—–]/);
      expect(line.endsWith(".")).toBe(true);
    }
  });

  it("never states a specific booking flow (offers) as fact, since artist_acceptance is a per-org toggle and a direct-book org never opens one", () => {
    expect(EMAIL_COPY_DEFAULTS["org-invitation.roleIntroProducer"].toLowerCase()).not.toContain("offer");
    expect(EMAIL_COPY_DEFAULTS["org-invitation.roleIntroArtist"].toLowerCase()).not.toContain("offer");
  });

  it("never names the /availability route, since that route is gated by the booking_flow entitlement", () => {
    expect(EMAIL_COPY_DEFAULTS["org-invitation.roleIntroArtist"].toLowerCase()).not.toContain("/availability");
  });
});

describe("ROLE_DESCRIPTIONS stays paired with its org-invitation email twin", () => {
  // ROLE_DESCRIPTIONS (third-person, app.config.ts) and the roleIntro* action lines
  // (second-person, emailCopy.ts) are deliberately two separate strings per role (see the
  // doc comment on ROLE_DESCRIPTIONS above), so nothing else pins them to each other as a
  // pair. This checks the load-bearing nouns each side should still share, so an edit to
  // one that silently drops a fact the other still claims fails a test instead of only
  // being caught by eyeballing both files side by side.
  it("admin: shares full control, people, casts, settings, and booking with its email action line", () => {
    const description = ROLE_DESCRIPTIONS.admin.toLowerCase();
    const actionLine = EMAIL_COPY_DEFAULTS["org-invitation.roleIntroAdmin"].toLowerCase();
    for (const term of ["full control", "people", "casts", "settings", "booking"]) {
      expect(description).toContain(term);
      expect(actionLine).toContain(term);
    }
  });

  it("producer: shares productions, show dates, and artists with its email action line", () => {
    const description = ROLE_DESCRIPTIONS.producer.toLowerCase();
    const actionLine = EMAIL_COPY_DEFAULTS["org-invitation.roleIntroProducer"].toLowerCase();
    for (const term of ["production", "show date", "artist"]) {
      expect(description).toContain(term);
      expect(actionLine).toContain(term);
    }
  });

  it("artist: shares booked and confirmed with its email action line", () => {
    const description = ROLE_DESCRIPTIONS.artist.toLowerCase();
    const actionLine = EMAIL_COPY_DEFAULTS["org-invitation.roleIntroArtist"].toLowerCase();
    for (const term of ["booked", "confirmed"]) {
      expect(description).toContain(term);
      expect(actionLine).toContain(term);
    }
  });
});
