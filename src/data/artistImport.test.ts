import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { bulkImportArtists } from "./artistImport";

describe("bulkImportArtists", () => {
  it("calls the bulk_import_artists rpc and returns per-row results", async () => {
    const rows = [{ index: 0, name: "Ada", email: "ada@x.com", phone: null, bio: null }];
    const fake = createFakeSupabase({ "rpc:bulk_import_artists": { data: [{ index: 0, status: "created", artist_id: "a1" }], error: null } });
    const res = await bulkImportArtists(fake as never, { orgId: "org-1", rows });
    expect(res).toEqual([{ index: 0, status: "created", artist_id: "a1" }]);
    expect(fake.calls).toContainEqual({ table: "rpc:bulk_import_artists", method: "rpc", args: [{ p_org: "org-1", p_rows: rows }] });
  });

  it("returns [] when the rpc yields null", async () => {
    const fake = createFakeSupabase({ "rpc:bulk_import_artists": { data: null, error: null } });
    expect(await bulkImportArtists(fake as never, { orgId: "org-1", rows: [] })).toEqual([]);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:bulk_import_artists": { data: null, error: { message: "boom" } } });
    await expect(bulkImportArtists(fake as never, { orgId: "org-1", rows: [] })).rejects.toBeTruthy();
  });
});
