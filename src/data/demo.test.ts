import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import {
  createDemoOrg,
  resetDemoOrg,
  wipeDemoOrg,
  fetchCapturedSends,
  fetchDemoState,
  updateDemoState,
  runCue,
} from "@/data/demo";

describe("resetDemoOrg", () => {
  it("invokes demo-ops with action reset, org_id, and volume", async () => {
    const fake = createFakeSupabase({
      "fn:demo-ops": { data: { ok: true }, error: null },
    });
    await resetDemoOrg(fake as never, { orgId: "o1", volume: "full" });
    expect(fake.calls).toContainEqual({
      table: "fn:demo-ops",
      method: "invoke",
      // resetState defaults to false (the rail volume toggle keeps the rep's place).
      args: [{ action: "reset", org_id: "o1", volume: "full", reset_state: false }],
    });
  });

  it("passes reset_state true for a new-prospect restart", async () => {
    const fake = createFakeSupabase({
      "fn:demo-ops": { data: { ok: true }, error: null },
    });
    await resetDemoOrg(fake as never, { orgId: "o1", volume: "small", resetState: true });
    expect(fake.calls).toContainEqual({
      table: "fn:demo-ops",
      method: "invoke",
      args: [{ action: "reset", org_id: "o1", volume: "small", reset_state: true }],
    });
  });

  it("throws when demo-ops returns a payload error", async () => {
    const fake = createFakeSupabase({
      "fn:demo-ops": { data: { error: "not_a_demo_org" }, error: null },
    });
    await expect(resetDemoOrg(fake as never, { orgId: "o1", volume: "small" })).rejects.toThrow(
      "not_a_demo_org",
    );
  });

  it("throws on a transport error", async () => {
    const fake = createFakeSupabase({
      "fn:demo-ops": { data: null, error: { message: "network" } },
    });
    await expect(resetDemoOrg(fake as never, { orgId: "o1", volume: "small" })).rejects.toBeTruthy();
  });
});

describe("wipeDemoOrg", () => {
  it("invokes demo-ops with action wipe and no volume", async () => {
    const fake = createFakeSupabase({
      "fn:demo-ops": { data: { ok: true }, error: null },
    });
    await wipeDemoOrg(fake as never, { orgId: "o1" });
    expect(fake.calls).toContainEqual({
      table: "fn:demo-ops",
      method: "invoke",
      args: [{ action: "wipe", org_id: "o1" }],
    });
  });
});

describe("createDemoOrg", () => {
  it("provisions the org first, then flags and seeds it via demo-ops", async () => {
    const fake = createFakeSupabase({
      "fn:provision-org": { data: { org_id: "org-new" }, error: null },
      "fn:demo-ops": { data: { ok: true }, error: null },
    });
    const orgId = await createDemoOrg(fake as never, {
      name: "Demo Org",
      slug: "demo-org",
      adminEmail: "admin@example.com",
      appOrigin: "https://app.showflow.pro",
      volume: "full",
    });
    expect(orgId).toBe("org-new");
    expect(fake.calls).toContainEqual({
      table: "fn:provision-org",
      method: "invoke",
      args: [
        {
          name: "Demo Org",
          slug: "demo-org",
          admin_email: "admin@example.com",
          role: "admin",
          app_origin: "https://app.showflow.pro",
          entitlements: { hire_orders: true, booking_flow: true },
        },
      ],
    });
    expect(fake.calls).toContainEqual({
      table: "fn:demo-ops",
      method: "invoke",
      args: [{ action: "flag_and_seed", org_id: "org-new", volume: "full" }],
    });
  });

  it("best-effort deletes the just-provisioned org and rethrows if flag_and_seed fails", async () => {
    const fake = createFakeSupabase({
      "fn:provision-org": { data: { org_id: "org-new" }, error: null },
      "fn:demo-ops": { data: { error: "seed failed" }, error: null },
      "rpc:delete_org": { data: null, error: null },
    });
    await expect(
      createDemoOrg(fake as never, {
        name: "Demo Org",
        slug: "demo-org",
        adminEmail: "admin@example.com",
        appOrigin: "https://app.showflow.pro",
        volume: "full",
      }),
    ).rejects.toThrow("seed failed");
    // The half-baked org is cleaned up.
    expect(fake.calls).toContainEqual({
      table: "rpc:delete_org",
      method: "rpc",
      args: [{ p_org: "org-new" }],
    });
  });
});

