import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { createInvitation, fetchOrgInvitations, revokeInvitation, claimMyInvitations, acceptInvitation, acceptInviteUrl, resendInvitation, inviteArtistToApp, fetchPendingArtistInvitations } from "./invitations";

const INV = { id: "inv1", org_id: "o1", email: "x@y.com", role: "producer", status: "pending", token: "tok123", expires_at: "2099-01-01" };

describe("createInvitation", () => {
  it("invokes create-invitation with org/email/role and returns the invitation", async () => {
    const fake = createFakeSupabase({ "fn:create-invitation": { data: { invitation: INV }, error: null } });
    const result = await createInvitation(fake as never, { orgId: "o1", email: "x@y.com", role: "producer" });
    expect(result).toEqual(INV);
    expect(fake.calls).toContainEqual({
      table: "fn:create-invitation",
      method: "invoke",
      args: [{ org_id: "o1", email: "x@y.com", role: "producer", app_origin: window.location.origin }],
    });
  });

  it("throws when the function returns an error payload", async () => {
    const fake = createFakeSupabase({ "fn:create-invitation": { data: { error: "nope" }, error: null } });
    await expect(createInvitation(fake as never, { orgId: "o1", email: "x@y.com", role: "artist" })).rejects.toBeTruthy();
  });

  it("throws when the invoke itself errors", async () => {
    const fake = createFakeSupabase({ "fn:create-invitation": { data: null, error: { message: "boom" } } });
    await expect(createInvitation(fake as never, { orgId: "o1", email: "x@y.com", role: "artist" })).rejects.toBeTruthy();
  });
});

describe("fetchOrgInvitations", () => {
  it("queries org_invitations by org_id, newest first", async () => {
    const rows = [INV];
    const fake = createFakeSupabase({ org_invitations: { data: rows, error: null } });
    const result = await fetchOrgInvitations(fake as never, "o1");
    expect(result).toEqual(rows);
    expect(fake.calls).toContainEqual({ table: "org_invitations", method: "eq", args: ["org_id", "o1"] });
    expect(fake.calls).toContainEqual({ table: "org_invitations", method: "order", args: ["created_at", { ascending: false }] });
  });

  it("returns [] when there are no invitations", async () => {
    const fake = createFakeSupabase({ org_invitations: { data: [], error: null } });
    expect(await fetchOrgInvitations(fake as never, "o1")).toEqual([]);
  });
});

describe("revokeInvitation", () => {
  it("calls the revoke_invitation RPC with the id", async () => {
    const fake = createFakeSupabase({ "rpc:revoke_invitation": { data: null, error: null } });
    await revokeInvitation(fake as never, "inv1");
    expect(fake.calls).toContainEqual({ table: "rpc:revoke_invitation", method: "rpc", args: [{ p_id: "inv1" }] });
  });
  it("throws on error", async () => {
    const fake = createFakeSupabase({ "rpc:revoke_invitation": { data: null, error: { message: "boom" } } });
    await expect(revokeInvitation(fake as never, "inv1")).rejects.toBeTruthy();
  });
});

describe("claimMyInvitations", () => {
  it("calls claim_my_invitations and returns the count", async () => {
    const fake = createFakeSupabase({ "rpc:claim_my_invitations": { data: 2, error: null } });
    const n = await claimMyInvitations(fake as never);
    expect(n).toBe(2);
    expect(fake.calls).toContainEqual({ table: "rpc:claim_my_invitations", method: "rpc", args: [undefined] });
  });
  it("returns 0 when data is null", async () => {
    const fake = createFakeSupabase({ "rpc:claim_my_invitations": { data: null, error: null } });
    expect(await claimMyInvitations(fake as never)).toBe(0);
  });
});

describe("acceptInvitation", () => {
  it("calls the accept_invitation rpc and returns { orgId, artistLinked }", async () => {
    const fake = createFakeSupabase({ "rpc:accept_invitation": { data: { org_id: "org-9", artist_linked: true }, error: null } });
    const res = await acceptInvitation(fake as never, "tok123");
    expect(res).toEqual({ orgId: "org-9", artistLinked: true });
    expect(fake.calls).toContainEqual({ table: "rpc:accept_invitation", method: "rpc", args: [{ p_token: "tok123" }] });
  });

  it("reports artistLinked=false when the deterministic link was skipped", async () => {
    const fake = createFakeSupabase({ "rpc:accept_invitation": { data: { org_id: "o1", artist_linked: false }, error: null } });
    expect((await acceptInvitation(fake as never, "t")).artistLinked).toBe(false);
  });

  it("throws on error (e.g. expired)", async () => {
    const fake = createFakeSupabase({ "rpc:accept_invitation": { data: null, error: { message: "Invalid or expired invitation" } } });
    await expect(acceptInvitation(fake as never, "tok123")).rejects.toBeTruthy();
  });
});

describe("acceptInviteUrl", () => {
  it("builds an /accept-invite link carrying the token", () => {
    expect(acceptInviteUrl("abc")).toContain("/accept-invite?token=abc");
  });
});

