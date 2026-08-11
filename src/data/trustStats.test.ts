import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { fetchOrgDataStats } from "./trustStats";

const ORG = "org-1";

describe("fetchOrgDataStats", () => {
  it("returns a head count per holding, scoped to the org", async () => {
    const fake = createFakeSupabase({
      bookings: { count: 1284 },
      artists: { count: 96 },
      shows: { count: 14 },
    });

    const stats = await fetchOrgDataStats(asSupabase(fake), ORG);

    expect(stats).toEqual({ bookings: 1284, artists: 96, productions: 14 });
  });

  it("filters every count by org_id rather than leaning on RLS alone", async () => {
    const fake = createFakeSupabase({
      bookings: { count: 1 },
      artists: { count: 1 },
      shows: { count: 1 },
    });

    await fetchOrgDataStats(asSupabase(fake), ORG);

    for (const table of ["bookings", "artists", "shows"]) {
      const eqCall = fake.calls.find((c) => c.table === table && c.method === "eq");
      expect(eqCall?.args, `${table} was not org-filtered`).toEqual(["org_id", ORG]);
    }
  });

  it("asks for a head count so no rows cross the wire", async () => {
    const fake = createFakeSupabase({
      bookings: { count: 0 },
      artists: { count: 0 },
      shows: { count: 0 },
    });

    await fetchOrgDataStats(asSupabase(fake), ORG);

    const selects = fake.calls.filter((c) => c.method === "select");
    expect(selects).toHaveLength(3);
    for (const call of selects) {
      expect(call.args[1]).toEqual({ count: "exact", head: true });
    }
  });

  it("reads a genuine zero as zero rather than falling back", async () => {
    const fake = createFakeSupabase({
      bookings: { count: 0 },
      artists: { count: 0 },
      shows: { count: 0 },
    });

    // A workspace with nothing in it must report 0, not a dash — the tile is a
    // statement about holdings, and "we hold nothing" is a real answer.
    await expect(fetchOrgDataStats(asSupabase(fake), ORG)).resolves.toEqual({
      bookings: 0,
      artists: 0,
      productions: 0,
    });
  });

  it("surfaces a failed count instead of reporting it as zero", async () => {
    const fake = createFakeSupabase({
      bookings: { error: { message: "permission denied" } },
      artists: { count: 96 },
      shows: { count: 14 },
    });

    await expect(fetchOrgDataStats(asSupabase(fake), ORG)).rejects.toThrow(/permission denied/);
  });

  it("treats a null count as a failure, not a zero", async () => {
    // PostgREST returns count: null when the count could not be computed.
    // Rendering that as "0 bookings" would be a false statement about the org.
    const fake = createFakeSupabase({
      bookings: { count: null },
      artists: { count: 96 },
      shows: { count: 14 },
    });

    await expect(fetchOrgDataStats(asSupabase(fake), ORG)).rejects.toThrow(/count unavailable/i);
  });
});
