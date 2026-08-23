import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchCastProductionFees, upsertCastProductionFee, deleteCastProductionFee } from "./castProductionFees";

describe("castProductionFees data-access", () => {
  it("fetchCastProductionFees selects rows for the org", async () => {
    const rows = [
      { id: "f1", cast_id: "cast-1", show_id: "show-1", fee_amount: 500, currency: "EUR", fee_basis: "per_date" },
    ];
    const fake = createFakeSupabase({ cast_production_fees: { data: rows, error: null } });
    const res = await fetchCastProductionFees(fake as never, "org-1");
    expect(res).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "cast_production_fees", method: "eq", args: ["org_id", "org-1"] });
  });

  it("fetchCastProductionFees throws on error", async () => {
    const fake = createFakeSupabase({ cast_production_fees: { data: null, error: { message: "nope" } } });
    await expect(fetchCastProductionFees(fake as never, "org-1")).rejects.toMatchObject({ message: "nope" });
  });

  it("upsertCastProductionFee upserts on the (cast_id,show_id) conflict target, including org_id (types require it; the DB trigger re-derives it authoritatively on insert)", async () => {
    const fake = createFakeSupabase({ cast_production_fees: { data: null, error: null } });
    await upsertCastProductionFee(fake as never, {
      orgId: "org-1", castId: "cast-1", showId: "show-1", feeAmount: 500, currency: "EUR", feeBasis: "per_date",
    });
    expect(fake.calls).toContainEqual({
      table: "cast_production_fees",
      method: "upsert",
      args: [
        { org_id: "org-1", cast_id: "cast-1", show_id: "show-1", fee_amount: 500, currency: "EUR", fee_basis: "per_date" },
        { onConflict: "cast_id,show_id" },
      ],
    });
  });

  it("upsertCastProductionFee throws on error", async () => {
    const fake = createFakeSupabase({ cast_production_fees: { data: null, error: { message: "nope" } } });
    await expect(upsertCastProductionFee(fake as never, {
      orgId: "org-1", castId: "cast-1", showId: "show-1", feeAmount: null, currency: "EUR", feeBasis: "total",
    })).rejects.toMatchObject({ message: "nope" });
  });

  it("deleteCastProductionFee deletes by id", async () => {
    const fake = createFakeSupabase({ cast_production_fees: { data: null, error: null } });
    await deleteCastProductionFee(fake as never, "f1");
    expect(fake.calls).toContainEqual({ table: "cast_production_fees", method: "delete", args: [] });
    expect(fake.calls).toContainEqual({ table: "cast_production_fees", method: "eq", args: ["id", "f1"] });
  });

  it("deleteCastProductionFee throws on error", async () => {
    const fake = createFakeSupabase({ cast_production_fees: { data: null, error: { message: "nope" } } });
    await expect(deleteCastProductionFee(fake as never, "f1")).rejects.toMatchObject({ message: "nope" });
  });
});
