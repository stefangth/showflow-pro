/// <reference types="npm:@types/react@18.3.1" />
import * as React from "npm:react@18.3.1";
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertEquals } from "../test-asserts.ts";
import { template } from "./airtable-sync-held.tsx";

async function renderAlert(props: Record<string, unknown>): Promise<string> {
  const { render } = await import("npm:@react-email/render@1.0.1");
  return await render(React.createElement(template.component, props));
}

Deno.test("airtable-sync-held email: singular held count reads naturally, not record(s)", async () => {
  const html = await renderAlert({ orgName: "Riverdance Co", heldCount: 1, settingsUrl: "https://app.showflow.pro/settings?tab=airtable" });
  assert(html.includes("1 Airtable record in Riverdance Co could not be brought into ShowFlow"), "singular record noun, no verb-agreement artifact");
  assert(!(html.includes("(s)")), "never renders a literal plural marker");
});

Deno.test("airtable-sync-held email: plural held count uses the plural noun", async () => {
  const html = await renderAlert({ orgName: "Riverdance Co", heldCount: 3, settingsUrl: "https://app.showflow.pro/settings?tab=airtable" });
  assert(html.includes("3 Airtable records in Riverdance Co could not be brought into ShowFlow"), "plural record noun");
  assert(!(html.includes("(s)")), "never renders a literal plural marker");
});

// Held records are held for more than one reason (an unmapped program, but also a
// blank date cell — grep "held += 1" in airtable-poll/index.ts) so the email cannot
// assert a single cause ("could not be matched to a show") or a single fix ("fix the
// mapping"): for a missing-date record neither is true. The copy stays cause-neutral
// and points the admin at the sync report, which DOES carry the per-record reason.
Deno.test("airtable-sync-held email: held branch stays cause-neutral, deferring the reason to the sync report", async () => {
  const html = await renderAlert({ orgName: "Riverdance Co", heldCount: 2, settingsUrl: "https://app.showflow.pro/settings?tab=airtable" });
  assert(html.includes("could not be brought into ShowFlow"), "states the outcome without asserting a specific cause");
  assert(!(html.includes("could not be matched to a show")), "does not assert the mapping-only cause");
  assert(!(html.includes("fix the mapping")), "the fix is not always a mapping fix (e.g. a missing date)");
  assert(html.includes("see which ones and why"), "points the admin at the sync report for the actual reason");
  assert(!(html.includes("non-empty table")), "no engineer-voice jargon");
});

// A single held record is "it", never "which ones" (there is only one), and when its
// reason is already known and stated on the line above, the followup must not ask
// "why" again — that would just repeat what was already said.
Deno.test("airtable-sync-held email: a single held record with no known reason is told to see why, never 'which ones'", async () => {
  const html = await renderAlert({ orgName: "Riverdance Co", heldCount: 1, settingsUrl: "https://app.showflow.pro/settings?tab=airtable" });
  assert(html.includes("see why"), "singular followup still points at the sync report for the reason");
  assert(!(html.includes("which ones")), "there is only one record, so 'which ones' is meaningless here");
});

Deno.test("airtable-sync-held email: a single held record whose reason is already stated is not asked 'why' again", async () => {
  const html = await renderAlert({
    orgName: "Riverdance Co",
    heldCount: 1,
    topReasonCategory: "missing_date",
    topReasonCount: 1,
    settingsUrl: "https://app.showflow.pro/settings?tab=airtable",
  });
  assert(html.includes("It&#x27;s missing a date") || html.includes("It's missing a date"), "the reason line still renders");
  assert(!(html.includes("see why")), "the reason was already stated on the line above; the followup must not re-ask why");
  assert(!(html.includes("which ones")), "there is only one record");
});

Deno.test("airtable-sync-held email: when every held record's reason is already stated, the plural followup drops 'and why' but keeps 'which ones'", async () => {
  const html = await renderAlert({
    orgName: "Riverdance Co",
    heldCount: 2,
    topReasonCategory: "unlinked_program",
    topReasonCount: 2,
    settingsUrl: "https://app.showflow.pro/settings?tab=airtable",
  });
  assert(html.includes("which ones"), "still points the admin at the sync report to find the individual records");
  assert(!(html.includes("and why")), "the shared reason was already stated on the line above; must not re-ask why");
});

