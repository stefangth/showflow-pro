import { describe, it, expect } from "vitest";
import { orderDate, snap } from "./orderDate";
import type { HireOrderListRow } from "@/data/hireOrders";
import type { OrderData } from "@/lib/hireOrders/types";

function row(overrides: Partial<HireOrderListRow> = {}): HireOrderListRow {
  return { id: "ho-1", data: {}, show_dates: null, ...overrides } as HireOrderListRow;
}

describe("snap", () => {
  it("reads a resolved snapshot field as a trimmed string", () => {
    expect(snap({ date: { value: "2026-02-01", source: "manual" } } as OrderData, "date")).toBe(
      "2026-02-01",
    );
  });

  it("returns an empty string when the field is absent", () => {
    expect(snap({} as OrderData, "date")).toBe("");
  });

  it("returns an empty string when the field's value is null", () => {
    expect(snap({ date: { value: null, source: "manual" } } as unknown as OrderData, "date")).toBe("");
  });
});

describe("orderDate", () => {
  it("prefers the linked show_date's date over the manual data.date fallback", () => {
    const o = row({
      show_dates: { date: "2030-01-01", venue: "Hall" },
      data: { date: { value: "2020-01-01", source: "manual" } },
    });
    const d = orderDate(o);
    expect(d?.getFullYear()).toBe(2030);
  });

  it("falls back to the manual data.date when there is no linked show_date", () => {
    const o = row({ show_dates: null, data: { date: { value: "2020-06-15", source: "manual" } } });
    const d = orderDate(o);
    expect(d?.getFullYear()).toBe(2020);
    expect(d?.getMonth()).toBe(5); // June = 5
    expect(d?.getDate()).toBe(15);
  });

  it("returns null when neither a linked date nor a manual date exists", () => {
    expect(orderDate(row({ show_dates: null, data: {} }))).toBeNull();
  });

  it("rejects a non-YYYY-MM-DD manual date value instead of parsing garbage", () => {
    expect(
      orderDate(row({ show_dates: null, data: { date: { value: "not-a-date", source: "manual" } } })),
    ).toBeNull();
  });
});
