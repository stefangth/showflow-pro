import { describe, it, expect } from "vitest";
import { computeSetupStatus } from "./setupStatus";
import type { HireOrderTermsSetting } from "./terms";

const EMPTY_TERMS: HireOrderTermsSetting = { templates: [], default_id: null };
const REAL_TERMS: HireOrderTermsSetting = {
  templates: [{ id: "t1", name: "Standard", clauses: [{ title: "Fee", body: "Payable in 14 days." }] }],
  default_id: "t1",
};

describe("computeSetupStatus", () => {
  it("reports nothing done on a fresh org", () => {
    const s = computeSetupStatus({ letterhead: null, terms: EMPTY_TERMS, countersignChosen: false });
    expect(s.steps.map((x) => x.key)).toEqual(["letterhead", "terms", "countersign"]);
    expect(s.steps.every((x) => !x.done)).toBe(true);
    expect(s.doneCount).toBe(0);
    expect(s.totalCount).toBe(3);
    expect(s.canIssue).toBe(false);
    expect(s.complete).toBe(false);
  });

  it("marks only letterhead and terms as blocking issue", () => {
    const s = computeSetupStatus({ letterhead: null, terms: EMPTY_TERMS, countersignChosen: false });
    expect(s.steps.filter((x) => x.blocksIssue).map((x) => x.key)).toEqual(["letterhead", "terms"]);
  });

  it("can issue once letterhead and terms are set, even with no countersign decision", () => {
    const s = computeSetupStatus({
      letterhead: { legal_name: "Aurora Productions GmbH" },
      terms: REAL_TERMS,
      countersignChosen: false,
    });
    expect(s.canIssue).toBe(true);
    expect(s.complete).toBe(false); // the decision is still outstanding
    expect(s.doneCount).toBe(2);
  });

  it("is complete only when the countersign decision is made too", () => {
    const s = computeSetupStatus({
      letterhead: { legal_name: "Aurora Productions GmbH" },
      terms: REAL_TERMS,
      countersignChosen: true,
    });
    expect(s.complete).toBe(true);
    expect(s.doneCount).toBe(3);
  });

  it("treats a whitespace-only legal name as missing", () => {
    const s = computeSetupStatus({ letterhead: { legal_name: "   " }, terms: REAL_TERMS, countersignChosen: true });
    expect(s.steps.find((x) => x.key === "letterhead")?.done).toBe(false);
    expect(s.canIssue).toBe(false);
  });

  // Matches the edge gate: issueOne pushes missing_terms when the RESOLVED variant has
  // no clauses, so templates that exist but are empty are not "done".
  it("treats templates that exist but have no clauses as missing", () => {
    const empty: HireOrderTermsSetting = {
      templates: [{ id: "t1", name: "Standard", clauses: [] }],
      default_id: "t1",
    };
    const s = computeSetupStatus({ letterhead: { legal_name: "X" }, terms: empty, countersignChosen: true });
    expect(s.steps.find((x) => x.key === "terms")?.done).toBe(false);
    expect(s.canIssue).toBe(false);
  });
});
