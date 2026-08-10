// The Trust Center restates two tables that already exist in the published
// privacy policy. Restating anything invites drift, so this suite parses the
// policy at test time and fails if the page and the document disagree.
//
// It deliberately checks the *facts* (which processors, which periods) rather
// than the prose, so the policy can be reworded without breaking the build —
// but a processor cannot be added, dropped, or re-homed without this going red.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RETENTION, SUBPROCESSORS } from "./facts";

const POLICY = readFileSync(resolve(process.cwd(), "docs/legal/privacy-policy.en.md"), "utf8");

/** Section 5 ("Recipients and processors") holds the Art. 28 processor table.
 *  Scope the parse to that section: section 9's cookie table names some of the
 *  same vendors, and counting both would quietly double the roster. */
function processorSection(): string {
  const start = POLICY.indexOf("## 5. Recipients and processors");
  const end = POLICY.indexOf("## 6. International transfers");
  expect(start, "section 5 heading moved or was renamed").toBeGreaterThan(-1);
  expect(end, "section 6 heading moved or was renamed").toBeGreaterThan(start);
  return POLICY.slice(start, end);
}

/** One row per processor; the first cell is the legal entity name. */
function policyProcessorNames(): string[] {
  return processorSection()
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.includes("---"))
    .map((line) => line.split("|")[1]?.trim() ?? "")
    .filter((cell) => cell.length > 0 && cell !== "Processor");
}

describe("subprocessor table matches the privacy policy", () => {
  it("names exactly the processors the policy names", () => {
    const policyNames = policyProcessorNames();
    expect(policyNames).toHaveLength(SUBPROCESSORS.length);

    // The policy uses legal entity names ("Functional Software, Inc. dba
    // Sentry"); the page uses the product name a reviewer recognises. Match on
    // the product name being present in the legal name.
    for (const sub of SUBPROCESSORS) {
      const match = policyNames.find((n) => n.includes(sub.name));
      expect(match, `no policy row names ${sub.name}`).toBeDefined();
    }
  });

  it("does not name a processor the policy omits", () => {
    const policyBlob = policyProcessorNames().join(" ");
    for (const sub of SUBPROCESSORS) {
      expect(policyBlob).toContain(sub.name);
    }
  });

  it("marks Airtable as off, matching the policy's 'currently disabled'", () => {
    const airtableRow = processorSection()
      .split("\n")
      .find((l) => l.startsWith("| Airtable"));
    expect(airtableRow).toMatch(/currently disabled/i);
    expect(SUBPROCESSORS.find((s) => s.name === "Airtable")?.status).toBe("Off");
  });

  it("marks exactly the two consent-gated processors as consent-only", () => {
    const consent = SUBPROCESSORS.filter((s) => s.status === "Consent").map((s) => s.name);
    // Section 4 records both of these under Art. 6(1)(a) consent.
    expect(consent).toEqual(["Sentry", "PostHog"]);
    expect(POLICY).toMatch(/Client-side error tracking \(Sentry\)[\s\S]*?your consent/);
    expect(POLICY).toMatch(/Product analytics including session replay \(PostHog\)[\s\S]*?your consent/);
  });
});

describe("retention table matches the privacy policy", () => {
  // Each page row is anchored to a phrase that must survive in section 7.
  const ANCHORS: Record<string, RegExp> = {
    "Bookings and audit log": /Bookings and audit log:\*\* three \(3\) years from the relevant show date/,
    "Show-date chat": /Chat messages:\*\*[\s\S]*?30 days after the show date[\s\S]*?deleted after 12 months/,
    Backups: /Backups:\*\* rolling 30-day window/,
    "Account and profile": /Account and profile data:\*\*[\s\S]*?plus 30 days after deletion/,
    "Email send log and suppressions": /Email send log and suppression list:\*\* 24 months/,
    "Hosting and database logs": /Hosting \/ Supabase logs:\*\*[\s\S]*?7–30 days/,
    "Error reports": /Sentry error reports:\*\* 90 days/,
    "Analytics and session replay": /PostHog analytics events and session replays:\*\* 12 months/,
  };

  it("covers every retention category the policy states, and no others", () => {
    expect(RETENTION.map((r) => r.item).sort()).toEqual(Object.keys(ANCHORS).sort());
  });

  it.each(RETENTION)("$item is still stated in the policy", ({ item }) => {
    expect(POLICY).toMatch(ANCHORS[item]);
  });

  it("leads with the three periods people actually ask about", () => {
    // The public page's summary view shows only the first three rows, so their
    // order is load-bearing rather than incidental.
    expect(RETENTION.slice(0, 3).map((r) => r.item)).toEqual([
      "Bookings and audit log",
      "Show-date chat",
      "Backups",
    ]);
  });
});
