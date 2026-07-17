import { describe, expect, it } from "vitest";
import { ORDER_FIELD_KEYS } from "./types";

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
