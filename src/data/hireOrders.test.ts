import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  fetchHireOrdersForDate,
  fetchHireOrder,
  fetchMyHireOrders,
  fetchHireOrders,
  fetchAwaitingCountersignCount,
  invokeHireOrderAction,
  updateHireOrderStatus,
  fetchArtistsLite,
  fetchShowDatesLite,
} from "./hireOrders";

describe("fetchHireOrdersForDate", () => {
  it("filters by show_date_id and orders by created_at", async () => {
    const fake = createFakeSupabase({
      hire_orders: { data: [{ id: "ho-1", show_date_id: "d1", artists: { name: "Lena" } }], error: null },
    });
    const res = await fetchHireOrdersForDate(fake as never, "d1");
    expect(res).toEqual([{ id: "ho-1", show_date_id: "d1", artists: { name: "Lena" } }]);
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "eq", args: ["show_date_id", "d1"] });
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "order", args: ["created_at", { ascending: true }] });
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: { message: "boom" } } });
    await expect(fetchHireOrdersForDate(fake as never, "d1")).rejects.toBeTruthy();
  });

  it("returns [] when there are no rows", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null } });
    expect(await fetchHireOrdersForDate(fake as never, "d1")).toEqual([]);
  });
});

describe("fetchHireOrder", () => {
  it("fetches a single order by id", async () => {
    const fake = createFakeSupabase({
      hire_orders: { data: { id: "ho-1", artists: { name: "Lena" } }, error: null },
    });
    const res = await fetchHireOrder(fake as never, "ho-1");
    expect(res).toEqual({ id: "ho-1", artists: { name: "Lena" } });
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "eq", args: ["id", "ho-1"] });
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "single", args: [] });
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: { message: "not found" } } });
    await expect(fetchHireOrder(fake as never, "ho-1")).rejects.toBeTruthy();
  });
});

describe("fetchMyHireOrders", () => {
  it("filters by artist_id in artistIds and status in issued/countersigned", async () => {
    const fake = createFakeSupabase({
      hire_orders: { data: [{ id: "ho-1", artist_id: "a1", status: "issued" }], error: null },
    });
    const res = await fetchMyHireOrders(fake as never, ["a1", "a2"]);
    expect(res).toEqual([{ id: "ho-1", artist_id: "a1", status: "issued" }]);
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "in", args: ["artist_id", ["a1", "a2"]] });
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "in", args: ["status", ["issued", "countersigned"]] });
  });

  it("returns [] without querying when artistIds is empty", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchMyHireOrders(fake as never, [])).toEqual([]);
    expect(fake.calls).toEqual([]);
  });
});

describe("invokeHireOrderAction", () => {
  it("calls functions.invoke('generate-hire-orders', { body }) with the given body", async () => {
    const fake = createFakeSupabase({
      "fn:generate-hire-orders": { data: { created: ["ho-1"], skipped: [] }, error: null },
    });
    const body = { action: "draft", org_id: "org-1", show_date_id: "d1" };
    const res = await invokeHireOrderAction(fake as never, body);
    expect(res).toEqual({ created: ["ho-1"], skipped: [] });
    expect(fake.calls).toContainEqual({ table: "fn:generate-hire-orders", method: "invoke", args: [body] });
  });

  it("throws on a transport error", async () => {
    const fake = createFakeSupabase({ "fn:generate-hire-orders": { data: null, error: { message: "network" } } });
    await expect(invokeHireOrderAction(fake as never, { action: "draft", org_id: "org-1" })).rejects.toBeTruthy();
  });
});

