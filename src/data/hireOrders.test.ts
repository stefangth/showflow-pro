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
  updateHireOrderDraft,
  updateHireOrderReview,
  fetchShowflowLayerForOrder,
  fetchArtistsLite,
  fetchShowDatesLite,
  bulkImportHireOrders,
  createArtistLite,
  fetchTermsLibrary,
  importTermsTemplates,
  TERMS_LIBRARY_KEY,
} from "./hireOrders";
import { HIRE_ORDER_STARTER_TERMS } from "@/lib/hireOrders/starterTerms";

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

  it("includes aggregate orders linked to the date and deduplicates a legacy parent", async () => {
    const legacy = {
      id: "ho-legacy",
      show_date_id: "d1",
      created_at: "2026-06-01T00:00:00Z",
      artists: { name: "Lena" },
    };
    const aggregate = {
      id: "ho-aggregate",
      show_date_id: null,
      created_at: "2026-06-02T00:00:00Z",
      artists: { name: "Miro" },
    };
    const fake = createFakeSupabase({
      hire_order_dates: {
        data: [
          { hire_order_id: "ho-legacy" },
          { hire_order_id: "ho-aggregate" },
        ],
        error: null,
      },
      hire_orders: [
        { when: { show_date_id: "d1" }, data: [legacy], error: null },
        { data: [legacy, aggregate], error: null },
      ],
    });

    await expect(fetchHireOrdersForDate(fake as never, "d1")).resolves.toEqual([
      legacy,
      aggregate,
    ]);
    expect(fake.calls).toContainEqual({ table: "hire_order_dates", method: "eq", args: ["show_date_id", "d1"] });
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "in", args: ["id", ["ho-legacy", "ho-aggregate"]] });
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
    expect(fake.calls).toContainEqual({
      table: "hire_orders",
      method: "select",
      args: ["*, artists(name), hire_order_dates(show_date_id)"],
    });
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
      table: "hire_orders",
      method: "select",
      args: ["*, artists(name), show_dates!hire_orders_show_date_id_fkey(date, venue)"],
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

describe("updateHireOrderDraft", () => {
  const DATA = { artist_name: { value: "Ada Lovelace", source: "manual" } };

  it("writes the full data snapshot and the id filter", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null } });
    await updateHireOrderDraft(fake as never, "ho-1", { data: DATA as never });
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "update", args: [{ data: DATA }] });
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "eq", args: ["id", "ho-1"] });
  });

  it("writes fee_amount as a number when given a string, and fee_currency/terms_variant when given", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null } });
    await updateHireOrderDraft(fake as never, "ho-1", {
      data: DATA as never, fee_amount: "4500.5", fee_currency: "USD", terms_variant: "full",
    });
    const update = fake.calls.find((c) => c.table === "hire_orders" && c.method === "update");
    expect(update?.args[0]).toEqual({ data: DATA, fee_amount: 4500.5, fee_currency: "USD", terms_variant: "full" });
  });

  it("writes fee_amount null for null or empty string, without touching omitted columns", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null } });
    await updateHireOrderDraft(fake as never, "ho-1", { data: DATA as never, fee_amount: null });
    let update = fake.calls.find((c) => c.table === "hire_orders" && c.method === "update");
    expect(update?.args[0]).toEqual({ data: DATA, fee_amount: null });

    fake.calls.length = 0;
    await updateHireOrderDraft(fake as never, "ho-1", { data: DATA as never, fee_amount: "" });
    update = fake.calls.find((c) => c.table === "hire_orders" && c.method === "update");
    expect(update?.args[0]).toEqual({ data: DATA, fee_amount: null });
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: { message: "boom" } } });
    await expect(updateHireOrderDraft(fake as never, "ho-1", { data: DATA as never })).rejects.toBeTruthy();
  });
});

