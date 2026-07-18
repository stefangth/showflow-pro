import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  fetchHireOrdersForDate,
  fetchHireOrder,
  fetchMyHireOrders,
  invokeHireOrderAction,
  updateHireOrderStatus,
  fetchHireOrders,
  fetchAwaitingCountersignCount,
  sanitizeSearchTerm,
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

describe("fetchHireOrders", () => {
  it("filters by org_id and orders by created_at descending", async () => {
    const fake = createFakeSupabase({
      hire_orders: { data: [{ id: "ho-1", org_id: "org-1" }], error: null },
    });
    const res = await fetchHireOrders(fake as never, "org-1", {});
    expect(res).toEqual([{ id: "ho-1", org_id: "org-1" }]);
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "order", args: ["created_at", { ascending: false }] });
    expect(fake.calls).toContainEqual({
      table: "hire_orders",
      method: "select",
      args: ["*, artists(name), show_dates(date, venue)"],
    });
  });

  it("applies a status filter via in() when given", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: [], error: null } });
    await fetchHireOrders(fake as never, "org-1", { status: ["draft", "ready"] });
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "in", args: ["status", ["draft", "ready"]] });
  });

  it("skips the status filter when empty or omitted", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: [], error: null } });
    await fetchHireOrders(fake as never, "org-1", { status: [] });
    expect(fake.calls.some((c) => c.method === "in")).toBe(false);
  });

  it("applies an ilike search across order_no and the joined artist name", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: [], error: null } });
    await fetchHireOrders(fake as never, "org-1", { search: "lena" });
    expect(fake.calls).toContainEqual({
      table: "hire_orders",
      method: "or",
      args: ["order_no.ilike.%lena%,artists.name.ilike.%lena%"],
    });
  });

  it("trims the search term and skips the filter when it is blank", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: [], error: null } });
    await fetchHireOrders(fake as never, "org-1", { search: "   " });
    expect(fake.calls.some((c) => c.method === "or")).toBe(false);
  });

  it("strips %/, from the search term before building the filter string", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: [], error: null } });
    await fetchHireOrders(fake as never, "org-1", { search: "50%, off" });
    expect(fake.calls).toContainEqual({
      table: "hire_orders",
      method: "or",
      args: ["order_no.ilike.%50 off%,artists.name.ilike.%50 off%"],
    });
  });

  it("strips parens/quotes so a term can't break out of the or() group", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: [], error: null } });
    // A term crafted to close the or(...) group early and inject a clause.
    await fetchHireOrders(fake as never, "org-1", { search: 'x) or (status.eq.void"' });
    const orCall = fake.calls.find((c) => c.table === "hire_orders" && c.method === "or");
    const filter = orCall?.args[0] as string;
    // No unescaped grouping/quoting metacharacters survive in the term.
    expect(filter).toBe(
      "order_no.ilike.%x or status.eq.void%,artists.name.ilike.%x or status.eq.void%",
    );
    // The only ')'/'('/'\"' anywhere are the ones the query never had to begin with.
    expect(filter).not.toContain(")");
    expect(filter).not.toContain("(");
    expect(filter).not.toContain('"');
  });

  it("returns [] when there are no rows", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null } });
    expect(await fetchHireOrders(fake as never, "org-1", {})).toEqual([]);
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: { message: "boom" } } });
    await expect(fetchHireOrders(fake as never, "org-1", {})).rejects.toBeTruthy();
  });
});

describe("fetchAwaitingCountersignCount", () => {
  it("counts only issued orders for the org", async () => {
    const fake = createFakeSupabase({ hire_orders: { data: null, error: null, count: 3 } });
    const res = await fetchAwaitingCountersignCount(fake as never, "org-1");
    expect(res).toBe(3);
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "eq", args: ["org_id", "org-1"] });
    expect(fake.calls).toContainEqual({ table: "hire_orders", method: "eq", args: ["status", "issued"] });
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

describe("sanitizeSearchTerm", () => {
  it("returns '' for undefined/blank", () => {
    expect(sanitizeSearchTerm(undefined)).toBe("");
    expect(sanitizeSearchTerm("   ")).toBe("");
  });

  it("strips wildcards and PostgREST grouping/quoting metacharacters", () => {
    expect(sanitizeSearchTerm('%*(),"\\')).toBe("");
    expect(sanitizeSearchTerm('a)b(c,d"e%f*g')).toBe("abcdefg");
  });

  it("preserves ordinary order-number / name characters", () => {
    expect(sanitizeSearchTerm("HO-2026-0201-1")).toBe("HO-2026-0201-1");
    expect(sanitizeSearchTerm("  Cleo Nile  ")).toBe("Cleo Nile");
  });
});
