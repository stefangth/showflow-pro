import { describe, expect, it } from "vitest";
import { PRODUCTION_VOCAB, resolveEmailCopy } from "./emailCopy";
import { VOCABULARY } from "@/lib/orgKind";

// Pre-change (origin/main) English strings for every noun-bearing key this PR rewrote
// into {{noun}} variables. Because the production vocabulary words equal these hardcoded
// nouns, resolving with the production table (or with no table at all) must reproduce
// them byte-for-byte. Runtime tokens ({{orgName}}, {{dateLabel}}, {{where}}, {{hours}})
// are left verbatim by the vocabulary pass and filled later by applyEmailTokens.
const PRE_CHANGE_EN: Record<string, string> = {
  "org-invitation.productIntro":
    "ShowFlow is where {{orgName}} plans its productions and books the artists for them.",
  "org-invitation.roleIntroAdmin":
    "You get full control of this workspace, including people, casts, settings, and every booking.",
  "org-invitation.roleIntroProducer":
    "You plan productions and show dates, and book artists into them.",
  "org-invitation.roleIntroArtist":
    "You are on the roster. You get booked for productions and can see every confirmed engagement.",
  // Names no domain noun; must survive the audit unchanged.
  "org-invitation.roleIntroArtistOffers":
    "You are on the roster. You will get booking offers by email, accept or decline each in one tap, then see every confirmed engagement.",
  "offer-immediate.intro":
    "You have been asked about {{referenceLabel}} on {{where}}. Say yes and the date is held for you. Say no and it will not count against you, and it does not affect any other date. Answer within {{hours}} hours.",
  "artist-offer-digest.intro":
    "You have {{count}} {{pendingOffer}}. Say yes and the date is held for you. Say no and it will not count against you, and it does not affect any other date.",
  "offer-expiry-reminder.introSingular":
    "One of your asks needs an answer within the next 24 hours. Answer soon to keep the date.",
  "offer-expiry-reminder.introPlural":
    "{{count}} of your asks need an answer within the next 24 hours. Answer soon to keep the dates.",
  "hire-order-issued.subject": "Your contract for {{dateLabel}} at {{venue}}",
  "hire-order-issued.heading": "Your contract is ready",
  "hire-order-issued.intro":
    "Your contract for {{dateLabel}} at {{venue}} is ready. Review the details below and download your copy.",
  "hire-order-issued.previewText": "Your contract for {{dateLabel}} at {{venue}}",
  "hire-order-issued.signPrompt": "Review and sign your contract online to confirm.",
  "hire-order-countersigned.subject": "Your contract for {{dateLabel}} is signed",
  "hire-order-countersigned.heading": "Your contract is signed",
  "hire-order-countersigned.intro":
    "Your contract for {{dateLabel}} at {{venue}} is fully signed. A copy is attached for your records.",
  "hire-order-countersigned.previewText": "Your contract for {{dateLabel}} is signed",
  "airtable-sync-held.topReasonUnlinkedProgram": "not linked to one of your productions",
};

const PRE_CHANGE_DE: Record<string, string> = {
  "org-invitation.productIntro":
    "ShowFlow ist die Plattform, auf der {{orgName}} seine Produktionen plant und die Artists dafür bucht.",
  "org-invitation.roleIntroAdmin":
    "Du hast die volle Kontrolle über diesen Workspace, einschließlich Personen, Besetzungen, Einstellungen und jeder Buchung.",
  "org-invitation.roleIntroProducer":
    "Du planst Produktionen und Show-Termine und buchst Artists dafür.",
  "org-invitation.roleIntroArtist":
    "Du stehst auf der Liste. Du wirst für Produktionen gebucht und siehst jedes bestätigte Engagement.",
  "offer-immediate.intro":
    "Du wurdest zu {{referenceLabel}} am {{where}} gefragt. Sag ja, und der Termin ist für Dich reserviert. Sag nein, und das wird Dir nicht angerechnet und wirkt sich auf keinen anderen Termin aus. Antworte innerhalb von {{hours}} Stunden.",
  "offer-expiry-reminder.introPlural":
    "{{count}} Deiner Anfragen brauchen innerhalb der nächsten 24 Stunden eine Antwort. Antworte bald, um Dir die Termine zu sichern.",
  "hire-order-issued.subject": "Dein Engagementvertrag für {{dateLabel}} im {{venue}}",
  "hire-order-issued.heading": "Dein Engagementvertrag ist bereit",
  "hire-order-countersigned.subject": "Dein Engagementvertrag für {{dateLabel}} ist unterschrieben",
  "airtable-sync-held.topReasonUnlinkedProgram": "nicht mit einer Deiner Produktionen verknüpft",
};

