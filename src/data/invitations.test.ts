import { describe, it, expect } from "vitest";
import { createFakeSupabase } from "@/test/supabaseFake";
import { createInvitation, fetchOrgInvitations, revokeInvitation, acceptInvitation, acceptInviteUrl, resendInvitation } from "./invitations";

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
  it("updates status to revoked for the id", async () => {
    const fake = createFakeSupabase({ org_invitations: { data: null, error: null } });
    await revokeInvitation(fake as never, "inv1");
    expect(fake.calls).toContainEqual({ table: "org_invitations", method: "update", args: [{ status: "revoked" }] });
    expect(fake.calls).toContainEqual({ table: "org_invitations", method: "eq", args: ["id", "inv1"] });
  });

  it("throws on error", async () => {
    const fake = createFakeSupabase({ org_invitations: { data: null, error: { message: "boom" } } });
    await expect(revokeInvitation(fake as never, "inv1")).rejects.toBeTruthy();
  });
});

describe("acceptInvitation", () => {
  it("calls the accept_invitation rpc with the token and returns the org id", async () => {
    const fake = createFakeSupabase({ "rpc:accept_invitation": { data: "org-9", error: null } });
    const orgId = await acceptInvitation(fake as never, "tok123");
    expect(orgId).toBe("org-9");
    expect(fake.calls).toContainEqual({ table: "rpc:accept_invitation", method: "rpc", args: [{ p_token: "tok123" }] });
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
});
