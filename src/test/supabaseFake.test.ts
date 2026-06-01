import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "./supabaseFake";

describe("createFakeSupabase", () => {
  it("resolves a seeded table result when awaited", async () => {
    const fake = createFakeSupabase({ artists: { data: [{ id: "a1" }], error: null } });
    const res = await fake.from("artists").select("*").eq("status", "active");
    expect(res).toEqual({ data: [{ id: "a1" }], error: null });
  });

  it("resolves maybeSingle to the seeded result", async () => {
    const fake = createFakeSupabase({ artists: { data: { id: "a1" }, error: null } });
    const res = await fake.from("artists").select("*").eq("user_id", "u1").maybeSingle();
    expect(res).toEqual({ data: { id: "a1" }, error: null });
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
    expect(await fake.from("whatever").select("*")).toEqual({ data: [], error: null });
  });

  it("resolves rpc() to a seeded rpc result and records it", async () => {
    const fake = createFakeSupabase({ "rpc:my_fn": { data: 7, error: null } });
    expect(await fake.rpc("my_fn", { x: 1 })).toEqual({ data: 7, error: null });
    expect(fake.calls).toContainEqual({ table: "rpc:my_fn", method: "rpc", args: [{ x: 1 }] });
  });
});
