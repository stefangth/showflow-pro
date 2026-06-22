import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { exportMyData, deleteMyAccount } from "./account";

describe("exportMyData", () => {
  it("calls export_my_data and returns the document", async () => {
    const doc = { schema_version: 1, account: { display_name: "Ada" } };
    const fake = createFakeSupabase({ "rpc:export_my_data": { data: doc, error: null } });
    expect(await exportMyData(fake as never)).toEqual(doc);
    expect(fake.calls).toContainEqual({ table: "rpc:export_my_data", method: "rpc", args: [undefined] });
  });
});

describe("deleteMyAccount", () => {
  it("invokes the delete-my-account function", async () => {
    const fake = createFakeSupabase({ "fn:delete-my-account": { data: { success: true }, error: null } });
    await deleteMyAccount(fake as never);
    expect(fake.calls).toContainEqual({ table: "fn:delete-my-account", method: "invoke", args: [{}] });
  });

  it("throws a friendly message on the last-admin block", async () => {
    const fake = createFakeSupabase({
      "fn:delete-my-account": { data: { error: "last_admin", org_name: "Acme" }, error: null },
    });
    await expect(deleteMyAccount(fake as never)).rejects.toThrow(/last admin of Acme/i);
  });
});
