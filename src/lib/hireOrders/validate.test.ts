import { describe, expect, it } from "vitest";
import { resolveFields } from "./resolveFields";
import { orderReadyIssues } from "./validate";

describe("orderReadyIssues", () => {
  it("ready gate requires fee, recipient email, date, and letterhead legal name", () => {
    expect(orderReadyIssues({}, {})).toEqual(expect.arrayContaining([
      "missing_fee", "missing_recipient_email", "missing_date", "missing_letterhead",
    ]));
    const ok = resolveFields({ manual: { fee: "4500", recipient_email: "a@b.de", date: "2026-06-15", artist_name: "M" } });
    expect(orderReadyIssues(ok, { legal_name: "Aurora GmbH" })).toEqual([]);
  });
});