describe("updateHireOrderReview agent override", () => {
  it("writes agent_name/agent_email when provided", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null } });
    await updateHireOrderReview(
      fake as never,
      "ho-1",
      { feeAmount: 500, termsVariant: "standard", agentName: "Solo Agent", agentEmail: "solo@x.com" },
      { artist_name: { value: "Ada", source: "showflow" } },
    );
    const update = fake.calls.find((c) => c.table === "hire_orders" && c.method === "update");
    const patch = update!.args[0] as { agent_name?: string; agent_email?: string };
    expect(patch.agent_name).toBe("Solo Agent");
    expect(patch.agent_email).toBe("solo@x.com");
  });

  it("omits agent columns entirely when not provided", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null } });
    await updateHireOrderReview(
      fake as never,
      "ho-1",
      { feeAmount: 500, termsVariant: "standard" },
      {},
    );
    const update = fake.calls.find((c) => c.table === "hire_orders" && c.method === "update");
    const patch = update!.args[0] as Record<string, unknown>;
    expect("agent_name" in patch).toBe(false);
    expect("agent_email" in patch).toBe(false);
  });
});

describe("updateHireOrderReview derived fee fields", () => {
  /** A 3-date aggregate billed at 500 per date: fee is the TOTAL, the two
   *  derived keys explain how it was reached. */
  const PER_DATE_SNAPSHOT = {
    artist_name: { value: "Ada", source: "showflow" },
    fee: { value: 1500, source: "manual" },
    fee_basis: { value: "per_date", source: "manual" },
    fee_per_date: { value: 500, source: "manual" },
    engagement_dates: {
      value: [
        { show_date_id: "d1", date: "2026-06-15", venue: "A", city: "Berlin" },
        { show_date_id: "d2", date: "2026-06-16", venue: "B", city: "Hamburg" },
        { show_date_id: "d3", date: "2026-06-17", venue: "C", city: "Munich" },
      ],
      source: "showflow",
    },
  };

  async function review(feeAmount: number | null, currentData: Record<string, unknown> = PER_DATE_SNAPSHOT) {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null } });
    await updateHireOrderReview(
      fake as never,
      "ho-1",
      { feeAmount, termsVariant: "standard" },
      currentData as never,
    );
    const update = fake.calls.find((c) => c.table === "hire_orders" && c.method === "update");
    return (update!.args[0] as { data: Record<string, unknown> }).data;
  }

  it("drops fee_basis and fee_per_date when the fee is changed", async () => {
    // Without this, the order issues a PDF reading "500.00 per date x 3 dates"
    // above a 1,200.00 total -- false arithmetic on an immutable document.
    const data = await review(1200);
    expect("fee_basis" in data).toBe(false);
    expect("fee_per_date" in data).toBe(false);
    expect(data.fee).toEqual({ value: 1200, source: "manual" });
    // Everything else in the snapshot is still preserved untouched.
    expect(data.artist_name).toEqual({ value: "Ada", source: "showflow" });
    expect(data.engagement_dates).toEqual(PER_DATE_SNAPSHOT.engagement_dates);
  });

  it("keeps them when the fee is unchanged (a terms-only or agent-only edit)", async () => {
    const data = await review(1500);
    expect(data.fee_basis).toEqual({ value: "per_date", source: "manual" });
    expect(data.fee_per_date).toEqual({ value: 500, source: "manual" });
  });

  it("treats the string spelling of the stored fee as unchanged", async () => {
    const data = await review(1500, { ...PER_DATE_SNAPSHOT, fee: { value: "1500.00", source: "sheet" } });
    expect(data.fee_basis).toEqual({ value: "per_date", source: "manual" });
  });

  it("drops them when the fee is cleared entirely", async () => {
    const data = await review(null);
    expect("fee_basis" in data).toBe(false);
    expect("fee_per_date" in data).toBe(false);
    expect(data.fee).toEqual({ value: null, source: "manual" });
  });

  it("leaves a legacy snapshot with no derived fields alone", async () => {
    const data = await review(1200, { fee: { value: 1500, source: "manual" } });
    expect("fee_basis" in data).toBe(false);
    expect(data.fee).toEqual({ value: 1200, source: "manual" });
  });
});

