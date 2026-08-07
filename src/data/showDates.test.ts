import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { createShowDate, updateShowDate, cancelShowDate, deleteShowDate, fetchShowDatesForShow, fetchNextRehearsalDate } from "./showDates";

describe("showDates data-access", () => {
  it("createShowDate inserts mapped fields (no status set) and returns id", async () => {
    const fake = createFakeSupabase({ show_dates: { data: { id: "d1" }, error: null } });
    const res = await createShowDate(fake as never, {
      orgId: "org-1", showId: "s1", date: "2026-07-01",
      session1: "19:30", session2: null, session3: null, venue: "Hall", cityId: "c1", notes: "n",
    });
    expect(res).toEqual({ id: "d1" });
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "insert", args: [{
      org_id: "org-1", show_id: "s1", date: "2026-07-01",
      session_1: "19:30", session_2: null, session_3: null, venue: "Hall", city_id: "c1", notes: "n",
    }] });
  });

  it("updateShowDate patches by id", async () => {
    const fake = createFakeSupabase({ show_dates: { data: null, error: null } });
    await updateShowDate(fake as never, "d1", { venue: "New", session_1: "20:00" });
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "update", args: [{ venue: "New", session_1: "20:00" }] });
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "eq", args: ["id", "d1"] });
  });

  it("cancelShowDate sets status cancelled + reason", async () => {
    const fake = createFakeSupabase({ show_dates: { data: null, error: null } });
    await cancelShowDate(fake as never, "d1", "venue lost");
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "update", args: [{ status: "cancelled", cancellation_reason: "venue lost" }] });
  });

  it("deleteShowDate deletes by id", async () => {
    const fake = createFakeSupabase({ show_dates: { data: null, error: null } });
    await deleteShowDate(fake as never, "d1");
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "delete", args: [] });
  });

  it("fetchShowDatesForShow scopes by show_id, returns dup-check rows", async () => {
    const rows = [{ id: "d1", show_id: "s1", date: "2026-07-01", status: "open" }];
    const fake = createFakeSupabase({ show_dates: { data: rows, error: null } });
    const res = await fetchShowDatesForShow(fake as never, "s1");
    expect(res).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "eq", args: ["show_id", "s1"] });
  });

  it("fetchShowDatesForShow returns [] for null show", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchShowDatesForShow(fake as never, null)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });
});

describe("fetchNextRehearsalDate", () => {
  it("returns the soonest future non-cancelled date that has a city", async () => {
    const client = createFakeSupabase({
      show_dates: { data: [{ id: "d1", date: "2026-09-18", city_id: "c1" }], error: null },
    });
    const r = await fetchNextRehearsalDate(client as never, { orgId: "org-1", today: "2026-08-07" });
    expect(r).toEqual({ id: "d1", date: "2026-09-18" });
  });

  it("returns null when nothing qualifies", async () => {
    const client = createFakeSupabase({ show_dates: { data: [], error: null } });
    expect(await fetchNextRehearsalDate(client as never, { orgId: "org-1", today: "2026-08-07" })).toBeNull();
  });

  it("filters to future, non-cancelled dates with a city and orders/limits (calls-level pin, seed data can't prove a dropped filter)", async () => {
    const client = createFakeSupabase({ show_dates: { data: [], error: null } });
    await fetchNextRehearsalDate(client as never, { orgId: "org-1", today: "2026-08-07" });
    expect(client.calls).toContainEqual({ table: "show_dates", method: "not", args: ["city_id", "is", null] });
    expect(client.calls).toContainEqual({ table: "show_dates", method: "neq", args: ["status", "cancelled"] });
    expect(client.calls).toContainEqual({ table: "show_dates", method: "gte", args: ["date", "2026-08-07"] });
    expect(client.calls).toContainEqual({ table: "show_dates", method: "order", args: ["date", { ascending: true }] });
    expect(client.calls).toContainEqual({ table: "show_dates", method: "limit", args: [1] });
  });
});