describe("fetchHireOrders", () => {
  const rows = [
    {
      id: "ho-1", order_no: "HO-2026-0201-1", status: "draft", org_id: "org-1",
      artists: { name: "Ada Lovelace" }, show_dates: { date: "2026-02-01", venue: "Main Hall" },
      created_at: "2026-01-03T00:00:00Z",
    },
    {
      id: "ho-2", order_no: "HO-2026-0301-1", status: "issued", org_id: "org-1",
      artists: { name: "Zed Zeta" }, show_dates: { date: "2026-03-01", venue: "West Wing" },
      created_at: "2026-01-02T00:00:00Z",
    },
    {
      id: "ho-3", order_no: "HO-2026-0401-1", status: "countersigned", org_id: "org-1",
      artists: { name: "Mira Voss" }, show_dates: { date: "2026-04-01", venue: "East Hall" },
      created_at: "2026-01-01T00:00:00Z",
    },
  ];

  it("filters by org_id, selects the artist+show_date join, and orders by created_at desc", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: rows, error: null } });
    const res = await fetchHireOrders(fake as never, "org-1", {});
    expect(res.map((r) => r.id)).toEqual(["ho-1", "ho-2", "ho-3"]);
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({
      table: "hire_orders", method: "select", args: ["*, artists(name), show_dates(date, venue)"],
    });
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "order", args: ["created_at", { ascending: false }] });
  });

  it("applies a status filter via .in() when given", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: rows, error: null } });
    const res = await fetchHireOrders(fake as never, "org-1", { status: ["draft"] });
    expect(res.map((r) => r.id)).toEqual(["ho-1"]);
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "in", args: ["status", ["draft"]] });
  });

  it("does not call .in() when no status filter is given", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: rows, error: null } });
    await fetchHireOrders(fake as never, "org-1", {});
    expect(fake.calls.some((c) => c.table === "hire_orders" && c.method === "in")).toBe(false);
  });

  it("searches order_no server-side via ilike", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: rows, error: null } });
    const res = await fetchHireOrders(fake as never, "org-1", { search: "0301" });
    expect(res.map((r) => r.id)).toEqual(["ho-2"]);
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "ilike", args: ["order_no", "%0301%"] });
  });

  it("matches by artist name in JS when order_no does not match (joined-column workaround)", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: rows, error: null } });
    const res = await fetchHireOrders(fake as never, "org-1", { search: "mira" });
    expect(res.map((r) => r.id)).toEqual(["ho-3"]);
  });

  it("merges order_no and artist-name matches without duplicates", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: rows, error: null } });
    const res = await fetchHireOrders(fake as never, "org-1", { search: "ada" });
    expect(res.map((r) => r.id)).toEqual(["ho-1"]);
  });

  it("returns [] when a search term matches nothing", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: rows, error: null } });
    const res = await fetchHireOrders(fake as never, "org-1", { search: "nonexistent" });
    expect(res).toEqual([]);
  });

  it("combines a status filter with a search term", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: rows, error: null } });
    // "zeta" matches ho-2's artist name; the status filter additionally excludes
    // ho-1 (draft) even though it wouldn't match the search term anyway.
    const res = await fetchHireOrders(fake as never, "org-1", { status: ["issued", "countersigned"], search: "zeta" });
    expect(res.map((r) => r.id)).toEqual(["ho-2"]);
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: { message: "boom" } } });
    await expect(fetchHireOrders(fake as never, "org-1", {})).rejects.toBeTruthy();
  });

  it("returns [] when there are no rows", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null } });
    expect(await fetchHireOrders(fake as never, "org-1", {})).toEqual([]);
  });
});

describe("fetchAwaitingCountersignCount", () => {
  it("counts only status=issued rows for the org via a head count", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: [], error: null, count: 4 } });
    const res = await fetchAwaitingCountersignCount(fake as never, "org-1");
    expect(res).toBe(4);
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "eq", args: ["status", "issued"] });
    expect(fake.calls).toContainEqual({
      table: "hire_orders", method: "select", args: ["id", { count: "exact", head: true }],
    });
  });

  it("returns 0 when count is null", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null, count: null } });
    expect(await fetchAwaitingCountersignCount(fake as never, "org-1")).toBe(0);
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: { message: "boom" } } });
    await expect(fetchAwaitingCountersignCount(fake as never, "org-1")).rejects.toBeTruthy();
  });
});