describe("resendInvitation", () => {
  it("invokes resend-invitation with invitation_id and app_origin", async () => {
    const fake = createFakeSupabase({ "fn:resend-invitation": { data: { ok: true }, error: null } });
    await resendInvitation(fake as never, "inv-9");
    expect(fake.calls).toContainEqual({
      table: "fn:resend-invitation",
      method: "invoke",
      args: [{ invitation_id: "inv-9", app_origin: window.location.origin }],
    });
  });

  it("throws when the invoke errors", async () => {
    const fake = createFakeSupabase({ "fn:resend-invitation": { data: null, error: { message: "boom" } } });
    await expect(resendInvitation(fake as never, "inv-9")).rejects.toBeTruthy();
  });

  it("surfaces the server's error sentence, not the opaque invoke message", async () => {
    // supabase-js throws "Edge Function returned a non-2xx status code" and hides the body
    // on error.context (see src/lib/edgeErrors.ts). The 422/502 sentences resend-invitation
    // returns are written for the admin reading the toast, so they must survive the throw.
    const serverError = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: new Response(
        JSON.stringify({ error: "That address has unsubscribed or previously bounced, so ShowFlow will not email it. Ask them to check spam, or invite a different address." }),
        { status: 422 },
      ),
    });
    const fake = createFakeSupabase({ "fn:resend-invitation": { data: null, error: serverError } });
    await expect(resendInvitation(fake as never, "inv-9")).rejects.toThrow(
      "That address has unsubscribed or previously bounced, so ShowFlow will not email it. Ask them to check spam, or invite a different address.",
    );
  });
});

describe("createInvitation error bodies", () => {
  // Same contract as resendInvitation below-the-fold: create-invitation returns its
  // refusals (duplicate pending invite, existing member, invalid role) as non-2xx JSON
  // bodies whose sentences are written for the admin's toast, and supabase-js hides
  // them behind the opaque invoke error. The husk must not be what the admin reads.
  it("surfaces the server's error sentence, not the opaque invoke message", async () => {
    const serverError = Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: new Response(
        JSON.stringify({ error: "A pending invitation for this email already exists." }),
        { status: 409 },
      ),
    });
    const fake = createFakeSupabase({ "fn:create-invitation": { data: null, error: serverError } });
    await expect(
      createInvitation(fake as never, { orgId: "org-1", email: "a@example.com", role: "artist" }),
    ).rejects.toThrow("A pending invitation for this email already exists.");
  });
});

describe("createInvitation with artistId", () => {
  it("forwards artist_id in the function body when provided", async () => {
    const fake = createFakeSupabase({ "fn:create-invitation": { data: { invitation: INV }, error: null } });
    await createInvitation(fake as never, { orgId: "o1", email: "x@y.com", role: "artist", artistId: "art-1" });
    expect(fake.calls).toContainEqual({
      table: "fn:create-invitation",
      method: "invoke",
      args: [{ org_id: "o1", email: "x@y.com", role: "artist", app_origin: window.location.origin, artist_id: "art-1" }],
    });
  });
});

describe("inviteArtistToApp", () => {
  it("calls create-invitation with role artist + the artist_id", async () => {
    const fake = createFakeSupabase({ "fn:create-invitation": { data: { invitation: INV }, error: null } });
    const result = await inviteArtistToApp(fake as never, { orgId: "o1", artistId: "art-1", email: "x@y.com" });
    expect(result).toEqual(INV);
    expect(fake.calls).toContainEqual({
      table: "fn:create-invitation",
      method: "invoke",
      args: [{ org_id: "o1", email: "x@y.com", role: "artist", app_origin: window.location.origin, artist_id: "art-1" }],
    });
  });
});

describe("fetchPendingArtistInvitations", () => {
  it("queries org_invitations by org_id, status pending, role artist, and maps artist_id -> artistId", async () => {
    const rows = [
      { id: "inv1", artist_id: "art-1", email: "a1@x.com" },
      { id: "inv2", artist_id: null, email: "a2@x.com" },
    ];
    const fake = createFakeSupabase({ org_invitations: { data: rows, error: null } });
    const result = await fetchPendingArtistInvitations(fake as never, "o1");
    expect(result).toEqual([
      { id: "inv1", artistId: "art-1", email: "a1@x.com" },
      { id: "inv2", artistId: null, email: "a2@x.com" },
    ]);
    expect(fake.calls).toContainEqual({ table: "org_invitations", method: "eq", args: ["org_id", "o1"] });
    expect(fake.calls).toContainEqual({ table: "org_invitations", method: "eq", args: ["status", "pending"] });
    expect(fake.calls).toContainEqual({ table: "org_invitations", method: "eq", args: ["role", "artist"] });
  });

  it("returns [] when there are no pending artist invitations", async () => {
    const fake = createFakeSupabase({ org_invitations: { data: [], error: null } });
    expect(await fetchPendingArtistInvitations(fake as never, "o1")).toEqual([]);
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ org_invitations: { data: null, error: { message: "boom" } } });
    await expect(fetchPendingArtistInvitations(fake as never, "o1")).rejects.toBeTruthy();
  });
});