describe("resolveEmailCopy org_kind vocabulary", () => {
  it("is byte-identical for production orgs, table passed or omitted (EN)", () => {
    const omitted = resolveEmailCopy(undefined, "en");
    const withProd = resolveEmailCopy(undefined, "en", VOCABULARY.production.en);
    for (const [key, before] of Object.entries(PRE_CHANGE_EN)) {
      expect(omitted[key as keyof typeof omitted], `omit ${key}`).toBe(before);
      expect(withProd[key as keyof typeof withProd], `prod ${key}`).toBe(before);
    }
  });

  it("is byte-identical for production orgs, table passed or omitted (DE)", () => {
    const omitted = resolveEmailCopy(undefined, "de");
    const withProd = resolveEmailCopy(undefined, "de", VOCABULARY.production.de);
    for (const [key, before] of Object.entries(PRE_CHANGE_DE)) {
      expect(omitted[key as keyof typeof omitted], `omit ${key}`).toBe(before);
      expect(withProd[key as keyof typeof withProd], `prod ${key}`).toBe(before);
    }
  });

  it("substitutes staffing words in the org invitation product intro (EN)", () => {
    const copy = resolveEmailCopy(undefined, "en", VOCABULARY.staffing.en);
    const intro = copy["org-invitation.productIntro"];
    expect(intro).toContain("clients");
    expect(intro).toContain("people");
    expect(intro).not.toContain("productions");
    expect(intro).not.toContain("artists");
    // Runtime token is untouched by the vocabulary pass.
    expect(intro).toContain("{{orgName}}");
  });

  it("substitutes staffing words across role, offer and hire-order copy (EN)", () => {
    const copy = resolveEmailCopy(undefined, "en", VOCABULARY.staffing.en);
    expect(copy["org-invitation.roleIntroAdmin"]).toContain("teams");
    expect(copy["org-invitation.roleIntroProducer"]).toContain("clients");
    expect(copy["org-invitation.roleIntroProducer"]).toContain("people");
    expect(copy["offer-immediate.intro"]).toContain("the shift is held for you");
    expect(copy["offer-expiry-reminder.introPlural"]).toContain("keep the shifts");
    expect(copy["hire-order-issued.subject"]).toContain("Your work order for");
    expect(copy["hire-order-countersigned.heading"]).toBe("Your work order is signed");
  });

  it("substitutes staffing words in German", () => {
    const copy = resolveEmailCopy(undefined, "de", VOCABULARY.staffing.de);
    expect(copy["org-invitation.productIntro"]).toContain("Kunden");
    expect(copy["org-invitation.productIntro"]).toContain("Personen");
    expect(copy["hire-order-issued.heading"]).toBe("Dein Arbeitsauftrag ist bereit");
  });

  it("returns an override with no variable verbatim, even under a staffing table", () => {
    const copy = resolveEmailCopy(
      { "org-invitation.productIntro": "Welcome to the Acme crew." },
      "en",
      VOCABULARY.staffing.en,
    );
    expect(copy["org-invitation.productIntro"]).toBe("Welcome to the Acme crew.");
  });

  it("substitutes a vocabulary variable that appears inside an admin override", () => {
    const copy = resolveEmailCopy(
      { "org-invitation.heading": "Join the {{Show}} team" },
      "en",
      VOCABULARY.staffing.en,
    );
    expect(copy["org-invitation.heading"]).toBe("Join the Project team");
  });
});

// PRODUCTION_VOCAB is a hand-maintained, import-free copy of VOCABULARY.production
// (the emailCopy mirror must import nothing). Guard against silent desync if the
// registry changes: the fallback table must stay identical to the source of truth.
describe("PRODUCTION_VOCAB stays in sync with the org_kind registry", () => {
  it("matches VOCABULARY.production for en and de", () => {
    expect(PRODUCTION_VOCAB.en).toEqual(VOCABULARY.production.en);
    expect(PRODUCTION_VOCAB.de).toEqual(VOCABULARY.production.de);
  });
});

// EN-only keys added after the first audit pass (subject-line fallback + hire-order
// labels/CTAs). Byte-identical for production, swapped for staffing in English.
describe("resolveEmailCopy EN-only staffing coverage", () => {
  it("staffing swaps the EN show fallback (feeds the subject) and hire-order labels", () => {
    const s = resolveEmailCopy(undefined, "en", VOCABULARY.staffing.en);
    expect(s["offer-immediate.showFallback"]).toBe("a client");
    expect(s["tier-at-risk.showFallback"]).toBe("a client");
    expect(s["hire-order-issued.orderLabel"]).toBe("Work order.");
    expect(s["hire-order-issued.signCtaLabel"]).toBe("Review work order");
    expect(s["hire-order-countersigned.ctaLabel"]).toBe("View signed work order");
  });
  it("production keeps the EN wording for those keys", () => {
    const p = resolveEmailCopy(undefined, "en");
    expect(p["offer-immediate.showFallback"]).toBe("a production");
    expect(p["hire-order-issued.orderLabel"]).toBe("Contract.");
    expect(p["hire-order-countersigned.ctaLabel"]).toBe("View signed contract");
  });
});
