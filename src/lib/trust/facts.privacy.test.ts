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
import { RETENTION, SUBPROCESSORS, SUBPROCESSOR_SUMMARY, TRUST_KPIS, DOCUMENTS } from "./facts";

const POLICY = readFileSync(resolve(process.cwd(), "docs/legal/privacy-policy.en.md"), "utf8");

/** The German twin. `privacy-policy.en.md:7` states the German version
 *  controls, so the translation is the document that legally binds while
 *  every assertion above reads the English one. Nothing kept the two in step:
 *  a retention period could be corrected in English and left stale in the
 *  binding text with CI green. See the EN/DE parity block at the bottom. */
const POLICY_DE = readFileSync(resolve(process.cwd(), "docs/legal/privacy-policy.de.md"), "utf8");

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

/** One row per processor, split into its table cells. */
function policyProcessorRows(): string[][] {
  return processorSection()
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.includes("---"))
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells[1]?.length > 0 && cells[1] !== "Processor");
}

/** One row per processor; the first cell is the legal entity name. */
function policyProcessorNames(): string[] {
  return policyProcessorRows().map((cells) => cells[1]);
}

/** The policy table row for one of our SUBPROCESSORS entries, matched by
 *  product name against the policy's legal entity name (the policy uses
 *  "PostHog, Inc."; the page uses "PostHog"). */
function policyRowFor(name: string): { location: string; transfer: string } {
  const row = policyProcessorRows().find((cells) => cells[1].includes(name));
  expect(row, `no policy row names ${name}`).toBeDefined();
  // Columns: ["", Processor, Service, Location, Transfer mechanism, ""]
  return { location: row![3], transfer: row![4] };
}

