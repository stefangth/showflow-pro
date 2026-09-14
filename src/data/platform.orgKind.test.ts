import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { fetchAllOrgs, provisionOrg } from "./platform";

describe("platform data: org_kind", () => {
  it("fetchAllOrgs selects org_kind", async () => {
    const fake = createFakeSupabase({ organizations: { data: [], error: null } });
    await fetchAllOrgs(asSupabase(fake));
    const select = fake.calls.find((c) => c.table === "organizations" && c.method === "select");
    expect(String(select?.args[0])).toContain("org_kind");
  });

  it("provisionOrg forwards org_kind when given and omits it otherwise", async () => {
    const invoked: unknown[] = [];
    const client = {
      functions: { invoke: (_n: string, opts: { body: unknown }) => { invoked.push(opts.body); return Promise.resolve({ data: { org_id: "o9" }, error: null }); } },
    };
    await provisionOrg(asSupabase(client), { name: "A", slug: "a", adminEmail: "a@x.com", appOrigin: "https://app", orgKind: "staffing" });
    expect(invoked[0]).toMatchObject({ org_kind: "staffing" });
    await provisionOrg(asSupabase(client), { name: "A", slug: "a", adminEmail: "a@x.com", appOrigin: "https://app" });
    expect(invoked[1]).not.toHaveProperty("org_kind");
  });
});
