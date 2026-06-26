import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "./supabaseFake";

describe("createFakeSupabase", () => {
  it("resolves a seeded table result when awaited", async () => {
    const fake = createFakeSupabase({ artists: { data: [{ id: "a1" }], error: null } });
    const res = await fake.from("artists").select("*").eq("status", "active");
    expect(res).toEqual({ data: [{ id: "a1" }], error: null, count: null });
  });

  it("resolves maybeSingle to the seeded result", async () => {
    const fake = createFakeSupabase({ artists: { data: { id: "a1" }, error: null } });
    const res = await fake.from("artists").select("*").eq("user_id", "u1").maybeSingle();
    expect(res).toEqual({ data: { id: "a1" }, error: null, count: null });
  });

  it("records the table, methods, and arguments used", async () => {
    const fake = createFakeSupabase({ artists: { data: null, error: null } });
    await fake.from("artists").select("id").eq("user_id", "u1").maybeSingle();
    expect(fake.calls).toEqual([
      { table: "artists", method: "from", args: [] },
      { table: "artists", method: "select", args: ["id"] },
      { table: "artists", method: "eq", args: ["user_id", "u1"] },
      { table: "artists", method: "maybeSingle", args: [] },
    ]);
  });

  it("defaults unseeded tables to an empty result", async () => {
    const fake = createFakeSupabase({});
    expect(await fake.from("whatever").select("*")).toEqual({ data: [], error: null, count: null });
  });

  it("resolves rpc() to a seeded rpc result and records it", async () => {
    const fake = createFakeSupabase({ "rpc:my_fn": { data: 7, error: null } });
    expect(await fake.rpc("my_fn", { x: 1 })).toEqual({ data: 7, error: null });
    expect(fake.calls).toContainEqual({ table: "rpc:my_fn", method: "rpc", args: [{ x: 1 }] });
  });
});

describe("createFakeSupabase — match-based seeding", () => {
  it("returns the array entry whose `when` matches recorded eq() args", async () => {
    const fake = createFakeSupabase({
      app_settings: [
        { when: { key: "a" }, data: { value: 1 }, error: null },
        { when: { key: "b" }, data: { value: 2 }, error: null },
      ],
    });
    const a = await fake.from("app_settings").select("value").eq("key", "a").maybeSingle();
    const b = await fake.from("app_settings").select("value").eq("key", "b").maybeSingle();
    expect(a).toEqual({ data: { value: 1 }, error: null, count: null });
    expect(b).toEqual({ data: { value: 2 }, error: null, count: null });
  });

  it("falls back to a `when`-less default entry", async () => {
    const fake = createFakeSupabase({ bookings: [{ when: { status: "suggested" }, data: [1], error: null }, { data: [], error: null }] });
    expect(await fake.from("bookings").select("*").eq("status", "suggested")).toEqual({ data: [1], error: null, count: null });
    expect(await fake.from("bookings").select("*").eq("status", "confirmed")).toEqual({ data: [], error: null, count: null });
  });

  it("single-object seed still works (backward compatible)", async () => {
    const fake = createFakeSupabase({ artists: { data: { id: "a1" }, error: null } });
    expect(await fake.from("artists").select("*").eq("id", "a1").maybeSingle()).toEqual({ data: { id: "a1" }, error: null, count: null });
  });
});

describe("createFakeSupabase — in() membership filtering", () => {
  it("returns only rows whose column value is in the allowed set", async () => {
    const fake = createFakeSupabase({
      user_roles: {
        data: [
          { user_id: "u1", role: "artist" },
          { user_id: "u2", role: "admin" },
          { user_id: "u3", role: "producer" },
        ],
        error: null,
      },
    });
    const res = await fake.from("user_roles").select("*").in("role", ["admin", "producer"]);
    expect(res).toEqual({
      data: [
        { user_id: "u2", role: "admin" },
        { user_id: "u3", role: "producer" },
      ],
      error: null,
      count: null,
    });
  });

  it("returns null when no row matches the in() set", async () => {
    const fake = createFakeSupabase({
      user_roles: { data: [{ user_id: "u1", role: "artist" }], error: null },
    });
    const res = await fake.from("user_roles").select("*").in("role", ["admin", "producer"]);
    expect(res).toEqual({ data: null, error: null, count: null });
  });
});
