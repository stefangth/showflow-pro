import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { fetchPublicSheetCsv } from "./remoteSheet";

const URL = "https://docs.google.com/spreadsheets/d/ABC/export?format=csv";

describe("fetchPublicSheetCsv", () => {
  it("invokes fetch-remote-sheet with org_id + url and returns the csv", async () => {
    const fake = createFakeSupabase({ "fn:fetch-remote-sheet": { data: { csv: "name,email\nAda,ada@x.com" }, error: null } });
    const csv = await fetchPublicSheetCsv(fake as never, URL, "org-1");
    expect(csv).toBe("name,email\nAda,ada@x.com");
    expect(fake.calls).toContainEqual({ table: "fn:fetch-remote-sheet", method: "invoke", args: [{ org_id: "org-1", url: URL }] });
  });

  it("throws on an error payload", async () => {
    const fake = createFakeSupabase({ "fn:fetch-remote-sheet": { data: { error: "nope" }, error: null } });
    await expect(fetchPublicSheetCsv(fake as never, URL, "org-1")).rejects.toBeTruthy();
  });

  it("throws when the invoke itself errors", async () => {
    const fake = createFakeSupabase({ "fn:fetch-remote-sheet": { data: null, error: { message: "boom" } } });
    await expect(fetchPublicSheetCsv(fake as never, URL, "org-1")).rejects.toBeTruthy();
  });
});