Deno.test("airtable-sync-held email: zero-import branch gets its own copy, not the held branch's, and does not overclaim what is blocked", async () => {
  const html = await renderAlert({ orgName: "Riverdance Co", zeroImport: true, settingsUrl: "https://app.showflow.pro/settings?tab=airtable" });
  assert(html.includes("brought in zero dates this time"), "states what happened");
  // "no offers can go out" is false whenever the booking flow is paused, the org is
  // direct-book (no offer step at all), or offers on already-synced dates keep going
  // out normally — only NEW dates are blocked by a stalled sync.
  assert(!(html.includes("no offers can go out")), "does not overclaim a blocked offer pipeline");
  // "no new dates can be staffed" is also an overclaim: an admin or producer can still
  // create and staff a show date manually in-app while the sync is stalled. Scope the
  // claim to Airtable itself, which is true in every reachable org state.
  assert(!(html.includes("no new dates can be staffed")), "does not overclaim that manual staffing is blocked too");
  assert(html.includes("Nothing from Airtable will reach ShowFlow"), "states what is actually blocked: Airtable data reaching ShowFlow");
  assert(!(html.includes("could not be brought into ShowFlow")), "does not reuse the held branch's sentence");
  assert(!(html.includes("non-empty table")), "no engineer-voice jargon");
  assert(!(html.includes("these records")), "never references an antecedent it never named");
});

// Real callers (notifyAdminsOnSyncProblem) always set exactly one of heldCount/zeroImport.
// An incomplete payload (neither set — e.g. a caller bug, or a raw preview/registry probe)
// must not silently render the zero-import alarm: that sentence claims a specific run
// outcome ("ran but brought in zero dates") that nobody asserted. Reading `zeroImport`
// explicitly, rather than inferring it from the absence of heldCount, is what guarantees this.
Deno.test("airtable-sync-held email: an incomplete payload (neither heldCount nor zeroImport) never renders the zero-import alarm", async () => {
  const html = await renderAlert({ orgName: "Riverdance Co", settingsUrl: "https://app.showflow.pro/settings?tab=airtable" });
  assert(!(html.includes("ran but brought in zero dates")), "must not claim a zero-import run nobody asserted");
  assert(!(html.includes("Nothing from Airtable will reach ShowFlow")), "must not claim the zero-import branch's specific consequence either");
});

Deno.test("airtable-sync-held email: previewText differs between the held and zero-import branches, and from the subject", async () => {
  const held = await renderAlert({ orgName: "Riverdance Co", heldCount: 2, settingsUrl: "https://app.showflow.pro/settings?tab=airtable" });
  const zero = await renderAlert({ orgName: "Riverdance Co", zeroImport: true, settingsUrl: "https://app.showflow.pro/settings?tab=airtable" });
  assert(held.includes("2 Airtable records waiting on you in Riverdance Co"), "held preview names the count");
  assert(zero.includes("The Airtable sync in Riverdance Co brought in nothing this time"), "zero-import preview is its own sentence");
});

// The inbox snippet is read before the body: it must not promise a reason the body
// itself deliberately withholds ("Here's why" was false — the zero-import branch
// never gives a reason, it points at the sync report), and it must not invent a
// cadence the poll doesn't run on (airtable-poll runs every airtable_poll_interval_minutes,
// at any hour, not once a day, so "Today's" overclaimed a schedule).
Deno.test("airtable-sync-held email: zero-import previewText does not overclaim a reason or a daily cadence", async () => {
  const zero = await renderAlert({ orgName: "Riverdance Co", zeroImport: true, settingsUrl: "https://app.showflow.pro/settings?tab=airtable" });
  assert(!(zero.includes("Here&#x27;s why") || zero.includes("Here's why")), "the preview text must not promise a reason the body withholds");
  assert(!(zero.includes("Today")), "the preview text must not imply a daily sync cadence");
});

Deno.test("airtable-sync-held email: followup text does not just repeat the CTA's own navigation instruction", async () => {
  const html = await renderAlert({ orgName: "Riverdance Co", heldCount: 1, settingsUrl: "https://app.showflow.pro/settings?tab=airtable" });
  assert(!(html.includes("Settings")), "the followup sentence itself does not re-instruct where to click; the CTA button does that");
});

Deno.test("airtable-sync-held email: subject names the org and does not depend on held vs zero-import", async () => {
  assertEquals(template.subject({ orgName: "Riverdance Co" }), "Airtable sync needs attention in Riverdance Co");
});

