import { describe, expect, it } from "vitest";
import { ORDER_FIELD_KEYS, type EditableOrderFieldKey, type OrderData } from "./types";

describe("ORDER_FIELD_KEYS", () => {
  it("lists every order field key exactly once, in a fixed order", () => {
    expect(ORDER_FIELD_KEYS).toEqual([
      "artist_name",
      "recipient_email",
      "role",
      "cast",
      "date",
      "venue",
      "city",
      "duration_min",
      "sessions",
      "fee",
      "currency",
      "notes",
    ]);
    expect(new Set(ORDER_FIELD_KEYS).size).toBe(ORDER_FIELD_KEYS.length);
  });
});

describe("derived fee snapshot fields", () => {
  it("stores fee_basis and fee_per_date on OrderData", () => {
    const data: OrderData = {
      fee: { value: 1500, source: "manual" },
      fee_basis: { value: "per_date", source: "manual" },
      fee_per_date: { value: 500, source: "manual" },
    };
    expect(data.fee_basis?.value).toBe("per_date");
    expect(data.fee_per_date?.value).toBe(500);
  });

  it("keeps them out of the editable field list", () => {
    expect(ORDER_FIELD_KEYS).not.toContain("fee_basis" as EditableOrderFieldKey);
    expect(ORDER_FIELD_KEYS).not.toContain("fee_per_date" as EditableOrderFieldKey);
    // The editable list is unchanged by this task.
    expect(ORDER_FIELD_KEYS).toHaveLength(12);
  });
});