describe("subprocessor table matches the privacy policy", () => {
  it("names exactly the processors the policy names", () => {
    const policyNames = policyProcessorNames();
    expect(policyNames).toHaveLength(SUBPROCESSORS.length);

    // The policy uses legal entity names ("PostHog, Inc."); the page uses the
    // product name a reviewer recognises. Match on the product name being
    // present in the legal name.
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

  // Airtable and PostHog were both "Off" and are in use now. The
  // two assertions this replaces pinned the old answer to the policy's own
  // forward-looking wording ("currently disabled"), which is exactly the
  // right way round: the page may not say a processor is off unless the
  // document behind it says so too. So the pin survives, inverted — the page
  // may not say a processor is in use while the policy still hedges it.
  it("states no processor prospectively, on the page or in the policy", () => {
    // Nothing on the page is "Off" any more, so nothing may be published as
    // named-but-not-processing.
    expect(SUBPROCESSORS.filter((s) => s.status === "Off")).toEqual([]);

    // …and section 5 may not describe any processor as pending, disabled, or
    // about to be switched on. This is the shape, not the string: "currently
    // disabled; will be enabled if and when" was the wording that shipped, and
    // banning that phrase alone would catch only a verbatim recurrence.
    const forwardLooking =
      /\b(currently disabled|not (?:yet|currently) (?:enabled|in use)|will be enabled|if and when|once .{0,30} is (?:enabled|turned on)|planned)\b/i;
    for (const row of policyProcessorRows()) {
      expect(
        row.join(" | "),
        `section 5 still describes a processor prospectively: ${row[1]}`,
      ).not.toMatch(forwardLooking);
    }
  });

  it("marks PostHog as consent-gated, matching section 4's legal basis", () => {
    // PostHog receives product analytics, session replay, and error reports,
    // and receives them only after the reader accepts — which is the basis
    // sections 4(g), 4(h) and 4(j) assert and the status this column exists to
    // publish. NOT asserted here: how the data reaches it. See
    // publishedClaims.test.ts, which stops a sentence about an SDK or a
    // package being written to fill that gap.
    expect(SUBPROCESSORS.find((s) => s.name === "PostHog")?.status).toBe("Consent");
    expect(POLICY).toMatch(/Client-side error tracking \(PostHog\)[\s\S]*?your consent/);
    expect(POLICY).toMatch(/Product analytics including session replay \(PostHog\)[\s\S]*?your consent/);
  });

  it("discloses the user ID and email sent for consented PostHog telemetry", () => {
    expect(POLICY).toMatch(/via PostHog[\s\S]*?user ID and email address/i);
    expect(POLICY_DE).toMatch(/über PostHog[\s\S]*?Nutzer-ID und E-Mail-Adresse/i);
  });

  it("marks Airtable optional rather than consent-gated, because it sets nothing on a device", () => {
    // The sync is server side: supabase/functions/airtable-poll/index.ts polls
    // the base an organisation has connected. There is no browser request and
    // no stored identifier, so it is disclosed in the privacy policy and
    // deliberately NOT in either cookie notice. "Consent" would send a reader
    // hunting for a toggle that does not exist; "Core" would say every
    // organisation's schedule is read out of Airtable.
    expect(SUBPROCESSORS.find((s) => s.name === "Airtable")?.status).toBe("Optional");
    const airtableRow = processorSection()
      .split("\n")
      .find((l) => l.startsWith("| Airtable"));
    expect(airtableRow, "section 5 no longer has an Airtable row").toBeDefined();
    expect(airtableRow).toMatch(/organisations that have connected/i);
    // And section 5 explains the shape of it, so "Optional" has a document
    // behind it rather than only a status word.
    expect(POLICY).toMatch(/nothing is written back to Airtable/i);
  });

  // Each processor's region and transfer basis are printed on both surfaces,
  // and neither was ever compared to section 5's Location / Transfer
  // mechanism columns — only the processor names were. A region or basis
  // could drift silently from the table it claims to mirror. Match on
  // keywords rather than prose, matching this suite's existing convention of
  // checking facts, not wording: "EU" in our region column must correspond to
  // "European Union" in the policy's Location cell, and vice versa; "DPF" /
  // "SCC" in our transfer column must correspond to the same abbreviations
  // (or their spelled-out forms) in the policy's Transfer mechanism cell.
  // BOTH DIRECTIONS. The first form of this checked only page -> policy ("if
  // the page says DPF, the policy must too"), which is structurally incapable
  // of seeing an OMISSION: PostHog's policy row asserts "DPF and
  // SCCs for US transfers" while the page printed SCCs alone, and the
  // assertion that exists to compare them passed. An under-claim is still a
  // divergence from the artefact the page says it mirrors, and on a page whose
  // whole premise is that its claims are checkable it is the kind a reviewer
  // finds first. The membership of each basis is now compared as a set.
  it("matches each processor's region and transfer basis against section 5", () => {
    for (const sub of SUBPROCESSORS) {
      const { location, transfer } = policyRowFor(sub.name);
      const regionTokens = sub.region.split("·").map((t) => t.trim());

      expect(regionTokens.includes("EU")).toBe(/European Union/.test(location));
      expect(regionTokens.includes("US")).toBe(/United States/.test(location));

      expect(
        sub.transfer.includes("DPF"),
        `${sub.name}: page transfer "${sub.transfer}" vs policy "${transfer}" disagree on DPF`,
      ).toBe(/DPF|Data Privacy Framework/.test(transfer));
      expect(
        sub.transfer.includes("SCC"),
        `${sub.name}: page transfer "${sub.transfer}" vs policy "${transfer}" disagree on SCCs`,
      ).toBe(/SCCs?|Standard Contractual Clauses/.test(transfer));

      // The policy hedges two of these rows ("EU storage option in use WHERE
      // AVAILABLE", "EU region used where available"). Dropping the hedge
      // publishes a firmer commitment than the document behind it makes, which
      // is the same defect in the opposite direction, so it is compared too.
      expect(
        /where available/i.test(sub.transfer),
        `${sub.name}: the policy hedges this basis with "where available" and the page does not`,
      ).toBe(/where available/i.test(transfer));
    }
  });

  // The subprocessor count is printed twice (the hero KPI and the documents
  // list) and both must move automatically with the table, never be typed by
  // hand — the exact failure mode this test exists to catch is a processor
  // added to SUBPROCESSORS without either printed count being touched.
  it("derives the subprocessor KPI and documents-list count from the table, never a literal", () => {
    // The second figure counts the UNCONDITIONAL processors. It used to count
    // the ones that were named but processing nothing, which is a number no
    // row produces any more. Counting "Core" is also the safe direction: a row
    // added without a considered status cannot inflate the reassuring half.
    const alwaysOn = SUBPROCESSORS.filter((s) => s.status === "Core").length;
    expect(alwaysOn, "no processor is unconditional — has the table been emptied?").toBeGreaterThan(0);
    expect(alwaysOn).toBeLessThan(SUBPROCESSORS.length);
    expect(SUBPROCESSOR_SUMMARY).toBe(`${SUBPROCESSORS.length} named, ${alwaysOn} always on`);

    const kpi = TRUST_KPIS.find((k) => k.label === "Subprocessors");
    expect(kpi?.value).toBe(SUBPROCESSOR_SUMMARY);

    const doc = DOCUMENTS.find((d) => d.title === "Subprocessor list");
    expect(doc?.meta).toBe(`Section 5 of the privacy policy · ${SUBPROCESSORS.length} entries`);
  });
});

// Every other printed figure on this page is derived or pinned — the
// subprocessor count, the capability counts, the retention numbers, the hosts.
// The documents list's "updated …" dates were not: two hand-typed literals a
// reader treats as fact, sitting outside every gate, on the one surface whose
// whole premise is that its claims are checkable. The next policy edit would
// have published a stale date on both surfaces with CI green.
//
// The privacy policy is a file this suite already opens, so its date is
// derived here. The terms of service live in the landing repo and nothing in
// this repo can read them; that date is pinned there instead, by
// scripts/check-doc-dates.mjs against src/pages/Tos.tsx.
describe("the documents list prints each document's own date", () => {
  /** The `_Last updated: 11 August 2026_` line at the head of the policy. */
  function policyDate(text: string, label: string): string {
    const match = text.match(new RegExp(`^_${label}:?\\s*(.+?)_$`, "m"));
    expect(match, `the "${label}" line at the head of the policy moved or was renamed`).not.toBeNull();
    return match![1].trim();
  }

  it("names the date the English privacy policy carries", () => {
    const doc = DOCUMENTS.find((d) => d.title === "Privacy policy");
    expect(doc, "the Privacy policy document row was renamed").toBeDefined();
    // Containment, not equality: the meta also carries the scope note. The
    // date is printed in the document's own format so this stays a comparison
    // rather than a reformatting step that could silently stop matching.
    expect(doc!.meta).toContain(`updated ${policyDate(POLICY, "Last updated")}`);
  });

  // "11 August 2026" and "11. August 2026" are the same day written two ways,
  // so the comparison has to normalise rather than compare strings. It must
  // NOT normalise all the way down to digits, which was the first attempt:
  // digits("11. Juli 2026") equals digits("11 August 2026"), so a month-only
  // divergence — the most likely way these two files drift, since only the
  // month name changes between most consecutive revisions — sailed through the
  // assertion that exists to catch it. Month names are mapped to an index
  // instead, and compared.
  const EN_MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const DE_MONTHS = [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember",
  ];

  /** `{ day, month, year }` where `month` is a 0-based index, so the two
   *  languages compare on the same scale. */
  function parseDate(text: string, months: string[], where: string) {
    const match = text.match(new RegExp(`^(\\d{1,2})\\.?\\s+(${months.join("|")})\\s+(\\d{4})$`));
    expect(match, `could not read a ${where} date out of ${JSON.stringify(text)}`).not.toBeNull();
    return { day: Number(match![1]), month: months.indexOf(match![2]), year: Number(match![3]) };
  }

  it("keeps the binding German twin on the same day", () => {
    // The German version controls (privacy-policy.en.md:7), so an English-only
    // date bump would leave the authoritative document stale while the page
    // published the newer date.
    expect(parseDate(policyDate(POLICY_DE, "Stand"), DE_MONTHS, "German")).toEqual(
      parseDate(policyDate(POLICY, "Last updated"), EN_MONTHS, "English"),
    );
  });
});

describe("retention table matches the privacy policy", () => {
  // Each page row is anchored to a phrase that must survive in section 7. The
  // capture group isolates the number+unit fragment the anchor is guarding,
  // so it can be compared against RETENTION[item].period below rather than
  // only proving the surrounding words still exist.
  const ANCHORS: Record<string, RegExp> = {
    "Bookings and audit log": /Bookings and audit log:\*\* three \(3\) years from the relevant show date/,
    "Show-date chat": /Chat messages:\*\*[\s\S]*?30 days after the show date[\s\S]*?deleted after 12 months/,
    Backups: /Backups:\*\* retained no longer than 30 days/,
    "Account and profile": /Account and profile data:\*\*[\s\S]*?plus 30 days after deletion/,
    "Email send log and suppressions": /Email send log and suppression list:\*\* 24 months/,
    "Hosting and database logs": /Hosting \/ Supabase logs:\*\*[\s\S]*?7-30 days/,
    "Analytics, session replay and error reports": /PostHog analytics events, session replays, and error reports:\*\* 12 months/,
    // Two figures, and the anchor has to reach both: the 24-hour discard of
    // the visitor identifier and the 1-to-24-month reporting window. Neither
    // is ours — both are quoted from Vercel's documentation — so what this
    // guards is that the page and the policy quote the SAME two.
    "Vercel Web Analytics":
      /Vercel Web Analytics \(public website\):\*\*[\s\S]*?24 hours[\s\S]*?from 1 to 24 months/,
  };

  /** All "<number> <hour|day|month|year>[s]" fragments in a string,
   *  singularised and sorted, so "3 years" and "three (3) years from the show
   *  date" (once parens are stripped) both reduce to the same comparable
   *  token — and so a changed number, not just changed wording, is what this
   *  test can catch.
   *
   *  Two widenings, both of which close a hole rather than open one. A range
   *  written with an ASCII hyphen ("7-30 days", now that the en-dash is gone
   *  from both surfaces) used to fall out of the pattern at the "7" and match
   *  only "30 days", so the low end of every range was unguarded. And "hours"
   *  was not a unit at all, so a figure stated in hours — the Vercel row's
   *  24-hour visitor-identifier discard is the first — was invisible to the
   *  comparison that exists to pin figures. */
  function periodNumbers(text: string): string[] {
    const cleaned = text.replace(/[()]/g, "");
    const matches = cleaned.match(/\d+(?:[–-]\d+)?-?\s*(?:hours?|days?|months?|years?)/gi) ?? [];
    return matches
      .map((m) => m.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim().replace(/s$/, ""))
      .sort();
  }

  it("covers every retention category the policy states, and no others", () => {
    expect(RETENTION.map((r) => r.item).sort()).toEqual(Object.keys(ANCHORS).sort());
  });

  // A category added to section 7 with no matching RETENTION row (or removed
  // from section 7 with a stale RETENTION row left behind) is invisible to
  // the item-name comparison above, because that comparison only checks
  // RETENTION against this file's own ANCHORS keys, never against the
  // document. Counting the policy's own bullet list closes that gap.
  it("has exactly as many rows as section 7 states, so a new policy category cannot go unnoticed", () => {
    const start = POLICY.indexOf("## 7. Retention");
    const end = POLICY.indexOf("## 8. Your rights");
    expect(start, "section 7 heading moved or was renamed").toBeGreaterThan(-1);
    expect(end, "section 8 heading moved or was renamed").toBeGreaterThan(start);
    const section = POLICY.slice(start, end);
    const bulletCount = [...section.matchAll(/^- \*\*.+?:\*\*/gm)].length;
    expect(RETENTION).toHaveLength(bulletCount);
  });

  it.each(RETENTION)("$item is still stated in the policy, with the same period", ({ item, period }) => {
    const anchor = ANCHORS[item];
    expect(POLICY).toMatch(anchor);
    const match = POLICY.match(anchor);
    expect(match, `anchor for ${item} did not capture a match`).not.toBeNull();
    // The number(s) printed on the page must be the same number(s) the
    // policy states, not just present in a page that also happens to mention
    // that phrase elsewhere. Fails if RETENTION[item].period drifts to a
    // different figure (e.g. "3 years" -> "10 years") without the anchored
    // policy text changing too.
    expect(periodNumbers(period)).toEqual(periodNumbers(match![0]));
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

// This build rewrote section 7 of BOTH policies so the Trust Center's chat and
// backup claims would have an artefact to cite, but only the English file was
// ever parsed by a test. The German one is the version the policy itself says
// controls, so the untested file is the binding one. These assertions compare
// the two documents' section 7 structurally: same number of categories, same
// numbers in the same order. They compare digits rather than prose so the
// translation stays free to read like German.
describe("the German privacy policy tracks the English one", () => {
  /** Section 7 of one policy, sliced between its own headings. */
  function retentionSection(text: string, from: string, to: string): string {
    const start = text.indexOf(from);
    const end = text.indexOf(to);
    expect(start, `${from} moved or was renamed`).toBeGreaterThan(-1);
    expect(end, `${to} moved or was renamed`).toBeGreaterThan(start);
    return text.slice(start, end);
  }

  const EN_SECTION_7 = () => retentionSection(POLICY, "## 7. Retention", "## 8. Your rights");
  const DE_SECTION_7 = () => retentionSection(POLICY_DE, "## 7. Speicherdauer", "## 8. Ihre Rechte");

  /** The bullet bodies of a section, one string per category. */
  function bullets(section: string): string[] {
    return section.split("\n").filter((line) => /^- \*\*.+?:\*\*/.test(line));
  }

  /** Every number in a bullet, in the order it appears. "three (3) years" and
   *  "drei (3) Jahre" both reduce to ["3"], so a period corrected in one
   *  language and not the other is what this catches. */
  function digits(line: string): string[] {
    return line.match(/\d+/g) ?? [];
  }

  it("states the same number of retention categories in both languages", () => {
    expect(bullets(DE_SECTION_7())).toHaveLength(bullets(EN_SECTION_7()).length);
    // …and the page's own table still matches, so all three move together.
    expect(bullets(DE_SECTION_7())).toHaveLength(RETENTION.length);
  });

  it("states the same retention periods, category by category", () => {
    const en = bullets(EN_SECTION_7());
    const de = bullets(DE_SECTION_7());
    en.forEach((line, index) => {
      expect(digits(de[index]), `section 7 bullet ${index + 1} differs between EN and DE`).toEqual(
        digits(line),
      );
    });
  });

  it("names the same processors in both section 5 tables", () => {
    const deSection = retentionSection(
      POLICY_DE,
      "## 5. Empfänger und Auftragsverarbeiter",
      "## 6. Übermittlungen in Drittländer",
    );
    const deNames = deSection
      .split("\n")
      .filter((line) => line.startsWith("|") && !line.includes("---"))
      .map((line) => line.split("|")[1].trim())
      .filter((name) => name.length > 0 && name !== "Auftragsverarbeiter");
    expect(deNames).toHaveLength(SUBPROCESSORS.length);
    for (const sub of SUBPROCESSORS) {
      expect(deNames.find((n) => n.includes(sub.name)), `no DE policy row names ${sub.name}`).toBeDefined();
    }
  });

  // The chat bullet is the one claim on this page that a previous round got
  // backwards in the policy while the page had it right: the policy said the
  // archive window "only hides it from the chats list", which is false against
  // ChatPanel.tsx:141 (a producer is shown a placeholder, not the messages)
  // and :160,187-193 (an admin's composer is disabled). A trust page that
  // cites an artefact stating the opposite of its own claim is worse than one
  // that says nothing, so both directions are pinned here.
  it("does not restate the archive window as a mere list filter", () => {
    const enChat = bullets(EN_SECTION_7()).find((l) => l.includes("Chat messages"));
    const deChat = bullets(DE_SECTION_7()).find((l) => l.includes("Chatnachrichten"));
    expect(enChat).toBeDefined();
    expect(deChat).toBeDefined();
    expect(enChat).not.toMatch(/only hides it from the chats list/i);
    expect(deChat).not.toMatch(/lediglich aus der Chat-Liste/i);
    expect(enChat).toMatch(/read only/i);
    expect(deChat).toMatch(/lesend/i);
  });
});