describe("fetchCapturedSends", () => {
  it("reads demo_captured_sends for the org, newest-first", async () => {
    const fake = createFakeSupabase({
      demo_captured_sends: {
        data: [{ id: "c1", org_id: "o1", kind: "email", subject: "Hi" }],
        error: null,
      },
    });
    const rows = await fetchCapturedSends(fake as never, "o1");
    expect(rows[0].subject).toBe("Hi");
    expect(fake.calls).toContainEqual({ table: "demo_captured_sends", method: "eq", args: ["org_id", "o1"] });
    expect(fake.calls).toContainEqual({
      table: "demo_captured_sends",
      method: "order",
      args: ["created_at", { ascending: false }],
    });
  });

  it("returns [] when there are no rows", async () => {
    const fake = createFakeSupabase({ demo_captured_sends: { data: null, error: null } });
    expect(await fetchCapturedSends(fake as never, "o1")).toEqual([]);
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ demo_captured_sends: { data: null, error: { message: "boom" } } });
    await expect(fetchCapturedSends(fake as never, "o1")).rejects.toBeTruthy();
  });
});

describe("fetchDemoState", () => {
  it("reads the demo_state row for the org", async () => {
    const fake = createFakeSupabase({
      demo_state: {
        data: {
          org_id: "o1",
          volume: "full",
          prospect_label: "Acme",
          sim_now: null,
          current_scene_id: "scene-1",
          script_id: "script-1",
          updated_at: "2026-08-17T00:00:00Z",
        },
        error: null,
      },
    });
    const row = await fetchDemoState(fake as never, "o1");
    expect(row?.prospect_label).toBe("Acme");
    expect(fake.calls).toContainEqual({ table: "demo_state", method: "eq", args: ["org_id", "o1"] });
    expect(fake.calls).toContainEqual({ table: "demo_state", method: "maybeSingle", args: [] });
  });

  it("returns null when there is no row", async () => {
    const fake = createFakeSupabase({ demo_state: { data: null, error: null } });
    expect(await fetchDemoState(fake as never, "o1")).toBeNull();
  });

  it("throws on a supabase error", async () => {
    const fake = createFakeSupabase({ demo_state: { data: null, error: { message: "boom" } } });
    await expect(fetchDemoState(fake as never, "o1")).rejects.toBeTruthy();
  });
});

describe("updateDemoState", () => {
  it("upserts demo_state with the patch and org_id, conflict target org_id", async () => {
    const fake = createFakeSupabase({ demo_state: { data: null, error: null } });
    await updateDemoState(fake as never, { orgId: "o1", patch: { volume: "small", prospect_label: "Acme" } });
    expect(fake.calls).toContainEqual({
      table: "demo_state",
      method: "upsert",
      args: [{ org_id: "o1", volume: "small", prospect_label: "Acme" }, { onConflict: "org_id" }],
    });
  });

  it("throws on upsert error", async () => {
    const fake = createFakeSupabase({ demo_state: { data: null, error: { message: "boom" } } });
    await expect(updateDemoState(fake as never, { orgId: "o1", patch: { volume: "full" } })).rejects.toBeTruthy();
  });
});

describe("runCue", () => {
  it("invokes demo-ops with action cue, org_id, and cue_id", async () => {
    const fake = createFakeSupabase({
      "fn:demo-ops": { data: { ok: true }, error: null },
    });
    await runCue(fake as never, { orgId: "o1", cueId: "cue-1" });
    expect(fake.calls).toContainEqual({
      table: "fn:demo-ops",
      method: "invoke",
      args: [{ action: "cue", org_id: "o1", cue_id: "cue-1" }],
    });
  });

  it("throws when demo-ops returns a payload error", async () => {
    const fake = createFakeSupabase({
      "fn:demo-ops": { data: { error: "no_cue" }, error: null },
    });
    await expect(runCue(fake as never, { orgId: "o1", cueId: "bad" })).rejects.toThrow("no_cue");
  });
});