describe("fetchShowflowLayerForOrder", () => {
  it("returns {} without querying when both ids are null", async () => {
    const fake = createFakeSupabase({});
    expect(await fetchShowflowLayerForOrder(fake as never, { showDateId: null, artistId: null })).toEqual({});
    expect(fake.calls).toEqual([]);
  });

  it("maps the artist row to artist_name/recipient_email/role", async () => {
    const fake = createFakeSupabase({
      artists: { data: { name: "Ada Lovelace", email: "ada@example.com", cast_role: "Lead" }, error: null },
    });
    const res = await fetchShowflowLayerForOrder(fake as never, { showDateId: null, artistId: "a1" });
    expect(res).toEqual({ artist_name: "Ada Lovelace", recipient_email: "ada@example.com", role: "Lead" });
    expect(fake.calls).toContainEqual({ table: "artists", method: "select", args: ["name, email, cast_role"] });
    expect(fake.calls).toContainEqual({ table: "artists", method: "eq", args: ["id", "a1"] });
  });

  it("skips null artist fields (email/role) rather than assigning null", async () => {
    const fake = createFakeSupabase({
      artists: { data: { name: "Ada Lovelace", email: null, cast_role: null }, error: null },
    });
    const res = await fetchShowflowLayerForOrder(fake as never, { showDateId: null, artistId: "a1" });
    expect(res).toEqual({ artist_name: "Ada Lovelace" });
  });

  it("maps the show_date row to date/venue/city/duration_min/sessions", async () => {
    const fake = createFakeSupabase({
      show_dates: {
        data: {
          date: "2026-02-01", venue: "Main Hall", duration_minutes: 90,
          session_1: "19:00", session_2: null, session_3: "22:00",
          cities: { name: "Berlin" },
        },
        error: null,
      },
    });
    const res = await fetchShowflowLayerForOrder(fake as never, { showDateId: "sd-1", artistId: null });
    expect(res).toEqual({
      date: "2026-02-01", venue: "Main Hall", city: "Berlin",
      duration_min: 90, sessions: ["19:00", "22:00"],
    });
    expect(fake.calls).toContainEqual({ table: "show_dates", method: "eq", args: ["id", "sd-1"] });
  });

  it("omits city and sessions when there is no city / no sessions", async () => {
    const fake = createFakeSupabase({
      show_dates: {
        data: {
          date: "2026-02-01", venue: null, duration_minutes: null,
          session_1: null, session_2: null, session_3: null, cities: null,
        },
        error: null,
      },
    });
    const res = await fetchShowflowLayerForOrder(fake as never, { showDateId: "sd-1", artistId: null });
    expect(res).toEqual({ date: "2026-02-01" });
  });

  it("fetches both artist and show_date in parallel when both ids are given", async () => {
    const fake = createFakeSupabase({
      artists: { data: { name: "Ada Lovelace", email: "ada@example.com", cast_role: "Lead" }, error: null },
      show_dates: {
        data: { date: "2026-02-01", venue: "Main Hall", duration_minutes: 90, session_1: null, session_2: null, session_3: null, cities: null },
        error: null,
      },
    });
    const res = await fetchShowflowLayerForOrder(fake as never, { showDateId: "sd-1", artistId: "a1" });
    expect(res).toEqual({
      artist_name: "Ada Lovelace", recipient_email: "ada@example.com", role: "Lead",
      date: "2026-02-01", venue: "Main Hall", duration_min: 90,
    });
  });

  it("throws on an artist supabase error", async () => {
    const fake = createFakeSupabase({ artists: { data: null, error: { message: "boom" } } });
    await expect(fetchShowflowLayerForOrder(fake as never, { showDateId: null, artistId: "a1" })).rejects.toBeTruthy();
  });

  it("throws on a show_date supabase error", async () => {
    const fake = createFakeSupabase({ show_dates: { data: null, error: { message: "boom" } } });
    await expect(fetchShowflowLayerForOrder(fake as never, { showDateId: "sd-1", artistId: null })).rejects.toBeTruthy();
  });
});