describe("fetchArtistsLite", () => {
  it("returns [] without querying when orgId is null", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchArtistsLite(fake as never, null)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("selects id/name/email, filters by org_id, orders by name", async () => {
    const fake = createFakeSupabase({
      artists: { data: [{ id: "a1", name: "Ann", email: "ann@x.de" }], error: null },
    });
    const res = await fetchArtistsLite(fake as never, "org-1");
    expect(res).toEqual([{ id: "a1", name: "Ann", email: "ann@x.de" }]);
    expect(fake.calls).toContainEqual({ table: "artists", method: "select", args: ["id, name, email"] });
    expect(fake.calls).toContainEqual({ table: "artists", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "artists", method: "order", args: ["name"] });
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ artists: { data: null, error: { message: "boom" } } });
    await expect(fetchArtistsLite(fake as never, "org-1")).rejects.toBeTruthy();
  });

  it("returns [] when there are no rows", async () => {
    const fake = createFakeSupabase({ artists: { data: null, error: null } });
    expect(await fetchArtistsLite(fake as never, "org-1")).toEqual([]);
  });
});

describe("fetchShowDatesLite", () => {
  it("returns [] without querying when orgId is null", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchShowDatesLite(fake as never, null)).toEqual([]);
    expect(fake.calls).toEqual([]);
  });

  it("selects date/venue/duration/sessions with the joined city name, filters by org_id, orders by date desc", async () => {
    const fake = createFakeSupabase({
      show_dates: {
        data: [
          {
            id: "sd1", date: "2026-03-01", venue: "Main Hall", duration_minutes: 90,
            session_1: "19:00", session_2: null, session_3: "22:00",
            cities: { name: "Berlin" },
          },
        ],
        error: null,
      },
    });
    const res = await fetchShowDatesLite(fake as never, "org-1");
    expect(res).toEqual([{
      id: "sd1", date: "2026-03-01", venue: "Main Hall", city: "Berlin",
      duration_minutes: 90, sessions: ["19:00", "22:00"],
    }]);
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "order", args: ["date", { ascending: false }] });
  });

  it("maps a null city and no sessions", async () => {
    const fake = createFakeSupabase({
      show_dates: {
        data: [{ id: "sd2", date: "2026-04-01", venue: null, duration_minutes: null, session_1: null, session_2: null, session_3: null, cities: null }],
        error: null,
      },
    });
    const res = await fetchShowDatesLite(fake as never, "org-1");
    expect(res).toEqual([{ id: "sd2", date: "2026-04-01", venue: null, city: null, duration_minutes: null, sessions: [] }]);
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ show_dates: { data: null, error: { message: "boom" } } });
    await expect(fetchShowDatesLite(fake as never, "org-1")).rejects.toBeTruthy();
  });

  it("returns [] when there are no rows", async () => {
    const fake = createFakeSupabase({ show_dates: { data: null, error: null } });
    expect(await fetchShowDatesLite(fake as never, "org-1")).toEqual([]);
  });
});

describe("updateHireOrderStatus", () => {
  it("updates only status for a non-countersigned status", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null } });
    await updateHireOrderStatus(fake as never, "ho-1", "void");
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "update", args: [{ status: "void" }] });
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "eq", args: ["id", "ho-1"] });
  });

  it("also sets countersigned_at when transitioning to countersigned", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null } });
    await updateHireOrderStatus(fake as never, "ho-1", "countersigned");
    const update = fake.calls.find((c) => c.table === "hire_orders" && c.method === "update");
    expect(update?.args[0]).toMatchObject({ status: "countersigned" });
    expect(typeof (update?.args[0] as { countersigned_at?: string }).countersigned_at).toBe("string");
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: { message: "boom" } } });
    await expect(updateHireOrderStatus(fake as never, "ho-1", "void")).rejects.toBeTruthy();
  });
});
