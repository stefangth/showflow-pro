import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchDatesReadyForHireOrder } from "./hireOrders";

describe("fetchDatesReadyForHireOrder", () => {
  it("returns fully-filled dates without an active order, and the active order per covered date", async () => {
    const client = createFakeSupabase({
      // The query filters to status='fully_filled' server-side; the `when` seed
      // returns exactly those rows (sd5 'open' is excluded by the DB, not here).
      show_dates: [
        {
          when: { org_id: "org1", status: "fully_filled" },
          data: [{ id: "sd1" }, { id: "sd2" }, { id: "sd3" }, { id: "sd4" }],
        },
      ],
      hire_orders: {
        data: [
          { id: "ho1", org_id: "org1", status: "issued", show_date_id: "sd1" }, // covers sd1
          { id: "ho2", org_id: "org1", status: "void", show_date_id: "sd2" }, // void => sd2 free
          { id: "ho3", org_id: "org1", status: "draft", show_date_id: null }, // aggregate covering sd3
        ],
        error: null,
      },
      hire_order_dates: {
        data: [{ hire_order_id: "ho3", show_date_id: "sd3", org_id: "org1" }],
        error: null,
      },
    }) as unknown as SupabaseClient<Database>;

    const result = await fetchDatesReadyForHireOrder(client, "org1");
    expect([...result.readyIds].sort()).toEqual(["sd2", "sd4"]);
    expect(result.orderByDate.sd1).toEqual({ id: "ho1", status: "issued" });
    expect(result.orderByDate.sd3).toEqual({ id: "ho3", status: "draft" });
    // A void order does not cover its date.
    expect(result.orderByDate.sd2).toBeUndefined();
  });

  it("returns empty for a null org without querying", async () => {
    const client = createFakeSupabase({}) as unknown as SupabaseClient<Database>;
    expect(await fetchDatesReadyForHireOrder(client, null)).toEqual({
      readyIds: [],
      orderByDate: {},
    });
  });
});
