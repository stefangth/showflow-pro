import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { signHireOrder } from "./hireOrders";

describe("signHireOrder", () => {
  it("invokes generate-hire-orders with a sign payload", async () => {
    const fake = createFakeSupabase({ "fn:generate-hire-orders": { data: { countersigned: true }, error: null } });
    await signHireOrder(fake as never, { orgId: "o1", orderId: "ho1", method: "typed", typedName: "Ann Lee", consent: true });
    expect(fake.calls).toContainEqual({
      table: "fn:generate-hire-orders",
      method: "invoke",
      args: [{ action: "sign", org_id: "o1", order_id: "ho1", method: "typed", typed_name: "Ann Lee", signature_png: undefined, consent: true }],
    });
  });
});