describe("bulkImportHireOrders", () => {
  it("calls the bulk_import_hire_orders RPC with p_org/p_import/p_rows and returns the per-row results", async () => {
    const results = [
      { row_index: 0, status: "created", order_id: "ho-1" },
      { row_index: 1, status: "skipped_existing" },
    ];
    const fake = createFakeSupabase({
      "rpc:bulk_import_hire_orders": { data: results, error: null },
    });
    const importMeta = { source: "csv" as const, file_name: "artists.csv", mapping: { artist_name: "Name" }, row_count: 2 };
    const rows = [
      {
        row_index: 0,
        artist_id: "a1",
        show_date_id: "sd1",
        data: { fee: { value: "500.00", source: "sheet" as const } },
        fee_amount: 500,
        fee_currency: "EUR",
        terms_variant: "standard",
      },
    ];
    const res = await bulkImportHireOrders(fake as never, { orgId: "org-1", import: importMeta, rows });
    expect(res).toEqual(results);
    expect(fake.calls).toContainEqual({
      table: "rpc:bulk_import_hire_orders",
      method: "rpc",
      args: [{ p_org: "org-1", p_import: importMeta, p_rows: rows }],
    });
  });

  it("returns [] when the RPC returns null", async () => {
    const fake = createFakeSupabase({ "rpc:bulk_import_hire_orders": { data: null, error: null } });
    const res = await bulkImportHireOrders(fake as never, {
      orgId: "org-1",
      import: { source: "gsheet", file_name: null, mapping: {}, row_count: 0 },
      rows: [],
    });
    expect(res).toEqual([]);
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ "rpc:bulk_import_hire_orders": { data: null, error: { message: "forbidden" } } });
    await expect(
      bulkImportHireOrders(fake as never, {
        orgId: "org-1",
        import: { source: "xlsx", file_name: "f.xlsx", mapping: {}, row_count: 0 },
        rows: [],
      }),
    ).rejects.toBeTruthy();
  });
});

describe("createArtistLite", () => {
  it("inserts a new artist scoped to the org and returns its lite shape", async () => {
    const fake = createFakeSupabase({
      artists: { data: { id: "a-new", name: "Walk-in Artist", email: "walkin@example.com" }, error: null },
    });
    const res = await createArtistLite(fake as never, { orgId: "org-1", name: "Walk-in Artist", email: "walkin@example.com" });
    expect(res).toEqual({ id: "a-new", name: "Walk-in Artist", email: "walkin@example.com" });
    expect(fake.calls).toContainEqual({
      table: "artists",
      method: "insert",
      args: [{ name: "Walk-in Artist", email: "walkin@example.com", org_id: "org-1" }],
    });
    expect(fake.calls).toContainEqual({ table: "artists", method: "single", args: [] });
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ artists: { data: null, error: { message: "boom" } } });
    await expect(createArtistLite(fake as never, { orgId: "org-1", name: "X", email: null })).rejects.toBeTruthy();
  });
});

describe("fetchTermsLibrary", () => {
  it("falls back to the code starter library when no platform row exists", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    expect(await fetchTermsLibrary(fake as never)).toEqual(HIRE_ORDER_STARTER_TERMS);
    expect(fake.calls).toContainEqual({ table: "app_settings", method: "eq", args: ["key", TERMS_LIBRARY_KEY] });
  });

  it("returns the platform row's templates when one exists", async () => {
    const templates = [{ id: "p1", name: "Custom", clauses: [{ title: "A", body: "B" }] }];
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: null, value: { templates } }], error: null },
    });
    expect(await fetchTermsLibrary(fake as never)).toEqual(templates);
  });

  it("falls back when the platform row is malformed", async () => {
    const fake = createFakeSupabase({
      app_settings: { data: [{ org_id: null, value: { templates: "nope" } }], error: null },
    });
    expect(await fetchTermsLibrary(fake as never)).toEqual(HIRE_ORDER_STARTER_TERMS);
  });
});

describe("importTermsTemplates", () => {
  it("upserts the merged setting onto hire_order_terms and returns it", async () => {
    const fake = createFakeSupabase({ app_settings: { data: [], error: null } });
    const next = await importTermsTemplates(fake as never, {
      orgId: "org-1",
      current: { templates: [], default_id: null },
      templates: HIRE_ORDER_STARTER_TERMS,
    });
    expect(next.default_id).toBe("platform-standard-engagement");
    expect(fake.calls).toContainEqual({
      table: "app_settings",
      method: "upsert",
      args: [
        { org_id: "org-1", key: "hire_order_terms", value: next },
        { onConflict: "org_id,key" },
      ],
    });
  });
});
