import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { asSupabase } from "@/test/castHelpers";
import { setMembership, linkArtist, fetchPlatformUsers } from "./platformUsers";

describe("platformUsers data layer", () => {
  it("setMembership calls the platform RPC with the right params", async () => {
    const fake = createFakeSupabase({ "rpc:platform_set_membership": { data: null, error: null } });
    await setMembership(asSupabase(fake), { orgId: "o1", userId: "u1", role: "producer", action: "add" });
    expect(fake.calls).toContainEqual({ table: "rpc:platform_set_membership", method: "rpc", args: [{ p_org: "o1", p_user: "u1", p_role: "producer", p_action: "add" }] });
  });
  it("linkArtist passes null artistId for unlink", async () => {
    const fake = createFakeSupabase({ "rpc:platform_link_artist": { data: null, error: null } });
    await linkArtist(asSupabase(fake), { orgId: "o1", userId: "u1", artistId: null });
    expect(fake.calls).toContainEqual({ table: "rpc:platform_link_artist", method: "rpc", args: [{ p_org: "o1", p_user: "u1", p_artist_id: null }] });
  });
  it("fetchPlatformUsers reads the edge-function payload", async () => {
    const fake = createFakeSupabase({ "fn:platform-list-users": { data: { users: [{ id: "u1" }] }, error: null } });
    const result = await fetchPlatformUsers(asSupabase(fake));
    expect(result.users[0].id).toBe("u1");
    expect(result.truncated).toBe(false);
  });

  it("fetchPlatformUsers surfaces the truncated flag instead of dropping it", async () => {
    const fake = createFakeSupabase({ "fn:platform-list-users": { data: { users: [{ id: "u1" }], truncated: true }, error: null } });
    const result = await fetchPlatformUsers(asSupabase(fake));
    expect(result.truncated).toBe(true);
  });
});