// The top-reason line is a quantified breakdown ("N of M"), not a blanket single-cause
// claim like the removed pre-WP4b intro used to be — see notifyAdminsOnSyncProblem in
// airtable-poll/index.ts. It stays truthful even when the held set has mixed causes,
// because it only ever states the count for the category it names.
Deno.test("airtable-sync-held email: names the most common held reason as a quantified breakdown", async () => {
  const html = await renderAlert({
    orgName: "Riverdance Co",
    heldCount: 3,
    topReasonCategory: "unlinked_program",
    topReasonCount: 2,
    settingsUrl: "https://app.showflow.pro/settings?tab=airtable",
  });
  assert(html.includes("2 of the 3 are not linked to one of your shows"), "states the count and reason for the majority category as a sentence, not a report label");
});

// unlinked_city is the third held cause (a mapped, non-empty city with no linked catalog
// city): the email must name it too, not fall through to no breakdown line.
Deno.test("airtable-sync-held email: names an unlinked-city top reason", async () => {
  const html = await renderAlert({
    orgName: "Riverdance Co",
    heldCount: 3,
    topReasonCategory: "unlinked_city",
    topReasonCount: 2,
    settingsUrl: "https://app.showflow.pro/settings?tab=airtable",
  });
  assert(html.includes("2 of the 3 are using a city that isn't linked to one of yours") || html.includes("2 of the 3 are using a city that isn&#x27;t linked to one of yours"), "states the count and the unlinked-city reason");
});

// The minimal mixed-cause case is completely ordinary (two held records, one blank
// date cell, one unlinked program): the majority category then counts exactly one
// record, and "1 of the 2 are" is subject-verb disagreement. The partial-breakdown
// line needs a singular form, not just the redundant-fraction shortcuts below.
Deno.test("airtable-sync-held email: a partial breakdown counting one record agrees in number", async () => {
  const html = await renderAlert({
    orgName: "Riverdance Co",
    heldCount: 2,
    topReasonCategory: "missing_date",
    topReasonCount: 1,
    settingsUrl: "https://app.showflow.pro/settings?tab=airtable",
  });
  assert(html.includes("1 of the 2 is missing a date"), "singular count takes a singular verb");
  assert(!(html.includes("1 of the 2 are")), "never pairs a singular count with a plural verb");
});

// A single held record has exactly one reason: "1 of 1" is a robotic way to say
// "this one". State it directly instead of a redundant fraction.
Deno.test("airtable-sync-held email: a single held record states its reason directly, not as a 1-of-1 fraction", async () => {
  const html = await renderAlert({
    orgName: "Riverdance Co",
    heldCount: 1,
    topReasonCategory: "missing_date",
    topReasonCount: 1,
    settingsUrl: "https://app.showflow.pro/settings?tab=airtable",
  });
  assert(html.includes("It&#x27;s missing a date") || html.includes("It's missing a date"), "states the single record's reason directly");
  assert(!(html.includes("1 of 1")), "never renders a 1-of-1 fraction");
});

// When every currently-held record shares the same reason, "N of N" is also a
// redundant fraction (it always equals "all of them"): say so plainly instead.
Deno.test("airtable-sync-held email: when every held record shares the reason, says all of them instead of an N-of-N fraction", async () => {
  const html = await renderAlert({
    orgName: "Riverdance Co",
    heldCount: 2,
    topReasonCategory: "unlinked_program",
    topReasonCount: 2,
    settingsUrl: "https://app.showflow.pro/settings?tab=airtable",
  });
  assert(html.includes("All 2 are not linked to one of your shows"), "states the reason applies to the whole held set, as a sentence");
  assert(!(html.includes("2 of 2")), "never renders a redundant N-of-N fraction");
});

Deno.test("airtable-sync-held email: without a topReasonCategory, no reason breakdown line renders", async () => {
  const html = await renderAlert({ orgName: "Riverdance Co", heldCount: 2, settingsUrl: "https://app.showflow.pro/settings?tab=airtable" });
  assert(!(html.includes(" of ")), "no quantified breakdown line without a resolved top reason");
});

Deno.test("airtable-sync-held email: a topReasonCategory is ignored on the zero-import branch (nothing was held)", async () => {
  const html = await renderAlert({
    orgName: "Riverdance Co",
    zeroImport: true,
    topReasonCategory: "missing_date",
    topReasonCount: 1,
    settingsUrl: "https://app.showflow.pro/settings?tab=airtable",
  });
  assert(!(html.includes("missing a date")), "the held-reason breakdown never applies to a zero-import run");
});
